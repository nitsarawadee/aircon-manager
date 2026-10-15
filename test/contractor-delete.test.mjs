/**
 * ลบบริษัทผู้รับเหมา — ไว้ลบชื่อที่พิมพ์ผิด/ซ้ำตอนสร้างบัญชี
 *
 * กติกาที่ชุดนี้ล็อกไว้: Infrastructure เท่านั้น · ไม่ยอมลบถ้ายังมีบัญชีผู้ใช้ แผนล้าง
 * หรืองานที่มอบหมายอ้างถึงบริษัทนั้น (ทุกที่เก็บแค่รหัส ลบแล้วจะเหลือรหัสลอยๆ)
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { deleteContractor } from '../src/modules/contractors.js';
import { createCleaningPlan } from '../src/modules/plan.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const addUser = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  addUser.run('admin', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  addUser.run('ra', 'แอดมินภาค', 'RegionAdmin', '1', '', 1, 'x');
  const addCt = db.prepare('INSERT INTO contractors (ID, Name, Active) VALUES (?,?,1)');
  addCt.run('CT001', 'ทีแอนด์เอ็น');
  addCt.run('CT002', 'บริษัทพิมพ์ผิด');
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, BTU, CleaningPricePerRound)
              VALUES ('ATG-ATG-AIR-1','อ่างทอง','ATG-ATG','1','ใช้งานปกติ',18000,450)`).run();
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, username) => { const c = new Ctx({}, state, db); c.username = username; return c; };
const ids = db => db.prepare('SELECT ID FROM contractors ORDER BY ID').all().map(r => r.ID);

test('Infrastructure ลบบริษัทที่ไม่มีอะไรอ้างถึงได้ — บริษัทอื่นยังอยู่', async () => {
  const db = freshDb();
  const list = await deleteContractor(as(db, 'admin'), 'CT002');
  assert.deepEqual(ids(db), ['CT001']);
  assert.deepEqual(list.map(c => c.ID), ['CT001'], 'คืนรายชื่อที่เหลือให้หน้าเว็บวาดใหม่');
});

test('คนที่ไม่ใช่ Infrastructure ลบไม่ได้', async () => {
  const db = freshDb();
  await assert.rejects(deleteContractor(as(db, 'ra'), 'CT002'));
  assert.deepEqual(ids(db), ['CT001', 'CT002']);
});

test('ยังมีบัญชีสังกัด (แม้ปิดใช้งานแล้ว) — ไม่ยอมลบ และบอกชื่อบัญชี', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (Username, Name, Role, Active, Password, ContractorID) VALUES ('tech','ช่าง','Contractor',0,'x','CT002')").run();
  await assert.rejects(deleteContractor(as(db, 'admin'), 'CT002'), /tech/);
  assert.deepEqual(ids(db), ['CT001', 'CT002']);
});

test('ยังถูกเลือกในแผนล้าง — ไม่ยอมลบ และบอกปี', async () => {
  const db = freshDb();
  await createCleaningPlan(as(db, 'admin'), 2030);
  db.prepare("UPDATE plans SET R2_ContractorID = 'ct002' WHERE Year = 2030").run();
  await assert.rejects(deleteContractor(as(db, 'admin'), 'CT002'), /2030/);
  assert.deepEqual(ids(db), ['CT001', 'CT002']);
});

test('มีงานซ่อม/ติดตั้งที่เคยมอบหมาย — ไม่ยอมลบ (เป็นประวัติว่าใครทำ)', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO job_assignments (ID, Kind, AirCode, RefID, ContractorID) VALUES ('JA1','repair','ATG-ATG-AIR-1','CM3001-01','CT002')").run();
  await assert.rejects(deleteContractor(as(db, 'admin'), 'CT002'), /มอบหมาย/);
  assert.deepEqual(ids(db), ['CT001', 'CT002']);
});

test('รหัสที่ไม่มีอยู่ — แจ้งให้รีเฟรช ไม่ลบอะไร', async () => {
  const db = freshDb();
  await assert.rejects(deleteContractor(as(db, 'admin'), 'CT999'), /รีเฟรช/);
  assert.deepEqual(ids(db), ['CT001', 'CT002']);
});
