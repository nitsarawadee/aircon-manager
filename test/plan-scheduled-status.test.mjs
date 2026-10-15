/**
 * ลงวันตามแผนแล้ว = "นัดหมายแล้ว" ทุกแผน ทุกช่องทาง (เจ้าของงานกำหนด 15/10/2569)
 *
 * - หน้าต่างตั้งแผนรอบ (updateCleaningRound) · นำเข้าไฟล์ (updatePlanBulk) · ตั้งทั้ง Node (มีอยู่แล้ว)
 * - ล้างเสร็จสิ้น / ยกเลิก ไม่ถูกเปลี่ยน
 * - ข้อมูลเดิม: วันที่ 15/10/2026 ที่นำเข้าไว้ → 2026-10-15 และรอบที่มีวันเป็นนัดหมายแล้ว (normalizePlanDatesAndScheduled)
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { normalizePlanDatesAndScheduled } from '../src/db/migrate.js';
import { Ctx } from '../src/context.js';
import { createCleaningPlan, updateCleaningRound, updatePlanBulk } from '../src/modules/plan.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('admin', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const u = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, BTU, CleaningPricePerRound)
              VALUES (?,'อ่างทอง','ATG-ATG','1','ใช้งานปกติ',18000,450)`);
  u.run('ATG-ATG-AIR-1');
  u.run('ATG-ATG-AIR-2');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const asAdmin = db => { const c = new Ctx({}, state, db); c.username = 'admin'; return c; };
const planRow = (db, code) => db.prepare('SELECT * FROM plans WHERE AirCode = ?').get(code);
const sheetRow = (db, code) => db.prepare('SELECT COUNT(*) AS n FROM plans WHERE rowid <= (SELECT rowid FROM plans WHERE AirCode = ?)').get(code).n + 1;

test('หน้าต่างตั้งแผนรอบ: ใส่วันแล้วสถานะรอดำเนินการ → นัดหมายแล้ว · ไม่มีวันคงรอดำเนินการ · ยกเลิกคงตามที่เลือก', async () => {
  const db = freshDb();
  await createCleaningPlan(asAdmin(db), 2030);
  await updateCleaningRound(asAdmin(db), 2030, sheetRow(db, 'ATG-ATG-AIR-1'), 1, { planDate: '2030-03-01', status: 'รอดำเนินการ' });
  assert.equal(planRow(db, 'ATG-ATG-AIR-1').R1_Status, 'นัดหมายแล้ว');

  await updateCleaningRound(asAdmin(db), 2030, sheetRow(db, 'ATG-ATG-AIR-2'), 1, { planDate: '', status: 'รอดำเนินการ' });
  assert.equal(planRow(db, 'ATG-ATG-AIR-2').R1_Status, 'รอดำเนินการ');

  await updateCleaningRound(asAdmin(db), 2030, sheetRow(db, 'ATG-ATG-AIR-2'), 2, { planDate: '2030-06-01', status: 'ยกเลิก' });
  assert.equal(planRow(db, 'ATG-ATG-AIR-2').R2_Status, 'ยกเลิก');
});

test('นำเข้าไฟล์: รอบที่ได้วัน → นัดหมายแล้ว · รอบที่ไม่ได้วัน/เครื่องอื่นไม่แตะ · ยกเลิกไม่แตะ', async () => {
  const db = freshDb();
  await createCleaningPlan(asAdmin(db), 2030);
  db.prepare("UPDATE plans SET R3_Status = 'ยกเลิก' WHERE AirCode = 'ATG-ATG-AIR-1'").run();
  await updatePlanBulk(asAdmin(db), 2030, [{ AirCode: 'ATG-ATG-AIR-1', R1_PlanDate: '01/03/2030', R3_PlanDate: '01/11/2030' }]);
  const r = planRow(db, 'ATG-ATG-AIR-1');
  assert.equal(r.R1_PlanDate, '2030-03-01');
  assert.equal(r.R1_Status, 'นัดหมายแล้ว');
  assert.equal(r.R2_Status, 'รอดำเนินการ', 'รอบที่ไฟล์ไม่ได้ใส่วัน');
  assert.equal(r.R3_Status, 'ยกเลิก', 'ยกเลิกไว้ ไม่เปลี่ยน');
  assert.equal(planRow(db, 'ATG-ATG-AIR-2').R1_Status, 'รอดำเนินการ', 'เครื่องที่ไม่อยู่ในไฟล์');
});

test('ข้อมูลเดิม (ทุกปี): วัน/เดือน/ปี → ปปปป-ดด-วว และรอบที่มีวันเป็นนัดหมายแล้ว · ล้างแล้ว/ยกเลิก/เกินจำนวนรอบไม่แตะ · รันซ้ำไม่ทำอะไร', () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO plans (Year, Rounds, AirCode, R1_PlanDate, R1_Status, R2_PlanDate, R2_Status, R3_PlanDate, R3_Status)
                          VALUES (?,?,?,?,?,?,?,?,?)`);
  ins.run(2026, 2, 'ATG-ATG-AIR-1', '15/10/2026', 'รอดำเนินการ', '1/2/2027', 'ยกเลิก', '20/12/2026', 'รอดำเนินการ');
  ins.run(2027, 3, 'ATG-ATG-AIR-1', '2027-03-05', '', '', 'รอดำเนินการ', '05/09/2027', 'ล้างเสร็จสิ้น');
  ins.run(2027, 3, 'ATG-ATG-AIR-2', 'ไม่ทราบ', 'รอดำเนินการ', '31/02/2027', 'รอดำเนินการ', '', '');

  assert.equal(normalizePlanDatesAndScheduled(db), 6);
  const get = (y, c) => db.prepare('SELECT * FROM plans WHERE Year = ? AND AirCode = ?').get(y, c);

  const a = get(2026, 'ATG-ATG-AIR-1');
  assert.deepEqual([a.R1_PlanDate, a.R1_Status], ['2026-10-15', 'นัดหมายแล้ว']);
  assert.deepEqual([a.R2_PlanDate, a.R2_Status], ['2027-02-01', 'ยกเลิก'], 'ยกเลิก: แปลงวันอย่างเดียว');
  assert.deepEqual([a.R3_PlanDate, a.R3_Status], ['20/12/2026', 'รอดำเนินการ'], 'แผน 2 รอบ ไม่มีรอบ 3 — ไม่แตะ');

  const b = get(2027, 'ATG-ATG-AIR-1');
  assert.deepEqual([b.R1_PlanDate, b.R1_Status], ['2027-03-05', 'นัดหมายแล้ว'], 'สถานะว่าง + มีวัน');
  assert.equal(b.R2_Status, 'รอดำเนินการ', 'ไม่มีวัน ไม่เปลี่ยน');
  assert.deepEqual([b.R3_PlanDate, b.R3_Status], ['2027-09-05', 'ล้างเสร็จสิ้น']);

  const c = get(2027, 'ATG-ATG-AIR-2');
  assert.deepEqual([c.R1_PlanDate, c.R1_Status], ['ไม่ทราบ', 'นัดหมายแล้ว'], 'ค่าที่อ่านไม่ออกคงไว้ แต่มีข้อความวัน = มีนัด');
  assert.equal(c.R2_PlanDate, '31/02/2027', 'วันที่ไม่มีจริง ไม่เดาแปลง');

  assert.equal(normalizePlanDatesAndScheduled(db), 0, 'รันซ้ำไม่เหลืออะไรให้เปลี่ยน');
});
