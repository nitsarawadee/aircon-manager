/**
 * ล้างต้องทำทีละรอบ — รอบก่อนหน้าของเครื่องนั้นต้องปิดเรียบร้อยก่อนจึงบันทึกรอบถัดไปได้
 *
 * ที่มา: ผู้รับเหมากรอก/แนบผิดรอบแล้วรอบที่ตั้งใจทำค้างอยู่ในรายการ (กรณี NGO) — เจ้าของงานกำหนดว่า
 * "รอบแรกปิดหมดค่อยรอบต่อไป" (15/10/2569)
 * - ใช้กับทั้งกรอกในระบบและแนบไฟล์ปิดงาน · ตรวจก่อนเขียนอะไร (ปฏิเสธแล้วไม่มีใบ ไม่มีไฟล์ ไม่มีประวัติ)
 * - รอบที่ยกเลิกถือว่าผ่านไปแล้ว · ตรวจรายเครื่อง
 * - ไม่ผูกกับแผน (ไม่ส่งปี/รอบ) ไม่ตรวจ
 */

import { strict as assert } from 'node:assert';
import test, { mock } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { createCleaningPlan, getCleaningPlan, updateCleaningRound } from '../src/modules/plan.js';
import { saveCleaningForm, uploadNodeDocuments, deleteCleaningForm, getCleaningForms } from '../src/modules/cleaningform.js';

