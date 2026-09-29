import { TABLES, columnKind } from './schema.js';

/**
 * ตัวคุยกับฐานข้อมูล SQLite — ตัวแทนของ src/sheets.js
 *
 * ============================================================================
 * ทำไมหน้าตาเหมือน sheets.js เป๊ะ ทั้งที่มันเป็นฐานข้อมูลแล้ว
 * ============================================================================
 * โมดูลธุรกิจทั้ง 7 ตัวเรียกใช้ sheets.js อยู่ 128 จุด ถ้าเปลี่ยนหน้าตา API
 * ต้องไล่แก้ทั้ง 128 จุดพร้อมกัน ซึ่งเสี่ยงเกินไปสำหรับการเปลี่ยนฐานข้อมูล
 * ไฟล์นี้จึงสวมรอยเป็น sheets.js แทน — สลับไปมาได้ด้วยการแก้ .env บรรทัดเดียว
 * ถ้าเจอปัญหาก็สลับกลับได้ทันทีโดยไม่ต้องแตะโค้ด
 *
 * เมื่อลบ sheets.js ทิ้งแล้ว (เฟส 5) ค่อยล้างส่วนที่เป็นมรดกของ Sheets ออก
 * ============================================================================
 *
 * ⚠️ เรื่อง _row ที่ต้องเข้าใจก่อนแก้ไฟล์นี้
 *
 * _row คือ "ลำดับที่เท่าไหร่ในตาราง" ไม่ใช่ id ถาวรของแถว — ตั้งใจทำแบบนี้
 *
 * เหตุผล: plan.js เขียนข้อมูลทับทั้งคอลัมน์ด้วย setValues(ชีต, 2, คอลัมน์, ค่า)
 * ซึ่งหมายถึง "เริ่มเขียนที่แถวที่ 2 ของตาราง" ถ้าเปลี่ยน _row ไปเป็น id ถาวร
 * เลข 2 จะกลายเป็น "แถวที่มี id = 2" ซึ่งคนละความหมายกันโดยสิ้นเชิง
 * ข้อมูลจะไปลงผิดแถวทั้งคอลัมน์แบบเงียบๆ
 *
 * ไฟล์นี้จึงเก็บทั้งสองอย่างคู่กัน: ลำดับแถวสำหรับคุยกับโมดูล และ id จริง
 * สำหรับคุยกับฐานข้อมูล แล้วแปลงไปมาให้เอง
 */

/** ชื่อ "ชีต" ที่โมดูลรู้จัก -> ตารางจริงในฐานข้อมูล */
const SHEET_TO_TABLE = {
  AirList: 'air_units',
  History: 'history',
  Users: 'users',
  Budget: 'budgets',
  CleaningForm: 'cleaning_forms',
  RepairForm: 'repair_forms',
  InstallForm: 'install_forms',
  Contractor: 'contractors',
  RepairLink: 'repair_links',
  DocApproval: 'doc_approvals',
  Config: 'config_values'
};

/** แผนล้างแอร์รายปี — ชีต Plan_2569 คือแถวใน plans ที่ Year = 2569 */
const PLAN_SHEET = /^Plan_(\d{4})$/;

/** ประเภทที่ชีต Config เดิมมี — ใช้เป็นหัวตารางของมุมมองแบบกว้าง */
const CONFIG_CATEGORIES = ['Region', 'LocationType', 'Brand', 'Status', 'Technician', 'EventType'];

/**
 * ตรวจว่าชื่อตาราง/คอลัมน์เป็นของจริงในโครงสร้างที่เรานิยามไว้
 *
 * ชื่อตารางกับชื่อคอลัมน์ผูกเข้าคำสั่ง SQL ตรงๆ ไม่ได้ (พารามิเตอร์ใช้ได้เฉพาะกับ "ค่า")
 * จึงต้องตรวจกับรายชื่อที่เรากำหนดไว้เองก่อนเสมอ ชื่อที่ไม่รู้จักจะถูกปฏิเสธทันที
 * ทำให้ไม่มีทางที่ข้อความจากผู้ใช้จะกลายเป็นคำสั่ง SQL ได้
 */
