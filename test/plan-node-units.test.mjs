/**
 * ตั้งวันราย Node — เลือกเครื่องที่จะล้างได้รายรอบ
 *
 * เจ้าของงานกำหนด: ติ๊กเลือกเครื่องเอง · เครื่องที่ไม่ได้เลือก รอบนั้นเป็น "ยกเลิก"
 * ลงวันแล้ว = นัดหมายแล้ว
 * กันไว้: รอบที่ล้างไปแล้วไม่ถูกยกเลิกย้อนหลัง · ไม่ส่งรายการเครื่อง = ทุกเครื่องแบบเดิม
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { updatePlanDatesByNode } from '../src/modules/plan.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  db.prepare("INSERT INTO contractors (ID, Name, Active) VALUES ('CT001','บริษัท เอ',1)").run();
  const unit = db.prepare('INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status) VALUES (?,?,?,?,?)');
  const plan = db.prepare(`INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R2_PlanDate, R2_Status, R2_ActualDate)
    VALUES (?,?,?,?,?,?,?)`);
  for (const n of [1, 2, 3]) {
    unit.run('ATG-PMK-AIR-' + n, 'ป่าโมก', 'ATG-PMK', '1', 'ใช้งานปกติ');
    plan.run(2026, 'ATG-PMK-AIR-' + n, 'ป่าโมก', 'ATG-PMK', '', 'รอดำเนินการ', '');
  }
  unit.run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'ใช้งานปกติ');
  plan.run(2026, 'AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '', 'รอดำเนินการ', '');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const boss = db => { const c = new Ctx({}, state, db, {}); c.username = 'boss'; return c; };
const row = (db, code) => db.prepare('SELECT * FROM plans WHERE AirCode = ?').get(code);

test('เลือกล้าง 2 จาก 3 เครื่อง — ตัวที่เลือกได้วันและผู้รับเหมา ตัวที่ไม่เลือกรอบนั้นเป็นยกเลิก', async () => {
  const db = freshDb();
  await updatePlanDatesByNode(boss(db), 2026, 'ป่าโมก', { r2: '2026-10-05' }, { r2: 'CT001' },
    { r2: ['ATG-PMK-AIR-1', 'ATG-PMK-AIR-3'] });

  for (const code of ['ATG-PMK-AIR-1', 'ATG-PMK-AIR-3']) {
    assert.equal(row(db, code).R2_PlanDate, '2026-10-05');
    assert.equal(row(db, code).R2_ContractorID, 'CT001');
    assert.equal(row(db, code).R2_Status, 'นัดหมายแล้ว', 'ลงวันแล้ว = นัดหมายแล้ว');
  }
  const skipped = row(db, 'ATG-PMK-AIR-2');
  assert.equal(skipped.R2_Status, 'ยกเลิก');
  assert.equal(skipped.R2_PlanDate, '', 'ตัวที่ไม่ล้างต้องไม่ได้วัน');
  assert.equal(skipped.R2_ContractorID, '', 'ตัวที่ไม่ล้างต้องไม่ได้ผู้รับเหมา');
  assert.equal(row(db, 'AYA-WNI-AIR-1').R2_Status, 'รอดำเนินการ', 'Node อื่นต้องไม่ถูกแตะ');
});

test('ติ๊กกลับเครื่องที่เคยยกเลิก — กลับเป็นรอดำเนินการ', async () => {
  const db = freshDb();
  await updatePlanDatesByNode(boss(db), 2026, 'ป่าโมก', {}, {}, { r2: ['ATG-PMK-AIR-1'] });
  assert.equal(row(db, 'ATG-PMK-AIR-2').R2_Status, 'ยกเลิก');

  await updatePlanDatesByNode(boss(db), 2026, 'ป่าโมก', {}, {},
    { r2: ['ATG-PMK-AIR-1', 'ATG-PMK-AIR-2', 'ATG-PMK-AIR-3'] });
  assert.equal(row(db, 'ATG-PMK-AIR-2').R2_Status, 'รอดำเนินการ');
});

test('รอบที่ล้างไปแล้ว — ไม่ติ๊กก็ไม่ถูกยกเลิกย้อนหลัง', async () => {
  const db = freshDb();
  db.exec("UPDATE plans SET R2_Status = 'ล้างเสร็จสิ้น', R2_ActualDate = '2026-09-01' WHERE AirCode = 'ATG-PMK-AIR-2'");
  await updatePlanDatesByNode(boss(db), 2026, 'ป่าโมก', {}, {}, { r2: ['ATG-PMK-AIR-1'] });
  assert.equal(row(db, 'ATG-PMK-AIR-2').R2_Status, 'ล้างเสร็จสิ้น');
  assert.equal(row(db, 'ATG-PMK-AIR-3').R2_Status, 'ยกเลิก');
});

test('ไม่ส่งรายการเครื่อง — ทุกเครื่องใน Node ได้วันและเป็นนัดหมายแล้ว ไม่มีใครถูกยกเลิก', async () => {
  const db = freshDb();
  await updatePlanDatesByNode(boss(db), 2026, 'ป่าโมก', { r2: '2026-10-05' }, {});
  for (const n of [1, 2, 3]) {
    assert.equal(row(db, 'ATG-PMK-AIR-' + n).R2_PlanDate, '2026-10-05');
    assert.equal(row(db, 'ATG-PMK-AIR-' + n).R2_Status, 'นัดหมายแล้ว');
  }
});
