/**
 * เวลาทำงานของใบที่รวมสองเครื่องเข้าด้วยกัน
 *
 * ============================================================================
 * ปัญหาที่ชุดนี้แก้
 * ============================================================================
 * เวลาเคยถูกนับเป็น "ช่องส่วนกลาง" ที่เติมให้เฉพาะตอนยังว่าง แปลว่าถ้าเครื่องแรก
 * กรอก 09:00-10:30 ไว้แล้ว เครื่องที่สองกรอก 14:00-15:30 ตามมา เวลาของเครื่อง
 * ที่สองจะถูกทิ้งเงียบๆ เอกสารขึ้นแค่ 09:00-10:30 ทั้งที่ช่างอยู่หน้างานถึงบ่าย
 *
 * ทางแก้ที่เจ้าของงานเลือกคือให้ช่วงเวลาคลุมทั้งสองเครื่อง แต่ระหว่างคุยกันเจอว่า
 * "บวกเวลาตรงๆ" ใช้ไม่ได้ เพราะหน้างานล้างสองตัวพร้อมกันเป็นเรื่องปกติ
 * ซึ่งจะกรอกเวลามาทับกัน แล้วการบวกจะได้เวลาทำงานเป็นสองเท่าของที่ทำจริง
 *
 * จึงคิดจาก "ช่วงเวลาที่ถูกครอบคลุมจริง" แทน
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - เวลาเริ่ม = เริ่มที่เร็วที่สุด · เวลาสิ้นสุด = จบที่ช้าที่สุด
 * - รวมเวลา = ความยาวของช่วงที่ครอบคลุมจริง ไม่ใช่ผลบวกดิบ
 * - ล้างพร้อมกัน (เวลาทับกัน) ต้องไม่ถูกนับซ้ำ
 * - ใบที่กรอกเวลาไม่ครบ ต้องไม่ไปลบเวลาของใบที่กรอกครบทิ้ง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm } from '../src/modules/cleaningform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');

  for (const code of ['AYA-WNI-AIR-1', 'AYA-WNI-AIR-2']) {
    db.prepare(
      'INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status)' +
      ' VALUES (?,?,?,?,?,?,?)'
    ).run(code, 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'Container', 'ใช้งานปกติ');
  }
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => {
  const c = new Ctx({}, state, db);
  c.username = 'boss';
  return c;
};

const base = over => ({
  NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Region: '1', Province: 'อยุธยา',
  Date: '2026-09-20', PlanYear: 2026, PlanRound: 2, Checklist: [],
  TechnicianName: 'ช่างเอ', ...over
});

/** ล้างเครื่องที่ 1 แล้วตามด้วยเครื่องที่ 2 ในวันเดียวกัน (ซึ่งจะถูกรวมเป็นใบเดียว) */
async function cleanBoth(first, second) {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), base({ AirCode1: 'AYA-WNI-AIR-1', Price1: 450, ...first }));
  await saveCleaningForm(ctxOf(db), base({ AirCode2: 'AYA-WNI-AIR-2', Price2: 500, ...second }));

  const rows = db.prepare('SELECT TimeStart, TimeEnd, TotalTime FROM cleaning_forms').all();
  assert.equal(rows.length, 1, 'วันเดียวกันต้องรวมเป็นใบเดียว');
  return { start: rows[0].TimeStart, end: rows[0].TimeEnd, total: rows[0].TotalTime };
}

/* ==================== สามแบบที่เกิดขึ้นจริงหน้างาน ==================== */

test('ล้างคนละช่วงเวลา — ช่วงต้องคลุมทั้งวัน และรวมเวลาเฉพาะที่ลงมือจริง', async () => {
  // เช้า 1 ชม. 30 นาที + บ่าย 1 ชม. 30 นาที = ลงมือจริง 3 ชม. แต่อยู่หน้างาน 09:00-15:30
  const got = await cleanBoth(
    { TimeStart: '09:00', TimeEnd: '10:30' },
    { TimeStart: '14:00', TimeEnd: '15:30' }
  );

  assert.equal(got.start, '09:00');
  assert.equal(got.end, '15:30');
  assert.equal(got.total, '3 ชม. 0 นาที');
});

test('ล้างพร้อมกัน — เวลาต้องไม่ถูกนับซ้ำ', async () => {
  // ข้อนี้คือเหตุผลที่ไม่ใช้การบวกตรงๆ ถ้าบวกจะได้ 3 ชม. ทั้งที่ทำงานจริง 1 ชม. 30 นาที
  const got = await cleanBoth(
    { TimeStart: '09:00', TimeEnd: '10:30' },
    { TimeStart: '09:00', TimeEnd: '10:30' }
  );

  assert.equal(got.start, '09:00');
  assert.equal(got.end, '10:30');
  assert.equal(got.total, '1 ชม. 30 นาที');
});

