/**
 * เปลี่ยนเลข ID ของประวัติเดิม จากเลขเวลาเป็นเลขรันที่อ่านออก
 *
 * วิธีรัน:
 *   node scripts/renumber-history.mjs           ดูอย่างเดียว
 *   node scripts/renumber-history.mjs --apply   เปลี่ยนจริง
 *
 * ของเดิมเป็น H1785308032365 (เวลาเป็นมิลลิวินาที) ซึ่งอ่านไม่ออกว่ารายการที่เท่าไหร่
 * เปลี่ยนเป็น H-0001 H-0002 ไล่ตามลำดับเวลาที่บันทึกเข้ามา
 *
 * ปลอดภัยเพราะตรวจแล้วว่าไม่มีตารางไหนอ้างถึง ID ของประวัติเลย
 * (ฟอร์มล้างแอร์ใช้ ID ของตัวเองที่ขึ้นต้นด้วย CF ไม่เกี่ยวกัน)
 *
 * คำสั่งนี้ตั้งใจให้รันครั้งเดียว รันซ้ำได้ไม่เสียหาย เพราะจะข้ามรายการที่แปลงแล้ว
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

// เรียงตาม row_id เพราะเป็นลำดับที่ข้อมูลถูกเขียนเข้ามาจริง
// (เรียงตาม Date ไม่ได้ เพราะวันที่ของเหตุการณ์ไม่ใช่วันที่บันทึก)
const rows = db.prepare('SELECT row_id, ID, AirCode, Date, EventType FROM history ORDER BY row_id').all();

const todo = [];
let n = 0;
for (const r of rows) {
  const already = /^H-\d+$/.test(String(r.ID || '').trim());
  if (already) {
    // นับต่อจากเลขที่แปลงไว้แล้ว เพื่อให้รันซ้ำได้โดยไม่ทับกัน
    n = Math.max(n, Number(String(r.ID).slice(2)));
    continue;
  }
  todo.push({ row_id: r.row_id, from: r.ID, to: 'H-' + String(++n).padStart(4, '0'), r });
}

console.log('ประวัติทั้งหมด ' + rows.length + ' รายการ');
console.log('ต้องเปลี่ยนเลข ' + todo.length + ' รายการ');
console.log();

if (!todo.length) {
  db.close();
  console.log('✅ ทุกรายการใช้เลขรันอยู่แล้ว ไม่มีอะไรต้องทำ');
  process.exit(0);
}

console.log('=== ตัวอย่างการเปลี่ยน ===');
for (const t of todo.slice(0, 8)) {
  console.log('  ' + String(t.from).padEnd(16) + ' -> ' + t.to +
              '   (' + t.r.Date + ' ' + t.r.AirCode + ' ' + t.r.EventType + ')');
}
if (todo.length > 8) console.log('  ... และอีก ' + (todo.length - 8) + ' รายการ');
console.log();

if (!apply) {
  db.close();
  console.log('👀 ดูอย่างเดียว ยังไม่ได้เปลี่ยนอะไร — เติม --apply เพื่อเปลี่ยนจริง');
  process.exit(0);
}

const backup = backupDatabase(db, join(ROOT, 'data', 'backups'), 'ก่อนเปลี่ยนเลขประวัติ');
console.log('💾 สำรองข้อมูลไว้แล้ว: data/backups/' + backup.name);

// เปลี่ยนทั้งหมดในรายการเดียว ถ้าพลาดกลางคันให้ย้อนกลับทั้งหมด
// ไม่งั้นจะเหลือประวัติที่ใช้เลขคนละแบบปนกันซึ่งแก้ตามยาก
db.exec('BEGIN');
try {
  const stmt = db.prepare('UPDATE history SET ID = ? WHERE row_id = ?');
  for (const t of todo) stmt.run(t.to, t.row_id);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ เปลี่ยนไม่สำเร็จ: ' + err.message);
  console.error('   ข้อมูลถูกย้อนกลับเป็นเหมือนเดิมแล้ว');
  db.close();
  process.exit(1);
}

const check = db.prepare("SELECT COUNT(*) c FROM history WHERE ID NOT LIKE 'H-%'").get().c;
db.close();

console.log();
console.log('✅ เปลี่ยนเรียบร้อย ' + todo.length + ' รายการ');
console.log('   รายการที่ยังไม่ใช่เลขรัน: ' + check);
