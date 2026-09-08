/**
 * เปลี่ยนชื่อสถานะเดิมให้ตรงกับชุดใหม่
 *
 * วิธีรัน:
 *   node scripts/rename-status.mjs           ดูอย่างเดียว
 *   node scripts/rename-status.mjs --apply   เปลี่ยนจริง
 *
 * ชุดสถานะใหม่:
 *   ใช้งานปกติ · ชำรุด · รอซ่อม · รื้อถอน/ปลดระวาง · Write off
 *
 * "ปลดระวาง" ถูก "เปลี่ยนชื่อ" เป็น "รื้อถอน/ปลดระวาง" — เป็นของสิ่งเดียวกัน
 * ไม่ใช่ของใหม่ที่เพิ่มเข้ามาคู่กัน จึงต้องไล่เปลี่ยนชื่อของเดิมให้หมดทุกที่
 * ไม่ใช่ปล่อยให้ชื่อเก่ากับชื่อใหม่อยู่ด้วยกันจนคนเลือกไม่ถูกว่าอันไหนคืออันไหน
 *
 * ส่วน "Write off" เป็นของใหม่จริง — ขั้นถัดไปตอนขายเครื่องที่รื้อถอนแล้วออกไป
 *
 * ต้องแปลงข้อมูลเดิมด้วย ไม่ใช่แค่เปลี่ยนตัวเลือก ไม่งั้นเครื่องเก่าจะค้างอยู่กับ
 * ชื่อสถานะที่ไม่มีในรายการแล้ว เปิดฟอร์มแก้ไขทีไรช่องสถานะจะว่างเปล่าทุกครั้ง
 *
 * ครอบคลุม 4 ที่:
 *   - สถานะของเครื่อง (air_units.Status)
 *   - ตัวเลือกสถานะ   (config_values หมวด Status)
 *   - เหตุการณ์ในประวัติ (history.EventType)
 *   - ตัวเลือกเหตุการณ์ (config_values หมวด EventType)
 * ตัวเลือกที่ผู้ใช้เห็นอ่านจาก config_values ไม่ได้อ่านจากค่าตั้งต้นในโค้ด
 *
 * รันซ้ำได้ไม่เสียหาย เพราะรอบสองจะไม่เหลือชื่อเก่าให้แปลงแล้ว
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase } from '../platform/backup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');
const apply = process.argv.includes('--apply');

/** ชื่อเก่า -> ชื่อใหม่ (เทียบแบบตรงตัวหลังตัดช่องว่างหัวท้าย) */
const RENAME = {
  'ปลดระวาง': 'รื้อถอน/ปลดระวาง',
  'ชำรุด/ปลดระวาง': 'รื้อถอน/ปลดระวาง'   // ค่าจากยุคก่อนแยกสถานะ เผื่อยังหลงเหลือ
};

/** ชุดสถานะที่ต้องมีในตัวเลือก เรียงตามลำดับวงจรของเครื่อง */
const STATUS = ['ใช้งานปกติ', 'ชำรุด', 'รอซ่อม', 'รื้อถอน/ปลดระวาง', 'Write off'];

/** ชื่อเหตุการณ์ในประวัติที่ถูกเปลี่ยนชื่อไปพร้อมกับสถานะ */
const EVENT_RENAME = { 'ปลดระวาง': 'รื้อถอน/ปลดระวาง' };

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูลที่ ' + DB + '\n');
  process.exit(1);
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

/* ---------------- 1. เครื่องที่ต้องเปลี่ยนชื่อสถานะ ---------------- */

const units = db.prepare('SELECT row_id, AirCode, Status FROM air_units').all();
const unitFixes = [];
for (const u of units) {
  const to = RENAME[String(u.Status || '').trim()];
  if (to) unitFixes.push({ ...u, to });
}

/* ---------------- 2. ตัวเลือกสถานะในระบบ ---------------- */

const current = db.prepare("SELECT Value FROM config_values WHERE Category = 'Status' ORDER BY Position")
  .all().map(r => String(r.Value));
const sameList = current.length === STATUS.length && current.every((v, i) => v === STATUS[i]);

/* ---------------- 3. ประวัติที่ใช้ชื่อเหตุการณ์เดิม ---------------- */

const events = db.prepare('SELECT row_id, ID, EventType FROM history').all();
const eventFixes = [];
for (const h of events) {
  const to = EVENT_RENAME[String(h.EventType || '').trim()];
  if (to) eventFixes.push({ ...h, to });
}

/* ---------------- 4. ตัวเลือกเหตุการณ์ที่ยังใช้ชื่อเดิม ---------------- */

const eventOpts = db.prepare("SELECT row_id, Value FROM config_values WHERE Category = 'EventType'").all();
const optOld = eventOpts.filter(o => EVENT_RENAME[String(o.Value || '').trim()]);
const optHasNew = eventOpts.some(o => Object.values(EVENT_RENAME).includes(String(o.Value || '').trim()));

/* ---------------- 5. รายงาน ---------------- */

console.log('ตัวเลือกสถานะตอนนี้: ' + (current.join(' · ') || '(ว่าง)'));
console.log('ตัวเลือกสถานะใหม่ : ' + STATUS.join(' · '));
console.log();

