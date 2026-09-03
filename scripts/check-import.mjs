/**
 * ตรวจไฟล์นำเข้าก่อนใช้งานจริง — อ่านอย่างเดียว ไม่แตะฐานข้อมูลเลย
 *
 * วิธีรัน:  node scripts/check-import.mjs <ไฟล์.csv>
 *
 * ใช้ตรวจว่าไฟล์ที่กรอกมาถูกต้องไหม ก่อนจะนำเข้าจริง
 * รันกี่ครั้งก็ได้ ไม่มีผลข้างเคียงใดๆ
 *
 * บอกได้ 3 อย่าง:
 *   1. ไฟล์มีคอลัมน์ครบและถูกต้องไหม
 *   2. แต่ละแถวมีข้อมูลผิดพลาดตรงไหน พร้อมเลขบรรทัดในไฟล์
 *   3. ถ้านำเข้าจริงจะเพิ่มกี่เครื่อง ทับของเดิมกี่เครื่อง
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { parseCsvObjects } from '../src/csv.js';
import { COLUMNS, HEADERS, validateRow, makeAirCode } from '../src/import-spec.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const file = process.argv[2];
if (!file) {
  console.error('\nใช้: node scripts/check-import.mjs <ไฟล์.csv>');
  console.error('เช่น: node scripts/check-import.mjs data/templates/aircon-template.csv\n');
  process.exit(1);
}

const path = resolve(ROOT, file);
if (!existsSync(path)) {
  console.error('\n❌ ไม่พบไฟล์: ' + path + '\n');
  process.exit(1);
}

console.log('ตรวจไฟล์: ' + file);
console.log();

const raw = readFileSync(path, 'utf8');

/* ---------------- 1. หัวตาราง ---------------- */

const { headers, rows } = parseCsvObjects(raw);

const missing = HEADERS.filter(h => !headers.includes(h));
const unknown = headers.filter(h => h && !HEADERS.includes(h));

console.log('=== 1. หัวตาราง ===');
console.log('  พบ ' + headers.length + ' คอลัมน์ · ระบบต้องการ ' + HEADERS.length);

if (missing.length) console.log('  ❌ ขาด: ' + missing.join(', '));
if (unknown.length) console.log('  ❌ ไม่รู้จัก: ' + unknown.join(', '));

if (missing.length || unknown.length) {
  console.log();
  console.log('  หยุดตรวจ — คอลัมน์ไม่ตรงกับที่ระบบรู้จัก');
  console.log('  ถ้าไฟล์ข้อมูลจริงของคุณหน้าตาต่างจากนี้ อย่าแก้ไฟล์ให้เข้ากับ template');
  console.log('  ส่งไฟล์จริงมาดูก่อน แล้วจะปรับตัวนำเข้าให้รับรูปแบบนั้นแทน');
  console.log();
  process.exit(1);
}
console.log('  ✅ คอลัมน์ครบและตรงทุกช่อง');
console.log();

if (!rows.length) {
  console.log('=== 2. ข้อมูล ===');
  console.log('  ไฟล์นี้ยังไม่มีข้อมูล มีแต่หัวตาราง — พร้อมให้กรอกแล้ว');
  console.log();
  process.exit(0);
}

/* ---------------- 2. ตรวจทีละแถว ---------------- */

console.log('=== 2. ตรวจข้อมูล ' + rows.length + ' แถว ===');

const errors = [];
const warns = [];
const seen = new Map();   // AirCode -> บรรทัดแรกที่เจอ
const airCodes = [];

for (const row of rows) {
  for (const p of validateRow(row)) {
    const item = { line: row.__line, ...p };
    (p.level === 'error' ? errors : warns).push(item);
  }

  // รหัสเครื่องซ้ำภายในไฟล์เดียวกัน
  if (row.SiteCode && row.AirNo) {
    const code = makeAirCode(row.SiteCode, row.AirNo);
    airCodes.push(code);
    if (seen.has(code)) {
      errors.push({
        line: row.__line, level: 'error', column: 'SiteCode + AirNo',
        message: `รหัสเครื่อง ${code} ซ้ำกับบรรทัดที่ ${seen.get(code)}`
      });
    } else {
      seen.set(code, row.__line);
    }
  }
}

const show = (list, icon, title) => {
  if (!list.length) return;
  console.log('  ' + icon + ' ' + title + ' ' + list.length + ' จุด');
  const byLine = {};
  for (const e of list) (byLine[e.line] ||= []).push(e);
  const lines = Object.keys(byLine).map(Number).sort((a, b) => a - b);
  for (const ln of lines.slice(0, 15)) {
    for (const e of byLine[ln]) {
      console.log('     บรรทัด ' + String(ln).padStart(4) + '  [' + e.column + ']  ' + e.message);
    }
  }
  if (lines.length > 15) console.log('     ... และอีก ' + (lines.length - 15) + ' บรรทัด');
  console.log();
};

if (!errors.length && !warns.length) console.log('  ✅ ไม่พบปัญหา');
console.log();
show(errors, '❌', 'ข้อผิดพลาดที่ต้องแก้ก่อนนำเข้า');
show(warns, '⚠️ ', 'จุดที่ควรตรวจสอบด้วยตาอีกครั้ง');

/* ---------------- 3. เทียบกับข้อมูลที่มีอยู่ ---------------- */

console.log('=== 3. ถ้านำเข้าจริงจะเกิดอะไรขึ้น ===');

const dbPath = join(ROOT, 'data', 'aircon.db');
if (!existsSync(dbPath)) {
  console.log('  (ยังไม่มีฐานข้อมูล ข้ามการเทียบ)');
} else {
  const db = new DatabaseSync(dbPath);
  const existing = new Set(db.prepare('SELECT AirCode FROM air_units').all().map(r => r.AirCode));
  db.close();

  const add = airCodes.filter(c => !existing.has(c));
  const update = airCodes.filter(c => existing.has(c));

  console.log('  เพิ่มเครื่องใหม่      ' + String(add.length).padStart(5) + ' เครื่อง');
  console.log('  ทับข้อมูลเครื่องเดิม  ' + String(update.length).padStart(5) + ' เครื่อง');
  console.log('  เครื่องเดิมที่ไม่ถูกแตะ ' + String(existing.size - update.length).padStart(4) + ' เครื่อง');

  if (add.length) console.log('     ตัวอย่างที่จะเพิ่ม: ' + add.slice(0, 5).join(', ') + (add.length > 5 ? ' ...' : ''));
}

console.log();
console.log('  ℹ️  คำสั่งนี้ไม่ได้แก้ไขอะไรทั้งสิ้น เป็นการตรวจอย่างเดียว');
console.log();

if (errors.length) {
  console.log('❌ ยังนำเข้าไม่ได้ — แก้ ' + errors.length + ' จุดข้างบนก่อน');
  process.exit(1);
}
console.log('✅ ไฟล์ผ่านการตรวจ' + (warns.length ? ' (แต่มี ' + warns.length + ' จุดที่ควรดูด้วยตาอีกครั้ง)' : ''));
