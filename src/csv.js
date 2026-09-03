/**
 * อ่านและเขียนไฟล์ CSV
 *
 * เขียนเองทั้งหมดเพราะระบบนี้ตั้งใจไม่ใช้ไลบรารีภายนอกเลย
 * และ CSV มีกฎแค่ไม่กี่ข้อ ไม่คุ้มที่จะลงไลบรารีมาเพื่อเรื่องนี้
 *
 * ============================================================================
 * กฎของ CSV ที่ต้องรองรับ (ไม่ใช่แค่ split ด้วยลูกน้ำ)
 * ============================================================================
 *   1. ข้อความที่มีลูกน้ำอยู่ข้างใน ต้องมีเครื่องหมายคำพูดครอบ
 *        เชียงใหม่, ลำพูน   ->   "เชียงใหม่, ลำพูน"
 *   2. เครื่องหมายคำพูดข้างในข้อความ ต้องพิมพ์ซ้ำสองครั้ง
 *        เขาบอกว่า "ดี"      ->   "เขาบอกว่า ""ดี"""
 *   3. ข้อความอาจมีการขึ้นบรรทัดใหม่อยู่ข้างในเครื่องหมายคำพูดได้
 *
 * ถ้าใช้ split(',') เฉยๆ ทั้งสามกรณีนี้จะพังหมด และพังแบบเงียบ —
 * ข้อมูลเลื่อนคอลัมน์ไปทั้งแถวโดยไม่มีอะไรฟ้อง
 * ============================================================================
 */

/**
 * แปลงข้อความ CSV เป็นตาราง 2 มิติ
 *
 * @param {string} text เนื้อหาไฟล์ทั้งไฟล์
 * @returns {string[][]} แต่ละแถวเป็นอาร์เรย์ของค่าในคอลัมน์
 */
export function parseCsv(text) {
  // ตัดเครื่องหมายกำกับไฟล์ (BOM) ที่ Excel ใส่มาให้ ถ้าไม่ตัด
  // ชื่อคอลัมน์แรกจะมีอักขระล่องหนติดอยู่ข้างหน้าแล้วจับคู่ไม่ตรง
  let s = String(text ?? '').replace(/^﻿/, '');

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inQuotes) {
      if (c === '"') {
        // คำพูดสองตัวติดกัน = คำพูดจริงหนึ่งตัวในข้อความ
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }

    if (c === '\r') continue;           // รองรับไฟล์จาก Windows ที่ลงท้ายด้วย \r\n
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }

    field += c;
  }

  // แถวสุดท้ายที่ไม่มีการขึ้นบรรทัดปิดท้าย
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // ตัดบรรทัดว่างทิ้ง (ไฟล์จาก Excel มักมีบรรทัดว่างต่อท้าย)
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

/**
 * แปลงข้อความ CSV เป็นอาร์เรย์ของ object โดยใช้แถวแรกเป็นชื่อคอลัมน์
 * @returns {{headers: string[], rows: Object[]}}
 */
export function parseCsvObjects(text) {
  const grid = parseCsv(text);
  if (!grid.length) return { headers: [], rows: [] };

  const headers = grid[0].map(h => String(h).trim());
  const rows = grid.slice(1).map((r, i) => {
    const obj = { __line: i + 2 };   // เลขบรรทัดในไฟล์จริง ใช้อ้างอิงตอนแจ้ง error
    headers.forEach((h, c) => { if (h) obj[h] = String(r[c] ?? '').trim(); });
    return obj;
  });

  return { headers, rows };
}

/** ใส่เครื่องหมายคำพูดครอบค่าถ้าจำเป็น */
function quote(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * สร้างข้อความ CSV จากตาราง
 *
 * @param {string[]} headers ชื่อคอลัมน์
 * @param {Array<Object|Array>} rows ข้อมูล
 * @param {boolean} [withBom=true] ใส่เครื่องหมายกำกับไฟล์สำหรับ Excel
 *
 * ⚠️ ต้องใส่ BOM เสมอถ้าไฟล์นี้จะถูกเปิดด้วย Excel
 * ไม่งั้น Excel จะเดาว่าเป็นภาษาอังกฤษแล้วภาษาไทยกลายเป็นตัวอักษรขยะทั้งไฟล์
 */
export function toCsv(headers, rows, withBom = true) {
  const lines = [headers.map(quote).join(',')];

  for (const r of rows) {
    const cells = Array.isArray(r) ? r : headers.map(h => r[h]);
    lines.push(cells.map(quote).join(','));
  }

  // ลงท้ายบรรทัดด้วย \r\n เพราะเป็นรูปแบบที่ Excel บน Windows คาดหวัง
  return (withBom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
