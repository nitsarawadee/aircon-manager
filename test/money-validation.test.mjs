/**
 * ค่าเงินที่กรอกมา (ค่าล้าง ค่าซ่อม ค่าติดตั้ง ค่าเปลี่ยนเครื่อง ค่าใช้จ่ายในประวัติ) ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป
 *
 * ติดลบหรือเป็นตัวอักษรเคยผ่านเซิร์ฟเวอร์ได้ (หน้าเว็บกันไว้แค่บางช่อง) ค่าติดลบไปหักค่าใช้จ่ายรวมในงบ
 * - ว่าง = ไม่ระบุ ยังใช้ได้เหมือนเดิม · 0 ใช้ได้
 * - ถูกปฏิเสธต้องไม่เขียนอะไรลงตารางเลย
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { assertMoney } from '../src/values.js';
import { addHistoryRecord, reportRepair, markCannotRepair } from '../src/modules/history.js';
import { saveCleaningForm, uploadNodeDocuments } from '../src/modules/cleaningform.js';
import { saveRepairForm } from '../src/modules/repairform.js';
import { saveInstallForm } from '../src/modules/installform.js';
import { replaceAirUnit, saveAirUnit } from '../src/modules/airlist.js';

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
const infra = db => { const c = new Ctx({}, state, db, {}); c.username = 'infra'; return c; };
const count = (db, t) => db.prepare('SELECT COUNT(*) n FROM ' + t).get().n;
const MONEY = /ตั้งแต่ 0 ขึ้นไป/;

test('assertMoney: ว่าง/0/ทศนิยม/ข้อความตัวเลข ผ่าน · ติดลบ/ตัวอักษร/ค่าไม่จำกัด ไม่ผ่าน', () => {
  for (const ok of ['', '  ', null, undefined, 0, '0', 500, '450.50', 0.5]) assert.doesNotThrow(() => assertMoney('ค่า', ok), String(ok));
  for (const bad of [-1, '-5', 'abc', '12abc', NaN, Infinity, {}, []]) {
    if (Array.isArray(bad)) continue;   // Number([]) = 0 ไม่ถือเป็นข้อมูลที่หน้าเว็บส่งมา
    assert.throws(() => assertMoney('ค่า', bad), MONEY, String(bad));
  }
});

test('ประวัติ: ค่าใช้จ่ายติดลบ/ตัวอักษรถูกปฏิเสธ ไม่เขียนอะไร', async () => {
  const db = freshDb();
  const rec = cost => ({ AirCode: 'ATG-ATG-AIR-1', Date: '2030-01-10', EventType: 'เปลี่ยนอะไหล่', Detail: 'x', Cost: cost });
  const before = count(db, 'history');
  for (const bad of [-5000, '-1', 'abc']) await assert.rejects(() => addHistoryRecord(infra(db), rec(bad)), MONEY);
  assert.equal(count(db, 'history'), before);
  await addHistoryRecord(infra(db), rec(1500));
  await addHistoryRecord(infra(db), rec(''));
  assert.equal(count(db, 'history'), before + 2);
});

test('ซ่อมไม่ได้ · เปลี่ยนเครื่อง: ค่าใช้จ่ายติดลบถูกปฏิเสธ', async () => {
  const db = freshDb();
  await reportRepair(infra(db), { AirCode: 'ATG-ATG-AIR-1', Detail: 'ไม่เย็น', Date: '2030-01-10' });
  await assert.rejects(() => markCannotRepair(infra(db), { AirCode: 'ATG-ATG-AIR-1', Reason: 'ไหม้', Cost: -10 }), MONEY);
  assert.equal(db.prepare("SELECT Status FROM air_units WHERE AirCode = 'ATG-ATG-AIR-1'").get().Status, 'ชำรุด', 'ปฏิเสธแล้วสถานะต้องไม่เปลี่ยน');

  const row = db.prepare("SELECT rowid AS r FROM air_units WHERE AirCode = 'ATG-ATG-AIR-2'").get().r + 1;
  await assert.rejects(() => replaceAirUnit(infra(db), row, { IndoorSN: 'N1', ReplaceCost: -9000 }, 'ATG-ATG-AIR-2'), MONEY);
  assert.equal(db.prepare("SELECT IndoorSN FROM air_units WHERE AirCode = 'ATG-ATG-AIR-2'").get().IndoorSN || '', '');
});

test('ใบล้าง: ราคาติดลบ/ตัวอักษรถูกปฏิเสธ ไม่สร้างใบ ไม่ลงประวัติ', async () => {
  const db = freshDb();
  const rec = extra => ({ NodeName: 'อ่างทอง', Date: '2030-01-10', AirCode1: 'ATG-ATG-AIR-1', EquipmentCondition: 'สภาพเครื่องสมบูรณ์', Checklist: [], ...extra });
  for (const extra of [{ Price1: -800 }, { Price1: 'abc' }, { Price: -1 }, { AirCode2: 'ATG-ATG-AIR-2', Price2: '-3' }]) {
    await assert.rejects(() => saveCleaningForm(infra(db), rec(extra)), MONEY);
  }
  assert.equal(count(db, 'cleaning_forms'), 0);
  assert.equal(count(db, 'history'), 0);
  await saveCleaningForm(infra(db), rec({ Price1: 0 }));
  assert.equal(count(db, 'cleaning_forms'), 1);
});

test('ใบซ่อม · ใบติดตั้ง: ค่าติดลบถูกปฏิเสธ ไม่สร้างใบ', async () => {
  const db = freshDb();
  await reportRepair(infra(db), { AirCode: 'ATG-ATG-AIR-1', Detail: 'ไม่เย็น', Date: '2030-01-10' });
  const u = db.prepare("SELECT rowid AS r FROM air_units WHERE AirCode = 'ATG-ATG-AIR-1'").get().r + 1;
  await saveAirUnit(infra(db), { _row: u, AirCode: 'ATG-ATG-AIR-1', Region: '1', Status: 'รอซ่อม' });
  const repair = cost => ({ AirCode: 'ATG-ATG-AIR-1', Date: '2030-01-11', Symptom: 'x', Cause: 'x', Fix: 'x', TechnicianName: 'x', CompanyName: 'x', Cost: cost, Checklist: [], Parts: [] });
  await assert.rejects(() => saveRepairForm(infra(db), repair(-700)), MONEY);
  await assert.rejects(() => saveRepairForm(infra(db), repair('abc')), MONEY);
  assert.equal(count(db, 'repair_forms'), 0);
  await saveRepairForm(infra(db), repair(1200));
  assert.equal(count(db, 'repair_forms'), 1);

  const install = cost => ({ NodeName: 'อ่างทอง', AirCode2: 'ATG-ATG-AIR-2', Date: '2030-01-10', SlotBase: 0, Checklist: [], TechnicianName: 'x', CompanyName: 'x', Cost: cost });
  await assert.rejects(() => saveInstallForm(infra(db), install(-100)), MONEY);
  assert.equal(count(db, 'install_forms'), 0);
  await saveInstallForm(infra(db), install(''));
  assert.equal(count(db, 'install_forms'), 1);
});

test('แนบไฟล์ใบล้างปิดงาน: ราคาติดลบถูกปฏิเสธก่อนเก็บไฟล์', async () => {
  const db = freshDb();
  const saved = [];
  const attachments = { save: (...a) => { saved.push(a); return [{ name: 'a.png' }]; }, list: () => [], read: () => null, removeAll() {} };
  const ctx = new Ctx({}, state, db, { attachments });
  ctx.username = 'infra';
  const payload = price => ({
    nodeName: 'อ่างทอง', files: [{ name: 'a.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' }],
    closeout: { date: '2030-01-10', year: 2030, round: 1, units: [{ airCode: 'ATG-ATG-AIR-1', price, condition: 'สภาพเครื่องสมบูรณ์' }] }
  });
  await assert.rejects(() => uploadNodeDocuments(ctx, payload(-500)), MONEY);
  assert.equal(saved.length, 0, 'ปฏิเสธแล้วต้องไม่เก็บไฟล์');
  assert.equal(count(db, 'cleaning_forms'), 0);
});
