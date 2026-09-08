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
 * "ปลดระวาง" ถูกเปลี่ยนชื่อเป็น "รื้อถอน/ปลดระวาง" เพื่อให้ตรงกับคำที่ใช้หน้างาน
 * และเพิ่ม "Write off" เป็นขั้นถัดไปตอนขายเครื่องที่รื้อถอนแล้วออกไป
 *
 * ต้องแปลงข้อมูลเดิมด้วย ไม่ใช่แค่เปลี่ยนตัวเลือก ไม่งั้นเครื่องเก่าจะค้างอยู่กับ
 * ชื่อสถานะที่ไม่มีในรายการแล้ว เปิดฟอร์มแก้ไขทีไรช่องสถานะจะว่างเปล่าทุกครั้ง
 *
 * แก้ทั้งตารางเครื่องและตารางตัวเลือก (config_values) เพราะตัวเลือกที่ผู้ใช้เห็น
 * อ่านจากตารางนั้น ไม่ได้อ่านจากค่าตั้งต้นในโค้ด
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

/* ---------------- 3. รายงาน ---------------- */

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

if (unitFixes.length === 0 && sameList) {
  db.close();
  console.log('✅ ตรงกับชุดใหม่อยู่แล้ว ไม่มีอะไรต้องทำ');
  process.exit(0);
}

console.log('จะเปลี่ยนชื่อสถานะของเครื่อง ' + unitFixes.length + ' เครื่อง');
console.log('จะตั้งตัวเลือกสถานะใหม่     ' + (sameList ? 'ไม่ต้อง (ตรงอยู่แล้ว)' : 'ใช่'));
console.log();

if (!apply) {
  db.close();
  console.log('👀 ดูอย่างเดียว ยังไม่ได้เปลี่ยนอะไร — เติม --apply เพื่อเปลี่ยนจริง');
  process.exit(0);
}

/* ---------------- 4. เขียนจริง ---------------- */

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

  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ เปลี่ยนไม่สำเร็จ: ' + err.message);
  console.error('   ข้อมูลถูกย้อนกลับเป็นเหมือนเดิมแล้ว');
  db.close();
  process.exit(1);
}

/* ---------------- 5. ตรวจผล ---------------- */

const left = db.prepare('SELECT Status, COUNT(*) c FROM air_units GROUP BY Status ORDER BY c DESC').all();
const unknown = left.filter(r => !STATUS.includes(String(r.Status || '').trim()));
db.close();

console.log();
console.log('✅ เรียบร้อย');
for (const r of left) console.log('   ' + String(r.Status).padEnd(18) + String(r.c).padStart(3) + ' เครื่อง');
if (unknown.length) {
  console.log();
  console.log('⚠️  ยังมีสถานะที่ไม่อยู่ในชุดใหม่: ' + unknown.map(r => JSON.stringify(r.Status)).join(', '));
  console.log('   เครื่องพวกนี้จะเปิดฟอร์มแก้ไขแล้วช่องสถานะว่าง ต้องไปตั้งค่าใหม่ทีละเครื่อง');
}
