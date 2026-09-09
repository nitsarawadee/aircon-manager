/**
 * ล้างร่องรอยการทดลอง "เปลี่ยนเครื่อง" ของเวอร์ชันเก่า
 *
 * วิธีรัน:
 *   node scripts/clean-demo-replace.mjs            ดูอย่างเดียวว่าจะเปลี่ยนอะไร (ไม่เขียน)
 *   node scripts/clean-demo-replace.mjs --apply    เขียนจริง
 *
 * ============================================================================
 * ที่มา
 * ============================================================================
 * replaceAirUnit เวอร์ชันเก่าปลดระวางรหัสเดิมแล้วสร้างแถวใหม่ ซึ่งบังคับให้ตั้ง
 * รหัสใหม่เพราะรหัสห้ามซ้ำ การทดลองกดจึงทิ้งไว้สองอย่าง
 *
 *   1. หมายเหตุบนเครื่องเดิม ที่ชี้ไปหาเครื่องทดสอบซึ่งถูกลบไปแล้ว
 *   2. ใบประวัติของการทดลอง (เปลี่ยนเครื่อง / ติดตั้ง / ลบเครื่องทดสอบ)
 *
 * เวอร์ชันใหม่แก้ตัวเครื่องที่ตำแหน่งเดิม ไม่งอกแถวและไม่เขียนหมายเหตุแบบนั้นอีก
 * สคริปต์นี้จึงเป็นการเก็บของที่ค้างจากเวอร์ชันเก่าครั้งเดียว ไม่ใช่ของที่ต้องรันซ้ำ
 *
 * ข้อมูลของ "ตัวเครื่อง" (ยี่ห้อ BTU รุ่น S/N ทะเบียน วันติดตั้ง) ไม่ถูกแตะ
 * เพราะค่าที่อยู่ตอนนี้เป็นของเครื่องเดิมที่ถูกต้องแล้ว การทดลองไม่ได้เขียนทับ
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase, pruneBackups } from '../platform/backup.js';
import { ymdhms } from '../src/values.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');
const BACKUP_DIR = join(ROOT, 'data', 'backups');

const apply = process.argv.slice(2).includes('--apply');

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูล: ' + DB + '\n');
  process.exit(1);
}

/** เครื่องที่ถูกทดลองเปลี่ยน และใบประวัติที่เกิดจากการทดลองนั้น */
const TARGET_CODE = 'AYA-BPC-AIR-1';
const DEMO_HISTORY_IDS = ['CM2609-09', 'CM2609-10', 'CM2609-11'];

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

const unit = db.prepare(
  'SELECT row_id, AirCode, Status, Note, Brand, IndoorSN FROM air_units WHERE AirCode = ?'
).get(TARGET_CODE);

if (!unit) {
  console.error('\n❌ ไม่พบเครื่องรหัส ' + TARGET_CODE + ' ในระบบ\n');
  process.exit(1);
}

const rows = DEMO_HISTORY_IDS
  .map(id => db.prepare('SELECT row_id, ID, Date, AirCode, EventType, Detail FROM history WHERE ID = ?').get(id))
  .filter(Boolean);

console.log('\n' + (apply ? '=== เขียนจริง ===' : '=== ดูอย่างเดียว (ยังไม่เขียน) ==='));

console.log('\nเครื่อง ' + unit.AirCode);
console.log('   สถานะ        : ' + unit.Status + '  (ไม่แก้)');
console.log('   ยี่ห้อ / S/N  : ' + unit.Brand + ' / ' + unit.IndoorSN + '  (ไม่แก้ — เป็นของเครื่องเดิมที่ถูกต้อง)');
const noteNow = String(unit.Note || '');
if (noteNow.trim()) {
  console.log('   หมายเหตุเดิม : "' + noteNow + '"');
  console.log('   หมายเหตุใหม่ : (ว่าง)');
} else {
  console.log('   หมายเหตุ     : ว่างอยู่แล้ว  (ไม่ต้องแก้)');
}

console.log('\nใบประวัติที่จะลบ ' + rows.length + ' ใบ' + (rows.length ? '' : '  (ไม่พบ — อาจลบไปแล้ว)'));
for (const r of rows) {
  console.log('   ' + r.ID + ' | ' + r.Date + ' | ' + r.AirCode + ' | ' + r.EventType);
  console.log('      ' + String(r.Detail || '').slice(0, 90));
}

const missing = DEMO_HISTORY_IDS.filter(id => !rows.some(r => r.ID === id));
if (missing.length) console.log('   ไม่พบเลขที่: ' + missing.join(', '));

const willChange = noteNow.trim() !== '' || rows.length > 0;
if (!willChange) {
  console.log('\n✅ ไม่มีอะไรต้องแก้ ข้อมูลสะอาดอยู่แล้ว\n');
  db.close();
  process.exit(0);
}

if (!apply) {
  console.log('\nยังไม่ได้เขียนอะไรลงฐานข้อมูล');
  console.log('ถ้าถูกต้องแล้ว สั่ง: node scripts/clean-demo-replace.mjs --apply\n');
  db.close();
  process.exit(0);
}

// สำรองก่อนเขียนทุกครั้ง ใช้ VACUUM INTO เพราะสำเนาแบบ copy ไฟล์จะไม่รวม WAL
const backup = backupDatabase(db, BACKUP_DIR, 'ก่อนล้างข้อมูลทดลองเปลี่ยนเครื่อง');
console.log('\nสำรองไว้ที่: ' + backup.path);
pruneBackups(BACKUP_DIR);

// ทรานแซกชันเดียว ถ้าพลาดกลางทางต้องไม่เหลือครึ่งๆ กลางๆ
db.exec('BEGIN');
try {
  let cleared = 0;
  if (noteNow.trim()) {
    db.prepare('UPDATE air_units SET Note = ?, UpdatedAt = ?, UpdatedBy = ? WHERE row_id = ?')
      // ใช้ ymdhms เหมือนทุกทางเขียนในระบบ ไม่ใช่ toISOString ซึ่งได้เวลา UTC
      // ทำให้เวลาแก้ไขล่าสุดเพี้ยนไป 7 ชั่วโมงเทียบกับแถวอื่น
      .run('', ymdhms(new Date()), 'cleanup-script', unit.row_id);
    cleared = 1;
  }

  let removed = 0;
  for (const r of rows) {
    db.prepare('DELETE FROM history WHERE row_id = ?').run(r.row_id);
    removed++;
  }

  db.exec('COMMIT');
  console.log('\n✅ เสร็จแล้ว — ล้างหมายเหตุ ' + cleared + ' รายการ · ลบประวัติ ' + removed + ' ใบ');
  console.log('   เลขที่เอกสารที่ลบไปจะไม่ถูกนำกลับมาใช้ซ้ำ ใบถัดไปจะรันเลขต่อจากเดิม\n');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ ผิดพลาด ไม่ได้เขียนอะไรลงไป: ' + err.message + '\n');
  process.exitCode = 1;
} finally {
  db.close();
}
