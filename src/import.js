/**
 * ตรรกะการนำเข้าข้อมูลเครื่องปรับอากาศจากไฟล์
 *
 * ไฟล์นี้ไม่รู้จักระบบไฟล์ ไม่รู้จักเว็บ ไม่รู้จัก Node
 * รับข้อมูลที่อ่านมาแล้วเข้ามาเป็นอาร์เรย์ธรรมดา แล้วคืนผลลัพธ์กลับไป
 * ทั้งคำสั่ง command line และหน้าเว็บจึงเรียกใช้ตัวเดียวกันได้
 * และวันย้ายขึ้นคลาวด์ไม่ต้องแก้ไฟล์นี้เลย
 *
 * ============================================================================
 * กฎความปลอดภัย 3 ข้อที่ฝังไว้ตายตัว
 * ============================================================================
 *
 * 1. การนำเข้า "ไม่ลบ" อะไรทั้งสิ้น
 *    ถ้าไฟล์มี 5 แถว เครื่องที่เหลืออีก 452 ตัวต้องอยู่ครบเหมือนเดิม
 *    เพราะความผิดพลาดที่คนทำบ่อยที่สุดคืออัปโหลดไฟล์ที่ไม่ครบ
 *    การลบเครื่องต้องไปกดลบทีละตัวในเว็บเท่านั้น ซึ่งมีการบันทึกประวัติไว้
 *
 * 2. แตะเฉพาะคอลัมน์ที่มีอยู่ในไฟล์
 *    ตารางจริงมีคอลัมน์ที่ไฟล์นำเข้าไม่มี เช่น พิกัด Lat/Long และที่อยู่
 *    ข้อมูลพวกนี้ต้องไม่ถูกล้างทิ้งเพียงเพราะไฟล์นำเข้าไม่มีคอลัมน์นั้น
 *
 * 3. คำนวณให้ดูก่อนเสมอ แล้วค่อยเขียน
 *    planImport() คำนวณอย่างเดียว ไม่เขียนอะไรเลย
 *    applyImport() ถึงจะเขียน — แยกกันคนละฟังก์ชันเพื่อให้หน้าเว็บ
 *    เอาผลจากข้อแรกไปแสดงให้คนยืนยันก่อนได้
 *
 * ============================================================================
 * เรื่องที่จงใจไม่ทำ: ไม่บันทึกลงตารางประวัติ
 * ============================================================================
 * การแก้ข้อมูลทีละเครื่องในเว็บจะบันทึกประวัติให้อัตโนมัติ แต่การนำเข้าไม่ทำ
 * เพราะการนำเข้าคือ "การลงข้อมูล" ไม่ใช่ "เหตุการณ์ที่เกิดกับเครื่อง"
 * ถ้านำเข้า 457 เครื่องแล้วเขียนประวัติ "ติดตั้ง" 457 รายการ
 * ประวัติจริงที่มีค่าจะจมหายไปในกองข้อมูลที่ไม่ใช่เหตุการณ์จริง
 *
 * ร่องรอยของการนำเข้าเก็บด้วยวิธีอื่นแทน คือไฟล์สำรองก่อนนำเข้าทุกครั้ง
 * ============================================================================
 */

import { COLUMNS, HEADERS, makeAirCode, validateRow, canonicalize } from './import-spec.js';

/** ชื่อชีต/ตารางของข้อมูลเครื่อง */
const AIRLIST = 'AirList';

/**
 * คอลัมน์ในไฟล์นำเข้าที่ตรงกับคอลัมน์ในตารางจริง
 *
 * AirNo ไม่อยู่ในนี้เพราะไม่ใช่คอลัมน์ในตาราง — ใช้แค่ประกอบเป็นรหัสเครื่องเท่านั้น
 */
export const IMPORT_FIELDS = HEADERS.filter(h => h !== 'AirNo');

/** เทียบค่าสองค่าว่าถือว่าเหมือนกันไหม (ตัวเลขกับข้อความที่หน้าตาเหมือนกันถือว่าเท่ากัน) */
function same(a, b) {
  const norm = v => (v === null || v === undefined ? '' : String(v).trim());
  return norm(a) === norm(b);
}

/**
 * คำนวณว่าถ้านำเข้าไฟล์นี้จะเกิดอะไรขึ้น — ไม่เขียนข้อมูลใดๆ ทั้งสิ้น
 *
 * @param {Array<Object>} existing  ข้อมูลเครื่องที่มีอยู่ในระบบ (จาก ss.objects)
 * @param {Array<Object>} rows      แถวจากไฟล์ (จาก parseCsvObjects)
 * @returns {{adds: Array, updates: Array, unchanged: Array, errors: Array, warnings: Array}}
 */
