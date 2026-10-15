/**
 * ปิดงานในแผนได้ต่อเมื่อมีเอกสารของการล้างครั้งนั้นอยู่จริง
 *
 * ============================================================================
 * ปัญหาที่ชุดนี้แก้
 * ============================================================================
 * ช่องสถานะในหน้าแผนกดเปลี่ยนเป็น "ล้างเสร็จสิ้น" ได้เลยโดยไม่ต้องมีหลักฐานอะไร
 * ตัวเลขความคืบหน้าและงบประมาณจึงเดินไปได้ทั้งที่ไม่มีใบงานสักใบ และเวลาถูกถาม
 * ย้อนหลังว่าล้างจริงหรือเปล่าก็ไม่มีอะไรยืนยัน
 *
 * ทางที่ถูกคือกรอกฟอร์มบันทึกผลการล้าง หรือแนบเอกสารที่ช่างเขียนมา
 * แล้วระบบปิดงานให้เองพร้อมลงประวัติและค่าใช้จ่าย
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - ไม่มีเอกสาร = เปลี่ยนเป็น "ล้างเสร็จสิ้น" จากหน้าแผนไม่ได้
 * - มีเอกสารของเครื่องนั้น ปีนั้น รอบนั้น = ปิดได้
 * - เอกสารของคนละรอบ/คนละเครื่อง ไม่นับ
 * - รอบที่ปิดไปแล้ว ยังแก้ราคา/ชื่อช่างได้ตามปกติ
 * - สถานะอื่นไม่ถูกกระทบ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { updateCleaningRound, getCleaningPlan } from '../src/modules/plan.js';
import { saveCleaningForm } from '../src/modules/cleaningform.js';
import { getHistory } from '../src/modules/history.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');

  db.prepare(
    'INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, Brand, BTU)' +
    ' VALUES (?,?,?,?,?,?,?,?,?)'
  ).run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'Container', 'ใช้งานปกติ', 'Daikin', 18000);

  db.prepare(
    "INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R2_PlanDate, R2_Status, R1_Status) VALUES (?,?,?,?,?,?,'ล้างเสร็จสิ้น')"
  ).run(2026, 'AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '2026-09-10', 'รอดำเนินการ');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => {
  const c = new Ctx({}, state, db);
  c.username = 'boss';
  return c;
};

/** ค่าที่หน้าแผนส่งมาตอนกด "อัปเดตผล" */
const roundData = (over = {}) => ({
  planDate: '2026-09-10',
  actualDate: '2026-09-15',
  price: '450',
  technician: 'ช่างสมชาย',
  status: 'ล้างเสร็จสิ้น',
  note: '',
  ...over
});

/** บันทึกฟอร์มของรอบนั้น เพื่อให้มีเอกสารรองรับ */
const saveForm = (db, over = {}) => saveCleaningForm(ctxOf(db), {
  NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Region: '1', Province: 'อยุธยา',
  Date: '2026-09-15', PlanYear: 2026, PlanRound: 2,
  AirCode1: 'AYA-WNI-AIR-1', Price1: 450, Unit1_Brand: 'Daikin',
  TechnicianName: 'ช่างสมชาย', EquipmentCondition: 'สภาพเครื่องสมบูรณ์',
  Checklist: [],
  ...over
});

const statusOf = (db, round = 2) =>
  db.prepare('SELECT R' + round + '_Status s FROM plans WHERE AirCode = ?').get('AYA-WNI-AIR-1').s;

/* ==================== ไม่มีเอกสาร = ปิดไม่ได้ ==================== */

test('ไม่มีเอกสาร ต้องเปลี่ยนเป็น "ล้างเสร็จสิ้น" จากหน้าแผนไม่ได้', async () => {
  const db = freshDb();

  await assert.rejects(
    () => updateCleaningRound(ctxOf(db), 2026, 2, 2, roundData()),
    /ยังไม่มีเอกสารของการล้างครั้งนี้/
  );
  assert.equal(statusOf(db), 'รอดำเนินการ', 'สถานะต้องไม่ขยับ');
});

test('ถูกปฏิเสธแล้วต้องไม่มีอะไรถูกเขียนลงไปเลย', async () => {
  // ปฏิเสธทีหลังการเขียนบางส่วนไปแล้ว จะเหลือวันที่กับราคาค้างอยู่โดยไม่มีสถานะ
  const db = freshDb();

  await assert.rejects(() => updateCleaningRound(ctxOf(db), 2026, 2, 2, roundData()));

  const row = db.prepare('SELECT R2_ActualDate a, R2_Price p FROM plans WHERE AirCode = ?').get('AYA-WNI-AIR-1');
  assert.ok(!row.a, 'วันที่ล้างจริงต้องยังว่าง');
  assert.ok(!row.p, 'ราคาต้องยังว่าง');
  assert.equal((await getHistory(ctxOf(db))).length, 0, 'ต้องไม่มีประวัติงอกขึ้นมา');
});

