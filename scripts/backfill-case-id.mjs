/**
 * เติมเลขเคสย้อนหลังให้งานซ่อมที่ยังค้างอยู่
 *
 * วิธีรัน:
 *   node scripts/backfill-case-id.mjs            ดูอย่างเดียวว่าจะเปลี่ยนอะไร
 *   node scripts/backfill-case-id.mjs --apply    เขียนจริง
 *
 * ============================================================================
 * ทำไมต้องมี
 * ============================================================================
 * เครื่องที่แจ้งซ่อมไว้ก่อนระบบเลขเคส มีประวัติอยู่แต่ช่องเลขเคสว่าง
 * หน้างานซ่อมจึงแสดงขีดแทนเลขเคส และที่แย่กว่านั้นคือถ้าเดินเคสต่อจากตรงนี้
 * ระบบจะออกเลขใหม่ให้เฉพาะใบถัดไป ใบแจ้งซ่อมใบแรกจะไม่ถูกนับเข้าเคส
 * ทำให้เคสดูเหมือนเริ่มที่กลางเรื่อง
 *
 * ============================================================================
 * ขอบเขต
 * ============================================================================
 * แตะเฉพาะเครื่องที่ "ยังอยู่ในสถานะงานซ่อม" และ "ยังไม่มีเลขเคสสักใบ"
 * ในช่วงเปิดปัจจุบัน — ประวัติที่ปิดจบไปแล้วไม่แตะ เพราะเรื่องจบแล้ว
 * การใส่เลขย้อนหลังไม่ได้ช่วยอะไร มีแต่จะเสี่ยงจับกลุ่มผิด
 *
 * ช่วงเปิดปัจจุบัน = ใบทั้งหมดนับจากหลังใบที่ปิดเคสใบล่าสุดเป็นต้นมา
 * (ปิดเคส = ซ่อมแล้ว หรือ เปลี่ยนเครื่อง)
 *
 * รันซ้ำได้ รอบสองจะไม่มีอะไรให้ทำ เพราะทุกใบมีเลขเคสแล้ว
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase, pruneBackups } from '../platform/backup.js';
import { makeCaseId } from '../src/modules/repair-case.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');
const BACKUP_DIR = join(ROOT, 'data', 'backups');

const apply = process.argv.slice(2).includes('--apply');

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูล: ' + DB + '\n');
  process.exit(1);
}

/** ใบที่ปิดเคส — ใบที่เก่ากว่านี้เป็นของเคสก่อนหน้า ไม่ใช่เคสที่ค้างอยู่ */
const CLOSING = new Set(['ซ่อมแล้ว', 'เปลี่ยนเครื่อง']);

/** ใบที่เป็นขั้นของเคสงานซ่อม ใบอื่น (ล้างแอร์ ย้าย ติดตั้ง) ไม่เกี่ยว */
const CASE_EVENTS = new Set(['แจ้งซ่อม', 'ชำรุด', 'รอซ่อม', 'รื้อถอน/ปลดระวาง']);

/** สถานะที่แปลว่าเครื่องยังอยู่ระหว่างเคส */
const OPEN_STATUS = new Set(['ชำรุด', 'รอซ่อม', 'รื้อถอน/ปลดระวาง']);

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

const cols = db.prepare('PRAGMA table_info(history)').all().map(c => c.name);
if (!cols.includes('CaseID')) {
  console.error('\n❌ ตารางประวัติยังไม่มีคอลัมน์ CaseID');
  console.error('   เปิดเซิร์ฟเวอร์หนึ่งครั้งก่อน (npm start) ระบบจะเติมคอลัมน์ให้เอง\n');
  process.exit(1);
}

const units = db.prepare('SELECT AirCode, Status FROM air_units').all()
  .filter(u => OPEN_STATUS.has(String(u.Status || '').trim()));

const allCaseIds = db.prepare('SELECT CaseID FROM history').all().map(r => r.CaseID);
const plans = [];

for (const u of units) {
  const rows = db.prepare(
    'SELECT row_id, ID, Date, EventType, CaseID FROM history WHERE AirCode = ? ORDER BY row_id'
  ).all(u.AirCode);

  // ตัดเอาเฉพาะช่วงหลังใบปิดเคสใบล่าสุด
  let start = 0;
  rows.forEach((r, i) => {
    if (CLOSING.has(String(r.EventType || '').trim())) start = i + 1;
  });
  const episode = rows.slice(start).filter(r => CASE_EVENTS.has(String(r.EventType || '').trim()));

  if (!episode.length) continue;
  if (episode.some(r => String(r.CaseID || '').trim())) continue;   // มีเลขแล้ว ไม่ต้องทำ

  // ออกเลขจากวันที่ของใบแรกในเคส เพื่อให้เดือนของเลขตรงกับตอนที่เรื่องเริ่ม
  const openedAt = new Date(String(episode[0].Date || '').slice(0, 10) + 'T00:00:00');
  const caseId = makeCaseId(allCaseIds, isNaN(openedAt) ? new Date() : openedAt);
  allCaseIds.push(caseId);

  plans.push({ airCode: u.AirCode, status: u.Status, caseId, rows: episode });
}

console.log('\n' + (apply ? '=== เขียนจริง ===' : '=== ดูอย่างเดียว (ยังไม่เขียน) ==='));
console.log('\nเครื่องที่ยังอยู่ในสถานะงานซ่อม: ' + units.length + ' ตัว');

if (!plans.length) {
  console.log('ไม่มีเคสไหนที่ต้องเติมเลข — ทุกใบมีเลขเคสแล้ว\n');
  db.close();
  process.exit(0);
}

for (const p of plans) {
  console.log('\n' + p.airCode + '  (' + p.status + ')  ->  ' + p.caseId);
  for (const r of p.rows) console.log('   ' + r.ID + '  ' + r.Date + '  ' + r.EventType);
}

if (!apply) {
  console.log('\nยังไม่ได้เขียนอะไรลงฐานข้อมูล');
  console.log('ถ้าถูกต้องแล้ว สั่ง: node scripts/backfill-case-id.mjs --apply\n');
  db.close();
  process.exit(0);
}

const bk = backupDatabase(db, BACKUP_DIR, 'ก่อนเติมเลขเคสย้อนหลัง');
console.log('\nสำรองไว้ที่: ' + bk.name);
pruneBackups(BACKUP_DIR);

db.exec('BEGIN');
try {
  let n = 0;
  const stmt = db.prepare('UPDATE history SET CaseID = ? WHERE row_id = ?');
  for (const p of plans) {
    for (const r of p.rows) { stmt.run(p.caseId, r.row_id); n++; }
  }
  db.exec('COMMIT');
  console.log('\n✅ เติมเลขเคสให้ ' + plans.length + ' เคส รวม ' + n + ' ใบ\n');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ ผิดพลาด ไม่ได้เขียนอะไรลงไป: ' + err.message + '\n');
  process.exitCode = 1;
} finally {
  db.close();
}
