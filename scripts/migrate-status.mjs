/**
 * แยกสถานะ "ชำรุด/ปลดระวาง" ออกเป็น "ชำรุด" กับ "ปลดระวาง"
 * และแก้ประวัติที่เคยบันทึกว่า "อื่นๆ" ให้เป็นชื่อเหตุการณ์ที่ตรงความหมาย
 *
 * วิธีรัน:
 *   node scripts/migrate-status.mjs           ดูอย่างเดียว
 *   node scripts/migrate-status.mjs --apply   เปลี่ยนจริง
 *
 * สถานะใหม่ 4 แบบ:  ใช้งานปกติ / ชำรุด / รอซ่อม / ปลดระวาง
 *
 * เครื่องที่ยังเป็น "ชำรุด/ปลดระวาง" อยู่ ระบบเดาไม่ได้ว่าอันไหนคือชำรุด
 * อันไหนคือปลดระวาง จึงตั้งเป็น "ปลดระวาง" ทั้งหมด แล้วให้คนไปแก้เองในหน้าเว็บ
 * ตัวไหนที่จริงๆ แค่ชำรุดแต่ยังไม่ปลดระวาง
 *
 * ส่วนประวัติใช้วิธีอ่านสถานะเดิมกับสถานะใหม่จากข้อความที่บันทึกไว้
 * แล้วส่งเข้า statusChangeEvent() ตัวเดียวกับที่ระบบใช้จริง
 * จึงได้ผลตรงกับที่ระบบจะบันทึกถ้าเหตุการณ์นั้นเกิดขึ้นวันนี้
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase } from '../platform/backup.js';
import { statusChangeEvent } from '../src/modules/airlist.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');
const apply = process.argv.includes('--apply');

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูลที่ ' + DB + '\n');
  process.exit(1);
}

const STATUSES = ['ใช้งานปกติ', 'ชำรุด', 'รอซ่อม', 'ปลดระวาง'];

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

/* ---------------- 1. ตัวเลือกสถานะใน Config ---------------- */

const currentOptions = db.prepare("SELECT Value FROM config_values WHERE Category='Status' ORDER BY Position")
  .all().map(r => r.Value);
const optionsNeedFix = JSON.stringify(currentOptions) !== JSON.stringify(STATUSES);

console.log('=== 1. ตัวเลือกสถานะ ===');
console.log('  ตอนนี้:  ' + currentOptions.join(' | '));
console.log('  จะเป็น:  ' + STATUSES.join(' | '));
console.log('  ' + (optionsNeedFix ? '→ ต้องแก้' : '✅ ถูกต้องอยู่แล้ว'));
console.log();

/* ---------------- 2. สถานะของเครื่อง ---------------- */

const units = db.prepare("SELECT row_id, AirCode, Status FROM air_units WHERE Status LIKE '%ชำรุด/ปลดระวาง%'").all();

console.log('=== 2. สถานะของเครื่อง ===');
if (!units.length) {
  console.log('  ✅ ไม่มีเครื่องที่ยังใช้สถานะเดิม');
} else {
  console.log('  ' + units.length + ' เครื่องจะเปลี่ยนเป็น "ปลดระวาง"');
  for (const u of units) console.log('    ' + u.AirCode);
  console.log('  ⚠️  ถ้าเครื่องไหนจริงๆ แค่ชำรุดแต่ยังไม่ปลดระวาง ให้ไปแก้เองในหน้าเว็บ');
}
console.log();

/* ---------------- 3. ประวัติที่เป็น "อื่นๆ" ---------------- */

