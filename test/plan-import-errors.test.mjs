/**
 * นำเข้าแผน — ข้อผิดพลาดคืนเป็นรายการแบบเดียวกันทั้งชื่อผู้รับเหมาและวันที่ (16/10/2569)
 *
 * เดิมชื่อผู้รับเหมาที่ไม่ตรงคืนเป็นรายการ แต่วันที่อ่านไม่ได้โยน error ข้อความยาวที่ตัดเหลือ 5 ช่องแรก
 * ไฟล์ที่ผิดทั้งสองอย่างเห็นแค่ชื่อผู้รับเหมา แก้แล้วดรอปใหม่ถึงเพิ่งเจอว่าวันที่ก็ผิด
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
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const plan = db.prepare("INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_Status) VALUES (2026, ?, 'ป่าโมก', 'ATG-PMK', 'รอดำเนินการ')");
  for (let n = 1; n <= 7; n++) plan.run('ATG-PMK-AIR-' + n);
  return db;
}
const state = { async acquireLock() { return true; }, async releaseLock() {} };
const boss = db => { const c = new Ctx({}, state, db, {}); c.username = 'boss'; return c; };

test('วันที่ผิดหลายช่อง — คืนครบทุกช่อง (ไม่ตัดเหลือ 5) ไม่เขียนอะไร', async () => {
  const db = freshDb();
  const rows = [1, 2, 3, 4, 5, 6, 7].map(n => ({ AirCode: 'ATG-PMK-AIR-' + n, R1_PlanDate: n === 1 ? '01/11/2026' : '2026/11/0' + n }));
  const res = await updatePlanBulk(boss(db), 2026, rows);

  assert.equal(res.rejected, true);
  assert.equal(res.badDates.length, 6);
  assert.deepEqual(res.badDates[0], { airCode: 'ATG-PMK-AIR-2', round: 1, value: '2026/11/02' });
  assert.equal(db.prepare("SELECT R1_PlanDate FROM plans WHERE AirCode = 'ATG-PMK-AIR-1'").get().R1_PlanDate || '', '');
});

test('ผิดทั้งชื่อผู้รับเหมาและวันที่ — เห็นทั้งสองรายการในครั้งเดียว', async () => {
  const res = await updatePlanBulk(boss(freshDb()), 2026, [
    { AirCode: 'ATG-PMK-AIR-1', R1_PlanDate: '31/02/2026', R1_Contractor: 'บริษัทที่ไม่มี' }
  ]);
  assert.equal(res.rejected, true);
  assert.deepEqual(res.unknownContractors, ['บริษัทที่ไม่มี']);
  assert.deepEqual(res.badDates, [{ airCode: 'ATG-PMK-AIR-1', round: 1, value: '31/02/2026' }]);
});
