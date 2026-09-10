/**
 * แก้ข้อมูลเครื่องที่กรอกผิดตั้งแต่ตอนนำเข้า
 *
 * วิธีรัน:
 *   node scripts/fix-unit-data.mjs            ดูอย่างเดียวว่าจะเปลี่ยนอะไร
 *   node scripts/fix-unit-data.mjs --apply    เขียนจริง
 *
 * ============================================================================
 * ทำไมต้องมี
 * ============================================================================
 * เจอตอนตรวจข้อมูลเพื่อจัดเรียงตารางรายการเครื่อง (2026-09-10) สองจุด
 *
 * 1) RYG-PDG-AIR-1 อยู่ภูมิภาค 6 แต่ RYG-PDG-AIR-2 ที่เป็นโหนดเดียวกันอยู่ภูมิภาค 5
 *    ไม่ใช่แค่เรื่องการจัดเรียง — ภูมิภาคเป็นตัวคุมสิทธิ์ด้วย
 *    แอร์สองตัวในโหนดเดียวกันจึงตกอยู่ในมือคนละคน คนที่ดูแลภูมิภาค 5
 *    แก้ข้อมูลตัวที่ 1 ไม่ได้ ทั้งที่เป็นเครื่องในความรับผิดชอบเดียวกัน
 *
 * 2) LRI-OFFICE-AIR-1 ใส่ชื่อโหนดว่า "Office สระบุรี" ทั้งที่รหัสเป็นลพบุรี
 *    (สระบุรีมีของตัวเองอยู่แล้วคือ SRI-OFFICE-AIR-1/2 ซึ่งใช้ชื่อเดียวกันเป๊ะ)
 *
 * ============================================================================
 * ขอบเขต
 * ============================================================================
 * แก้เฉพาะสองแถวนี้ ระบุด้วยรหัสเครื่อง ไม่ใช่เลขแถว เพราะเลขแถวเลื่อนได้
 * และเขียนทับก็ต่อเมื่อค่าเดิมยังเป็นค่าที่ผิดอยู่จริง ถ้ามีคนแก้ไปแล้ว
 * หรือค่าเปลี่ยนไปเป็นอย่างอื่น จะไม่แตะและรายงานให้ทราบ
 *
 * ไม่บันทึกลงหน้าประวัติ เพราะการแก้ข้อมูลเครื่องผ่านหน้าเว็บก็ไม่ได้บันทึก
 * (หน้าเว็บบันทึกประวัติเฉพาะตอนสถานะเปลี่ยน) ร่องรอยอยู่ในช่อง UpdatedBy
 * ของแถวนั้นแทน จะได้ไม่ทำให้ประวัติของเครื่องรกไปด้วยเรื่องที่ไม่ใช่งานหน้างาน
 *
 * รันซ้ำได้ รอบสองจะไม่มีอะไรให้ทำ
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

/** แต่ละรายการ: แก้ช่องไหน จากค่าอะไร เป็นค่าอะไร และเพราะอะไร */
const FIXES = [
  {
    airCode: 'RYG-PDG-AIR-1',
    column: 'Region',
    from: '6',
    to: '5',
    why: 'โหนดปลวกแดงอยู่ภูมิภาค 5 ตามเครื่องตัวที่ 2 ในโหนดเดียวกัน'
  },
  {
    airCode: 'LRI-OFFICE-AIR-1',
    column: 'NodeName',
    from: 'Office สระบุรี',
    to: 'Office ลพบุรี',
    why: 'รหัสสถานที่เป็น LRI (ลพบุรี) ส่วนสระบุรีมี SRI-OFFICE ของตัวเองอยู่แล้ว'
  }
];

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูล: ' + DB + '\n');
  process.exit(1);
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

console.log('\n' + (apply ? '=== เขียนจริง ===' : '=== ดูอย่างเดียว (ยังไม่เขียน) ==='));

const todo = [];

for (const f of FIXES) {
  const row = db.prepare(
    'SELECT row_id, AirCode, NodeName, Region FROM air_units WHERE AirCode = ?'
  ).get(f.airCode);

  console.log('\n' + f.airCode + '  ช่อง ' + f.column);

  if (!row) {
    console.log('   ⏭  ไม่พบเครื่องรหัสนี้ในระบบ ข้ามไป');
    continue;
  }

  const now = String(row[f.column] ?? '');
  if (now === f.to) {
    console.log('   ✅ เป็น "' + f.to + '" อยู่แล้ว ไม่ต้องแก้');
    continue;
  }
  if (now !== f.from) {
    console.log('   ⚠️  ค่าปัจจุบันคือ "' + now + '" ไม่ใช่ "' + f.from + '" ที่คาดไว้');
    console.log('       มีคนแก้ไปแล้วหรือข้อมูลเปลี่ยนไป — ไม่แตะ');
    continue;
  }

  console.log('   "' + f.from + '"  ->  "' + f.to + '"');
  console.log('   เหตุผล: ' + f.why);
  todo.push({ ...f, row_id: row.row_id });
}

if (!todo.length) {
  console.log('\nไม่มีอะไรต้องแก้\n');
  db.close();
  process.exit(0);
}

if (!apply) {
  console.log('\nยังไม่ได้เขียนอะไรลงฐานข้อมูล');
  console.log('ถ้าถูกต้องแล้ว สั่ง: node scripts/fix-unit-data.mjs --apply\n');
  db.close();
  process.exit(0);
}

const bk = backupDatabase(db, BACKUP_DIR, 'ก่อนแก้ข้อมูลที่กรอกผิด');
console.log('\nสำรองไว้ที่: ' + bk.name);
pruneBackups(BACKUP_DIR);

db.exec('BEGIN');
try {
  const stamp = ymdhms(new Date());
  for (const f of todo) {
    // ชื่อคอลัมน์มาจากรายการคงที่ด้านบน ไม่ได้มาจากผู้ใช้ จึงต่อเป็นสตริงได้
    db.prepare(
      'UPDATE air_units SET "' + f.column + '" = ?, UpdatedAt = ?, UpdatedBy = ? WHERE row_id = ?'
    ).run(f.to, stamp, 'fix-unit-data-script', f.row_id);
  }
  db.exec('COMMIT');
  console.log('\n✅ แก้แล้ว ' + todo.length + ' จุด\n');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ ผิดพลาด ไม่ได้เขียนอะไรลงไป: ' + err.message + '\n');
  process.exitCode = 1;
} finally {
  db.close();
}
