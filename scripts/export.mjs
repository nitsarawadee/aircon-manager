/**
 * ส่งออกข้อมูลเครื่องปรับอากาศเป็นไฟล์ CSV
 *
 * วิธีรัน:  node scripts/export.mjs [ชื่อไฟล์ปลายทาง]
 *
 * ไฟล์ที่ได้อยู่ในรูปแบบเดียวกับไฟล์นำเข้าเป๊ะๆ จึงแก้แล้วนำเข้ากลับได้ทันที
 *
 * นี่คือวิธีแก้ข้อมูลจำนวนมากที่ปลอดภัยที่สุด — ส่งออก แก้ใน Excel แล้วนำเข้ากลับ
 * เพราะไฟล์ที่ได้มีรหัสเครื่องและคอลัมน์ถูกต้องอยู่แล้ว
 * ไม่ต้องพิมพ์รหัสเครื่องเอง และไม่มีทางใส่คอลัมน์ผิด
 *
 * คำสั่งนี้อ่านอย่างเดียว ไม่แก้ไขฐานข้อมูล
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { Repository } from '../src/db/repository.js';
import { toExportRows } from '../src/import.js';
import { HEADERS } from '../src/import-spec.js';
import { toCsv } from '../src/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูลที่ ' + DB + '\n');
  process.exit(1);
}

// ตั้งชื่อไฟล์ตามวันที่ให้เอง เพื่อไม่ให้ไฟล์ที่ส่งออกคนละรอบทับกัน
const d = new Date();
const p = n => String(n).padStart(2, '0');
const stamp = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());

const out = process.argv[2]
  ? resolve(ROOT, process.argv[2])
  : join(ROOT, 'data', 'templates', 'ข้อมูลปัจจุบัน-' + stamp + '.csv');

const db = new DatabaseSync(DB, { readOnly: true });
const ss = new Repository(db);
await ss.load('AirList');
const units = ss.objects('AirList');
db.close();

const rows = toExportRows(units);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toCsv(HEADERS, rows), 'utf8');

console.log('ส่งออกเรียบร้อย ' + rows.length + ' เครื่อง');
console.log('  ' + out);
console.log();
console.log('แก้ไฟล์นี้ใน Excel ได้เลย เสร็จแล้วนำเข้ากลับด้วย:');
console.log('  node scripts/import.mjs "' + out + '"');
