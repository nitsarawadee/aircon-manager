/**
 * ลบแผนล้างทั้งปี — มีไว้แก้กรณีกดสร้างแผนผิดปี
 *
 * กติกาที่ชุดนี้ล็อกไว้: ลบได้เฉพาะ Admin · ต้องพิมพ์ปียืนยันให้ตรง ·
 * ไม่ยอมลบแผนที่มีงานล้างจริงแล้ว (เป็นเงินที่จ่ายจริง) · ลบแล้วไม่แตะแผนปีอื่น
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { createCleaningPlan, deleteCleaningPlan, getPlanYears } from '../src/modules/plan.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const addUser = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  addUser.run('admin', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  addUser.run('ra', 'แอดมินภาค', 'RegionAdmin', '1', '', 1, 'x');
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, BTU, CleaningPricePerRound)
              VALUES ('ATG-ATG-AIR-1','อ่างทอง','ATG-ATG','1','ใช้งานปกติ',18000,450)`).run();
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, username) => { const c = new Ctx({}, state, db); c.username = username; return c; };
const count = (db, year) => db.prepare('SELECT COUNT(*) AS n FROM plans WHERE Year = ?').get(year).n;

test('Admin ลบแผนที่ยังไม่มีงานจริงได้ และแผนปีอื่นยังอยู่ครบ', async () => {
  const db = freshDb();
  await createCleaningPlan(as(db, 'admin'), 2030);
  await createCleaningPlan(as(db, 'admin'), 2031);

  const res = await deleteCleaningPlan(as(db, 'admin'), 2031, '2031');
  assert.equal(res.deleted, 1);
  assert.equal(count(db, 2031), 0);
  assert.equal(count(db, 2030), 1, 'แผนปีอื่นต้องไม่โดนลบไปด้วย');
  assert.deepEqual(await getPlanYears(as(db, 'admin')), ['Plan_2030']);
});

test('ปีที่พิมพ์ยืนยันไม่ตรง — ไม่ลบ', async () => {
  const db = freshDb();
  await createCleaningPlan(as(db, 'admin'), 2030);
  await assert.rejects(deleteCleaningPlan(as(db, 'admin'), 2030, '2031'), /ไม่ตรง/);
  await assert.rejects(deleteCleaningPlan(as(db, 'admin'), 2030, ''), /ไม่ตรง/);
  assert.equal(count(db, 2030), 1);
});

test('คนที่ไม่ใช่ Admin ลบแผนไม่ได้', async () => {
  const db = freshDb();
  await createCleaningPlan(as(db, 'admin'), 2030);
  await assert.rejects(deleteCleaningPlan(as(db, 'ra'), 2030, '2030'), /Infrastructure/);
  assert.equal(count(db, 2030), 1);
});

test('แผนที่มีรอบล้างไปแล้ว — ไม่ยอมลบ', async () => {
  const db = freshDb();
  await createCleaningPlan(as(db, 'admin'), 2030);
  db.prepare("UPDATE plans SET R2_ActualDate = '2030-05-01' WHERE Year = 2030").run();
  await assert.rejects(deleteCleaningPlan(as(db, 'admin'), 2030, '2030'), /ล้างไปแล้ว/);
  assert.equal(count(db, 2030), 1);
});

test('แผนที่มีใบบันทึกผลการล้างผูกอยู่ — ไม่ยอมลบ', async () => {
  const db = freshDb();
  await createCleaningPlan(as(db, 'admin'), 2030);
  db.prepare("INSERT INTO cleaning_forms (AirCode1, PlanYear, PlanRound) VALUES ('ATG-ATG-AIR-1', 2030, 1)").run();
  await assert.rejects(deleteCleaningPlan(as(db, 'admin'), 2030, '2030'), /ใบบันทึกผล/);
  assert.equal(count(db, 2030), 1);
});

test('ลบปีที่ไม่มีแผน — แจ้งว่าไม่พบ', async () => {
  const db = freshDb();
  await assert.rejects(deleteCleaningPlan(as(db, 'admin'), 2099, '2099'), /ไม่พบ/);
});
