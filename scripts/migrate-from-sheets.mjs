/**
 * ย้ายข้อมูลจาก Google Sheets เข้าฐานข้อมูล SQLite — ทำครั้งเดียว
 *
 * วิธีรัน:  node scripts/migrate-from-sheets.mjs
 *
 * ============================================================================
 * สคริปต์นี้ปลอดภัย: อ่านจาก Google Sheets อย่างเดียว ไม่แก้ไขอะไรในชีตเลย
 * ถ้าผลลัพธ์ไม่ถูกใจ ลบไฟล์ฐานข้อมูลทิ้งแล้วรันใหม่ได้ ข้อมูลต้นทางไม่กระทบ
 * ============================================================================
 *
 * ท้ายสคริปต์จะเทียบจำนวนแถวต้นทาง-ปลายทางให้ดู ถ้าตัวเลขไม่ตรงกันจะแจ้งเตือน
 * และคืนค่าออกเป็นข้อผิดพลาด — จะได้ไม่เผลอเอาข้อมูลที่ย้ายไม่ครบไปใช้
 */

import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAccessToken } from '../src/google-auth.js';
import { Spreadsheet } from '../src/sheets.js';
import { TABLES, createTableStatements, columnKind } from '../src/db/schema.js';
import { formatDate, ymd, partsOf, serialToDate } from '../src/values.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'data', 'aircon.db');

/* ------------------------------ อ่านค่าตั้งค่า ------------------------------ */

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val.at(-1) === val[0]) val = val.slice(1, -1);
      if (!(key in process.env)) env[key] = val;
    }
  } catch { /* ไม่มี .env ก็ใช้ค่าจาก environment */ }
  return env;
}

/* ------------------------------ แปลงค่า ------------------------------ */

/** เวลาแบบ HH:mm จากเศษของวันที่ Sheets ใช้เก็บ */
function toTime(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v !== 'number') return String(v);
  if (v < 0 || v >= 1) return String(v);
  const mins = Math.round(v * 24 * 60);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
}

/** วันที่+เวลาแบบ yyyy-MM-dd HH:mm:ss */
function toDateTime(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') {
    const d = serialToDate(v);
    if (!d || isNaN(d.getTime())) return '';
    const p = partsOf(d);
    const pad = n => String(n).padStart(2, '0');
    return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}`;
  }
  return String(v);
}

/** ตัวเลข — ค่าว่างคืน null ไม่ใช่ 0 (ราคาที่ยังไม่กรอก ต่างจากราคา 0 บาท) */
function toNumber(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/** จริง/เท็จ — ชีตอาจเก็บเป็น boolean หรือข้อความ "TRUE"/"FALSE" */
function toBool(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  const s = String(v).trim().toUpperCase();
  if (s === 'TRUE') return 1;
  if (s === 'FALSE') return 0;
  return s === '' ? 1 : 1; // ไม่ระบุ = เปิดใช้งาน (พฤติกรรมเดิมของระบบ)
}

/** แปลงค่าหนึ่งช่องตามชนิดของคอลัมน์ */
function convert(value, kind) {
  switch (kind) {
    case 'date': return formatDate(value) || '';
    case 'datetime': return toDateTime(value);
    case 'time': return toTime(value);
    case 'number': return toNumber(value);
    case 'boolean': return toBool(value);
    default:
      if (value === null || value === undefined) return '';
      // ตัวเลขที่เก็บเป็นข้อความ (Serial number ยาวๆ) ต้องไม่กลายเป็น 5.23e7
      if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : String(value);
      return String(value);
  }
}

/* ------------------------------ ย้ายข้อมูล ------------------------------ */

function insertRows(db, table, rows) {
  if (!rows.length) return 0;
  const cols = Object.keys(TABLES[table].columns);
  const sql = `INSERT INTO ${table} (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  const stmt = db.prepare(sql);

  let n = 0;
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      stmt.run(...cols.map(c => convert(row[c], columnKind(table, c))));
      n++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return n;
}