function assertIdent(table, column) {
  const def = TABLES[table];
  if (!def) throw new Error('ไม่รู้จักตาราง "' + table + '"');
  if (column !== undefined && !Object.prototype.hasOwnProperty.call(def.columns, column)) {
    throw new Error('ไม่รู้จักคอลัมน์ "' + column + '" ในตาราง ' + table);
  }
}

/** ค่าที่อ่านจากฐานข้อมูล -> ค่าที่โมดูลคาดหวัง (เหมือนที่เคยได้จาก Sheets) */
function fromDb(value, kind) {
  if (value === null || value === undefined) return '';
  // ชีตเก็บ Active เป็น true/false ฐานข้อมูลเก็บเป็น 1/0 ต้องแปลงกลับ
  // ถ้าไม่แปลง โค้ดตรวจสิทธิ์จะมองว่า 0 ไม่ใช่ false แล้วปล่อยบัญชีที่ถูกปิดผ่านเข้ามาได้
  if (kind === 'boolean') return value === 1 || value === true;
  return value;
}

/** ค่าจากโมดูล -> ค่าที่เก็บลงฐานข้อมูล */
function toDb(value, kind) {
  if (value === undefined || value === null || value === '') {
    // ตัวเลขที่ยังไม่กรอก เก็บเป็นค่าว่างจริง ไม่ใช่เลขศูนย์
    return kind === 'number' ? null : (kind === 'boolean' ? null : '');
  }
  if (kind === 'boolean') {
    if (value === true || value === 1) return 1;
    if (value === false || value === 0) return 0;
    return String(value).toUpperCase() === 'TRUE' ? 1 : 0;
  }
  if (kind === 'number') {
    const n = Number(value);
    return isNaN(n) ? null : n;
  }
  if (typeof value === 'number') {
    // เลขที่ต้องเก็บเป็นข้อความ (เช่น Serial number ยาวๆ) ห้ามกลายเป็น 5.23e7
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value);
}

export class Repository {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   *   ตัวฐานข้อมูลที่เปิดไว้แล้ว ส่งเข้ามาจาก platform/node.js
   *   ไฟล์นี้ไม่เปิดไฟล์เอง เพราะ src/ ห้ามแตะระบบไฟล์
   */
  constructor(db) {
    this.db = db;
    /** ชื่อชีต -> { table, year, headers, rows, rowIds, dirty, deletes, isNew } */
    this._sheets = new Map();
  }

  /* ==================== แปลงชื่อชีตเป็นตาราง ==================== */

  _resolve(name) {
    if (SHEET_TO_TABLE[name]) return { table: SHEET_TO_TABLE[name], year: null };
    const m = PLAN_SHEET.exec(name);
    if (m) return { table: 'plans', year: Number(m[1]) };
    throw new Error('ไม่รู้จักชีต "' + name + '"');
  }

  /** ลำดับคอลัมน์ที่ตายตัวของตารางนั้น (ต้องคงที่เสมอ ดู test ที่ล็อกไว้) */
  _columnsOf(table, year) {
    const cols = Object.keys(TABLES[table].columns);
    // คอลัมน์ Year เป็นของภายใน ไม่ใช่ส่วนหนึ่งของ "ชีต" ที่โมดูลเห็น
    return year === null ? cols : cols.filter(c => c !== 'Year');
  }

  /* ==================== โครงสร้าง ==================== */

  async sheetNames() {
    const names = Object.keys(SHEET_TO_TABLE);
    const years = this.db.prepare('SELECT DISTINCT Year FROM plans ORDER BY Year').all();
    return names.concat(years.map(r => 'Plan_' + r.Year));
  }

  async hasSheet(name) {
    if (SHEET_TO_TABLE[name]) return true;
    const m = PLAN_SHEET.exec(name);
    if (!m) return false;
    // ชีตแผนที่สร้างไว้ในหน่วยความจำแล้วแต่ยังไม่ได้บันทึก ก็ถือว่ามีแล้ว
    if (this._sheets.has(name)) return true;
    const row = this.db.prepare('SELECT 1 AS ok FROM plans WHERE Year = ? LIMIT 1').get(Number(m[1]));
    return !!row;
  }

