/**
 * นำเข้าแผนจากไฟล์ — คอลัมน์ผู้รับเหมาของแต่ละรอบ (R1_Contractor / R2_Contractor / R3_Contractor)
 *
 * เจ้าของงานกำหนด: ดรอปไฟล์สั่งงานล้างทีเดียว ผูกผู้รับเหมากับเครื่อง/รอบ
 * ต้องสร้าง User ผู้รับเหมาก่อน — ชื่อในไฟล์ต้องตรงกับผู้รับเหมาที่มี User ในระบบ
 * ไม่ตรงแม้ชื่อเดียว ไม่นำเข้าทั้งไฟล์ แล้วบอกรายชื่อ
 *
 * กันไว้: ไม่สร้างผู้รับเหมาใหม่เอง · ช่องว่างไม่แตะของเดิม · รอบที่ล้างแล้วไม่เปลี่ยน
 * ไฟล์วันอย่างเดียวแบบเดิมยังใช้ได้ · คอลัมน์ R4 ขึ้นไปไม่นำเข้าแต่บอกชื่อกลับไป
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { updatePlanBulk } from '../src/modules/plan.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const u = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  u.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x', '');
  u.run('ctA', 'ช่างเอ', 'Contractor', '', '', 1, 'x', 'CT001');
  u.run('ctOld', 'ช่างบีที่ลาออก', 'Contractor', '', '', 0, 'x', 'CT002');
  u.run('ctSom', 'สมชาย', 'Contractor', '', '', 1, 'x', 'CT003');
  const c = db.prepare('INSERT INTO contractors (ID, Name, Active) VALUES (?,?,?)');
  c.run('CT001', 'บริษัท เอ แอร์ จำกัด', 1);
  c.run('CT002', 'หจก. บี', 1);              // มีแต่บัญชีที่ปิดแล้ว
  c.run('CT003', 'นายสมชาย ใจดี', 1);        // ชื่อคนก็ได้
  c.run('CT004', 'ร้านแอร์ซีดี', 1);          // ยังไม่มี User เลย
  const unit = db.prepare('INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status) VALUES (?,?,?,?,?)');
  const plan = db.prepare(`INSERT INTO plans (Year, Rounds, AirCode, NodeName, SiteCode, R1_Status, R1_ActualDate, R1_ContractorID, R2_Status)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const n of [1, 2, 3]) unit.run('ATG-PMK-AIR-' + n, 'ป่าโมก', 'ATG-PMK', '1', 'ใช้งานปกติ');
  plan.run(2026, 2, 'ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', 'ล้างเสร็จสิ้น', '2026-03-10', 'CT001', 'รอดำเนินการ');
  plan.run(2026, 2, 'ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', 'รอดำเนินการ', '', 'CT001', 'รอดำเนินการ');
  plan.run(2026, 2, 'ATG-PMK-AIR-3', 'ป่าโมก', 'ATG-PMK', 'รอดำเนินการ', '', '', 'รอดำเนินการ');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const boss = db => { const c = new Ctx({}, state, db, {}); c.username = 'boss'; return c; };
const row = (db, code) => db.prepare('SELECT * FROM plans WHERE AirCode = ?').get(code);
const contractorCount = db => db.prepare('SELECT COUNT(*) AS n FROM contractors').get().n;

test('ผูกผู้รับเหมาที่มี User ด้วยชื่อ — ไม่สนตัวพิมพ์/ช่องว่าง · ชื่อคนก็ได้', async () => {
  const db = freshDb();
  const res = await updatePlanBulk(boss(db), 2026, [
    { AirCode: 'ATG-PMK-AIR-2', R1_Contractor: 'นายสมชาย  ใจดี', R2_Contractor: 'บริษัท  เอ แอร์ จำกัด' },
    { AirCode: 'ATG-PMK-AIR-3', R2_Contractor: 'นายสมชาย ใจดี' }
  ]);
  assert.equal(res.matchedCount, 2);
  assert.equal(row(db, 'ATG-PMK-AIR-2').R1_ContractorID, 'CT003');
  assert.equal(row(db, 'ATG-PMK-AIR-2').R2_ContractorID, 'CT001');
  assert.equal(row(db, 'ATG-PMK-AIR-3').R2_ContractorID, 'CT003');
  assert.equal(contractorCount(db), 4, 'ต้องไม่สร้างผู้รับเหมาเพิ่ม');
});

test('มีชื่อที่ไม่มี User (ยังไม่สร้าง · มีแต่บัญชีที่ปิด · สะกดผิด) — ไม่นำเข้าทั้งไฟล์ และบอกทุกชื่อ', async () => {
  const db = freshDb();
  const res = await updatePlanBulk(boss(db), 2026, [
    { AirCode: 'ATG-PMK-AIR-2', R1_Contractor: 'นายสมชาย ใจดี', R2_PlanDate: '2026-10-20' },
    { AirCode: 'ATG-PMK-AIR-3', R1_Contractor: 'ร้านแอร์ซีดี', R2_Contractor: 'หจก. บี' },
    { AirCode: 'ATG-PMK-AIR-1', R2_Contractor: 'บริษัท เอ แอร์ จำกัดด' }
  ]);
  assert.equal(res.rejected, true, 'ต้องไม่นำเข้า');
  assert.deepEqual(res.unknownContractors, ['ร้านแอร์ซีดี', 'หจก. บี', 'บริษัท เอ แอร์ จำกัดด'],
    'บอกทุกชื่อที่ไม่ตรง ชื่อที่ถูกต้อง (นายสมชาย) ไม่อยู่ในรายการ');

  // ไม่มีอะไรถูกเขียนเลย — แม้แต่แถวที่ชื่อถูก และวันที่ในไฟล์เดียวกัน
  assert.equal(row(db, 'ATG-PMK-AIR-2').R1_ContractorID, 'CT001');
  assert.equal(row(db, 'ATG-PMK-AIR-2').R2_PlanDate ?? '', '');
  assert.equal(contractorCount(db), 4);
});

test('รอบที่ล้างแล้วไม่เปลี่ยนผู้รับเหมา · ช่องว่างไม่แตะของเดิม · รอบที่ปีนี้ไม่มีไม่รับ', async () => {
  const db = freshDb();
  const res = await updatePlanBulk(boss(db), 2026, [
    { AirCode: 'ATG-PMK-AIR-1', R1_Contractor: 'นายสมชาย ใจดี', R3_Contractor: 'นายสมชาย ใจดี' },
    { AirCode: 'ATG-PMK-AIR-2', R1_Contractor: '', R2_Contractor: '' }
  ]);
  assert.equal(row(db, 'ATG-PMK-AIR-1').R1_ContractorID, 'CT001', 'รอบ 1 ล้างเสร็จแล้ว ต้องคงคนเดิม');
  assert.equal(row(db, 'ATG-PMK-AIR-1').R3_ContractorID ?? '', '', 'แผนปีนี้มี 2 รอบ');
  assert.equal(res.skippedDoneRounds, 1);
  assert.equal(row(db, 'ATG-PMK-AIR-2').R1_ContractorID, 'CT001', 'ช่องว่าง = ไม่แตะ');
});

test('ไฟล์มีแต่วันแบบเดิมยังใช้ได้ · ไฟล์ที่ไม่มีทั้งวันและผู้รับเหมาถูกปฏิเสธ', async () => {
  const db = freshDb();
  const res = await updatePlanBulk(boss(db), 2026, [{ AirCode: 'ATG-PMK-AIR-3', R2_PlanDate: '2026-10-20' }]);
  assert.equal(res.matchedCount, 1);
  assert.equal(row(db, 'ATG-PMK-AIR-3').R2_PlanDate, '2026-10-20');

  await assert.rejects(() => updatePlanBulk(boss(db), 2026, [{ AirCode: 'ATG-PMK-AIR-3', Foo: 'x' }]), /Template/);
});

test('คอลัมน์ R4 ขึ้นไปที่เติมเอง — ไม่นำเข้า แต่บอกชื่อกลับไปให้เตือน · ส่วนที่เหลือของไฟล์ยังเข้าปกติ', async () => {
  const db = freshDb();
  const res = await updatePlanBulk(boss(db), 2026, [
    { AirCode: 'ATG-PMK-AIR-3', R2_Contractor: 'บริษัท เอ แอร์ จำกัด', R4_Contractor: 'หจก. บี', R10_PlanDate: '2026-12-01' },
    { AirCode: 'ATG-PMK-AIR-2', R5_PlanDate: '2026-11-01' }
  ]);
  assert.deepEqual(res.ignoredColumns, ['R4_Contractor', 'R5_PlanDate', 'R10_PlanDate']);
  assert.equal(row(db, 'ATG-PMK-AIR-3').R2_ContractorID, 'CT001');

  const clean = await updatePlanBulk(boss(db), 2026, [{ AirCode: 'ATG-PMK-AIR-3', R2_PlanDate: '2026-10-21' }]);
  assert.deepEqual(clean.ignoredColumns, []);
});

test('วันที่ในไฟล์เป็น วว/ดด/ปปปป → เก็บเป็น ปปปป-ดด-วว แบบที่หน้าเว็บบันทึก (เจ้าของงานกำหนด 15/10/2569)', async () => {
  const db = freshDb();
  await updatePlanBulk(boss(db), 2026, [
    { AirCode: 'ATG-PMK-AIR-2', R2_PlanDate: '05/11/2026' },
    { AirCode: 'ATG-PMK-AIR-3', R1_PlanDate: '3/2/2026', R2_PlanDate: '2026-10-20' }
  ]);
  assert.equal(row(db, 'ATG-PMK-AIR-2').R2_PlanDate, '2026-11-05', '05/11 = 5 พ.ย. ไม่ใช่ 11 พ.ค.');
  assert.equal(row(db, 'ATG-PMK-AIR-3').R1_PlanDate, '2026-02-03');
  assert.equal(row(db, 'ATG-PMK-AIR-3').R2_PlanDate, '2026-10-20', 'ปปปป-ดด-วว เดิมยังรับ');
});

test('วันที่อ่านไม่ได้ (เดือนก่อนวัน · ปี พ.ศ. · ไม่มีวันจริง) — ไม่นำเข้าทั้งไฟล์ และบอกเครื่อง/รอบ', async () => {
  const db = freshDb();
  for (const bad of ['10/15/2026', '15/10/2569', '31/02/2026', 'พรุ่งนี้']) {
    // คืนเป็นรายการ (ไม่โยน error) แบบเดียวกับชื่อผู้รับเหมาที่ไม่ตรง — ดู plan-import-errors.test.mjs
    const res = await updatePlanBulk(boss(db), 2026, [
      { AirCode: 'ATG-PMK-AIR-2', R2_PlanDate: '01/11/2026' },
      { AirCode: 'ATG-PMK-AIR-3', R2_PlanDate: bad }
    ]);
    assert.equal(res.rejected, true);
    assert.deepEqual(res.badDates, [{ airCode: 'ATG-PMK-AIR-3', round: 2, value: bad }]);
  }
  assert.equal(row(db, 'ATG-PMK-AIR-2').R2_PlanDate || '', '', 'แถวที่ถูกต้องในไฟล์เดียวกันก็ไม่ถูกเขียน');
});