test('เวลาคาบเกี่ยวกัน — ส่วนที่ทับกันต้องนับครั้งเดียว', async () => {
  // เริ่มตัวที่สองตอนตัวแรกยังไม่เสร็จ ซึ่งเกิดได้ถ้าช่างสองคนช่วยกัน
  const got = await cleanBoth(
    { TimeStart: '09:00', TimeEnd: '10:30' },
    { TimeStart: '10:00', TimeEnd: '11:00' }
  );

  assert.equal(got.start, '09:00');
  assert.equal(got.end, '11:00');
  assert.equal(got.total, '2 ชม. 0 นาที', 'ช่วง 10:00-10:30 ที่ทับกันต้องนับครั้งเดียว');
});

/* ==================== กรอกไม่ครบ ==================== */

test('ใบหลังไม่ได้กรอกเวลา ต้องไม่ไปลบเวลาของใบแรกทิ้ง', async () => {
  const got = await cleanBoth(
    { TimeStart: '09:00', TimeEnd: '10:30' },
    { TimeStart: '', TimeEnd: '' }
  );

  assert.equal(got.start, '09:00');
  assert.equal(got.end, '10:30');
  assert.equal(got.total, '1 ชม. 30 นาที');
});

test('ใบแรกไม่ได้กรอกเวลา แต่ใบหลังกรอก ต้องได้เวลาของใบหลัง', async () => {
  // ของเดิมเคสนี้ทำงานถูกอยู่แล้ว (เพราะช่องยังว่าง) ต้องไม่พังตอนเปลี่ยนวิธีคิด
  const got = await cleanBoth(
    { TimeStart: '', TimeEnd: '' },
    { TimeStart: '14:00', TimeEnd: '15:30' }
  );

  assert.equal(got.start, '14:00');
  assert.equal(got.end, '15:30');
  assert.equal(got.total, '1 ชม. 30 นาที');
});

test('ไม่มีใบไหนกรอกเวลาเลย ต้องปล่อยว่าง ไม่ใช่ขึ้น 0 ชม.', async () => {
  const got = await cleanBoth({}, {});

  assert.ok(!got.start, 'เวลาเริ่มต้องว่าง');
  assert.ok(!got.total, 'รวมเวลาต้องว่าง ไม่ใช่ "0 ชม. 0 นาที" ที่ดูเหมือนล้างเสร็จใน 0 นาที');
});

test('เวลาที่กรอกมาผิดรูปแบบ ต้องไม่ทำให้บันทึกล้มเหลว', async () => {
  const got = await cleanBoth(
    { TimeStart: '09:00', TimeEnd: '10:30' },
    { TimeStart: 'บ่ายโมง', TimeEnd: '25:99' }
  );

  assert.equal(got.start, '09:00', 'ยึดใบที่กรอกถูกไว้');
  assert.equal(got.total, '1 ชม. 30 นาที');
});

/* ==================== ข้ามเที่ยงคืน ==================== */

test('ล้างข้ามเที่ยงคืน ต้องไม่ได้เวลาติดลบ', async () => {
  // ไซต์ที่ต้องเข้าตอนดึกมีจริง กติกาเดียวกับที่หน้าเว็บใช้ตอนคำนวณใบเดียว
  const got = await cleanBoth(
    { TimeStart: '23:00', TimeEnd: '00:30' },
    { TimeStart: '', TimeEnd: '' }
  );

  assert.equal(got.total, '1 ชม. 30 นาที');
});

/* ==================== สิ่งที่ต้องไม่ถูกกระทบ ==================== */

test('กรอกใบเดียวไม่ได้รวมกับใคร เวลาต้องเป็นตามที่กรอกเป๊ะ', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), base({
    AirCode1: 'AYA-WNI-AIR-1', Price1: 450,
    TimeStart: '09:00', TimeEnd: '10:30', TotalTime: '1 ชม. 30 นาที'
  }));

  const r = db.prepare('SELECT TimeStart, TimeEnd, TotalTime FROM cleaning_forms').get();
  assert.deepEqual([r.TimeStart, r.TimeEnd, r.TotalTime], ['09:00', '10:30', '1 ชม. 30 นาที']);
});

test('ล้างคนละวัน ต้องแยกใบ และเวลาของแต่ละใบต้องไม่ปนกัน', async () => {
  // เจ้าของงานยืนยันว่าคนละวัน = คนละครั้ง = คนละใบ ข้อนี้เฝ้าไว้ไม่ให้หลุด
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), base({
    Date: '2026-09-10', AirCode1: 'AYA-WNI-AIR-1', Price1: 450, TimeStart: '09:00', TimeEnd: '10:30'
  }));
  await saveCleaningForm(ctxOf(db), base({
    Date: '2026-09-14', AirCode2: 'AYA-WNI-AIR-2', Price2: 500, TimeStart: '13:00', TimeEnd: '14:00'
  }));

  const rows = db.prepare('SELECT Date, TimeStart, TimeEnd FROM cleaning_forms ORDER BY Date').all();
  assert.equal(rows.length, 2, 'คนละวันต้องแยกใบ');
  assert.deepEqual([rows[0].TimeStart, rows[0].TimeEnd], ['09:00', '10:30']);
  assert.deepEqual([rows[1].TimeStart, rows[1].TimeEnd], ['13:00', '14:00']);
});
