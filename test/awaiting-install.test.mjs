/**
 * เครื่องติดตั้งใหม่ต้องรอใบติดตั้งอนุมัติครบก่อนขึ้นรายการต่างๆ (เจ้าของงานขอ)
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - เพิ่มเครื่องใหม่ = สถานะ "รอติดตั้ง" เสมอ (ไม่สนสถานะที่ส่งมา) + งานติดตั้งรอเอกสาร
 * - ระหว่างรอ: ไม่นับในแดชบอร์ด · ไม่เข้าแผนล้าง (สร้าง/อัปเดต) · แจ้งซ่อม ออกใบล้าง ย้ายเครื่องไม่ได้
 *   · ไม่อยู่ในไฟล์สำหรับแก้ และไม่นับว่า "หายจากไฟล์" ตอนนำเข้า
 * - ฟอร์มติดตั้งยังเห็นเครื่อง (รายการ Node ติดป้าย Awaiting ให้หน้าเว็บซ่อนฝั่งใบล้าง)
 * - เปลี่ยนสถานะเอง / ตั้ง "รอติดตั้ง" เองไม่ได้
 * - ใบติดตั้งอนุมัติขั้นสุดท้าย (Infrastructure) → "ใช้งานปกติ" · ขั้นก่อนหน้ายังรออยู่
 * - เครื่องที่เปลี่ยน/ย้ายมาแทนไม่ใช้กติกานี้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { INSTALL_PENDING_NOTE } from '../src/schema.js';
import { planImport } from '../src/import.js';
import { approveDoc } from '../src/modules/approval.js';
import { saveAirUnit, moveAirUnit, getAirUnitImportFile } from '../src/modules/airlist.js';
import { getDashboardSummary } from '../src/modules/dashboard.js';
import { createCleaningPlan, syncCleaningPlan, getCleaningPlan } from '../src/modules/plan.js';
import { getCleaningFormNodes, saveCleaningForm } from '../src/modules/cleaningform.js';
import { reportRepair } from '../src/modules/history.js';
import { saveInstallForm, getInstallForms } from '../src/modules/installform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  user.run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  user.run('staff', 'สตาฟ ภาคหนึ่ง', 'Staff', '1', '', 1, 'x');
  user.run('sup', 'ซุป ภาคหนึ่ง', 'Supervisor', '1', '', 1, 'x');
  const a = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, BTU, CleaningPricePerRound)
                        VALUES (?,?,?,?,?,?,?,?)`);
  a.run('ATG-ATG-AIR-1', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'ใช้งานปกติ', 18000, 450);
  a.run('ATG-ATG-AIR-2', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'ใช้งานปกติ', 18000, 450);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };
const as = (db, u) => { const c = new Ctx({}, state, db, {}); c.username = u; return c; };
const statusOf = (db, code) => db.prepare('SELECT Status FROM air_units WHERE AirCode = ?').get(code).Status;

/** เพิ่มเครื่องใหม่ AIR-3 จากฟอร์มเพิ่มเครื่อง (ส่งสถานะ "ใช้งานปกติ" มาด้วย — ต้องไม่ได้ผล) */
async function addNew(db) {
  await saveAirUnit(as(db, 'infra'), {
    AirCode: 'ATG-ATG-AIR-3', NodeName: 'อ่างทอง', SiteCode: 'ATG-ATG', Region: '1', Province: 'อ่างทอง',
    Status: 'ใช้งานปกติ', BTU: 36000, CleaningPricePerRound: 450
  });
}

test('เพิ่มเครื่องใหม่ = "รอติดตั้ง" + งานติดตั้งรอเอกสาร', async () => {
  const db = freshDb();
  await addNew(db);
  assert.equal(statusOf(db, 'ATG-ATG-AIR-3'), 'รอติดตั้ง');
  const h = db.prepare("SELECT Note FROM history WHERE AirCode = 'ATG-ATG-AIR-3'").get();
  assert.equal(h.Note, INSTALL_PENDING_NOTE);
});

test('ระหว่างรอ: ไม่นับในแดชบอร์ด ไม่เข้าแผนล้าง ไม่อยู่ในไฟล์สำหรับแก้ ไม่นับว่าหายจากไฟล์', async () => {
  const db = freshDb();
  await createCleaningPlan(as(db, 'infra'), 2030, 2);
  await addNew(db);

  assert.equal((await getDashboardSummary(as(db, 'infra'), 2030)).totalUnits, 2);

  const pre = await syncCleaningPlan(as(db, 'infra'), 2030, false);
  assert.equal(pre.counts.adds, 0, 'อัปเดตแผนต้องไม่เอาเครื่องที่รอติดตั้งเข้าแผน');
  await createCleaningPlan(as(db, 'infra'), 2031, 2);
  assert.deepEqual((await getCleaningPlan(as(db, 'infra'), 2031)).map(p => p.AirCode), ['ATG-ATG-AIR-1', 'ATG-ATG-AIR-2']);

  const file = await getAirUnitImportFile(as(db, 'infra'));
  assert.equal(file.rows.length, 2);
  const existing = db.prepare('SELECT * FROM air_units').all();
  assert.deepEqual(planImport(existing, []).missing.map(u => u.AirCode), ['ATG-ATG-AIR-1', 'ATG-ATG-AIR-2']);
});

