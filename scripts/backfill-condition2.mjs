/**
 * เติมผลประเมินของเครื่องที่ 2 ให้เอกสารเก่าที่บันทึกไว้ก่อนแยกผลรายเครื่อง
 *
 * วิธีรัน:
 *   node scripts/backfill-condition2.mjs           ดูอย่างเดียว
 *   node scripts/backfill-condition2.mjs --apply   เติมจริง
 *
 * ที่มา: แบบฟอร์มกระดาษให้ติ๊กผลประเมินแยกรายเครื่อง แต่ระบบเดิมเก็บไว้ค่าเดียว
 * ต่อใบ (คอลัมน์ EquipmentCondition) เอกสารสองเครื่องจึงติ๊กตรงกันเสมอ
 * และบันทึกกรณี "ตัวหนึ่งสมบูรณ์ อีกตัวควรปรับปรุง" ไม่ได้เลย
 *
 * ตอนนี้มีคอลัมน์ EquipmentCondition2 แล้ว ผลของเครื่องที่ 1 ยังอยู่คอลัมน์เดิม
 * ส่วนใบเก่าที่มีสองเครื่องยังไม่มีค่าในคอลัมน์ใหม่ ถ้าไม่เติม เอกสารที่ประกอบ
 * ขึ้นมาใหม่จะเว้นช่องติ๊กของเครื่องที่ 2 ว่าง ทั้งที่ตอนกรอกคนกรอกตั้งใจให้
 * ค่านั้นครอบคลุมทั้งใบ
 *
 * ⚠️ สคริปต์นี้มีไว้รันครั้งเดียวตอนอัปเดตเท่านั้น
 * หลังจากนี้ "ช่องของเครื่องที่ 2 ว่าง" แปลว่ายังไม่ได้กรอกจริงๆ
 * เอาค่าของเครื่องที่ 1 ไปเติมให้อีกไม่ได้ เพราะจะกลายเป็นข้อมูลที่ไม่มีใครบันทึก
 * ตัวเลข CreatedAt ที่พิมพ์ออกมาช่วยยืนยันว่าทุกใบในรายการเป็นใบเก่าจริง
 *
 * รันซ้ำได้ไม่เสียหาย เพราะรอบสองจะไม่เหลือใบที่ช่องนั้นยังว่าง
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { addMissingColumns } from '../src/db/migrate.js';
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

// เผื่อกรณียังไม่ได้รีสตาร์ทเซิร์ฟเวอร์หลังอัปเดตโค้ด คอลัมน์ใหม่อาจยังไม่มี
const added = addMissingColumns(db);
if (added.length) console.log('เติมคอลัมน์ที่ขาดให้แล้ว: ' + added.join(', ') + '\n');

const targets = db.prepare(
  "SELECT row_id, DocNo, ID, Date, CreatedAt, AirCode1, AirCode2, EquipmentCondition " +
  "FROM cleaning_forms " +
  "WHERE TRIM(COALESCE(AirCode1,'')) <> '' AND TRIM(COALESCE(AirCode2,'')) <> '' " +
  "  AND TRIM(COALESCE(EquipmentCondition,'')) <> '' " +
  "  AND TRIM(COALESCE(EquipmentCondition2,'')) = '' " +
  "ORDER BY row_id"
).all();

const total = db.prepare('SELECT COUNT(*) c FROM cleaning_forms').get().c;
const twoUnits = db.prepare(
  "SELECT COUNT(*) c FROM cleaning_forms " +
  "WHERE TRIM(COALESCE(AirCode1,'')) <> '' AND TRIM(COALESCE(AirCode2,'')) <> ''"
).get().c;

console.log('เอกสารทั้งหมด:                    ' + total + ' ใบ');
console.log('ใบที่มีสองเครื่อง:                 ' + twoUnits + ' ใบ');
console.log('ใบที่ช่องของเครื่องที่ 2 ยังว่าง:    ' + targets.length + ' ใบ');
console.log();

if (targets.length === 0) {
  db.close();
  console.log('✅ ไม่มีใบไหนค้าง ไม่ต้องทำอะไร');
  process.exit(0);
}

console.log('=== รายการที่จะเติม (คัดลอกผลของเครื่องที่ 1 ไปลงช่องของเครื่องที่ 2) ===');
for (const r of targets) {
  console.log('  ' + String(r.DocNo || r.ID).padEnd(16) +
              'บันทึกเมื่อ ' + String(r.CreatedAt || '-').padEnd(21) +
              String(r.AirCode2).padEnd(18) + '← ' + r.EquipmentCondition);
}
console.log();

if (!apply) {
  db.close();
  console.log('👀 ดูอย่างเดียว ยังไม่ได้เติมอะไร — เติม --apply เพื่อเติมจริง');
  console.log('   ก่อนสั่งจริง ดูคอลัมน์ "บันทึกเมื่อ" ให้แน่ใจว่าทุกใบเป็นใบเก่า');
  process.exit(0);
}

const backup = backupDatabase(db, join(ROOT, 'data', 'backups'), 'ก่อนเติมผลประเมินเครื่องที่ 2');
console.log('💾 สำรองข้อมูลไว้แล้ว: data/backups/' + backup.name);

// ทำทั้งหมดในรายการเดียว ถ้าพลาดกลางคันให้ย้อนกลับทั้งหมด
db.exec('BEGIN');
try {
  const fill = db.prepare('UPDATE cleaning_forms SET EquipmentCondition2 = ? WHERE row_id = ?');
  for (const r of targets) fill.run(r.EquipmentCondition, r.row_id);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ เติมไม่สำเร็จ: ' + err.message);
  console.error('   ข้อมูลถูกย้อนกลับเป็นเหมือนเดิมแล้ว');
  db.close();
  process.exit(1);
}

const left = db.prepare(
  "SELECT COUNT(*) c FROM cleaning_forms " +
  "WHERE TRIM(COALESCE(AirCode1,'')) <> '' AND TRIM(COALESCE(AirCode2,'')) <> '' " +
  "  AND TRIM(COALESCE(EquipmentCondition,'')) <> '' " +
  "  AND TRIM(COALESCE(EquipmentCondition2,'')) = ''"
).get().c;
db.close();

console.log();
console.log('✅ เรียบร้อย เติมไป ' + targets.length + ' ใบ');
console.log('   ที่ยังค้างอยู่: ' + left);
