/**
 * แปลงรหัสผ่านที่ยังเก็บเป็นข้อความธรรมดา ให้เป็นแฮช
 *
 * วิธีรัน:
 *   node scripts/hash-existing-passwords.mjs            ดูอย่างเดียวว่าจะเปลี่ยนอะไร
 *   node scripts/hash-existing-passwords.mjs --apply    เขียนจริง
 *
 * ============================================================================
 * ⚠️ ต้องรีสตาร์ทเซิร์ฟเวอร์ก่อนรันสคริปต์นี้
 * ============================================================================
 * เซิร์ฟเวอร์ที่ยังรันโค้ดเวอร์ชันเก่าอยู่ ตรวจรหัสแบบใหม่ (pbkdf2) ไม่เป็น
 * ถ้าแปลงข้อมูลก่อนรีสตาร์ท ทุกคนจะล็อกอินไม่ได้จนกว่าจะรีสตาร์ท
 *
 * ลำดับที่ถูกต้อง: หยุดเซิร์ฟเวอร์ -> เปิดใหม่ -> ค่อยรันสคริปต์นี้
 *
 * ============================================================================
 * ทำอะไร
 * ============================================================================
 * แตะเฉพาะบัญชีที่ "มีรหัสเป็นข้อความธรรมดา" และ "ยังไม่มีแฮช" เท่านั้น
 * บัญชีที่แปลงแล้วหรือใช้แฮชอยู่แล้ว ไม่ถูกแตะ — รันซ้ำจึงไม่มีอะไรให้ทำ
 *
 * รหัสผ่านของทุกคนยังใช้เข้าระบบได้เหมือนเดิมทุกประการ เปลี่ยนแค่วิธีเก็บ
 * สคริปต์นี้ไม่พิมพ์รหัสจริงออกหน้าจอเลยสักตัว
 *
 * ============================================================================
 * ⚠️ ไฟล์สำรองเก่ายังมีรหัสจริงอยู่
 * ============================================================================
 * แปลงเสร็จแล้วรหัสจริงจะหายไปจากฐานข้อมูลปัจจุบัน แต่ไฟล์สำรองที่ถ่ายไว้
 * ก่อนหน้านี้ยังมีรหัสเป็นข้อความธรรมดาอยู่ครบ รวมถึงไฟล์ที่สคริปต์นี้ถ่ายไว้เอง
 * ถ้าต้องการให้หมดจริง ต้องลบไฟล์สำรองเก่าทิ้งด้วย — สคริปต์จะบอกจำนวนให้ตอนจบ
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase, pruneBackups } from '../platform/backup.js';
import { makePasswordHash } from '../src/modules/users.js';
import { ymdhms } from '../src/values.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.DB_PATH || join(ROOT, 'data', 'aircon.db');
const BACKUP_DIR = process.env.BACKUP_DIR || join(ROOT, 'data', 'backups');

const apply = process.argv.slice(2).includes('--apply');

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูล: ' + DB + '\n');
  process.exit(1);
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
for (const need of ['Password', 'PasswordHash', 'PasswordSalt']) {
  if (!cols.includes(need)) {
    console.error('\n❌ ตารางผู้ใช้ไม่มีคอลัมน์ ' + need + ' — เปิดเซิร์ฟเวอร์หนึ่งครั้งก่อน\n');
    process.exit(1);
  }
}

const all = db.prepare('SELECT row_id, Username, Password, PasswordHash FROM users').all();

const plain = s => String(s == null ? '' : s).trim();
const todo = all.filter(u => plain(u.Password) && !plain(u.PasswordHash));
const already = all.filter(u => plain(u.PasswordHash));
const noCredential = all.filter(u => !plain(u.Password) && !plain(u.PasswordHash));

console.log('\n' + (apply ? '=== เขียนจริง ===' : '=== ดูอย่างเดียว (ยังไม่เขียน) ==='));
console.log('\nผู้ใช้ทั้งหมด ' + all.length + ' คน');
console.log('  ต้องแปลง            ' + todo.length + ' คน');
console.log('  เป็นแฮชอยู่แล้ว      ' + already.length + ' คน');
if (noCredential.length) {
  console.log('  ยังไม่ได้ตั้งรหัส    ' + noCredential.length + ' คน (ข้าม)');
}

if (!todo.length) {
  console.log('\nไม่มีอะไรต้องแปลง — รหัสผ่านทุกบัญชีเก็บเป็นแฮชเรียบร้อยแล้ว\n');
  db.close();
  process.exit(0);
}

// ไม่พิมพ์รหัสจริงออกมา บอกแค่ว่าใครและยาวกี่ตัวอักษร พอให้ยืนยันว่าถูกคน
console.log('\nบัญชีที่จะแปลง');
for (const u of todo) {
  console.log('   ' + String(u.Username).padEnd(20) + ' (รหัสยาว ' + plain(u.Password).length + ' ตัวอักษร)');
}

if (!apply) {
  console.log('\n⚠️  รีสตาร์ทเซิร์ฟเวอร์ก่อน แล้วค่อยรันแบบเขียนจริง');
  console.log('    ไม่งั้นทุกคนจะล็อกอินไม่ได้จนกว่าจะรีสตาร์ท');
  console.log('\nยังไม่ได้เขียนอะไรลงฐานข้อมูล');
  console.log('ถ้าถูกต้องแล้ว สั่ง: node scripts/hash-existing-passwords.mjs --apply\n');
  db.close();
  process.exit(0);
}

const bk = backupDatabase(db, BACKUP_DIR, 'ก่อนแปลงรหัสผ่านเป็นแฮช');
console.log('\nสำรองไว้ที่: ' + bk.name);
pruneBackups(BACKUP_DIR);

// คำนวณแฮชให้ครบก่อน แล้วค่อยเปิดทรานแซกชัน
// เพราะการคำนวณใช้เวลาหลักร้อยมิลลิวินาทีต่อคน ไม่ควรถือล็อกฐานข้อมูลไว้ระหว่างนั้น
const hashes = [];
for (const u of todo) {
  hashes.push({ row_id: u.row_id, username: u.Username, hash: await makePasswordHash(u.Password) });
}

db.exec('BEGIN');
try {
  const stmt = db.prepare(
    "UPDATE users SET PasswordHash = ?, PasswordSalt = '', Password = '', UpdatedAt = ?, UpdatedBy = ? " +
    'WHERE row_id = ?'
  );
  const stamp = ymdhms(new Date());
  for (const h of hashes) stmt.run(h.hash, stamp, 'hash-passwords-script', h.row_id);
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ ผิดพลาด ไม่ได้เขียนอะไรลงไป: ' + err.message + '\n');
  db.close();
  process.exit(1);
}

/**
 * เขียนไฟล์ใหม่ทั้งไฟล์หลังแก้ข้อมูลเสร็จ
 *
 * SQLite ไม่ได้ลบข้อมูลเก่าทิ้งทันทีที่แก้แถว หน้าเก่าอาจถูกปล่อยว่างไว้เฉยๆ
 * โดยที่เนื้อข้อมูลเดิมยังอยู่ในไฟล์ VACUUM จะสร้างไฟล์ใหม่จากข้อมูลที่ใช้จริง
 * เท่านั้น เศษที่ค้างอยู่จึงหายไปด้วย
 *
 * ทำนอกทรานแซกชันเพราะ SQLite ไม่ให้ VACUUM ระหว่างถือทรานแซกชันอยู่
 */