export function planImport(existing, rows) {
  const byCode = new Map();
  for (const u of existing) if (u.AirCode) byCode.set(String(u.AirCode).trim(), u);

  const adds = [];
  const updates = [];
  const unchanged = [];
  const errors = [];
  const warnings = [];
  const seenInFile = new Map();

  for (const row of rows) {
    const line = row.__line;

    // ตรวจความถูกต้องของข้อมูลในแถวก่อน
    let rowHasError = false;
    for (const p of validateRow(row)) {
      const item = { line, column: p.column, message: p.message };
      if (p.level === 'error') { errors.push(item); rowHasError = true; }
      else warnings.push(item);
    }

    // ไม่มีรหัสไซต์หรือเลขเครื่องก็ประกอบรหัสเครื่องไม่ได้ ข้ามไปเลย
    if (!row.SiteCode || !row.AirNo) continue;

    const airCode = makeAirCode(row.SiteCode, row.AirNo);

    // รหัสซ้ำกันเองภายในไฟล์ — ถ้าปล่อยผ่าน แถวหลังจะทับแถวหน้าเงียบๆ
    if (seenInFile.has(airCode)) {
      errors.push({
        line, column: 'SiteCode + AirNo',
        message: `รหัสเครื่อง ${airCode} ซ้ำกับบรรทัดที่ ${seenInFile.get(airCode)}`
      });
      continue;
    }
    seenInFile.set(airCode, line);

    if (rowHasError) continue;   // แถวที่ข้อมูลผิด ไม่เอาเข้าแผน

    // เก็บเฉพาะคอลัมน์ที่ไฟล์มีจริง (กฎข้อ 2)
    const values = { AirCode: airCode };
    for (const f of IMPORT_FIELDS) {
      if (f === 'AirCode') continue;
      // ปรับค่าที่ต่างกันแค่ตัวพิมพ์ใหญ่เล็กให้ตรงมาตรฐาน เช่น "Shop house" -> "Shop House"
      // การแก้นี้จะโผล่ในรายการเปลี่ยนแปลงให้คนเห็น ไม่ได้แก้เงียบๆ
      if (row[f] !== undefined) values[f] = canonicalize(f, row[f]);
    }

    const current = byCode.get(airCode);

    if (!current) {
      adds.push({ line, airCode, values });
      continue;
    }

    // มีอยู่แล้ว — ดูว่าเปลี่ยนอะไรบ้าง
    const changes = [];
    for (const [col, next] of Object.entries(values)) {
      if (col === 'AirCode') continue;
      if (!same(current[col], next)) {
        changes.push({ column: col, from: current[col] ?? '', to: next });
      }
    }

    if (changes.length) updates.push({ line, airCode, _row: current._row, values, changes });
    else unchanged.push({ line, airCode });
  }

  return { adds, updates, unchanged, errors, warnings };
}

/**
 * เขียนผลของแผนลงฐานข้อมูลจริง
 *
 * ต้องเรียก planImport ก่อนแล้วตรวจว่าไม่มี errors เหลืออยู่
 * ฟังก์ชันนี้จะปฏิเสธถ้าแผนยังมีข้อผิดพลาดค้างอยู่ เพื่อไม่ให้เผลอเรียกข้าม
 *
 * @param {Object} ss    ตัวเข้าถึงข้อมูล (Repository)
 * @param {Object} plan  ผลจาก planImport
 * @param {Object} opts  { user, now }
 */
export async function applyImport(ss, plan, opts = {}) {
  if (plan.errors.length) {
    throw new Error('แผนนำเข้ายังมีข้อผิดพลาด ' + plan.errors.length + ' จุด ต้องแก้ให้หมดก่อน');
  }

  const user = opts.user || 'import';
  const now = opts.now || stamp(new Date());
  const headers = ss.headers(AIRLIST);

  for (const u of plan.updates) {
    ss.writeByHeaders(AIRLIST, u._row, { ...u.values, UpdatedAt: now, UpdatedBy: user });
  }

  for (const a of plan.adds) {
    const payload = { ...a.values, UpdatedAt: now, UpdatedBy: user };
    // เรียงค่าตามลำดับคอลัมน์จริงของตาราง คอลัมน์ที่ไฟล์ไม่มีให้เว้นว่างไว้
    ss.appendRow(AIRLIST, headers.map(h => (payload[h] !== undefined ? payload[h] : '')));
  }

  await ss.flush();

  return { added: plan.adds.length, updated: plan.updates.length, unchanged: plan.unchanged.length };
}

/** เวลาในรูปแบบที่ระบบใช้บันทึกลงคอลัมน์ UpdatedAt */
function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/**
 * สร้างข้อมูลสำหรับส่งออกเป็นไฟล์ ในรูปแบบเดียวกับไฟล์นำเข้า
 *
 * สำคัญ: ไฟล์ที่ส่งออกต้องนำเข้ากลับได้ทันทีโดยไม่ต้องแก้อะไร
 * เพราะวิธีแก้ข้อมูลที่ปลอดภัยที่สุดคือ ส่งออก -> แก้ใน Excel -> นำเข้ากลับ
 * คนใช้จึงไม่ต้องพิมพ์รหัสเครื่องเองและไม่มีทางใส่คอลัมน์ผิด
 */
export function toExportRows(existing) {
  return existing
    .filter(u => u.AirCode)
    .map(u => {
      const out = {};
      for (const h of HEADERS) out[h] = u[h] === undefined || u[h] === null ? '' : String(u[h]);
      // แยกเลขเครื่องกลับออกมาจากรหัสเครื่อง เพราะไฟล์นำเข้าใช้ SiteCode + AirNo
      const m = /-AIR-(\d+)$/.exec(String(u.AirCode));
      out.AirNo = m ? m[1] : '';
      return out;
    });
}