// ข้อความที่ระบบบันทึกไว้ตอนเปลี่ยนสถานะ มีทั้งสถานะเดิมและสถานะใหม่อยู่ในนั้น
// จึงถอดกลับออกมาแล้วคำนวณชื่อเหตุการณ์ใหม่ด้วยตรรกะเดียวกับระบบได้เลย
const DETAIL = /เปลี่ยนสถานะจาก\s*"([^"]*)"\s*เป็น\s*"([^"]*)"/;

// รวมเหตุการณ์ที่เคยแยกย่อยเกินไป กลับมาเป็นชื่อเดียวตามที่ตกลงกันใหม่
// "ซ่อมแล้ว" กับ "กลับมาใช้งาน" ยุบกลับเป็น "ซ่อม" ทั้งคู่
const RETIRED_NAMES = ['อื่นๆ', 'ซ่อมแล้ว', 'กลับมาใช้งาน'];
const placeholders = RETIRED_NAMES.map(() => '?').join(',');

const others = db.prepare(
  'SELECT row_id, ID, Date, AirCode, EventType, Detail FROM history WHERE EventType IN (' + placeholders + ')'
).all(...RETIRED_NAMES);

const historyFixes = [];

for (const h of others) {
  const m = DETAIL.exec(String(h.Detail || ''));
  if (!m) continue;

  const [, before, after] = m;
  const event = statusChangeEvent(after);
  if (event !== h.EventType && event !== 'อื่นๆ') historyFixes.push({ ...h, event, before, after });
}

console.log('=== 3. ประวัติที่ต้องแก้ชื่อเหตุการณ์ ===');
console.log('  ตรวจ ' + others.length + ' รายการ · แก้ ' + historyFixes.length + ' รายการ');
for (const h of historyFixes) {
  console.log('    ' + h.ID.padEnd(13) + h.Date + '  ' + h.AirCode.padEnd(16) +
              '"' + h.before + '" → "' + h.after + '"  ⇒  ' + h.event);
}
const leftover = others.length - historyFixes.length;
if (leftover) console.log('    (อีก ' + leftover + ' รายการไม่ใช่การเปลี่ยนสถานะ จึงยังเป็น "อื่นๆ" ตามเดิม)');
console.log();

/* ---------------- ตัดสินใจ ---------------- */

if (!optionsNeedFix && !units.length && !historyFixes.length) {
  db.close();
  console.log('✅ ทุกอย่างถูกต้องอยู่แล้ว ไม่มีอะไรต้องทำ');
  process.exit(0);
}

if (!apply) {
  db.close();
  console.log('👀 ดูอย่างเดียว ยังไม่ได้เปลี่ยนอะไร — เติม --apply เพื่อเปลี่ยนจริง');
  process.exit(0);
}

/* ---------------- เขียนจริง ---------------- */

const backup = backupDatabase(db, join(ROOT, 'data', 'backups'), 'ก่อนแยกสถานะ');
console.log('💾 สำรองข้อมูลไว้แล้ว: data/backups/' + backup.name);

db.exec('BEGIN');
try {
  if (optionsNeedFix) {
    db.prepare("DELETE FROM config_values WHERE Category='Status'").run();
    const ins = db.prepare('INSERT INTO config_values (Category, Value, Position) VALUES (?, ?, ?)');
    STATUSES.forEach((v, i) => ins.run('Status', v, i));
  }

  const setStatus = db.prepare('UPDATE air_units SET Status = ? WHERE row_id = ?');
  for (const u of units) setStatus.run('ปลดระวาง', u.row_id);

  const setEvent = db.prepare('UPDATE history SET EventType = ? WHERE row_id = ?');
  for (const h of historyFixes) setEvent.run(h.event, h.row_id);

  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ เปลี่ยนไม่สำเร็จ: ' + err.message);
  console.error('   ข้อมูลถูกย้อนกลับเป็นเหมือนเดิมแล้ว');
  db.close();
  process.exit(1);
}

console.log();
console.log('✅ เรียบร้อย');
console.log('   สถานะที่ใช้อยู่ตอนนี้:');
for (const r of db.prepare('SELECT Status, COUNT(*) c FROM air_units GROUP BY Status ORDER BY c DESC').all()) {
  console.log('     ' + String(r.Status || '(ว่าง)').padEnd(14) + r.c);
}
console.log('   เหตุการณ์ในประวัติ:');
for (const r of db.prepare('SELECT EventType, COUNT(*) c FROM history GROUP BY EventType ORDER BY c DESC').all()) {
  console.log('     ' + String(r.EventType).padEnd(14) + r.c);
}
db.close();

console.log();
console.log('ℹ️  ถ้าเหตุการณ์เปลี่ยนแล้ว ให้รัน node scripts/renumber-history.mjs อีกครั้ง');
console.log('   เผื่อเลขที่เอกสารต้องเปลี่ยนตามประเภทงาน');