// ข้อมูลทดสอบไฟล์นี้ใช้ปี 2030 — ตั้งนาฬิกาให้เป็นปลายปี 2030
// เพราะวันที่ปิดงานห้ามเป็นวันล่วงหน้า (assertNotFuture · ผู้ใช้ขอ 20/10/2569)
mock.timers.enable({ apis: ['Date'], now: new Date('2030-12-31T05:00:00Z') });

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  const a = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, BTU, CleaningPricePerRound)
                        VALUES (?,?,?,?,?,?,?,?)`);
  a.run('ATG-ATG-AIR-1', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'ใช้งานปกติ', 18000, 450);
  a.run('ATG-ATG-AIR-2', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'ใช้งานปกติ', 18000, 450);
  return db;
}
const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };
const attachments = { save: () => [{ name: 'a.png' }], list: () => [], read: () => null, removeAll() {} };
const infra = db => { const c = new Ctx({}, state, db, { attachments }); c.username = 'infra'; return c; };

const form = (code, round, extra = {}) => ({
  NodeName: 'อ่างทอง', Date: '2030-02-' + String(10 + round), AirCode1: code, EquipmentCondition: 'สภาพเครื่องสมบูรณ์', Checklist: [],
  PlanYear: 2030, PlanRound: round, ...extra
});
const attach = (code, round) => ({
  nodeName: 'อ่างทอง', files: [{ name: 'a.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' }],
  closeout: { date: '2030-02-20', year: 2030, round, units: [{ airCode: code, price: 450, condition: 'สภาพเครื่องสมบูรณ์' }] }
});
const status = async (db, code, round) => (await getCleaningPlan(infra(db), 2030)).find(r => r.AirCode === code)['R' + round + '_Status'];
const ORDER = /ทีละรอบ/;
const count = (db, t) => db.prepare('SELECT COUNT(*) n FROM ' + t).get().n;

test('กรอกในระบบ: ข้ามรอบไม่ได้ · ปิดรอบ 1 แล้วถึงรอบ 2 · แล้วถึงรอบ 3', async () => {
  const db = freshDb();
  await createCleaningPlan(infra(db), 2030, 3);

  await assert.rejects(() => saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 3)), ORDER);
  await assert.rejects(() => saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 2)), /ยังไม่ได้ปิดรอบที่ 1/);
  assert.equal(count(db, 'cleaning_forms'), 0, 'ปฏิเสธแล้วต้องไม่สร้างใบ');
  assert.equal(count(db, 'history'), 0, 'ปฏิเสธแล้วต้องไม่ลงประวัติ');
  assert.notEqual(await status(db, 'ATG-ATG-AIR-1', 3), 'ล้างเสร็จสิ้น');

  await saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 1));
  await assert.rejects(() => saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 3)), /ยังไม่ได้ปิดรอบที่ 2/);
  await saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 2));
  await saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 3));
  assert.equal(await status(db, 'ATG-ATG-AIR-1', 3), 'ล้างเสร็จสิ้น');
});

test('แนบไฟล์ปิดงาน: ใช้กติกาเดียวกัน (ไม่เก็บไฟล์ ไม่สร้างใบเมื่อถูกปฏิเสธ)', async () => {
  const db = freshDb();
  await createCleaningPlan(infra(db), 2030, 3);

  await assert.rejects(() => uploadNodeDocuments(infra(db), attach('ATG-ATG-AIR-1', 2)), /ยังไม่ได้ปิดรอบที่ 1/);
  assert.equal(count(db, 'cleaning_forms'), 0);
  await uploadNodeDocuments(infra(db), attach('ATG-ATG-AIR-1', 1));
  await uploadNodeDocuments(infra(db), attach('ATG-ATG-AIR-1', 2));
  assert.equal(await status(db, 'ATG-ATG-AIR-1', 2), 'ล้างเสร็จสิ้น');
  assert.notEqual(await status(db, 'ATG-ATG-AIR-1', 3), 'ล้างเสร็จสิ้น');
});

test('ตรวจรายเครื่อง: เครื่องหนึ่งไปรอบ 2 แล้ว อีกเครื่องที่ยังรอบ 1 ต้องปิดรอบ 1 ก่อน · ใบสองเครื่องต้องผ่านทั้งคู่', async () => {
  const db = freshDb();
  await createCleaningPlan(infra(db), 2030, 3);
  await saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 1));

  await saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 2));   // เครื่อง 1 ไปรอบ 2 ได้ ไม่ต้องรอเครื่อง 2
  await assert.rejects(() => saveCleaningForm(infra(db), form('ATG-ATG-AIR-2', 2)), /ATG-ATG-AIR-2 ยังไม่ได้ปิดรอบที่ 1/);
  await assert.rejects(() => saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 3, { AirCode2: 'ATG-ATG-AIR-2', EquipmentCondition2: 'สภาพเครื่องสมบูรณ์' })), ORDER);
});

test('รอบที่ยกเลิกถือว่าผ่านแล้ว · ไม่ผูกกับแผนไม่ตรวจ · ลบใบที่ปิดแล้วย้อนรอบ ต้องกลับมาติดกฎอีก', async () => {
  const db = freshDb();
  await createCleaningPlan(infra(db), 2030, 3);

  const plan = await getCleaningPlan(infra(db), 2030);
  const row = plan.find(r => r.AirCode === 'ATG-ATG-AIR-2')._row;
  await updateCleaningRound(infra(db), 2030, row, 1, { status: 'ยกเลิก' });
  assert.equal(await status(db, 'ATG-ATG-AIR-2', 1), 'ยกเลิก');
  await saveCleaningForm(infra(db), form('ATG-ATG-AIR-2', 2));   // รอบ 1 ยกเลิกแล้ว ไปรอบ 2 ได้

  // ไม่ส่งปี/รอบ = บันทึกเป็นเอกสารเฉยๆ ไม่ตรวจลำดับ
  await saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', '', { PlanYear: '', PlanRound: '' }));

  // ลบใบรอบ 1 ของเครื่อง 1 ไม่มี (ยังไม่เคยปิดรอบ 1) — ปิดรอบ 1 แล้วลบ → รอบ 1 กลับค้าง รอบ 2 ต้องถูกกันอีก
  await saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 1));
  const f1 = (await getCleaningForms(infra(db))).find(f => f.PlanRound === 1 || String(f.PlanRound) === '1');
  if (f1) {
    await deleteCleaningForm(infra(db), f1._row, f1.ID);
    await assert.rejects(() => saveCleaningForm(infra(db), form('ATG-ATG-AIR-1', 2)), /ยังไม่ได้ปิดรอบที่ 1/);
  }
});