db.exec('VACUUM');

// ตรวจผลจากฐานข้อมูลจริงอีกครั้ง ไม่เชื่อว่าคำสั่งผ่านแล้วแปลว่าถูก
const after = db.prepare('SELECT Username, Password, PasswordHash FROM users').all();
const leftover = after.filter(u => plain(u.Password));
const hashed = after.filter(u => plain(u.PasswordHash).startsWith('pbkdf2$'));

console.log('\n✅ แปลงแล้ว ' + hashes.length + ' บัญชี');
console.log('   บัญชีที่เก็บเป็นแฮชแล้ว: ' + hashed.length + ' / ' + after.length);
console.log('   บัญชีที่ยังมีรหัสเป็นข้อความธรรมดา: ' + leftover.length +
            (leftover.length ? ' (' + leftover.map(u => u.Username).join(', ') + ')' : ' ✓'));

let backupCount = 0;
try { backupCount = readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).length; } catch { /* ไม่มีโฟลเดอร์ */ }

console.log('\n⚠️  ไฟล์สำรอง ' + backupCount + ' ไฟล์ในโฟลเดอร์ backups ยังมีรหัสจริงอยู่ข้างใน');
console.log('    ถ้าต้องการให้รหัสหายไปจริงทั้งระบบ ต้องลบไฟล์เหล่านั้นทิ้งด้วย');
console.log('    (แต่จะเสียจุดกู้คืนย้อนหลังไปด้วย — ชั่งน้ำหนักเอง)\n');

db.close();
