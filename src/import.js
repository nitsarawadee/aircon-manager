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
 * 1. การนำเข้า "ไม่ลบ" อะไรเอง
 *    ถ้าไฟล์มี 5 แถว เครื่องที่เหลืออีก 452 ตัวต้องอยู่ครบเหมือนเดิม
 *    เพราะความผิดพลาดที่คนทำบ่อยที่สุดคืออัปโหลดไฟล์ที่ไม่ครบ
 *    planImport แค่บอกว่าเครื่องไหนไม่มีในไฟล์ (missing) ให้คนเห็นในหน้าสรุป
 *    จะลบได้ก็ต่อเมื่อคนนำเข้าติ๊กเลือกเองตอนยืนยัน (plan.removes — ว่างไว้เป็นค่าเริ่มต้น)
 *    เจ้าของงานขอเพิ่ม หลังนำเข้าไฟล์ทั้งชุดแล้วต้องมาไล่ลบเครื่องเก่าที่ค้างอยู่เอง
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
import { isAwaitingInstall, normalizeCode, ymdhms } from './values.js';

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

/** ช่องที่ระบุตัวเครื่องจริง ใช้จับว่าเครื่องใหม่ในไฟล์คือเครื่องเดิมที่รหัสเปลี่ยน */
const IDENTITY_FIELDS = ['IndoorAsset', 'OutdoorAsset', 'IndoorSN', 'OutdoorSN'];

/**
 * ค่า Asset / S/N ที่ใช้เทียบได้ — ค่าที่คนกรอกแทน "ไม่มี" (-, 0, N/A) ไม่นับ
 * ไม่งั้นทุกเครื่องที่ใส่ขีดไว้จะถูกมองว่าเป็นเครื่องเดียวกันหมด
 */
function identityValue(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (s.length < 3 || /^[-_.\s0]*$/.test(s)) return '';
  if (['N/A', 'NA', 'NONE', 'ไม่มี', 'ไม่ทราบ', 'ไม่ระบุ'].includes(s)) return '';
  return s;
}

/**
 * คำนวณว่าถ้านำเข้าไฟล์นี้จะเกิดอะไรขึ้น — ไม่เขียนข้อมูลใดๆ ทั้งสิ้น
 *
 * นอกจากเพิ่ม/แก้ ยังบอกอีกสองอย่างเพื่อกันเครื่องซ้อน (เคยเกิดจริง: ไฟล์แรกใส่ชื่อ Node ไทยในช่อง
 * SiteCode พอนำเข้าไฟล์ที่แก้แล้ว รหัสเครื่องเปลี่ยนทั้งหมด ระบบเลยเพิ่มซ้ำอีก 517 เครื่อง)
 *   suspects = เครื่องที่จะเพิ่มใหม่ แต่ Asset/S/N ตรงกับเครื่องที่มีอยู่แล้วคนละรหัส
 *   missing  = เครื่องที่มีในระบบแต่ไม่มีในไฟล์ (ไม่ลบเอง — ดูกฎข้อ 1)
 *
 * @param {Array<Object>} existing  ข้อมูลเครื่องที่มีอยู่ในระบบ (จาก ss.objects)
 * @param {Array<Object>} rows      แถวจากไฟล์ (จาก parseCsvObjects)
 * @returns {{adds: Array, updates: Array, unchanged: Array, errors: Array, warnings: Array,
 *            suspects: Array, missing: Array}}
 */
