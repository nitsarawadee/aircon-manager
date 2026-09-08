/**
 * ล้างอาการเสียที่ค้างอยู่ในเครื่องที่ไม่ได้รออะไรอยู่แล้ว
 *
 * วิธีรัน:
 *   node scripts/clear-stale-repair-notes.mjs           ดูอย่างเดียว
 *   node scripts/clear-stale-repair-notes.mjs --apply   ล้างจริง
 *
 * ที่มา: ก่อนหน้านี้ตอนกดปิดงานซ่อม ระบบเปลี่ยนสถานะกลับเป็น "ใช้งานปกติ" ให้
 * แต่ไม่ได้ล้างช่องหมายเหตุ อาการเสียจึงค้างอยู่กับเครื่องตลอดไป
 * ทั้งที่ซ่อมเสร็จไปแล้ว ทำให้เปิดดูหน้าเครื่องแล้วเข้าใจผิดว่ายังเสียอยู่
 *
 * ตัวโปรแกรมแก้ที่ต้นเหตุไปแล้ว (completeRepairRecord ล้างให้เอง) สคริปต์นี้
 * มีไว้เก็บกวาดของที่ค้างมาจากก่อนหน้านั้น
 *
 * เกณฑ์: ล้างเฉพาะเครื่องที่ "ไม่ได้อยู่ในสถานะรอซ่อม" แต่ยังมีหมายเหตุค้าง
 * เพราะช่องนี้ถูกใช้เป็นที่บันทึกอาการเสียอย่างเดียว (ป้ายในฟอร์มก็เขียนไว้แบบนั้น)
 * เครื่องที่ยังรอซ่อมอยู่ต้องไม่แตะ เพราะอาการนั้นยังใช้งานอยู่จริง
 *
 * ไม่เพิ่มรายการประวัติใหม่ เพราะการซ่อมถูกบันทึกไว้แล้วตอนปิดงาน
 * การเติมเหตุการณ์ที่ไม่ได้เกิดขึ้นจริงเข้าไปจะทำให้ประวัติเชื่อถือไม่ได้
 *
 * รันซ้ำได้ไม่เสียหาย เพราะรอบสองจะไม่เหลือรายการให้ล้างแล้ว
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase } from '../platform/backup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');
const apply = process.argv.includes('--apply');

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูลที่ ' + DB + '\n');
  process.exit(1);
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

const stale = db.prepare(
  "SELECT row_id, AirCode, NodeName, Status, Note FROM air_units " +
  "WHERE TRIM(COALESCE(Note,'')) <> '' AND TRIM(COALESCE(Status,'')) <> 'รอซ่อม' " +
  "ORDER BY AirCode"
).all();

const keep = db.prepare(
  "SELECT COUNT(*) c FROM air_units WHERE TRIM(COALESCE(Note,'')) <> '' AND TRIM(COALESCE(Status,'')) = 'รอซ่อม'"
).get().c;

console.log('เครื่องที่มีอาการเสียค้างอยู่ทั้งที่ไม่ได้รอซ่อม: ' + stale.length + ' เครื่อง');
console.log('เครื่องที่ยังรอซ่อมอยู่ (ไม่แตะ):                  ' + keep + ' เครื่อง');
console.log();

if (stale.length === 0) {
  db.close();
  console.log('✅ ไม่มีอะไรค้าง ไม่ต้องทำอะไร');
  process.exit(0);
}

console.log('=== รายการที่จะล้าง ===');
for (const r of stale) {
  console.log('  ' + String(r.AirCode).padEnd(18) + String(r.Status).padEnd(14) +
              '(' + String(r.NodeName || '-') + ')  ' + JSON.stringify(r.Note));
}
console.log();

if (!apply) {
  db.close();
  console.log('👀 ดูอย่างเดียว ยังไม่ได้ล้างอะไร — เติม --apply เพื่อล้างจริง');
  process.exit(0);
}

const backup = backupDatabase(db, join(ROOT, 'data', 'backups'), 'ก่อนล้างอาการเสียค้าง');
console.log('💾 สำรองข้อมูลไว้แล้ว: data/backups/' + backup.name);

// ทำทั้งหมดในรายการเดียว ถ้าพลาดกลางคันให้ย้อนกลับทั้งหมด
db.exec('BEGIN');
try {
  const clear = db.prepare("UPDATE air_units SET Note = '' WHERE row_id = ?");
  for (const r of stale) clear.run(r.row_id);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ ล้างไม่สำเร็จ: ' + err.message);
  console.error('   ข้อมูลถูกย้อนกลับเป็นเหมือนเดิมแล้ว');
  db.close();
  process.exit(1);
}

const left = db.prepare(
  "SELECT COUNT(*) c FROM air_units WHERE TRIM(COALESCE(Note,'')) <> '' AND TRIM(COALESCE(Status,'')) <> 'รอซ่อม'"
).get().c;
db.close();

console.log();
console.log('✅ เรียบร้อย ล้างไป ' + stale.length + ' เครื่อง');
console.log('   ที่ยังค้างอยู่: ' + left);