console.log('=== สถานะของเครื่องตอนนี้ ===');
const byStatus = db.prepare('SELECT Status, COUNT(*) c FROM air_units GROUP BY Status ORDER BY c DESC').all();
for (const r of byStatus) {
  const to = RENAME[String(r.Status || '').trim()];
  console.log('  ' + String(r.Status).padEnd(18) + String(r.c).padStart(3) + ' เครื่อง' + (to ? '   -> ' + to : ''));
}
console.log();

if (eventFixes.length) {
  console.log('=== ประวัติที่ยังใช้ชื่อเหตุการณ์เดิม ===');
  for (const h of eventFixes) console.log('  ' + h.ID + '  ' + h.EventType + ' -> ' + h.to);
  console.log();
}

if (optOld.length) {
  console.log('=== ตัวเลือกเหตุการณ์ที่ยังใช้ชื่อเดิม ===');
  for (const o of optOld) {
    console.log('  ' + o.Value + (optHasNew ? '  -> ลบทิ้ง (มีชื่อใหม่อยู่แล้ว)' : '  -> ' + EVENT_RENAME[o.Value]));
  }
  console.log();
}

if (unitFixes.length === 0 && sameList && eventFixes.length === 0 && optOld.length === 0) {
  db.close();
  console.log('✅ ตรงกับชุดใหม่อยู่แล้ว ไม่มีอะไรต้องทำ');
  process.exit(0);
}

console.log('จะเปลี่ยนชื่อสถานะของเครื่อง ' + unitFixes.length + ' เครื่อง');
console.log('จะตั้งตัวเลือกสถานะใหม่     ' + (sameList ? 'ไม่ต้อง (ตรงอยู่แล้ว)' : 'ใช่'));
console.log('จะเปลี่ยนชื่อเหตุการณ์ในประวัติ ' + eventFixes.length + ' รายการ');
console.log('จะจัดตัวเลือกเหตุการณ์      ' + (optOld.length ? optOld.length + ' รายการ' : 'ไม่ต้อง'));
console.log();

if (!apply) {
  db.close();
  console.log('👀 ดูอย่างเดียว ยังไม่ได้เปลี่ยนอะไร — เติม --apply เพื่อเปลี่ยนจริง');
  process.exit(0);
}

/* ---------------- 6. เขียนจริง ---------------- */

const backup = backupDatabase(db, join(ROOT, 'data', 'backups'), 'ก่อนเปลี่ยนชื่อสถานะ');
console.log('💾 สำรองข้อมูลไว้แล้ว: data/backups/' + backup.name);

// ทำทั้งหมดในรายการเดียว ถ้าพลาดกลางคันให้ย้อนกลับทั้งหมด
// ไม่งั้นจะเหลือเครื่องที่ใช้ชื่อสถานะคนละชุดกับตัวเลือกที่มีอยู่
db.exec('BEGIN');
try {
  const setStatus = db.prepare('UPDATE air_units SET Status = ? WHERE row_id = ?');
  for (const u of unitFixes) setStatus.run(u.to, u.row_id);

  if (!sameList) {
    db.prepare("DELETE FROM config_values WHERE Category = 'Status'").run();
    const ins = db.prepare('INSERT INTO config_values (Category, Value, Position) VALUES (?,?,?)');
    STATUS.forEach((v, i) => ins.run('Status', v, i));
  }

  const setEvent = db.prepare('UPDATE history SET EventType = ? WHERE row_id = ?');
  for (const h of eventFixes) setEvent.run(h.to, h.row_id);

  // ถ้ามีชื่อใหม่อยู่ในตัวเลือกแล้ว ให้ลบชื่อเก่าทิ้ง ไม่ใช่เปลี่ยนชื่อจนได้สองอันเหมือนกัน
  const dropOpt = db.prepare('DELETE FROM config_values WHERE row_id = ?');
  const renameOpt = db.prepare('UPDATE config_values SET Value = ? WHERE row_id = ?');
  for (const o of optOld) {
    if (optHasNew) dropOpt.run(o.row_id);
    else renameOpt.run(EVENT_RENAME[String(o.Value).trim()], o.row_id);
  }

  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ เปลี่ยนไม่สำเร็จ: ' + err.message);
  console.error('   ข้อมูลถูกย้อนกลับเป็นเหมือนเดิมแล้ว');
  db.close();
  process.exit(1);
}

/* ---------------- 7. ตรวจผล ---------------- */

const left = db.prepare('SELECT Status, COUNT(*) c FROM air_units GROUP BY Status ORDER BY c DESC').all();
const unknown = left.filter(r => !STATUS.includes(String(r.Status || '').trim()));
const evLeft = db.prepare("SELECT Value FROM config_values WHERE Category = 'EventType' ORDER BY Position").all()
  .map(r => String(r.Value));
db.close();

console.log();
console.log('✅ เรียบร้อย');
for (const r of left) console.log('   ' + String(r.Status).padEnd(18) + String(r.c).padStart(3) + ' เครื่อง');
console.log('   ตัวเลือกเหตุการณ์: ' + evLeft.join(' · '));

if (unknown.length) {
  console.log();
  console.log('⚠️  ยังมีสถานะที่ไม่อยู่ในชุดใหม่: ' + unknown.map(r => JSON.stringify(r.Status)).join(', '));
  console.log('   เครื่องพวกนี้จะเปิดฟอร์มแก้ไขแล้วช่องสถานะว่าง ต้องไปตั้งค่าใหม่ทีละเครื่อง');
}
