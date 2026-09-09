/**
 * กู้เครื่องปรับอากาศที่ถูกลบไปแล้ว กลับมาจากไฟล์สำรอง
 *
 * วิธีรัน:
 *   node scripts/restore-air-unit.mjs <รหัสเครื่อง>            ดูอย่างเดียว ไม่เขียน
 *   node scripts/restore-air-unit.mjs <รหัสเครื่อง> --apply    กู้จริง
 *   node scripts/restore-air-unit.mjs <รหัสเครื่อง> --from <ไฟล์สำรอง> [--apply]
 *
 * ไม่ระบุ --from จะเลือกไฟล์สำรองที่ใหม่ที่สุดที่ยังมีเครื่องรหัสนั้นอยู่ให้เอง
 *
 * ============================================================================
 * ทำไมต้องมีสคริปต์นี้
 * ============================================================================
 * ปุ่มลบในหน้าเว็บลบแถวออกจริง ไม่ได้แค่ซ่อน และไม่มีทางกู้คืนจากหน้าเว็บ
 * ตัวที่กู้ได้คือไฟล์สำรองเท่านั้น สคริปต์นี้จึงเป็นทางกลับทางเดียวที่มี
 *
 * กู้เฉพาะแถวในตารางเครื่อง ไม่แตะอย่างอื่น เพราะประวัติกับแถวในแผนล้างแอร์
 * ไม่เคยถูกลบตามไปด้วยอยู่แล้ว พอเครื่องกลับมา ของพวกนั้นจะกลับมาผูกกันเอง
 *
 * ใส่ประวัติการกู้คืนไว้หนึ่งใบ ไม่ลบใบที่บันทึกว่าเคยถูกลบ เพราะสองเหตุการณ์นั้น
 * เกิดขึ้นจริงทั้งคู่ การลบร่องรอยออกจะทำให้ประวัติเล่าเรื่องไม่ตรงกับที่เกิด
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase, pruneBackups } from '../platform/backup.js';
import { ymd, ymdhms } from '../src/values.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');
const BACKUP_DIR = join(ROOT, 'data', 'backups');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fromIdx = args.indexOf('--from');
const fromFile = fromIdx >= 0 ? args[fromIdx + 1] : '';
// เว้นค่าที่ตามหลัง --from ไว้ (เป็นชื่อไฟล์ ไม่ใช่รหัสเครื่อง)
// ต้องเช็ค fromIdx >= 0 ก่อน ไม่งั้นตอนไม่ได้ใส่ --from เลข -1 + 1 = 0 จะไปตัดตัวแรกทิ้ง
const code = args.find((a, i) => !a.startsWith('--') && !(fromIdx >= 0 && i === fromIdx + 1));

if (!code) {
  console.error('\nใช้: node scripts/restore-air-unit.mjs <รหัสเครื่อง> [--from <ไฟล์สำรอง>] [--apply]\n');
  process.exit(1);
}
if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูล: ' + DB + '\n');
  process.exit(1);
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

const already = db.prepare('SELECT AirCode FROM air_units WHERE UPPER(TRIM(AirCode)) = ?').get(code.trim().toUpperCase());
if (already) {
  console.log('\n✅ รหัส ' + already.AirCode + ' ยังอยู่ในระบบ ไม่ต้องกู้อะไร\n');
  process.exit(0);
}

/** ไฟล์สำรองเรียงจากใหม่ไปเก่า */
function backupsNewestFirst() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => ({ name: f, path: join(BACKUP_DIR, f), at: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
}

/** หาแถวของเครื่องรหัสนี้ในไฟล์สำรอง */
function findInBackup(path) {
  const bk = new DatabaseSync(path, { readOnly: true });
  try {
    return bk.prepare('SELECT * FROM air_units WHERE UPPER(TRIM(AirCode)) = ?').get(code.trim().toUpperCase()) || null;
  } catch {
    return null;   // ไฟล์เสียหรือโครงสร้างคนละแบบ ข้ามไป
  } finally {
    bk.close();
  }
}

let source = null;
let row = null;

if (fromFile) {
  const path = existsSync(fromFile) ? fromFile : join(BACKUP_DIR, fromFile);
  if (!existsSync(path)) { console.error('\n❌ ไม่พบไฟล์สำรอง: ' + fromFile + '\n'); process.exit(1); }
  row = findInBackup(path);
  source = path;
} else {
  // ไล่จากไฟล์ใหม่สุดลงไป จะได้ข้อมูลที่ใกล้เคียงตอนก่อนลบที่สุด
  for (const b of backupsNewestFirst()) {
    const found = findInBackup(b.path);
    if (found) { row = found; source = b.path; break; }
  }
}

if (!row) {
  console.error('\n❌ หารหัส ' + code + ' ในไฟล์สำรองไม่เจอเลยสักไฟล์');
  console.error('   ไฟล์สำรองที่มี: ' + (backupsNewestFirst().length || 0) + ' ไฟล์\n');
  process.exit(1);
}

console.log('\n' + (apply ? '=== กู้คืนจริง ===' : '=== ดูอย่างเดียว (ยังไม่เขียน) ==='));
console.log('\nกู้จากไฟล์: ' + source);
console.log('\nข้อมูลที่จะเขียนกลับ');
for (const [k, v] of Object.entries(row)) {
  if (k !== 'row_id' && v !== null && String(v).trim() !== '') console.log('   ' + k.padEnd(22) + ' ' + v);
}

// คืนตำแหน่งเดิมได้ถ้าเลขแถวนั้นยังว่างอยู่ จะได้เรียงเหมือนก่อนถูกลบ
const taken = db.prepare('SELECT 1 AS ok FROM air_units WHERE row_id = ?').get(row.row_id);
console.log('\nตำแหน่งแถวเดิม (' + row.row_id + '): ' + (taken ? 'ถูกใช้ไปแล้ว จะต่อท้ายแทน' : 'ยังว่าง คืนตำแหน่งเดิมได้'));

const plans = db.prepare('SELECT Year FROM plans WHERE UPPER(TRIM(AirCode)) = ? ORDER BY Year').all(code.trim().toUpperCase());
if (plans.length) console.log('แถวในแผนล้างแอร์ที่จะกลับมาใช้งาน: ปี ' + plans.map(p => p.Year).join(', '));

if (!apply) {
  console.log('\nยังไม่ได้เขียนอะไรลงฐานข้อมูล');
  console.log('ถ้าถูกต้องแล้ว สั่ง: node scripts/restore-air-unit.mjs ' + code + ' --apply\n');
  db.close();
  process.exit(0);
}

const backup = backupDatabase(db, BACKUP_DIR, 'ก่อนกู้คืน ' + code);
console.log('\nสำรองไว้ที่: ' + backup.path);
pruneBackups(BACKUP_DIR);

db.exec('BEGIN');
try {
  const cols = Object.keys(row).filter(k => taken ? k !== 'row_id' : true);
  const sql = 'INSERT INTO air_units (' + cols.map(c => '"' + c + '"').join(',') + ') ' +
              'VALUES (' + cols.map(() => '?').join(',') + ')';
  db.prepare(sql).run(...cols.map(c => row[c]));

  // ประวัติการกู้คืน — ใบที่บันทึกว่าเคยถูกลบยังอยู่ เพราะทั้งสองเหตุการณ์เกิดขึ้นจริง
  const ids = db.prepare('SELECT ID FROM history').all().map(r => r.ID);
  const stem = 'CM' + ymdhms(new Date()).slice(2, 4) + ymdhms(new Date()).slice(5, 7) + '-';
  let max = 0;
  for (const id of ids) {
    if (!String(id || '').startsWith(stem)) continue;
    const n = Number(String(id).slice(stem.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  const newId = stem + String(max + 1).padStart(2, '0');

  const hCols = ['ID', 'AirCode', 'Date', 'EventType', 'Detail', 'Cost', 'Technician', 'Note', 'CreatedAt', 'RecordedBy'];
  db.prepare('INSERT INTO history (' + hCols.map(c => '"' + c + '"').join(',') + ') VALUES (' + hCols.map(() => '?').join(',') + ')')
    .run(newId, row.AirCode, ymd(new Date()), 'อื่นๆ',
         'กู้ข้อมูลเครื่องกลับคืนจากไฟล์สำรอง (' + source.split(/[\\/]/).pop() + ')',
         '', '', '', ymdhms(new Date()), 'restore-script');

  db.exec('COMMIT');
  console.log('\n✅ กู้คืน ' + row.AirCode + ' สำเร็จ — บันทึกประวัติการกู้คืนเลขที่ ' + newId + '\n');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ ผิดพลาด ไม่ได้เขียนอะไรลงไป: ' + err.message + '\n');
  process.exitCode = 1;
} finally {
  db.close();
}