  /**
   * "สร้างชีตใหม่" — ในฐานข้อมูลไม่มีการสร้างตารางจริง เพราะโครงสร้างตายตัวอยู่แล้ว
   * มีความหมายเฉพาะกับแผนรายปี: เตรียมที่ว่างไว้รอให้ createCleaningPlan เขียนแถวลงมา
   * @returns {Promise<boolean>} true ถ้าเพิ่งสร้าง
   */
  async ensureSheet(name, headers) {
    if (await this.hasSheet(name)) return false;

    const { table, year } = this._resolve(name);
    this._sheets.set(name, {
      table, year,
      headers: this._columnsOf(table, year),
      rows: [this._columnsOf(table, year)],
      rowIds: [null],
      dirty: new Set(),
      deletes: [],
      isNew: true
    });
    return true;
  }

  /**
   * โครงสร้างฐานข้อมูลตายตัว ไม่มีคอลัมน์ให้เติม
   * เก็บเมธอดไว้เพราะโมดูลเรียกอยู่ 7 จุด — แต่ตรวจให้ด้วยว่าคอลัมน์ที่โค้ดต้องการมีจริง
   * ถ้าใครเพิ่มคอลัมน์ในโค้ดแต่ลืมเพิ่มใน schema จะได้รู้ทันทีตอนนี้ ไม่ใช่ไปพังตอนเขียนข้อมูล
   */
  async ensureColumns(name, headers) {
    let known;
    let where;

    if (name === 'Config') {
      // Config เป็นชีตเสมือน — "หัวตาราง" ของมันคือชื่อประเภทตัวเลือก (Region, Brand, ...)
      // ไม่ใช่ชื่อคอลัมน์จริงในตาราง config_values ซึ่งมีแค่ Category/Value/Position
      known = CONFIG_CATEGORIES;
      where = 'ประเภทตัวเลือกในชีต Config';
    } else {
      const { table, year } = this._resolve(name);
      known = this._columnsOf(table, year);
      where = 'ตาราง ' + table;
    }

    const missing = (headers || []).filter(h => h && !known.includes(h));
    if (missing.length) {
      throw new Error(
        'โค้ดต้องการคอลัมน์ที่ยังไม่มีในฐานข้อมูล: ' + missing.join(', ') +
        ' (' + where + ') — ต้องเพิ่มใน src/db/schema.js ก่อน'
      );
    }
  }

  /* ==================== อ่าน ==================== */

  async load(...names) {
    for (const name of [...new Set(names.flat())].filter(Boolean)) {
      if (this._sheets.has(name)) continue;

      if (name === 'Config') { this._loadConfig(); continue; }

      const { table, year } = this._resolve(name);
      assertIdent(table);
      const cols = this._columnsOf(table, year);
      const quoted = cols.map(c => `"${c}"`).join(', ');

      const rows = year === null
        ? this.db.prepare(`SELECT row_id, ${quoted} FROM ${table} ORDER BY row_id`).all()
        : this.db.prepare(`SELECT row_id, ${quoted} FROM ${table} WHERE Year = ? ORDER BY row_id`).all(year);

      const grid = [cols.slice()];
      const ids = [null];
      for (const r of rows) {
        grid.push(cols.map(c => fromDb(r[c], columnKind(table, c))));
        ids.push(r.row_id);
      }

      this._sheets.set(name, { table, year, headers: cols, rows: grid, rowIds: ids, dirty: new Set(), deletes: [], isNew: false });
    }
  }

  /**
   * ชีต Config เดิมเก็บแนวนอน (1 คอลัมน์ = 1 ประเภท) แต่ฐานข้อมูลเก็บแนวตั้ง
   * ตรงนี้ประกอบกลับเป็นตารางกว้างให้เหมือนเดิม เพื่อให้ getConfig ใช้ได้โดยไม่ต้องแก้
   */
  _loadConfig() {
    const rows = this.db.prepare(
      'SELECT Category, Value FROM config_values ORDER BY Category, Position, row_id'
    ).all();

    const byCat = {};
    CONFIG_CATEGORIES.forEach(c => (byCat[c] = []));
    for (const r of rows) {
      if (!byCat[r.Category]) byCat[r.Category] = [];
      byCat[r.Category].push(r.Value);
    }

    const height = Math.max(0, ...CONFIG_CATEGORIES.map(c => byCat[c].length));
    const grid = [CONFIG_CATEGORIES.slice()];
    for (let i = 0; i < height; i++) {
      grid.push(CONFIG_CATEGORIES.map(c => byCat[c][i] ?? ''));
    }

    this._sheets.set('Config', {
      table: 'config_values', year: null,
      headers: CONFIG_CATEGORIES.slice(),
      rows: grid, rowIds: null, dirty: new Set(), deletes: [], isNew: false,
      isConfig: true
    });
  }

