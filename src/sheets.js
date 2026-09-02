/**
 * ชั้นที่คุยกับ Google Sheets API — ตัวแทนของ SpreadsheetApp ใน Apps Script เดิม
 *
 * ============================================================================
 * ทำไมเขียนใหม่แทนที่จะแปลงตรงๆ ทีละบรรทัด
 * ============================================================================
 * Apps Script รันอยู่ในเครื่องของ Google การเรียก sh.getRange().setValue()
 * ทีละช่องจึงเร็วพอจะยอมรับได้ แต่พอย้าย backend ออกมาข้างนอก
 * ทุกคำสั่งกลายเป็น HTTP request ข้ามอินเทอร์เน็ต ครั้งละ 100-300 ms
 * โค้ดเดิมบางฟังก์ชันแตะชีต 20-30 ครั้ง ถ้าแปลงตรงๆ จะช้ากว่าเดิมอีก
 *
 * ไฟล์นี้จึงทำงานแบบ "อ่านทีเดียว เขียนทีเดียว":
 *   - อ่าน: รวมทุกชีตที่ต้องใช้เป็น values:batchGet ครั้งเดียว
 *   - เขียน: เก็บงานเขียนไว้ในคิว แล้วส่งรวดเดียวตอนเรียก flush()
 * ผลคือ 1 request ของผู้ใช้ = คุยกับ Google แค่ 2 ครั้ง ไม่ว่างานจะซับซ้อนแค่ไหน
 * ============================================================================
 */

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

