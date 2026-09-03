/**
 * นำเข้าข้อมูลเครื่องปรับอากาศจากไฟล์ CSV
 *
 * วิธีรัน:
 *   node scripts/import.mjs <ไฟล์.csv>            ดูอย่างเดียวว่าจะเปลี่ยนอะไร (ไม่เขียน)
 *   node scripts/import.mjs <ไฟล์.csv> --apply    เขียนจริง
 *
 * ค่าเริ่มต้นคือ "ดูอย่างเดียว" โดยตั้งใจ ต้องพิมพ์ --apply เพิ่มเองถึงจะเขียนจริง
 * เพราะคำสั่งที่เผลอรันแล้วข้อมูลเปลี่ยนทันทีเป็นสิ่งที่ไม่ควรมี
 *
 * สิ่งที่คำสั่งนี้ "ไม่ทำ" ไม่ว่ากรณีใด:
 *   - ไม่ลบเครื่องที่ไม่ได้อยู่ในไฟล์
 *   - ไม่ล้างคอลัมน์ที่ไฟล์นำเข้าไม่มี (เช่น พิกัด ที่อยู่)
 *   - ไม่เขียนอะไรเลยถ้ายังมีข้อผิดพลาดค้างอยู่แม้แต่จุดเดียว
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { Repository } from '../src/db/repository.js';
import { parseCsvObjects, decodeCsvBytes } from '../src/csv.js';
import { planImport, applyImport } from '../src/import.js';
import { HEADERS } from '../src/import-spec.js';
import { backupDatabase, pruneBackups } from '../platform/backup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');
const BACKUP_DIR = join(ROOT, 'data', 'backups');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find(a => !a.startsWith('--'));

if (!file) {
  console.error('\nใช้: node scripts/import.mjs <ไฟล์.csv> [--apply]');
  console.error('  ไม่ใส่ --apply = ดูอย่างเดียวว่าจะเปลี่ยนอะไร ไม่เขียนจริง\n');
  process.exit(1);
}

const path = resolve(ROOT, file);
for (const [p, label] of [[path, 'ไฟล์นำเข้า'], [DB, 'ฐานข้อมูล']]) {
  if (!existsSync(p)) { console.error('\n❌ ไม่พบ' + label + ': ' + p + '\n'); process.exit(1); }
}

/* ---------------- อ่านไฟล์ ---------------- */

const { text, encoding } = decodeCsvBytes(readFileSync(path));
const { headers, rows } = parseCsvObjects(text);

console.log('ไฟล์: ' + file);
console.log('รหัสภาษา: ' + encoding + (encoding !== 'utf-8' ? '  (แปลงให้อัตโนมัติแล้ว)' : ''));
console.log();

const missing = HEADERS.filter(h => !headers.includes(h));
const unknown = headers.filter(h => h && !HEADERS.includes(h));
if (missing.length || unknown.length) {
  if (missing.length) console.error('❌ ขาดคอลัมน์: ' + missing.join(', '));
  if (unknown.length) console.error('❌ ไม่รู้จักคอลัมน์: ' + unknown.join(', '));
  console.error('\nหยุด — คอลัมน์ไม่ตรงกับที่ระบบรู้จัก\n');
  process.exit(1);
}

/* ---------------- คำนวณว่าจะเปลี่ยนอะไร ---------------- */

const db = new DatabaseSync(DB);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');

const ss = new Repository(db);
await ss.load('AirList');
const plan = planImport(ss.objects('AirList'), rows);

const list = (items, icon, title, limit = 20) => {
  if (!items.length) return;
  console.log(icon + ' ' + title + ' ' + items.length + ' จุด');
  for (const e of items.slice(0, limit)) {
    console.log('   บรรทัด ' + String(e.line).padStart(4) + '  [' + e.column + ']  ' + e.message);
  }
  if (items.length > limit) console.log('   ... และอีก ' + (items.length - limit) + ' จุด');
  console.log();
};