  _sheet(name) {
    const s = this._sheets.get(name);
    if (!s) throw new Error('ยังไม่ได้โหลดข้อมูลชีต "' + name + '" (ลืมเรียก load)');
    return s;
  }

  values(name) { return this._sheet(name).rows; }

  headers(name) { return this._sheet(name).rows[0].slice(); }

  lastRow(name) {
    const rows = this._sheet(name).rows;
    for (let i = rows.length - 1; i >= 0; i--) {
      if ((rows[i] || []).some(c => c !== '' && c !== null && c !== undefined)) return i + 1;
    }
    return 0;
  }

  objects(name) {
    const s = this._sheet(name);
    if (s.rows.length < 2) return [];
    const headers = s.rows[0];

    const out = [];
    for (let i = 1; i < s.rows.length; i++) {
      const row = s.rows[i] || [];
      if (!row.some(c => c !== '' && c !== null && c !== undefined)) continue;
      const obj = { _row: i + 1 };
      headers.forEach((h, c) => {
        if (!h) return;
        const v = row[c];
        obj[h] = v === undefined || v === null ? '' : v;
      });
      out.push(obj);
    }
    return out;
  }

  cell(name, row, col) {
    const rows = this._sheet(name).rows;
    const r = rows[row - 1];
    if (!r) return '';
    const c = r[col - 1];
    return c === undefined || c === null ? '' : c;
  }

  /* ==================== เขียน ==================== */

  /** ขยายตารางในหน่วยความจำให้พอสำหรับตำแหน่งที่จะเขียน */
  _grow(s, row, col) {
    while (s.rows.length < row) {
      s.rows.push(new Array(s.headers.length).fill(''));
      if (s.rowIds) s.rowIds.push(null); // แถวใหม่ที่ยังไม่มีในฐานข้อมูล
    }
    const r = s.rows[row - 1];
    while (r.length < col) r.push('');
  }

  setValues(name, row, col, values2d) {
    const s = this._sheet(name);
    values2d.forEach((rowVals, dr) => {
      rowVals.forEach((val, dc) => {
        this._grow(s, row + dr, col + dc);
        s.rows[row + dr - 1][col + dc - 1] = val;
      });
      if (row + dr > 1) s.dirty.add(row + dr); // แถว 1 คือหัวตาราง ไม่ใช่ข้อมูล
    });
  }

  setValue(name, row, col, value) {
    this.setValues(name, row, col, [[value]]);
  }

  writeByHeaders(name, row, payload) {
    const headers = this.headers(name);
    Object.keys(payload).forEach(key => {
      const col = headers.indexOf(key);
      if (col === -1) return; // คีย์ที่ไม่มีคอลัมน์รองรับ ข้ามเงียบๆ เหมือนพฤติกรรมเดิม
      this.setValue(name, row, col + 1, payload[key]);
    });
  }

  appendRow(name, rowValues) {
    const s = this._sheet(name);
    const at = Math.max(this.lastRow(name), 1);
    this._grow(s, at + 1, s.headers.length);
    s.rows[at] = rowValues.slice();
    s.dirty.add(at + 1);
    return at + 1;
  }

