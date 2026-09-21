/**
 * ล้างลิงก์ Google Drive ที่ค้างมาจากระบบเดิม
 *
 * วิธีรัน:
 *   node scripts/clear-legacy-drive-links.mjs           ดูอย่างเดียว
 *   node scripts/clear-legacy-drive-links.mjs --apply   ล้างจริง
 *
 * ที่มา: ระบบรุ่นแรกให้ Apps Script สร้าง PDF แล้วเก็บไว้บน Google Drive
 * ลิงก์ของไฟล์พวกนั้นถูกบันทึกไว้ในสามที่ คือช่องไฟล์ของเอกสาร ช่องลิงก์ของ
 * แต่ละรอบในแผน และในข้อความประวัติ
 *
 * ตอนนี้เอกสารถูกประกอบขึ้นใหม่จากข้อมูลในระบบทุกครั้ง และเก็บไฟล์ PDF ไว้เอง
 * ที่ data/docs/<ปี>/<เดือน>/ ลิงก์เก่าจึงไม่ได้ชี้ไปที่อะไรที่ระบบใช้อีกแล้ว
 * และทำให้หน้าเว็บรกเปล่าๆ
 *
 * ⚠️ ไม่แตะใบที่มาจากการแนบไฟล์ (Source = 'attach')
 * ใบพวกนั้นไม่มีข้อมูลเช็คลิสต์ให้ประกอบเอกสารใหม่ ลิงก์ที่เก็บไว้จึงเป็นทาง
 * เดียวที่จะเปิดไฟล์ที่ช่างถ่ายส่งมาได้ ล้างทิ้งแล้วเอกสารใบนั้นจะกลายเป็นใบเปล่า
 *
 * รันซ้ำได้ไม่เสียหาย เพราะรอบสองจะไม่เหลือลิงก์ให้ล้างแล้ว
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { backupDatabase } from '../platform/backup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = join(ROOT, 'data', 'aircon.db');
const apply = process.argv.includes('--apply');

if (!existsSync(DB)) {
  console.error('\n❌ ไม่พบฐานข้อมูลที่ ' + DB + '\n');
  process.exit(1);
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 5000');

const DRIVE = '%drive.google.com%';

/* ---------- 1. ช่องไฟล์ของเอกสาร ---------- */
const forms = db.prepare(
  "SELECT row_id, DocNo, ID, PdfUrl FROM cleaning_forms " +
  "WHERE COALESCE(Source,'') <> 'attach' " +
  "  AND (PdfUrl LIKE ? OR TRIM(COALESCE(PdfFileId,'')) <> '') " +
  "ORDER BY row_id"
).all(DRIVE);

const kept = db.prepare(
  "SELECT COUNT(*) c FROM cleaning_forms WHERE COALESCE(Source,'') = 'attach' AND TRIM(COALESCE(PdfUrl,'')) <> ''"
).get().c;

/* ---------- 2. ช่องลิงก์ของแต่ละรอบในแผน ---------- */
const planRows = db.prepare(
  "SELECT row_id, Year, AirCode, R1_FormUrl a, R2_FormUrl b, R3_FormUrl c FROM plans " +
  "WHERE R1_FormUrl LIKE ? OR R2_FormUrl LIKE ? OR R3_FormUrl LIKE ? ORDER BY row_id"
).all(DRIVE, DRIVE, DRIVE);

/* ---------- 3. ข้อความประวัติ ---------- */
const histRows = db.prepare(
  "SELECT row_id, AirCode, Detail FROM history WHERE Detail LIKE ? ORDER BY row_id"
).all(DRIVE);

