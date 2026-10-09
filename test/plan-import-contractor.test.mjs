/**
 * นำเข้าแผนจากไฟล์ — คอลัมน์ผู้รับเหมาของแต่ละรอบ (R1_Contractor / R2_Contractor / R3_Contractor)
 *
 * เจ้าของงานกำหนด: ดรอปไฟล์สั่งงานล้างทีเดียว ผูกผู้รับเหมากับเครื่อง/รอบ
 * ผู้รับเหมาที่ยังไม่มีบัญชีต้องแจ้งให้ Infrastructure ไปสร้าง
 *
 * กันไว้: ใส่ชื่อ (บริษัทหรือคนก็ได้) · ชื่อใหม่สร้างให้เอง ไม่ซ้ำ · ช่องว่างไม่แตะของเดิม
 * รอบที่ล้างแล้วไม่เปลี่ยน · ไฟล์วันอย่างเดียวแบบเดิมยังใช้ได้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { updatePlanBulk } from '../src/modules/plan.js';
import { getContractors } from '../src/modules/contractors.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const u = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  u.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x', '');
  u.run('ctA', 'ช่างเอ', 'Contractor', '', '', 1, 'x', 'CT001');
  u.run('ctOld', 'ช่างบีที่ลาออก', 'Contractor', '', '', 0, 'x', 'CT002');
  db.prepare("INSERT INTO contractors (ID, Name, Active) VALUES ('CT001','บริษัท เอ แอร์ จำกัด',1)").run();
  db.prepare("INSERT INTO contractors (ID, Name, Active) VALUES ('CT002','หจก. บี',1)").run();
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

test('ผูกผู้รับเหมาด้วยชื่อ — ชื่อเดิมเจอรหัสเดิม (ไม่สนตัวพิมพ์/ช่องว่าง) · ชื่อใหม่ (คนก็ได้) สร้างให้ครั้งเดียว', async () => {
  const db = freshDb();
  const res = await updatePlanBulk(boss(db), 2026, [
    { AirCode: 'ATG-PMK-AIR-2', R1_Contractor: 'นายสมชาย ใจดี', R2_Contractor: 'บริษัท  เอ แอร์ จำกัด' },
    { AirCode: 'ATG-PMK-AIR-3', R1_Contractor: 'นายสมชาย  ใจดี', R2_Contractor: 'ร้านแอร์ซีดี' }
  ]);
  assert.equal(res.matchedCount, 2);
  assert.equal(res.newContractors, 2, 'สมชาย + ร้านแอร์ซีดี ต้องถูกสร้างคนละครั้ง');

  const all = db.prepare('SELECT ID, Name FROM contractors ORDER BY ID').all();
  assert.equal(all.length, 4);
  assert.equal(new Set(all.map(c => c.ID)).size, 4, 'รหัสผู้รับเหมาใหม่ต้องไม่ชนกัน');
  const idOf = n => all.find(c => c.Name === n).ID;

  assert.equal(row(db, 'ATG-PMK-AIR-2').R1_ContractorID, idOf('นายสมชาย ใจดี'));
  assert.equal(row(db, 'ATG-PMK-AIR-3').R1_ContractorID, idOf('นายสมชาย ใจดี'));
  assert.equal(row(db, 'ATG-PMK-AIR-2').R2_ContractorID, 'CT001');
  assert.equal(row(db, 'ATG-PMK-AIR-3').R2_ContractorID, idOf('ร้านแอร์ซีดี'));
});

test('แจ้งผู้รับเหมาที่ได้งานแต่ยังไม่มีบัญชีใช้งาน — รวมเจ้าที่มีแต่บัญชีที่ปิดไปแล้ว', async () => {
  const db = freshDb();
  const res = await updatePlanBulk(boss(db), 2026, [
    { AirCode: 'ATG-PMK-AIR-2', R1_Contractor: 'บริษัท เอ แอร์ จำกัด', R2_Contractor: 'หจก. บี' },
    { AirCode: 'ATG-PMK-AIR-3', R1_Contractor: 'นายสมชาย ใจดี' }
  ]);
  assert.deepEqual(res.noAccount.map(c => c.Name).sort(), ['นายสมชาย ใจดี', 'หจก. บี'].sort(),
    'บริษัท เอ มีบัญชีใช้งานอยู่ ไม่ต้องเตือน · หจก. บี มีแต่บัญชีที่ปิดแล้ว ต้องเตือน');

  // ชื่อใหม่อยู่ในรายชื่อผู้รับเหมาแล้ว — หน้าจัดการผู้ใช้กดสร้างบัญชีให้เจ้านี้ได้
  const list = await getContractors(boss(db));
  assert.ok(list.some(c => c.Name === 'นายสมชาย ใจดี' && c.Active));
});

test('รอบที่ล้างแล้วไม่เปลี่ยนผู้รับเหมา · ช่องว่างไม่แตะของเดิม · รอบที่ปีนี้ไม่มีไม่รับ', async () => {
  const db = freshDb();
  const res = await updatePlanBulk(boss(db), 2026, [
    { AirCode: 'ATG-PMK-AIR-1', R1_Contractor: 'หจก. บี', R3_Contractor: 'หจก. บี' },
    { AirCode: 'ATG-PMK-AIR-2', R1_Contractor: '', R2_Contractor: '' }
  ]);
  assert.equal(row(db, 'ATG-PMK-AIR-1').R1_ContractorID, 'CT001', 'รอบ 1 ล้างเสร็จแล้ว ต้องคงคนเดิม');
  assert.equal(row(db, 'ATG-PMK-AIR-1').R3_ContractorID ?? '', '', 'แผนปีนี้มี 2 รอบ');
  assert.equal(res.skippedDoneRounds, 1);
  assert.equal(row(db, 'ATG-PMK-AIR-2').R1_ContractorID, 'CT001', 'ช่องว่าง = ไม่แตะ');
  assert.deepEqual(res.noAccount, [], 'ไม่ได้มอบงานให้ใครเลย ไม่ต้องเตือน');
});

test('ไฟล์มีแต่วันแบบเดิมยังใช้ได้ · ไฟล์ที่ไม่มีทั้งวันและผู้รับเหมาถูกปฏิเสธ', async () => {
  const db = freshDb();
  const res = await updatePlanBulk(boss(db), 2026, [{ AirCode: 'ATG-PMK-AIR-3', R2_PlanDate: '2026-10-20' }]);
  assert.equal(res.matchedCount, 1);
  assert.equal(row(db, 'ATG-PMK-AIR-3').R2_PlanDate, '2026-10-20');
  assert.equal(res.newContractors, 0);

  await assert.rejects(() => updatePlanBulk(boss(db), 2026, [{ AirCode: 'ATG-PMK-AIR-3', Foo: 'x' }]), /Template/);
});