  async deleteRow(name, row) {
    const s = this._sheet(name);
    if (s.isConfig) throw new Error('ลบค่าตัวเลือกในชีต Config ผ่านทางนี้ไม่ได้');

    const id = s.rowIds[row - 1];
    if (id != null) s.deletes.push(id);

    s.rows.splice(row - 1, 1);
    s.rowIds.splice(row - 1, 1);

    // ตำแหน่งแถวเลื่อนขึ้นทั้งหมด รายการที่รอเขียนจึงต้องเลื่อนตาม
    const shifted = new Set();
    for (const pos of s.dirty) {
      if (pos < row) shifted.add(pos);
      else if (pos > row) shifted.add(pos - 1);
      // pos === row คือแถวที่เพิ่งลบ ทิ้งไป
    }
    s.dirty = shifted;
  }

  /* ==================== ส่งงานเขียนจริง ==================== */

  get dirty() {
    for (const s of this._sheets.values()) {
      if (s.dirty.size || s.deletes.length) return true;
    }
    return false;
  }

  /**
   * เขียนทุกอย่างที่ค้างอยู่ลงฐานข้อมูล ใน transaction เดียว
   * ถ้าพลาดกลางทาง ข้อมูลจะถูกย้อนกลับทั้งหมด ไม่มีการเขียนค้างครึ่งๆ กลางๆ
   */
  async flush() {
    if (!this.dirty) return;

    this.db.exec('BEGIN');
    try {
      for (const [name, s] of this._sheets) {
        if (s.isConfig) { this._flushConfig(s); continue; }
        if (!s.dirty.size && !s.deletes.length) continue;

        assertIdent(s.table);

        for (const id of s.deletes) {
          this.db.prepare(`DELETE FROM ${s.table} WHERE row_id = ?`).run(id);
        }
        s.deletes = [];

        // เรียงจากบนลงล่าง เพื่อให้แถวที่แทรกใหม่ได้ id เรียงตามลำดับที่เห็นบนหน้าจอ
        for (const pos of [...s.dirty].sort((a, b) => a - b)) {
          const rowVals = s.rows[pos - 1];
          if (!rowVals) continue;

          const id = s.rowIds[pos - 1];
          const cols = s.headers;
          const vals = cols.map((c, i) => toDb(rowVals[i], columnKind(s.table, c)));

          if (id == null) {
            const insCols = s.year === null ? cols : ['Year', ...cols];
            const insVals = s.year === null ? vals : [s.year, ...vals];
            insCols.forEach(c => assertIdent(s.table, c));
            const sql = `INSERT INTO ${s.table} (${insCols.map(c => `"${c}"`).join(',')}) ` +
                        `VALUES (${insCols.map(() => '?').join(',')})`;
            this.db.prepare(sql).run(...insVals);
            s.rowIds[pos - 1] = this.db.prepare('SELECT last_insert_rowid() AS id').get().id;
          } else {
            cols.forEach(c => assertIdent(s.table, c));
            const sql = `UPDATE ${s.table} SET ${cols.map(c => `"${c}" = ?`).join(', ')} WHERE row_id = ?`;
            this.db.prepare(sql).run(...vals, id);
          }
        }
        s.dirty.clear();
        s.isNew = false;
      }

      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /**
   * บันทึกชีต Config กลับเป็นแนวตั้ง
   * เขียนเฉพาะประเภทที่มีการเปลี่ยนแปลง โดยลบของเดิมของประเภทนั้นแล้วใส่ใหม่ทั้งชุด
   * (ข้อมูลชุดเล็กมาก ไม่กี่สิบแถว จึงไม่ต้องหาว่าแถวไหนเปลี่ยนบ้าง)
   */
  _flushConfig(s) {
    if (!s.dirty.size) return;

    const touched = new Set();
    for (const pos of s.dirty) {
      const row = s.rows[pos - 1] || [];
      row.forEach((v, ci) => { if (v !== '' && v != null) touched.add(s.headers[ci]); });
    }

    for (const cat of touched) {
      const ci = s.headers.indexOf(cat);
      const values = [];
      for (let i = 1; i < s.rows.length; i++) {
        const v = (s.rows[i] || [])[ci];
        if (v !== '' && v != null) values.push(String(v));
      }
      this.db.prepare('DELETE FROM config_values WHERE Category = ?').run(cat);
      const ins = this.db.prepare('INSERT INTO config_values (Category, Value, Position) VALUES (?,?,?)');
      values.forEach((v, i) => ins.run(cat, v, i));
    }

    s.dirty.clear();
  }
}
