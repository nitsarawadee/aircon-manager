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

test('บันทึกฟอร์มต้องไม่ออกเน็ตเลยสักครั้ง', async () => {
  // เดิมการบันทึกส่งข้อมูลไปให้ Google สร้าง PDF ซึ่งรอได้นานถึง 2 นาที
  // และเคยอยู่ในล็อกเขียนข้อมูลด้วย ทำให้ล็อกถูกยกให้คนอื่นกลางคัน
  // แล้วสองคนเขียนทับกันเงียบๆ
  //
  // ตอนนี้ไม่มีการออกเน็ตในเส้นทางนี้แล้ว เพราะเอกสารประกอบจากข้อมูลที่บันทึกไว้
  // ได้ทุกเมื่อ จึงไม่ต้องสร้างไฟล์ค้างไว้ตั้งแต่ตอนบันทึก
  const db = freshDb();
  const state = trackingState();

  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error('ห้ามออกเน็ตตอนบันทึกฟอร์ม'); };

  try {
    const ctx = new Ctx({ PDF_SERVICE_URL: 'https://example.invalid/pdf' }, state, db);
    ctx.username = 'tester';
    await saveCleaningForm(ctx, record());
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(calls, 0, 'บันทึกฟอร์มไม่ควรคุยกับบริการภายนอกเลย');
  assert.deepEqual(state.log, ['lock', 'unlock'], 'ต้องถือล็อกรอบเดียวและปล่อยทุกครั้ง');
});

test('เส้นทางบันทึกฟอร์มต้องไม่ผูกกับบริการ PDF ภายนอกอีก', async () => {
  // ตรวจที่โครงสร้าง ไม่ใช่แค่ผลลัพธ์ เพื่อกันไม่ให้ใครเผลอต่อกลับเข้าไป
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

  const src = readFileSync(join(ROOT, 'src', 'modules', 'cleaningform.js'), 'utf8');
  assert.ok(!src.includes('buildCleaningPdf'),
    'บันทึกฟอร์มต้องไม่เรียก buildCleaningPdf อีก — เอกสารประกอบเองในระบบแล้ว');
});

test('เน็ตล่มก็ยังบันทึกข้อมูลการล้างได้ครบ', async () => {
  const db = freshDb();
  const state = trackingState();

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('จำลองว่าเน็ตล่ม'); };

  let result;
  try {
    const ctx = new Ctx({}, state, db);
    ctx.username = 'tester';
    result = await saveCleaningForm(ctx, record());
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(result.forms.length, 1, 'ใบงานต้องถูกบันทึก');

  const ctx2 = new Ctx({}, state, db);
  ctx2.username = 'tester';
  const hist = await getHistory(ctx2);
  assert.equal(hist.length, 1, 'ประวัติการล้างต้องถูกบันทึก');
  assert.equal(hist[0].AirCode, 'A-AIR-1');
});