test('ระหว่างรอ: แจ้งซ่อม ออกใบล้าง ย้ายเครื่อง เปลี่ยนสถานะเองไม่ได้ · ฟอร์มติดตั้งยังเห็นเครื่อง', async () => {
  const db = freshDb();
  await addNew(db);

  await assert.rejects(() => reportRepair(as(db, 'infra'), { AirCode: 'ATG-ATG-AIR-3', Detail: 'ไม่เย็น' }), /รอใบติดตั้ง/);
  await assert.rejects(() => saveCleaningForm(as(db, 'infra'),
    { NodeName: 'อ่างทอง', AirCode1: 'ATG-ATG-AIR-3', Date: '2030-01-10' }), /รอใบติดตั้ง/);

  const row = n => db.prepare('SELECT rowid AS r FROM air_units WHERE AirCode = ?').get(n).r;
  await assert.rejects(() => moveAirUnit(as(db, 'infra'), row('ATG-ATG-AIR-3') + 1, 'ATG-ATG-AIR-1', '', 'ATG-ATG-AIR-3'), /รอใบติดตั้ง/);

  const units = (await getCleaningFormNodes(as(db, 'infra')))[0].units;
  assert.deepEqual(units.map(u => [u.AirCode, u.Awaiting]),
    [['ATG-ATG-AIR-1', false], ['ATG-ATG-AIR-2', false], ['ATG-ATG-AIR-3', true]]);

  await assert.rejects(() => saveAirUnit(as(db, 'infra'),
    { _row: row('ATG-ATG-AIR-3') + 1, AirCode: 'ATG-ATG-AIR-3', Region: '1', Status: 'ใช้งานปกติ' }), /รอใบติดตั้ง/);
  await assert.rejects(() => saveAirUnit(as(db, 'infra'),
    { _row: row('ATG-ATG-AIR-1') + 1, AirCode: 'ATG-ATG-AIR-1', Region: '1', Status: 'รอติดตั้ง' }), /ตั้งเองไม่ได้/);
  // แก้ช่องอื่นของเครื่องที่รอได้ตามปกติ (สถานะเดิมส่งกลับมาเหมือนเดิม)
  await saveAirUnit(as(db, 'infra'),
    { _row: row('ATG-ATG-AIR-3') + 1, AirCode: 'ATG-ATG-AIR-3', Region: '1', Status: 'รอติดตั้ง', Brand: 'Carrier' });
  assert.equal(db.prepare("SELECT Brand FROM air_units WHERE AirCode = 'ATG-ATG-AIR-3'").get().Brand, 'Carrier');
});

test('ใบติดตั้งอนุมัติครบ 4 ขั้น → "ใช้งานปกติ" ขึ้นรายการ · ขั้นก่อนหน้ายังรอ', async () => {
  const db = freshDb();
  await addNew(db);
  await saveInstallForm(as(db, 'infra'), { AirCode1: 'ATG-ATG-AIR-3', SlotBase: 2, Date: '2030-01-05', AcceptResult1: 'ผ่าน' });
  const form = (await getInstallForms(as(db, 'infra')))[0];
  assert.equal(statusOf(db, 'ATG-ATG-AIR-3'), 'รอติดตั้ง', 'กรอกใบแล้วแต่ยังไม่อนุมัติ = ยังรอ');

  await approveDoc(as(db, 'staff'), 'install', form.ID);
  await approveDoc(as(db, 'sup'), 'install', form.ID);
  assert.equal(statusOf(db, 'ATG-ATG-AIR-3'), 'รอติดตั้ง', 'ยังไม่ถึงขั้นสุดท้าย');

  await approveDoc(as(db, 'infra'), 'install', form.ID);
  assert.equal(statusOf(db, 'ATG-ATG-AIR-3'), 'ใช้งานปกติ');
  assert.equal((await getDashboardSummary(as(db, 'infra'), 2030)).totalUnits, 3);
});

test('ใบติดตั้งของเครื่องที่เปลี่ยนมาแทน อนุมัติครบแล้วสถานะไม่ถูกแตะ', async () => {
  const db = freshDb();
  db.prepare("UPDATE air_units SET Status = 'ชำรุด' WHERE AirCode = 'ATG-ATG-AIR-2'").run();
  db.prepare(`INSERT INTO history (ID, AirCode, Date, EventType, Detail, Note) VALUES
              ('CM3001-01','ATG-ATG-AIR-2','2030-01-02','เปลี่ยนเครื่อง','x',?)`).run(INSTALL_PENDING_NOTE);
  await saveInstallForm(as(db, 'infra'), { AirCode2: 'ATG-ATG-AIR-2', Date: '2030-01-05', AcceptResult2: 'ผ่าน' });
  const form = (await getInstallForms(as(db, 'infra')))[0];
  for (const u of ['staff', 'sup', 'infra']) await approveDoc(as(db, u), 'install', form.ID);
  assert.equal(statusOf(db, 'ATG-ATG-AIR-2'), 'ชำรุด');
});