test('มีเอกสารของคนละรอบ ก็ยังปิดรอบนี้ไม่ได้', async () => {
  const db = freshDb();
  await saveForm(db, { PlanRound: 1 });

  await assert.rejects(
    () => updateCleaningRound(ctxOf(db), 2026, 2, 2, roundData()),
    /ยังไม่มีเอกสารของการล้างครั้งนี้/
  );
});

test('มีเอกสารของคนละปี ก็ยังปิดรอบนี้ไม่ได้', async () => {
  const db = freshDb();
  await saveForm(db, { PlanYear: 2025 });

  await assert.rejects(
    () => updateCleaningRound(ctxOf(db), 2026, 2, 2, roundData()),
    /ยังไม่มีเอกสารของการล้างครั้งนี้/
  );
});

/* ==================== มีเอกสาร = ปิดได้ ==================== */

test('มีเอกสารของรอบนั้นแล้ว ต้องอัปเดตผลได้ตามปกติ', async () => {
  const db = freshDb();
  await saveForm(db);

  // การบันทึกฟอร์มปิดรอบให้อยู่แล้ว เปลี่ยนกลับก่อนเพื่อทดสอบทางหน้าแผนโดยตรง
  db.prepare("UPDATE plans SET R2_Status = 'รอดำเนินการ' WHERE AirCode = ?").run('AYA-WNI-AIR-1');

  await updateCleaningRound(ctxOf(db), 2026, 2, 2, roundData({ price: '600' }));
  assert.equal(statusOf(db), 'ล้างเสร็จสิ้น');
});

test('เอกสารที่ครอบสองเครื่อง ต้องนับให้เครื่องที่อยู่ช่องที่สองด้วย', async () => {
  const db = freshDb();
  db.prepare(
    'INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status)' +
    ' VALUES (?,?,?,?,?,?,?)'
  ).run('AYA-WNI-AIR-2', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'Container', 'ใช้งานปกติ');
  db.prepare(
    "INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R2_PlanDate, R2_Status, R1_Status) VALUES (?,?,?,?,?,?,'ล้างเสร็จสิ้น')"
  ).run(2026, 'AYA-WNI-AIR-2', 'วังน้อย', 'AYA-WNI', '2026-09-10', 'รอดำเนินการ');

  await saveForm(db, { AirCode2: 'AYA-WNI-AIR-2', Price2: 500, Unit2_Brand: 'Carrier' });
  db.prepare("UPDATE plans SET R2_Status = 'รอดำเนินการ'").run();

  // แถวที่ 3 ในตาราง = เครื่องตัวที่สอง (แถวที่ 1 เป็นหัวตาราง)
  await updateCleaningRound(ctxOf(db), 2026, 3, 2, roundData());
  const s = db.prepare("SELECT R2_Status s FROM plans WHERE AirCode = ?").get('AYA-WNI-AIR-2').s;
  assert.equal(s, 'ล้างเสร็จสิ้น');
});

/* ==================== สิ่งที่ต้องไม่ถูกกระทบ ==================== */

test('สถานะอื่นยังเปลี่ยนได้ตามปกติ ไม่ต้องมีเอกสาร', async () => {
  const db = freshDb();

  await updateCleaningRound(ctxOf(db), 2026, 2, 2, roundData({ status: 'นัดหมายแล้ว', actualDate: '' }));
  assert.equal(statusOf(db), 'นัดหมายแล้ว');

  await updateCleaningRound(ctxOf(db), 2026, 2, 2, roundData({ status: 'ยกเลิก', actualDate: '' }));
  assert.equal(statusOf(db), 'ยกเลิก');
});

test('รอบที่ปิดไปแล้ว ยังแก้ราคาและชื่อช่างได้ ไม่ต้องตรวจเอกสารซ้ำ', async () => {
  // ปิดจากการกรอกฟอร์มแล้วมาแก้ราคาทีหลัง เป็นเรื่องที่ทำกันจริง
  const db = freshDb();
  db.prepare("UPDATE plans SET R2_Status = 'ล้างเสร็จสิ้น' WHERE AirCode = ?").run('AYA-WNI-AIR-1');

  await updateCleaningRound(ctxOf(db), 2026, 2, 2, roundData({ price: '999', technician: 'ช่างคนใหม่' }));

  const row = db.prepare('SELECT R2_Price p, R2_Technician t FROM plans WHERE AirCode = ?').get('AYA-WNI-AIR-1');
  assert.equal(Number(row.p), 999);
  assert.equal(row.t, 'ช่างคนใหม่');
});

test('กรอกฟอร์มแล้วระบบยังปิดงานให้เองได้เหมือนเดิม', async () => {
  // ด่านนี้ต้องไม่ไปขวางทางที่ถูกต้อง
  const db = freshDb();
  const res = await saveForm(db);

  assert.equal(res.planClosed, 1);
  assert.equal(statusOf(db), 'ล้างเสร็จสิ้น');
  assert.equal((await getCleaningPlan(ctxOf(db), 2026)).length, 1);
});
