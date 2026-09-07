/**
 * แปลงเลขที่เอกสารของประวัติเดิม ให้เป็นรูปแบบ PM/CM + ปี + เดือน + ลำดับ
 * และแก้เหตุการณ์ที่เป็นการปลดระวาง จากที่เคยบันทึกว่า "อื่นๆ" ให้เป็น "ปลดระวาง"
 *
 * วิธีรัน:
 *   node scripts/renumber-history.mjs           ดูอย่างเดียว
 *   node scripts/renumber-history.mjs --apply   เปลี่ยนจริง
 *
 * รูปแบบใหม่:
 *   PM2609-01     งานล้างแอร์ ก.ย. 2026 ลำดับที่ 1
 *   CM2611-123    งานซ่อม พ.ย. 2026 ลำดับที่ 123
 *
 * ปลอดภัยเพราะตรวจแล้วว่าไม่มีตารางไหนอ้างถึง ID ของประวัติเลย
 * (ฟอร์มล้างแอร์ใช้ ID ของตัวเองที่ขึ้นต้นด้วย CF ไม่เกี่ยวกัน)
 *
 * รันซ้ำได้ไม่เสียหาย เพราะคำนวณเลขใหม่ทั้งชุดจากข้อมูลจริงทุกครั้ง
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase } from '../platform/backup.js';
import { historyPrefix } from '../src/modules/history.js';
import { safeParseDate, partsOf } from '../src/values.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');
const apply = process.argv.includes('--apply');

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูลที่ ' + DB + '\n');
  process.exit(1);
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

// เรียงตาม row_id เพราะเป็นลำดับที่ข้อมูลถูกบันทึกเข้ามาจริง
// ลำดับในเลขที่เอกสารจึงสะท้อนลำดับการทำงานจริงภายในเดือนนั้น
const rows = db.prepare('SELECT row_id, ID, Date, AirCode, EventType, Detail FROM history ORDER BY row_id').all();

/* ---------------- 1. แก้เหตุการณ์ปลดระวาง ---------------- */

// รายการที่บันทึกว่า "อื่นๆ" แต่เนื้อหาบอกว่าเปลี่ยนสถานะไปเป็นชำรุด/ปลดระวาง
// ต้องแยกให้ออกจากรายการที่เปลี่ยน "กลับมา" ใช้งานปกติ ซึ่งไม่ใช่การปลดระวาง
const isDecommission = r =>
  String(r.EventType) === 'อื่นๆ' && /เป็น\s*"[^"]*(?:ปลดระวาง|ชำรุด)[^"]*"/.test(String(r.Detail || ''));

const eventFixes = rows.filter(isDecommission);
for (const r of eventFixes) r.EventType = 'ปลดระวาง';

/* ---------------- 2. คำนวณเลขที่ใหม่ทั้งชุด ---------------- */

const counters = new Map();   // stem -> ลำดับล่าสุด
const plan = [];

for (const r of rows) {
  const d = safeParseDate(r.Date);
  if (!d) {
    console.warn('⚠️  ข้าม row_id ' + r.row_id + ' เพราะวันที่ใช้ไม่ได้: ' + JSON.stringify(r.Date));
    continue;
  }

  const { y, m } = partsOf(d);
  const stem = historyPrefix(r.EventType) + String(y).slice(-2) + String(m).padStart(2, '0') + '-';

  const n = (counters.get(stem) || 0) + 1;
  counters.set(stem, n);

  const id = stem + String(n).padStart(2, '0');
  if (id !== r.ID) plan.push({ row_id: r.row_id, from: r.ID, to: id, r });
}

/* ---------------- 3. รายงาน ---------------- */

console.log('ประวัติทั้งหมด ' + rows.length + ' รายการ');
console.log('  แก้เหตุการณ์เป็น "ปลดระวาง"  ' + eventFixes.length + ' รายการ');
console.log('  เปลี่ยนเลขที่เอกสาร          ' + plan.length + ' รายการ');
console.log();

if (eventFixes.length) {
  console.log('=== รายการที่เปลี่ยนเป็น "ปลดระวาง" ===');
  for (const r of eventFixes.slice(0, 10)) {
    console.log('  ' + r.Date + '  ' + String(r.AirCode).padEnd(16) + String(r.Detail).slice(0, 55));
  }
  console.log();
}

if (plan.length) {
  console.log('=== ตัวอย่างเลขที่ใหม่ ===');
  for (const t of plan.slice(0, 10)) {
    console.log('  ' + String(t.from).padEnd(12) + ' -> ' + String(t.to).padEnd(13) +
                '(' + t.r.Date + '  ' + t.r.EventType + ')');
  }
  if (plan.length > 10) console.log('  ... และอีก ' + (plan.length - 10) + ' รายการ');
  console.log();
}

console.log('=== สรุปตามเดือน ===');
for (const [stem, n] of [...counters].sort()) {
  console.log('  ' + stem + '  ' + String(n).padStart(3) + ' รายการ   (ล่าสุด ' + stem + String(n).padStart(2, '0') + ')');
}
console.log();

if (!plan.length && !eventFixes.length) {
  db.close();
  console.log('✅ ทุกรายการถูกต้องอยู่แล้ว ไม่มีอะไรต้องทำ');
  process.exit(0);
}

if (!apply) {
  db.close();
  console.log('👀 ดูอย่างเดียว ยังไม่ได้เปลี่ยนอะไร — เติม --apply เพื่อเปลี่ยนจริง');
  process.exit(0);
}

/* ---------------- 4. เขียนจริง ---------------- */

const backup = backupDatabase(db, join(ROOT, 'data', 'backups'), 'ก่อนเปลี่ยนเลขที่ประวัติ');
console.log('💾 สำรองข้อมูลไว้แล้ว: data/backups/' + backup.name);

// ทำทั้งหมดในรายการเดียว ถ้าพลาดกลางคันให้ย้อนกลับทั้งหมด
// ไม่งั้นจะเหลือประวัติที่ใช้เลขคนละแบบปนกันซึ่งแก้ตามยาก
db.exec('BEGIN');
try {
  const setEvent = db.prepare('UPDATE history SET EventType = ? WHERE row_id = ?');
  for (const r of eventFixes) setEvent.run('ปลดระวาง', r.row_id);

  const setId = db.prepare('UPDATE history SET ID = ? WHERE row_id = ?');
  for (const t of plan) setId.run(t.to, t.row_id);

  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ เปลี่ยนไม่สำเร็จ: ' + err.message);
  console.error('   ข้อมูลถูกย้อนกลับเป็นเหมือนเดิมแล้ว');
  db.close();
  process.exit(1);
}

const dup = db.prepare('SELECT COUNT(*) c FROM (SELECT ID FROM history GROUP BY ID HAVING COUNT(*) > 1)').get().c;
const bad = db.prepare("SELECT COUNT(*) c FROM history WHERE ID NOT LIKE 'PM%' AND ID NOT LIKE 'CM%'").get().c;
db.close();

console.log();
console.log('✅ เรียบร้อย');
console.log('   เลขที่ซ้ำกัน: ' + dup);
console.log('   รายการที่ยังไม่ใช่รูปแบบใหม่: ' + bad);