export function planImport(existing, rows) {
  const byCode = new Map();
  for (const u of existing) if (u.AirCode) byCode.set(normalizeCode(u.AirCode), u);

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

    // เก็บเฉพาะช่องที่กรอกมาจริง (กฎข้อ 2)
    //
    // ช่องที่เว้นว่างแปลว่า "ไม่ยุ่งกับช่องนี้" ไม่ใช่ "ล้างค่าเดิมทิ้ง"
    // เพราะวิธีใช้งานจริงคือทยอยเติมข้อมูลทีละรอบ เช่น รอบนี้หาวันติดตั้งมาได้
    // ก็กรอกแค่ช่องนั้นแล้วนำเข้า ถ้าช่องว่างล้างค่าเดิม ข้อมูลที่สะสมมาจะหายทั้งแถว
    // โดยที่คนกรอกไม่รู้ตัวเลยว่าตัวเองเพิ่งลบอะไรไป
    //
    // ถ้าต้องการล้างค่าในช่องไหนจริงๆ ให้ไปลบในหน้าเว็บทีละเครื่อง
    // ซึ่งเห็นค่าเดิมอยู่ตรงหน้าและมีการบันทึกประวัติไว้
    const values = { AirCode: airCode };
    for (const f of IMPORT_FIELDS) {
      if (f === 'AirCode') continue;
      // ปรับค่าที่ต่างกันแค่ตัวพิมพ์ใหญ่เล็กให้ตรงมาตรฐาน เช่น "Shop house" -> "Shop House"
      // การแก้นี้จะโผล่ในรายการเปลี่ยนแปลงให้คนเห็น ไม่ได้แก้เงียบๆ
      const v = canonicalize(f, row[f] ?? '');
      if (v !== '') values[f] = v;
    }

    const current = byCode.get(airCode);

    if (!current) {
      adds.push({ line, airCode, values });
      continue;
    }

    // มีอยู่แล้ว — ดูว่าเปลี่ยนอะไรบ้าง
    // เครื่องที่รอใบติดตั้งอนุมัติ: สถานะระบบปลดเองตอนอนุมัติครบ ไฟล์นำเข้าเปลี่ยนไม่ได้ (ดู isAwaitingInstall)
    if (isAwaitingInstall(current.Status)) delete values.Status;
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

  // ---------- เครื่องใหม่ที่ Asset/S/N ตรงกับเครื่องที่มีอยู่แล้ว ----------
  const owner = new Map();   // ค่า Asset/S/N → เครื่องในระบบที่ถือค่านั้น
  for (const u of existing) {
    if (!u.AirCode) continue;
    for (const f of IDENTITY_FIELDS) {
      const v = identityValue(u[f]);
      if (v && !owner.has(v)) owner.set(v, { airCode: String(u.AirCode).trim(), field: f });
    }
  }
  const suspects = [];
  for (const a of adds) {
    for (const f of IDENTITY_FIELDS) {
      const v = identityValue(a.values[f]);
      const hit = v && owner.get(v);
      if (!hit) continue;
      suspects.push({ line: a.line, airCode: a.airCode, matchCode: hit.airCode, field: f, value: a.values[f] });
      break;   // เครื่องละรายการพอ เจอช่องเดียวก็รู้แล้วว่าน่าสงสัย
    }
  }

  // ---------- เครื่องในระบบที่ไม่มีในไฟล์ ----------
  // นับรหัสที่ไฟล์พูดถึงทั้งหมด รวมแถวที่มีข้อผิดพลาดด้วย — แถวผิดยังตั้งใจหมายถึงเครื่องนั้นอยู่
  // เครื่องที่รอใบติดตั้งอนุมัติไม่อยู่ในไฟล์สำหรับแก้อยู่แล้ว (ยังไม่ขึ้นรายการ) — ไม่นับว่าหายจากไฟล์
  const missing = existing.filter(u => u.AirCode && !isAwaitingInstall(u.Status) &&
                                       !seenInFile.has(normalizeCode(u.AirCode)));

  return { adds, updates, unchanged, errors, warnings, suspects, missing };
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
  // เวลาไทยเสมอ (ymdhms) เหมือนทุกจุดที่เขียน UpdatedAt — เดิมใช้เวลาของเครื่องเซิร์ฟเวอร์
  // ถ้าเครื่องตั้งเป็น UTC (เช่นบนคลาวด์) เวลาที่นำเข้าจะช้าไป 7 ชั่วโมง ไม่ตรงกับการแก้ทีละเครื่อง
  const now = opts.now || ymdhms(new Date());
  const headers = ss.headers(AIRLIST);

  for (const u of plan.updates) {
    ss.writeByHeaders(AIRLIST, u._row, { ...u.values, UpdatedAt: now, UpdatedBy: user });
  }

  for (const a of plan.adds) {
    const payload = { ...a.values, UpdatedAt: now, UpdatedBy: user };
    // เรียงค่าตามลำดับคอลัมน์จริงของตาราง คอลัมน์ที่ไฟล์ไม่มีให้เว้นว่างไว้
    ss.appendRow(AIRLIST, headers.map(h => (payload[h] !== undefined ? payload[h] : '')));
  }

  // เครื่องที่ไม่มีในไฟล์ — มีเฉพาะเมื่อคนนำเข้าติ๊กเลือกลบเอง (กฎข้อ 1)
  // ลบจากแถวล่างขึ้นบน เลขแถวของเครื่องที่ยังรอลบจะได้ไม่เลื่อนก่อนถึงคิว
  const removes = (plan.removes || []).slice().sort((a, b) => b._row - a._row);
  for (const r of removes) await ss.deleteRow(AIRLIST, r._row);

  await ss.flush();

  return {
    added: plan.adds.length, updated: plan.updates.length,
    unchanged: plan.unchanged.length, removed: removes.length
  };
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
