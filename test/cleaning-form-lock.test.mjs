/**
 * ล็อกไว้ว่า "การรอเน็ตต้องไม่เกิดขึ้นระหว่างถือล็อกเขียนข้อมูล"
 *
 * การสร้าง PDF เรียกบริการภายนอกซึ่งรอได้นานถึง 2 นาที ส่วนล็อกเขียนข้อมูลจะยก
 * ให้คนถัดไปเมื่อผู้ถือครองนานเกินกำหนด การยกล็อกไม่ได้หยุดคนแรก เขายังเขียนต่ออยู่
 * ถ้าเรียก PDF อยู่ในล็อก จึงมีโอกาสที่คนสองคนเขียนพร้อมกัน ต่างคนต่างถือสำเนา
 * ข้อมูลคนละเวลา ใครบันทึกทีหลังทับของคนแรกโดยไม่มีอะไรฟ้อง
 *
 * เทสต์นี้จับ "ลำดับ" ไม่ใช่ผลลัพธ์ จึงกันการถอยกลับไปเป็นแบบเดิมได้จริง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm } from '../src/modules/cleaningform.js';
import { getHistory } from '../src/modules/history.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('tester', 'ผู้ทดสอบ', 'Admin', '', '', 1, 'x');
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, CleaningPricePerRound)
              VALUES ('A-AIR-1','โหนดทดสอบ','A','1','ใช้งานปกติ',450)`).run();
  return db;
}

/** state ที่จดไว้ว่าตอนนี้ถือล็อกอยู่หรือเปล่า */
function trackingState() {
  const s = {
    held: false,
    log: [],
    async acquireLock() { s.held = true; s.log.push('lock'); return true; },
    async releaseLock() { s.held = false; s.log.push('unlock'); return true; }
  };
  return s;
}

const record = () => ({
  NodeName: 'โหนดทดสอบ',
  AirCode1: 'A-AIR-1',
  Price1: 450,
  Date: '2026-09-09',
  Region: '1',
  TechnicianName: 'ช่างสมชาย',
  Checklist: []
});

test('ต้องไม่เรียกบริการ PDF ระหว่างที่ถือล็อกเขียนข้อมูล', async () => {
  const db = freshDb();
  const state = trackingState();

  let heldDuringPdf = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    heldDuringPdf = state.held;             // จุดสำคัญ: ตอนคุยกับเน็ต ถือล็อกอยู่หรือเปล่า
    throw new Error('จำลองว่าบริการ PDF ล่ม');
  };

  try {
    const ctx = new Ctx({ PDF_SERVICE_URL: 'https://example.invalid/pdf' }, state, db);
    ctx.username = 'tester';
    await saveCleaningForm(ctx, record());
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(heldDuringPdf, false, 'เรียก PDF ตอนถือล็อกอยู่ — จะทำให้ล็อกถูกยกให้คนอื่นกลางคัน');
  assert.deepEqual(state.log, ['lock', 'unlock'], 'ต้องถือล็อกรอบเดียว หลังสร้าง PDF เสร็จแล้ว');
});

test('บริการ PDF ล่ม ข้อมูลการล้างต้องยังถูกบันทึกครบ', async () => {
  const db = freshDb();
  const state = trackingState();

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('จำลองว่าบริการ PDF ล่ม'); };

  let result;
  try {
    const ctx = new Ctx({ PDF_SERVICE_URL: 'https://example.invalid/pdf' }, state, db);
    ctx.username = 'tester';
    result = await saveCleaningForm(ctx, record());
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.ok(result.pdfError, 'ต้องส่งข้อความบอกว่า PDF พลาด ไม่ใช่เงียบหายไป');
  assert.equal(result.pdfUrl, '');
  assert.equal(result.forms.length, 1, 'ใบงานต้องถูกบันทึก');

  const ctx2 = new Ctx({}, state, db);
  ctx2.username = 'tester';
  const hist = await getHistory(ctx2);
  assert.equal(hist.length, 1, 'ประวัติการล้างต้องถูกบันทึก');
  assert.equal(hist[0].AirCode, 'A-AIR-1');
});
