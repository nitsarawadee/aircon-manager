/**
 * เลือกจำนวนรอบของแผนล้างแอร์ต่อปี (1–3) — เจ้าของงานขอ เพราะบางปีล้างไม่ครบ 3 รอบ
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - สร้างแผนแบบ 2 รอบ: รอบ 3 ว่างทั้งบล็อก ไม่มีราคา/สถานะ
 * - สรุปคืบหน้า/งบนับเฉพาะรอบที่มี (ตัวหารไม่รวมรอบ 3)
 * - ตั้งวันราย Node / นำเข้าวัน / ปิดงาน ไม่แตะรอบที่ปีนั้นไม่มี
 * - แผนเก่าที่ไม่มีค่าจำนวนรอบ = 3 รอบเหมือนเดิม
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import {
  createCleaningPlan, getCleaningSummary, updateCleaningRound, updatePlanDatesByNode,
  updatePlanBulk, closePlanRound, planRounds
} from '../src/modules/plan.js';

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
const planRow = (db, y) => db.prepare('SELECT * FROM plans WHERE Year = ?').get(y);

test('สร้างแผน 2 รอบ — รอบ 3 ว่างทั้งบล็อก และจำจำนวนรอบไว้', async () => {
  const db = freshDb();
  await createCleaningPlan(asAdmin(db), 2030, 2);
  const row = planRow(db, 2030);

  assert.equal(row.Rounds, 2);
  for (const r of [1, 2]) {
    assert.equal(row['R' + r + '_Price'], 450);
    assert.equal(row['R' + r + '_Status'], 'รอดำเนินการ');
  }
  assert.equal(row.R3_Price ?? '', '', 'รอบ 3 ต้องไม่มีราคา');
  assert.equal(row.R3_Status ?? '', '', 'รอบ 3 ต้องไม่มีสถานะ');
});

test('ไม่ส่งจำนวนรอบ = 3 รอบแบบเดิม · ส่งค่านอก 1–3 ต้องฟ้อง', async () => {
  const db = freshDb();
  await createCleaningPlan(asAdmin(db), 2030);
  assert.equal(planRow(db, 2030).Rounds, 3);
  await assert.rejects(() => createCleaningPlan(asAdmin(db), 2031, 4), /1, 2 หรือ 3/);
});

test('แผนเก่าที่ไม่มีค่าจำนวนรอบ ถือเป็น 3 รอบ', () => {
  assert.equal(planRounds({}), 3);
  assert.equal(planRounds({ Rounds: null }), 3);
  assert.equal(planRounds({ Rounds: '' }), 3);
  assert.equal(planRounds({ Rounds: 1 }), 1);
});

test('สรุปคืบหน้านับเฉพาะรอบที่มี', async () => {
  const db = freshDb();
  await createCleaningPlan(asAdmin(db), 2030, 1);
  const s = await getCleaningSummary(asAdmin(db), 2030);

  assert.equal(s.roundCount, 1);
  assert.equal(s.rounds.length, 1);
  assert.equal(s.planned, 1, 'เครื่องเดียว 1 รอบ = งาน 1 ชิ้น ไม่ใช่ 3');
});

test('ตั้งแผนรอบที่ปีนั้นไม่มี ต้องฟ้อง', async () => {
  const db = freshDb();
  await createCleaningPlan(asAdmin(db), 2030, 2);
  const row = planRow(db, 2030);

  await assert.rejects(
    () => updateCleaningRound(asAdmin(db), 2030, 2, 3, { planDate: '2030-05-01', status: 'นัดหมายแล้ว' }),
    /ล้าง 2 รอบ ไม่มีรอบที่ 3/
  );
  assert.ok(row);   // แถวยังอยู่ (เลขแถว 2 = แถวข้อมูลแรก)
});

test('ตั้งวันราย Node / นำเข้าวัน ไม่ลงรอบที่ปีนั้นไม่มี', async () => {
  const db = freshDb();
  await createCleaningPlan(asAdmin(db), 2030, 2);

  await updatePlanDatesByNode(asAdmin(db), 2030, 'อ่างทอง',
    { r1: '2030-02-01', r2: '2030-06-01', r3: '2030-10-01' }, {}, undefined);
  let row = planRow(db, 2030);
  assert.equal(row.R1_Status, 'นัดหมายแล้ว');
  assert.equal(row.R2_Status, 'นัดหมายแล้ว');
  assert.equal(row.R3_PlanDate ?? '', '', 'รอบ 3 ไม่มี ต้องไม่ได้วัน');
  assert.equal(row.R3_Status ?? '', '');

  await updatePlanBulk(asAdmin(db), 2030, [{ AirCode: 'ATG-ATG-AIR-1', R3_PlanDate: '2030-11-01' }]);
  row = planRow(db, 2030);
  assert.equal(row.R3_PlanDate ?? '', '', 'นำเข้าวันรอบ 3 ต้องถูกข้าม');
});

test('ปิดงานรอบที่ปีนั้นไม่มี = ไม่ปิดอะไร', async () => {
  const db = freshDb();
  await createCleaningPlan(asAdmin(db), 2030, 2);
  const ctx = asAdmin(db);
  await ctx.ensureBase();

  const closed = await closePlanRound(ctx, { year: 2030, round: 3, airCode: 'ATG-ATG-AIR-1', actualDate: '2030-10-02' });
  await ctx.ss.flush();
  assert.equal(closed, 0);
  assert.equal(planRow(db, 2030).R3_Status ?? '', '');
});