list(plan.errors, '❌', 'ข้อผิดพลาดที่ต้องแก้ก่อน');
list(plan.warnings, '⚠️ ', 'จุดที่ควรตรวจด้วยตาอีกครั้ง');

console.log('=== สรุปสิ่งที่จะเปลี่ยน ===');
console.log('  เพิ่มเครื่องใหม่   ' + String(plan.adds.length).padStart(5));
console.log('  แก้ข้อมูลเดิม     ' + String(plan.updates.length).padStart(5));
console.log('  เหมือนเดิม        ' + String(plan.unchanged.length).padStart(5));
console.log();

// แสดงของจริงว่าเปลี่ยนช่องไหนจากอะไรเป็นอะไร ไม่ใช่บอกแค่จำนวน
// เพราะคนที่แก้ Excel ผิดช่องจะรู้ตัวตอนเห็นบรรทัดพวกนี้เท่านั้น
if (plan.updates.length) {
  console.log('=== รายละเอียดการแก้ ===');
  for (const u of plan.updates.slice(0, 15)) {
    console.log('  ' + u.airCode);
    for (const c of u.changes) {
      console.log('     ' + c.column + ':  "' + (c.from || '-') + '"  ->  "' + c.to + '"');
    }
  }
  if (plan.updates.length > 15) console.log('  ... และอีก ' + (plan.updates.length - 15) + ' เครื่อง');
  console.log();
}

if (plan.adds.length) {
  console.log('=== เครื่องที่จะเพิ่มใหม่ ===');
  console.log('  ' + plan.adds.slice(0, 10).map(a => a.airCode).join(', ') +
              (plan.adds.length > 10 ? ' ... และอีก ' + (plan.adds.length - 10) : ''));
  console.log();
}

console.log('  ℹ️  เครื่องที่ไม่ได้อยู่ในไฟล์จะไม่ถูกแตะและไม่ถูกลบ');
console.log('  ℹ️  พิกัดและที่อยู่จะไม่ถูกล้าง เพราะไฟล์นำเข้าไม่มีคอลัมน์นี้');
console.log();

/* ---------------- ตัดสินใจ ---------------- */

if (plan.errors.length) {
  db.close();
  console.log('❌ ยังนำเข้าไม่ได้ — แก้ ' + plan.errors.length + ' จุดข้างบนก่อน');
  process.exit(1);
}

if (!apply) {
  db.close();
  console.log('👀 นี่เป็นการดูอย่างเดียว ยังไม่ได้เขียนอะไรลงฐานข้อมูล');
  if (plan.adds.length || plan.updates.length) {
    console.log('   ถ้าตรวจแล้วถูกต้อง ให้สั่งซ้ำโดยเติม --apply ต่อท้าย');
  }
  process.exit(0);
}

if (!plan.adds.length && !plan.updates.length) {
  db.close();
  console.log('✅ ไม่มีอะไรต้องเปลี่ยน ข้อมูลตรงกับไฟล์อยู่แล้ว');
  process.exit(0);
}

/* ---------------- สำรองก่อน แล้วค่อยเขียน ---------------- */

const backup = backupDatabase(db, BACKUP_DIR, 'ก่อนนำเข้า');
console.log('💾 สำรองข้อมูลไว้แล้ว: data/backups/' + backup.name);

try {
  const result = await applyImport(ss, plan, { user: process.env.USERNAME || 'import' });
  console.log();
  console.log('✅ นำเข้าเรียบร้อย — เพิ่ม ' + result.added + ' แก้ ' + result.updated + ' เครื่อง');
} catch (err) {
  console.error();
  console.error('❌ นำเข้าไม่สำเร็จ: ' + err.message);
  console.error('   ข้อมูลเดิมยังอยู่ครบ และมีไฟล์สำรองที่ data/backups/' + backup.name);
  db.close();
  process.exit(1);
}

const removed = pruneBackups(BACKUP_DIR);
if (removed.length) console.log('   (ลบไฟล์สำรองเก่าที่เกิน 10 ไฟล์ออก ' + removed.length + ' ไฟล์)');

db.close();
