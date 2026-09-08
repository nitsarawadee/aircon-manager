/**
 * ลบตัวเลือกเหตุการณ์ที่ซ้ำซ้อนออกจากรายการ
 *
 * วิธีรัน:
 *   node scripts/clean-event-types.mjs           ดูอย่างเดียว
 *   node scripts/clean-event-types.mjs --apply   ลบจริง
 *
 * ที่มา: รายการตัวเลือกเหตุการณ์สะสมของตกค้างมาตั้งแต่ยุค Google Sheets
 * บางตัวไม่มีโค้ดไหนเขียน ไม่มีประวัติใบไหนใช้ และซ้ำความหมายกับตัวที่ใช้จริงอยู่แล้ว
 * ปล่อยไว้จะทำให้คนเลือกผิด แล้วได้เหตุการณ์ที่ระบบไม่รู้จักว่าเป็นงานประเภทไหน
 *
 * ลบเฉพาะรายชื่อที่ระบุไว้ตรงๆ ข้างล่าง ไม่ใช่ "ลบทุกตัวที่ไม่เคยถูกใช้"
 * เพราะบางตัวยังไม่เคยถูกใช้แต่ตั้งใจให้มีไว้เลือกเอง (เปลี่ยนอะไหล่ ตรวจเช็คทั่วไป)
 *
 * ปลอดภัยเพราะเช็คก่อนลบว่าไม่มีประวัติใบไหนใช้ค่านั้นอยู่จริง
 * ถ้ามีจะข้ามไปพร้อมบอกเหตุผล ไม่ลบทิ้งจนประวัติกลายเป็นค่าที่ไม่มีในรายการ
 *
 * รันซ้ำได้ไม่เสียหาย เพราะรอบสองจะไม่เหลือให้ลบแล้ว
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase } from '../platform/backup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');
const apply = process.argv.includes('--apply');

/** ตัวเลือกที่ต้องลบ พร้อมเหตุผลว่าตัวไหนใช้แทน */
const DROP = {
  'ย้ายตำแหน่ง': 'ซ้ำกับ "ย้าย" ซึ่งเป็นตัวที่ปุ่มย้ายเครื่องเขียนจริง',
  'ซ่อม': 'ซ้ำกับ "ซ่อมแล้ว" ซึ่งเป็นตัวที่ปุ่มปิดงานซ่อมเขียนจริง'
};

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูลที่ ' + DB + '\n');
  process.exit(1);
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

const opts = db.prepare("SELECT row_id, Value FROM config_values WHERE Category = 'EventType' ORDER BY Position").all();
const usedCount = db.prepare('SELECT EventType, COUNT(*) c FROM history GROUP BY EventType').all();
const used = Object.fromEntries(usedCount.map(r => [String(r.EventType), r.c]));

console.log('=== ตัวเลือกเหตุการณ์ตอนนี้ ===');
for (const o of opts) {
  const n = used[String(o.Value)] || 0;
  const mark = DROP[String(o.Value).trim()] ? '  <- จะลบ' : '';
  console.log('  ' + String(o.Value).padEnd(20) + (n ? n + ' ใบ' : 'ไม่เคยถูกใช้') + mark);
}
console.log();

const toDrop = [];
const skipped = [];
for (const o of opts) {
  const reason = DROP[String(o.Value).trim()];
  if (!reason) continue;

  // ถ้ามีประวัติใช้ค่านี้อยู่ ห้ามลบ ไม่งั้นประวัติจะเหลือค่าที่ไม่มีในรายการ
  // แล้วเปิดฟอร์มแก้ไขทีไรช่องเหตุการณ์จะว่างเปล่า
  const n = used[String(o.Value)] || 0;
  if (n > 0) skipped.push({ ...o, n });
  else toDrop.push({ ...o, reason });
}

if (skipped.length) {
  console.log('⚠️  ข้ามไม่ลบ เพราะยังมีประวัติใช้อยู่:');
  for (const s of skipped) console.log('   ' + s.Value + '  (' + s.n + ' ใบ)');
  console.log('   ต้องเปลี่ยนชื่อในประวัติก่อน ถึงจะลบตัวเลือกได้');
  console.log();
}

if (toDrop.length === 0) {
  db.close();
  console.log('✅ ไม่มีตัวเลือกที่ต้องลบ');
  process.exit(0);
}

console.log('=== จะลบ ===');
for (const d of toDrop) console.log('  ' + String(d.Value).padEnd(20) + d.reason);
console.log();

if (!apply) {
  db.close();
  console.log('👀 ดูอย่างเดียว ยังไม่ได้ลบอะไร — เติม --apply เพื่อลบจริง');
  process.exit(0);
}

const backup = backupDatabase(db, join(ROOT, 'data', 'backups'), 'ก่อนลบตัวเลือกเหตุการณ์ซ้ำ');
console.log('💾 สำรองข้อมูลไว้แล้ว: data/backups/' + backup.name);

db.exec('BEGIN');
try {
  const del = db.prepare('DELETE FROM config_values WHERE row_id = ?');
  for (const d of toDrop) del.run(d.row_id);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ ลบไม่สำเร็จ: ' + err.message);
  console.error('   ข้อมูลถูกย้อนกลับเป็นเหมือนเดิมแล้ว');
  db.close();
  process.exit(1);
}

const left = db.prepare("SELECT Value FROM config_values WHERE Category = 'EventType' ORDER BY Position")
  .all().map(r => String(r.Value));
db.close();

console.log();
console.log('✅ เรียบร้อย ลบไป ' + toDrop.length + ' ตัวเลือก');
console.log('   ที่เหลือ: ' + left.join(' · '));
