/**
 * สร้างแผนล้างปีใหม่ — ค่าต้องลงคอลัมน์ที่ถูก
 *
 * ============================================================================
 * บั๊กที่ชุดนี้ล็อกไว้
 * ============================================================================
 * createCleaningPlan เคยเขียนแถวเป็นลำดับช่องแบบชีตเก่า (รอบละ 6 ช่อง) แต่ตาราง plans
 * มี R*_FormUrl ต่อท้ายทุกรอบ ค่าของรอบ 2 เลื่อนไป 1 ช่อง รอบ 3 เลื่อนไป 2 ช่อง
 * ราคาไปโผล่ในช่องวันที่ และชื่อคนสร้างไปอยู่ในช่องสถานะ
 * (เจ้าของงานเจอตอนสร้างแผนปี 2028, 2029 · แผน 2026 ไม่โดนเพราะย้ายมาจากชีตเดิม)
 *
 * repairShiftedPlanRows ย้ายค่าของแผนที่เลื่อนไปแล้วกลับที่เดิม ตอนเปิดเซิร์ฟเวอร์
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { repairShiftedPlanRows } from '../src/db/migrate.js';
import { Ctx } from '../src/context.js';
import { createCleaningPlan } from '../src/modules/plan.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('admin', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, BTU, CleaningPricePerRound)
              VALUES ('ATG-ATG-AIR-1','อ่างทอง','ATG-ATG','1','ใช้งานปกติ',18000,450)`).run();
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const asAdmin = db => { const c = new Ctx({}, state, db); c.username = 'admin'; return c; };

test('สร้างแผนปีใหม่ — ราคาและสถานะลงช่องของทุกรอบถูกต้อง ไม่เลื่อน', async () => {
  const db = freshDb();
  await createCleaningPlan(asAdmin(db), 2028);
  const row = db.prepare('SELECT * FROM plans WHERE Year = 2028').get();

  for (const r of [1, 2, 3]) {
    assert.equal(row['R' + r + '_Price'], 450, 'ราคารอบ ' + r);
    assert.equal(row['R' + r + '_Status'], 'รอดำเนินการ', 'สถานะรอบ ' + r);
    assert.equal(row['R' + r + '_PlanDate'] || '', '', 'วันตามแผนรอบ ' + r + ' ต้องว่าง');
    assert.equal(row['R' + r + '_ActualDate'] || '', '', 'วันที่จริงรอบ ' + r + ' ต้องว่าง');
    assert.equal(row['R' + r + '_Technician'] || '', '', 'ช่างรอบ ' + r + ' ต้องว่าง');
  }
  assert.equal(row.UpdatedBy, 'admin', 'ชื่อคนสร้างต้องอยู่ช่อง UpdatedBy ไม่ใช่ช่องสถานะ');
});

/** แถวที่หน้าตาเหมือนที่บั๊กเดิมเขียนไว้จริง (คัดจากฐานข้อมูลจริง ปี 2028) */
function insertShifted(db, year, code) {
  db.prepare(`INSERT INTO plans (Year, AirCode, NodeName, SiteCode, BTU,
      R1_PlanDate, R1_ActualDate, R1_Price, R1_Technician, R1_Status, R1_Note, R1_FormUrl,
      R2_PlanDate, R2_ActualDate, R2_Price, R2_Technician, R2_Status, R2_Note, R2_FormUrl,
      R3_PlanDate, R3_ActualDate, R3_Price, R3_Technician, R3_Status, R3_Note, R3_FormUrl, UpdatedBy)
    VALUES (?, ?, 'อ่างทอง', 'ATG-ATG', 18000,
      '', '', 450, '', 'รอดำเนินการ', '', '',
      '', '450', NULL, 'รอดำเนินการ', '', '', '',
      '450', '', NULL, '', 'admin', '', '', '')`).run(year, code);
}

test('ซ่อมแผนที่เลื่อนแล้ว — ย้ายค่าของรอบ 2 และ 3 กลับที่เดิม', () => {
  const db = freshDb();
  insertShifted(db, 2028, 'ATG-ATG-AIR-1');

  assert.equal(repairShiftedPlanRows(db), 2, 'ซ่อมสองรอบ (รอบ 2 และรอบ 3)');
  const row = db.prepare('SELECT * FROM plans').get();

  assert.equal(row.R2_Price, 450);
  assert.equal(row.R2_ActualDate, '');
  assert.equal(row.R2_Technician, '');
  assert.equal(row.R2_Status, 'รอดำเนินการ');
  assert.equal(row.R3_Price, 450);
  assert.equal(row.R3_PlanDate, '');
  assert.equal(row.R3_Status, 'รอดำเนินการ');
  assert.equal(row.UpdatedBy, 'admin', 'ชื่อคนสร้างย้ายกลับไปช่อง UpdatedBy');
  assert.equal(row.R1_Price, 450, 'รอบ 1 ไม่โดนบั๊ก ต้องไม่ถูกแตะ');
});

test('ซ่อมซ้ำได้ — รอบที่สองไม่มีอะไรให้ซ่อมแล้ว', () => {
  const db = freshDb();
  insertShifted(db, 2028, 'ATG-ATG-AIR-1');
  repairShiftedPlanRows(db);
  const before = JSON.stringify(db.prepare('SELECT * FROM plans').get());

  assert.equal(repairShiftedPlanRows(db), 0);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM plans').get()), before);
});

test('แผนปกติ (สร้างถูก หรือย้ายมาจากชีตเดิม) ต้องไม่ถูกแตะเลย', async () => {
  const db = freshDb();
  await createCleaningPlan(asAdmin(db), 2029);
  db.prepare(`INSERT INTO plans (Year, AirCode, R2_PlanDate, R2_ActualDate, R2_Price, R2_Technician, R2_Status,
      R3_PlanDate, R3_Status) VALUES (2026, 'X-1', '2026-09-10', '2026-09-12', 500, 'ช่างเอ', 'ล้างเสร็จสิ้น',
      '2026-12-10', 'นัดหมายแล้ว')`).run();
  const before = JSON.stringify(db.prepare('SELECT * FROM plans ORDER BY row_id').all());

  assert.equal(repairShiftedPlanRows(db), 0);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM plans ORDER BY row_id').all()), before);
});

test('รอบที่มีคนแก้ไปแล้ว ไม่ถูกซ่อมทับ — ซ่อมเฉพาะรอบที่ยังเป็นรูปแบบที่เลื่อน', () => {
  const db = freshDb();
  insertShifted(db, 2028, 'ATG-ATG-AIR-1');
  // มีคนตั้งวันตามแผนรอบ 2 ไปแล้ว (หน้าแผนเขียนตามชื่อคอลัมน์ จึงลงช่องถูก)
  db.prepare("UPDATE plans SET R2_PlanDate = '2028-06-01', R2_Status = 'นัดหมายแล้ว'").run();

  assert.equal(repairShiftedPlanRows(db), 1, 'ซ่อมแค่รอบ 3');
  const row = db.prepare('SELECT * FROM plans').get();
  assert.equal(row.R2_PlanDate, '2028-06-01', 'รอบ 2 ที่มีคนแก้แล้วต้องคงเดิม');
  assert.equal(row.R2_Status, 'นัดหมายแล้ว');
  assert.equal(row.R3_Status, 'รอดำเนินการ');
});