/** ใส่เครื่องหมายคำพูดรอบชื่อชีตให้ปลอดภัยสำหรับ A1 notation */
function quoteSheet(name) {
  return "'" + String(name).replace(/'/g, "''") + "'";
}

/** แปลงเลขคอลัมน์ (เริ่มที่ 1) เป็นตัวอักษร A, B, ..., AA */
export function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export class Spreadsheet {
  constructor(spreadsheetId, accessToken) {
    this.id = spreadsheetId;
    this.token = accessToken;

    this._meta = null;        // { ชื่อชีต -> {sheetId, rowCount, colCount} }
    this._values = new Map(); // ชื่อชีต -> อาร์เรย์ 2 มิติ (รวมแถวหัวตาราง)
    this._pendingValues = []; // คิวงานเขียนค่า

    // คิวงานแก้โครงสร้างแบ่งเป็น 2 กอง เพราะลำดับการส่งสำคัญมาก:
    //   _pendingGrowth  = งานที่ต้องทำ "ก่อน" เขียนค่า เช่นขยายจำนวนคอลัมน์
    //   _pendingShrink  = งานที่ต้องทำ "หลัง" เขียนค่า เช่นลบแถว (เพราะทำให้เลขแถวเลื่อน)
    // ถ้าส่งขยายคอลัมน์ทีหลัง การเขียนค่าลงคอลัมน์ใหม่จะถูกปฏิเสธทันที
    // ด้วยข้อความว่า "exceeds grid limits" และเนื่องจากการตรวจโครงสร้างชีต
    // ถูกเรียกตั้งแต่คำสั่งแรกที่หน้าเว็บติดต่อ server ความผิดพลาดตรงนี้
    // จะทำให้ "ทั้งระบบเปิดไม่ขึ้น" ไม่ใช่แค่ฟีเจอร์เดียวพัง
    this._pendingGrowth = [];
    this._pendingShrink = [];

    this._appends = new Map(); // ชื่อชีต -> อาร์เรย์ของแถวที่จะต่อท้าย
  }

  /* ------------------------------ พื้นฐาน HTTP ------------------------------ */

  async _req(path, init = {}) {
    const res = await fetch(API + '/' + this.id + path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + this.token,
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let msg = 'HTTP ' + res.status;
      try {
        const j = JSON.parse(body);
        if (j.error && j.error.message) msg = j.error.message;
      } catch { /* ใช้ข้อความเริ่มต้น */ }

      if (res.status === 403) {
        throw new Error(
          'ไม่มีสิทธิ์เข้าถึง Google Sheet — ตรวจว่าได้แชร์ไฟล์ให้อีเมลของ service account ' +
          'เป็น "ผู้แก้ไข" แล้วหรือยัง (' + msg + ')'
        );
      }
      if (res.status === 429) {
        throw new Error('เรียกใช้ Google Sheets ถี่เกินกำหนด กรุณารอสักครู่แล้วลองใหม่');
      }
      throw new Error('Google Sheets: ' + msg);
    }

    return res.json();
  }

  /* ------------------------------ โครงสร้างชีต ------------------------------ */

  /** อ่านรายชื่อชีตทั้งหมดพร้อมขนาด (แคชไว้ตลอด request) */
  async meta() {
    if (this._meta) return this._meta;
    const data = await this._req(
      '?fields=' + encodeURIComponent('sheets.properties(sheetId,title,gridProperties)')
    );
    this._meta = {};
    (data.sheets || []).forEach(s => {
      const p = s.properties;
      this._meta[p.title] = {
        sheetId: p.sheetId,
        rowCount: (p.gridProperties && p.gridProperties.rowCount) || 0,
        colCount: (p.gridProperties && p.gridProperties.columnCount) || 0
      };
    });
    return this._meta;
  }

  /** รายชื่อชีตทั้งหมด (แทน SS.getSheets().map(s => s.getName())) */
  async sheetNames() {
    return Object.keys(await this.meta());
  }

  async hasSheet(name) {
    const m = await this.meta();
    return Object.prototype.hasOwnProperty.call(m, name);
  }

  /* -------------------------------- การอ่าน -------------------------------- */

  /**
   * โหลดข้อมูลของชีตที่ระบุทั้งหมดในการเรียก Google ครั้งเดียว
   * ชีตที่โหลดไว้แล้วจะถูกข้าม และชีตที่ไม่มีอยู่จริงจะได้อาร์เรย์ว่าง
   */
  async load(...names) {
    const meta = await this.meta();
    const want = [...new Set(names.flat())].filter(
      n => n && !this._values.has(n) && Object.prototype.hasOwnProperty.call(meta, n)
    );

    // ชีตที่ไม่มีอยู่จริง ให้ถือว่าว่างเปล่า จะได้ไม่ต้องเช็ค null ทุกที่ที่เรียกใช้
    [...new Set(names.flat())].forEach(n => {
      if (n && !Object.prototype.hasOwnProperty.call(meta, n)) this._values.set(n, []);
    });

    if (want.length === 0) return;

    const qs = new URLSearchParams();
    want.forEach(n => qs.append('ranges', quoteSheet(n)));
    // อ่านค่าดิบเสมอ ดูคำอธิบายเหตุผลใน values.js
    qs.set('valueRenderOption', 'UNFORMATTED_VALUE');
    qs.set('dateTimeRenderOption', 'SERIAL_NUMBER');
    qs.set('majorDimension', 'ROWS');

    const data = await this._req('/values:batchGet?' + qs.toString());
    (data.valueRanges || []).forEach((vr, i) => {
      this._values.set(want[i], vr.values || []);
    });
  }

  /** อาร์เรย์ 2 มิติของชีต (ต้องเรียก load() มาก่อน) */
  values(name) {
    const v = this._values.get(name);
    if (!v) throw new Error('ยังไม่ได้โหลดข้อมูลชีต "' + name + '" (ลืมเรียก load)');
    return v;
  }

  /** แถวหัวตาราง */
  headers(name) {
    const v = this.values(name);
    return (v[0] || []).map(h => (h === null || h === undefined ? '' : String(h)));
  }

  /** เลขแถวสุดท้ายที่มีข้อมูล (นับแบบเดียวกับ getLastRow() ของ Apps Script) */
  lastRow(name) {
    const v = this.values(name);
    for (let i = v.length - 1; i >= 0; i--) {
      if ((v[i] || []).some(c => c !== '' && c !== null && c !== undefined)) return i + 1;
    }
    return 0;
  }

  /**
   * แปลงชีตเป็นอาร์เรย์ของ object โดยใช้แถวแรกเป็นชื่อคีย์
   * เทียบเท่า sheetToObjects_() ของเดิม รวมถึง _row ที่เป็นเลขแถวจริงในชีต
   *
   * คอลัมน์ที่ไม่มีชื่อหัวตารางจะถูกข้าม กันไม่ให้เกิดคีย์เป็น "" ซึ่งทำให้
   * ข้อมูลที่ส่งกลับหน้าเว็บพัง (ปัญหาเดิมที่เคยเจอในเวอร์ชัน Apps Script)
   */
  objects(name) {
    const values = this.values(name);
    if (values.length < 2) return [];
    const headers = this.headers(name);

    const out = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      if (!row.some(c => c !== '' && c !== null && c !== undefined)) continue;
      const obj = { _row: i + 1 };
      headers.forEach((h, c) => {
        if (h === '') return;
        const v = row[c];
        obj[h] = v === undefined || v === null ? '' : v;
      });
      out.push(obj);
    }
    return out;
  }

  /** ค่าของช่องเดียว (แถว/คอลัมน์เริ่มนับที่ 1) */
  cell(name, row, col) {
    const v = this.values(name);
    const r = v[row - 1];
    if (!r) return '';
    const c = r[col - 1];
    return c === undefined || c === null ? '' : c;
  }

  /* -------------------------------- การเขียน -------------------------------- */

  /** ให้แน่ใจว่าอาร์เรย์ในหน่วยความจำมีแถว/คอลัมน์พอที่จะเขียนลงไป */
  _ensureCell(name, row, col) {
    const v = this._values.get(name) || [];
    while (v.length < row) v.push([]);
    const r = v[row - 1];
    while (r.length < col) r.push('');
    this._values.set(name, v);
    return v;
  }

  /** เขียนบล็อกข้อมูลลงตำแหน่งที่ระบุ (แทน getRange(r,c,nr,nc).setValues()) */
  setValues(name, row, col, values2d) {
    values2d.forEach((rowVals, dr) => {
      rowVals.forEach((val, dc) => {
        const v = this._ensureCell(name, row + dr, col + dc);
        v[row + dr - 1][col + dc - 1] = val;
      });
    });

    const endRow = row + values2d.length - 1;
    // ใช้ reduce ไม่ใช้ Math.max(...) เพราะการกระจายอาร์เรย์หลายพันช่องทำให้ stack ล้น
    const widest = values2d.reduce((m, r) => (r.length > m ? r.length : m), 0);
    const endCol = col + widest - 1;
    this._pendingValues.push({
      range: `${quoteSheet(name)}!${colLetter(col)}${row}:${colLetter(endCol)}${endRow}`,
      values: values2d
    });
  }

  /** เขียนช่องเดียว (แทน getRange(r,c).setValue()) */
  setValue(name, row, col, value) {
    this.setValues(name, row, col, [[value]]);
  }

  /**
   * เขียนค่าลงแถวโดยอ้างอิงตาม "ชื่อคอลัมน์" ไม่ใช่ตำแหน่ง
   * เทียบเท่า writeRowByHeaders_() ของเดิม
   *
   * ปลอดภัยแม้ลำดับคอลัมน์จริงในชีตจะไม่ตรงกับลำดับใน headers array ของโค้ด
   * (เช่นชีตเก่าที่เคย migrate มาหลายรอบ) คีย์ที่ไม่มีคอลัมน์ตรงกันจะถูกข้ามเงียบๆ
   */
  writeByHeaders(name, row, payload) {
    const headers = this.headers(name);
    Object.keys(payload).forEach(key => {
      const col = headers.indexOf(key);
      if (col === -1) return;
      this.setValue(name, row, col + 1, payload[key]);
    });
  }

  /**
   * ต่อแถวใหม่ท้ายชีต (แทน appendRow())
   * อัปเดตข้อมูลในหน่วยความจำทันที เพื่อให้โค้ดที่อ่านต่อในคำสั่งเดียวกันเห็นแถวใหม่ด้วย
   */
  appendRow(name, rowValues) {
    if (!this._values.has(name)) this._values.set(name, []);
    const v = this._values.get(name);
    const at = Math.max(this.lastRow(name), 1);
    v[at] = rowValues.slice();

    if (!this._appends.has(name)) this._appends.set(name, []);
    this._appends.get(name).push(rowValues);
    return at + 1; // เลขแถวจริงของแถวที่เพิ่งเพิ่ม
  }

  /** ลบแถว (แทน deleteRow()) — จัดการทั้งในหน่วยความจำและบนชีตจริง */
  async deleteRow(name, row) {
    const meta = await this.meta();
    const info = meta[name];
    if (!info) throw new Error('ไม่พบชีต "' + name + '"');

    const v = this._values.get(name);
    if (v) v.splice(row - 1, 1);

    this._pendingShrink.push({
      deleteDimension: {
        range: { sheetId: info.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row }
      }
    });
  }

  /**
   * สร้างชีตใหม่พร้อมแถวหัวตารางถ้ายังไม่มี
   * เทียบเท่า getOrCreateSheet_() ของเดิม
   */
  async ensureSheet(name, headers) {
    const meta = await this.meta();
    if (Object.prototype.hasOwnProperty.call(meta, name)) return false;

    // สร้างชีตทันที (ไม่เข้าคิว) เพราะคำสั่งถัดไปต้องรู้ sheetId ของชีตนี้
    const res = await this._req(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          addSheet: {
            properties: {
              title: name,
              gridProperties: { rowCount: 1000, columnCount: Math.max(headers.length, 26), frozenRowCount: 1 }
            }
          }
        }]
      })
    });

    const props = res.replies[0].addSheet.properties;
    meta[name] = {
      sheetId: props.sheetId,
      rowCount: props.gridProperties.rowCount,
      colCount: props.gridProperties.columnCount
    };
    this._values.set(name, [headers.slice()]);

    this._pendingValues.push({
      range: `${quoteSheet(name)}!A1:${colLetter(headers.length)}1`,
      values: [headers]
    });
    this._pendingGrowth.push(headerStyleRequest(props.sheetId, headers.length));
    return true;
  }

  /**
   * เติมคอลัมน์ที่ "ยังขาด" ต่อท้ายชีต (ไม่แตะคอลัมน์เดิม)
   * เทียบเท่า ensureColumnsMatch_() ของเดิม
   *
   * ใช้ migrate ชีตที่ deploy ไปแล้วให้มีคอลัมน์ใหม่ โดยไม่กระทบลำดับหรือข้อมูลเดิม
   * ด้วยเหตุนี้คอลัมน์ที่เพิ่มภายหลังในโค้ดจึง "ต้องต่อท้ายสุดเสมอ" ห้ามแทรกกลาง
   */
  async ensureColumns(name, headers) {
    const existing = this.headers(name);
    const missing = headers.filter(h => existing.indexOf(h) === -1);
    if (missing.length === 0) return;

    const meta = await this.meta();
    const info = meta[name];
    const startCol = existing.length + 1;
    const needCols = startCol + missing.length - 1;

    // ขยายความกว้างของชีตก่อนถ้าคอลัมน์ไม่พอ
    // ถ้าไม่ทำ Google จะปฏิเสธคำสั่งเขียน แล้วทั้งระบบจะเปิดไม่ขึ้น ไม่ใช่แค่ฟีเจอร์เดียวพัง
    if (info && info.colCount < needCols) {
      this._pendingGrowth.push({
        appendDimension: { sheetId: info.sheetId, dimension: 'COLUMNS', length: needCols - info.colCount }
      });
      info.colCount = needCols;
    }

    const v = this._values.get(name) || [[]];
    if (!v[0]) v[0] = [];
    missing.forEach((h, i) => { v[0][startCol - 1 + i] = h; });
    this._values.set(name, v);

    this._pendingValues.push({
      range: `${quoteSheet(name)}!${colLetter(startCol)}1:${colLetter(needCols)}1`,
      values: [missing]
    });
    if (info) this._pendingGrowth.push(headerStyleRequest(info.sheetId, needCols, startCol - 1));
  }

  /* -------------------------------- ส่งงานจริง -------------------------------- */

  /** มีงานเขียนค้างอยู่หรือไม่ */
  get dirty() {
    return this._pendingValues.length > 0
        || this._pendingGrowth.length > 0
        || this._pendingShrink.length > 0
        || this._appends.size > 0;
  }

  /**
   * ส่งงานเขียนทั้งหมดที่ค้างอยู่ไปยัง Google ในครั้งเดียว
   * เรียกก่อน return ผลลัพธ์เสมอ เพื่อไม่ให้ผู้ใช้เห็นว่าบันทึกสำเร็จทั้งที่ยังไม่ได้เขียนจริง
   */
  async flush() {
    // 1) ขยายโครงสร้างชีตก่อนเป็นอันดับแรก เช่นเพิ่มคอลัมน์ที่ยังไม่มี
    //    ต้องทำก่อนเขียนค่าเสมอ ไม่งั้น Google จะปฏิเสธการเขียนลงคอลัมน์ใหม่
    //    ด้วยข้อความ "exceeds grid limits" แล้วระบบจะเปิดไม่ขึ้นทั้งระบบ
    if (this._pendingGrowth.length) {
      const requests = this._pendingGrowth;
      this._pendingGrowth = [];
      await this._req(':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({ requests })
      });
    }

    // 2) เขียนค่าลงช่องที่ระบุตำแหน่งไว้แล้ว
    if (this._pendingValues.length) {
      const data = this._pendingValues;
      this._pendingValues = [];
      await this._req('/values:batchUpdate', {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
      });
    }

    // 3) ต่อแถวใหม่ท้ายชีต (แยกจากข้อ 2 เพราะ Google ใช้คนละ endpoint)
    if (this._appends.size) {
      const appends = [...this._appends.entries()];
      this._appends.clear();
      for (const [name, rows] of appends) {
        await this._req(
          '/values/' + encodeURIComponent(quoteSheet(name)) +
          ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
          { method: 'POST', body: JSON.stringify({ values: rows }) }
        );
      }
    }

    // 4) การลบแถว — ทำทีหลังสุดเพราะทำให้เลขแถวอื่นเลื่อน
    //    ถ้าทำก่อนเขียนค่า ค่าที่เตรียมไว้จะไปลงผิดแถวทั้งหมด
    if (this._pendingShrink.length) {
      const requests = this._pendingShrink;
      this._pendingShrink = [];
      await this._req(':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({ requests })
      });
    }
  }
}

/** จัดรูปแบบแถวหัวตารางให้เป็นพื้นน้ำเงินตัวหนังสือขาว เหมือนที่ Apps Script เดิมทำ */
function headerStyleRequest(sheetId, endCol, startCol = 0) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: startCol, endColumnIndex: endCol },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0x11 / 255, green: 0x53 / 255, blue: 0xa1 / 255 },
          textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
        }
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat)'
    }
  };
}
