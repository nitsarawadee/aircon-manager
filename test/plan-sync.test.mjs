/**
 * อัปเดตแผนที่สร้างแล้วตามรายการเครื่อง (syncCleaningPlan) — เจ้าของงานขอ
 *
 * แผนเก็บชื่อ Node / BTU / ราคารายรอบไว้ตอนสร้าง ต้องมีทางดึงของใหม่มาโดยไม่แตะงานที่ทำไปแล้ว
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - ดูผลต้องไม่เขียนอะไรเลย
 * - เครื่องใหม่ที่ใช้งานอยู่ → เพิ่มเข้าแผน จำนวนรอบเท่าแผนปีนั้น · เครื่องที่รื้อถอนแล้วไม่เพิ่ม
 * - แก้ชื่อ Node / BTU / ราคา เฉพาะรอบที่ยังไม่ล้าง · รอบที่ล้างแล้วราคาคงเดิม
 * - ค่าว่างในรายการเครื่องไม่ล้างค่าในแผน
 * - เฉพาะ Infrastructure (Admin)
 * - ตัวเลขที่เห็นตอนยืนยันไม่ตรง = หยุด
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { createCleaningPlan, syncCleaningPlan } from '../src/modules/plan.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const u = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  u.run('admin', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  u.run('r1', 'ภาค 1', 'RegionAdmin', '1', 'plan:edit', 1, 'x');
  const a = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, BTU, CleaningPricePerRound)
                        VALUES (?,?,?,?,?,?,?)`);
  a.run('ATG-ATG-AIR-1', 'อ่างทอง', 'ATG-ATG', '1', 'ใช้งานปกติ', 18000, 450);
  a.run('ATG-ATG-AIR-2', 'อ่างทอง', 'ATG-ATG', '1', 'ใช้งานปกติ', 18000, 450);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, user = 'admin') => { const c = new Ctx({}, state, db); c.username = user; return c; };
const row = (db, code) => db.prepare('SELECT * FROM plans WHERE Year = 2030 AND AirCode = ?').get(code);

/** หลังสร้างแผน: เครื่อง 1 เปลี่ยน BTU/ราคา และล้างรอบ 1 ไปแล้ว · มีเครื่องใหม่ 1 ตัว + เครื่องรื้อถอน 1 ตัว */
async function scenario() {
  const db = freshDb();
  await createCleaningPlan(as(db), 2030, 2);
  db.prepare("UPDATE plans SET R1_Status = 'ล้างเสร็จสิ้น', R1_ActualDate = '2030-02-01' WHERE AirCode = 'ATG-ATG-AIR-1'").run();
  db.prepare("UPDATE air_units SET BTU = 24000, CleaningPricePerRound = 500, NodeName = 'อ่างทอง (ใหม่)' WHERE AirCode = 'ATG-ATG-AIR-1'").run();
  db.prepare("UPDATE air_units SET BTU = NULL WHERE AirCode = 'ATG-ATG-AIR-2'").run();   // ค่าว่าง ต้องไม่ล้างของในแผน
  const a = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, BTU, CleaningPricePerRound)
                        VALUES (?,?,?,?,?,?,?)`);
  a.run('ATG-ATG-AIR-3', 'อ่างทอง', 'ATG-ATG', '1', 'ใช้งานปกติ', 12000, 400);
  a.run('ATG-ATG-AIR-4', 'อ่างทอง', 'ATG-ATG', '1', 'รื้อถอน/ปลดระวาง', 12000, 400);
  return db;
}

test('ดูผลบอกเพิ่ม/แก้ โดยไม่เขียนอะไรเลย', async () => {
  const db = await scenario();
  const before = db.prepare('SELECT COUNT(*) n FROM plans').get().n;

  const res = await syncCleaningPlan(as(db), 2030, false);
  assert.deepEqual(res.counts, { adds: 1, updates: 1 });
  assert.equal(res.adds[0].airCode, 'ATG-ATG-AIR-3', 'เครื่องรื้อถอนต้องไม่ถูกเพิ่ม');
  const cols = res.updates[0].changes.map(c => c.column);
  assert.deepEqual(cols.sort(), ['BTU', 'NodeName', 'ราคารอบ 2'].sort(), 'รอบ 1 ล้างแล้ว ราคาต้องไม่ถูกแตะ');

  assert.equal(db.prepare('SELECT COUNT(*) n FROM plans').get().n, before);
  assert.equal(row(db, 'ATG-ATG-AIR-1').BTU, 18000);
});

test('ยืนยันแล้วเขียนจริง — รอบที่ล้างแล้วคงราคาเดิม · เครื่องใหม่ได้จำนวนรอบเท่าแผนปีนั้น', async () => {
  const db = await scenario();
  const res = await syncCleaningPlan(as(db), 2030, true, { adds: 1, updates: 1 });
  assert.equal(res.added, 1);
  assert.equal(res.updated, 1);

  const r1 = row(db, 'ATG-ATG-AIR-1');
  assert.equal(r1.BTU, 24000);
  assert.equal(r1.NodeName, 'อ่างทอง (ใหม่)');
  assert.equal(r1.R1_Price, 450, 'รอบที่ล้างแล้วคงราคาเดิม');
  assert.equal(r1.R2_Price, 500);

  assert.equal(row(db, 'ATG-ATG-AIR-2').BTU, 18000, 'BTU ว่างในรายการเครื่อง ต้องไม่ล้างค่าในแผน');

  const r3 = row(db, 'ATG-ATG-AIR-3');
  assert.equal(r3.Rounds, 2);
  assert.equal(r3.R1_Price, 400);
  assert.equal(r3.R2_Status, 'รอดำเนินการ');
  assert.equal(r3.R3_Status ?? '', '', 'แผน 2 รอบ เครื่องใหม่ต้องไม่มีรอบ 3');
  assert.ok(!row(db, 'ATG-ATG-AIR-4'), 'เครื่องรื้อถอนต้องไม่ถูกเพิ่ม');
});

test('ตัวเลขที่เห็นตอนยืนยันไม่ตรง ต้องหยุด ไม่เขียนอะไร', async () => {
  const db = await scenario();
  await assert.rejects(() => syncCleaningPlan(as(db), 2030, true, { adds: 0, updates: 1 }), /เปลี่ยนไประหว่างที่ดูผล/);
  assert.ok(!row(db, 'ATG-ATG-AIR-3'));
});

test('แผนตรงกับรายการเครื่องอยู่แล้ว — ดูผลได้ 0 · ยืนยันต้องบอกว่าไม่มีอะไรต้องทำ', async () => {
  const db = freshDb();
  await createCleaningPlan(as(db), 2030);
  assert.deepEqual((await syncCleaningPlan(as(db), 2030, false)).counts, { adds: 0, updates: 0 });
  await assert.rejects(() => syncCleaningPlan(as(db), 2030, true), /ไม่มีอะไรต้องอัปเดต/);
});

test('คนที่ไม่ใช่ Infrastructure ใช้ไม่ได้', async () => {
  const db = await scenario();
  await assert.rejects(() => syncCleaningPlan(as(db, 'r1'), 2030, false));
});