async function main() {
  const env = loadEnv();
  for (const k of ['SPREADSHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']) {
    if (!env[k]) { console.error('❌ ยังตั้งค่าไม่ครบ ขาด ' + k); process.exit(1); }
  }

  console.log('เชื่อมต่อ Google Sheets...');
  const ss = new Spreadsheet(env.SPREADSHEET_ID, await getAccessToken(env));
  const meta = await ss.meta();
  const sheetNames = Object.keys(meta);
  const planSheets = sheetNames.filter(n => /^Plan_\d{4}$/.test(n)).sort();

  const needed = [...new Set(
    Object.values(TABLES).map(t => t.sheet).filter(Boolean).concat(planSheets)
  )].filter(n => sheetNames.includes(n));

  console.log('อ่านชีต: ' + needed.join(', '));
  await ss.load(needed);

  // เริ่มจากไฟล์เปล่าเสมอ เพื่อให้รันซ้ำได้ผลเหมือนเดิมทุกครั้ง
  if (existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    console.log('ลบฐานข้อมูลเดิมทิ้งแล้ว (สร้างใหม่จากต้นทาง)');
  }

  const db = new DatabaseSync(DB_PATH);
  // WAL ทำให้อ่านพร้อมกันได้หลายคนขณะที่มีคนเขียนอยู่
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  for (const sql of createTableStatements()) db.exec(sql);
  console.log('สร้างตารางเรียบร้อย ' + Object.keys(TABLES).length + ' ตาราง');
  console.log();

  const report = [];

  // ---- ตารางที่มาจากชีตเดียวตรงๆ ----
  for (const [table, def] of Object.entries(TABLES)) {
    if (!def.sheet || !needed.includes(def.sheet)) continue;
    if (table === 'config_values') continue; // รูปแบบต่างออกไป จัดการแยกด้านล่าง

    const src = ss.objects(def.sheet);
    const wrote = insertRows(db, table, src);
    report.push({ table, source: def.sheet, from: src.length, to: wrote });
  }

  // ---- แผนทุกปีรวมเป็นตารางเดียว ----
  let planFrom = 0, planTo = 0;
  for (const sheet of planSheets) {
    const year = Number(sheet.replace('Plan_', ''));
    const src = ss.objects(sheet).map(r => ({ ...r, Year: year }));
    planFrom += src.length;
    planTo += insertRows(db, 'plans', src);
  }
  if (planSheets.length) {
    report.push({ table: 'plans', source: planSheets.join(' + '), from: planFrom, to: planTo });
  }

  // ---- Config: จากแนวนอน (คอลัมน์ละประเภท) เป็นแนวตั้ง ----
  if (needed.includes('Config')) {
    const headers = ss.headers('Config').filter(Boolean);
    const values = ss.values('Config');
    const rows = [];
    headers.forEach((cat, ci) => {
      let pos = 0;
      for (let r = 1; r < values.length; r++) {
        const v = (values[r] || [])[ci];
        if (v === '' || v === null || v === undefined) continue;
        rows.push({ Category: cat, Value: String(v), Position: pos++ });
      }
    });
    const wrote = insertRows(db, 'config_values', rows);
    report.push({ table: 'config_values', source: 'Config', from: rows.length, to: wrote });
  }

  /* ------------------------------ ตรวจผล ------------------------------ */

  console.log('=== ผลการย้ายข้อมูล ===');
  console.log('  ' + 'ตาราง'.padEnd(18) + 'ต้นทาง'.padEnd(22) + 'จากชีต'.padStart(8) + 'เข้าฐานข้อมูล'.padStart(16) + '   ผล');
  let bad = 0;
  for (const r of report) {
    const inDb = db.prepare(`SELECT COUNT(*) c FROM ${r.table}`).get().c;
    const ok = r.from === r.to && r.to === inDb;
    if (!ok) bad++;
    console.log('  ' + r.table.padEnd(18) + String(r.source).slice(0, 20).padEnd(22)
      + String(r.from).padStart(8) + String(inDb).padStart(16) + '   ' + (ok ? '✅' : '❌ ไม่ตรง'));
  }

  // ---- ตรวจความถูกต้องของข้อมูลแบบสุ่มตัวอย่าง ----
  console.log();
  console.log();
  console.log('=== ตรวจตัวอย่างข้อมูลว่าแปลงถูกต้อง ===');
  const a = db.prepare("SELECT AirCode, Region, NodeName, BTU, CleaningPricePerRound, Status FROM air_units LIMIT 2").all();
  a.forEach(r => console.log('  แอร์: ' + JSON.stringify(r)));
  const h = db.prepare("SELECT AirCode, Date, EventType, Cost FROM history WHERE Date != '' LIMIT 2").all();
  h.forEach(r => console.log('  ประวัติ: ' + JSON.stringify(r)));
  const p = db.prepare("SELECT Year, AirCode, R1_Status, R1_ActualDate, R1_Price FROM plans WHERE R1_Status = 'ล้างเสร็จสิ้น' LIMIT 2").all();
  p.forEach(r => console.log('  แผน: ' + JSON.stringify(r)));
  const c = db.prepare("SELECT Category, COUNT(*) n FROM config_values GROUP BY Category").all();
  console.log('  ตัวเลือก: ' + c.map(x => x.Category + '=' + x.n).join(', '));

  db.close();

  // วัดขนาดไฟล์หลังปิดฐานข้อมูลเท่านั้น
  // ระหว่างที่ยังเปิดอยู่ ข้อมูลบางส่วนค้างอยู่ในไฟล์ -wal ยังไม่ถูกรวมเข้าไฟล์หลัก
  // ถ้าวัดตอนนั้นจะได้ขนาดที่เล็กกว่าความจริงมากจนเข้าใจผิดว่าย้ายข้อมูลไม่ครบ
  console.log();
  console.log('  ไฟล์ฐานข้อมูล: data/aircon.db (' + (readFileSync(DB_PATH).length / 1024).toFixed(0) + ' KB)');

  console.log();
  if (bad) {
    console.log('❌ มี ' + bad + ' ตารางที่จำนวนแถวไม่ตรงกัน — อย่าเพิ่งใช้ฐานข้อมูลนี้');
    process.exit(1);
  }
  console.log('✅ ย้ายข้อมูลครบถ้วน จำนวนแถวตรงกันทุกตาราง');
  console.log('   ข้อมูลใน Google Sheets ไม่ถูกแตะต้องเลย ยังใช้งานระบบเดิมได้ตามปกติ');
}

main().catch(e => {
  console.error('\n❌ ย้ายข้อมูลไม่สำเร็จ: ' + (e && e.message || e));
  console.error(e && e.stack);
  process.exit(1);
});