/**
 * ตัดส่วนลิงก์เอกสารที่ต่อท้ายข้อความไว้ออก
 *
 * ข้อมูลจริงมีสองรูปแบบ เพราะคำที่ใช้เปลี่ยนไประหว่างทาง:
 *   " — PDF: <ลิงก์>"     12 รายการ (รุ่นแรก)
 *   " — เอกสาร: <ลิงก์>"   5 รายการ (รุ่นถัดมา)
 * ตรวจกับข้อมูลจริงก่อนเขียนเงื่อนไขนี้ ไม่ได้เดาจากโค้ดที่เหลืออยู่อย่างเดียว
 */
const LINK_TAIL = /\s*—\s*(?:เอกสาร|PDF):\s*\S+\s*$/u;
const stripLink = text => String(text || '').replace(LINK_TAIL, '').trimEnd();

console.log('ช่องไฟล์ของเอกสารที่ยังชี้ไป Drive:   ' + forms.length + ' ใบ');
console.log('รอบในแผนที่ยังผูกลิงก์ Drive:          ' + planRows.length + ' แถว');
console.log('ประวัติที่มีลิงก์ Drive ในข้อความ:      ' + histRows.length + ' รายการ');
console.log('ใบที่แนบไฟล์ไว้ (ไม่แตะ):              ' + kept + ' ใบ');
console.log();

const total = forms.length + planRows.length + histRows.length;
if (total === 0) {
  db.close();
  console.log('✅ ไม่มีลิงก์เก่าค้างอยู่ ไม่ต้องทำอะไร');
  process.exit(0);
}

if (histRows.length) {
  console.log('=== ตัวอย่างข้อความประวัติหลังล้าง ===');
  for (const h of histRows.slice(0, 3)) {
    console.log('  ก่อน: ' + h.Detail);
    console.log('  หลัง: ' + stripLink(h.Detail));
    console.log();
  }
}

if (!apply) {
  db.close();
  console.log('👀 ดูอย่างเดียว ยังไม่ได้ล้างอะไร — เติม --apply เพื่อล้างจริง');
  process.exit(0);
}

const backup = backupDatabase(db, join(ROOT, 'data', 'backups'), 'ก่อนล้างลิงก์ Drive เก่า');
console.log('💾 สำรองข้อมูลไว้แล้ว: data/backups/' + backup.name);

// ทำทั้งหมดในรายการเดียว ถ้าพลาดกลางคันให้ย้อนกลับทั้งหมด
db.exec('BEGIN');
try {
  const clearForm = db.prepare("UPDATE cleaning_forms SET PdfUrl = '', PdfFileId = '' WHERE row_id = ?");
  for (const f of forms) clearForm.run(f.row_id);

  const clearPlan = db.prepare(
    "UPDATE plans SET R1_FormUrl = '', R2_FormUrl = '', R3_FormUrl = '' WHERE row_id = ?"
  );
  for (const p of planRows) clearPlan.run(p.row_id);

  const fixHist = db.prepare('UPDATE history SET Detail = ? WHERE row_id = ?');
  for (const h of histRows) fixHist.run(stripLink(h.Detail), h.row_id);

  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('\n❌ ล้างไม่สำเร็จ: ' + err.message);
  console.error('   ข้อมูลถูกย้อนกลับเป็นเหมือนเดิมแล้ว');
  db.close();
  process.exit(1);
}

const left = db.prepare(
  "SELECT (SELECT COUNT(*) FROM cleaning_forms WHERE COALESCE(Source,'') <> 'attach' AND PdfUrl LIKE ?) + " +
  "       (SELECT COUNT(*) FROM plans WHERE R1_FormUrl LIKE ? OR R2_FormUrl LIKE ? OR R3_FormUrl LIKE ?) + " +
  "       (SELECT COUNT(*) FROM history WHERE Detail LIKE ?) AS c"
).get(DRIVE, DRIVE, DRIVE, DRIVE, DRIVE).c;
db.close();

console.log();
console.log('✅ เรียบร้อย ล้างไป ' + total + ' จุด');
console.log('   ที่ยังค้างอยู่: ' + left + ' (ที่เหลือคือใบแนบไฟล์ ซึ่งตั้งใจไม่แตะ)');
