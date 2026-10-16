/**
 * หน้าต่างรอบ — ลบวันตามแผนออก สถานะ "นัดหมายแล้ว" ต้องกลับเป็น "รอดำเนินการ" (16/10/2569)
 *
 * เดิมสถานะค้าง "นัดหมายแล้ว" ทั้งที่ไม่มีวันนัด ขณะที่ตั้งวันทั้ง Node และลบใบล้าง
 * ใช้กติกา "ไม่มีวัน = รอดำเนินการ" อยู่แล้ว — ตอนนี้ทุกทางใช้กติกาเดียวกัน
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { updateCleaningRound } from '../src/modules/plan.js';

function freshDb(status = 'นัดหมายแล้ว') {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status)
      VALUES ('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ')`).run();
  db.prepare("INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_PlanDate, R1_Status, R1_Price) VALUES (2026, 'ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '2026-09-10', ?, 500)")
    .run(status);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => { const c = new Ctx({}, state, db, {}); c.username = 'boss'; return c; };
const save = (db, over) => updateCleaningRound(ctxOf(db), 2026, 2, 1,
  { planDate: '', actualDate: '', price: 500, technician: '', status: 'นัดหมายแล้ว', note: '', ...over });
const r1 = db => ({ ...db.prepare('SELECT R1_PlanDate AS plan, R1_Status AS status FROM plans').get() });

test('ลบวันตามแผนออก สถานะ "นัดหมายแล้ว" กลับเป็น "รอดำเนินการ"', async () => {
  const db = freshDb();
  await save(db, { planDate: '' });
  assert.deepEqual(r1(db), { plan: '', status: 'รอดำเนินการ' });
});

test('ยังมีวันตามแผน — "นัดหมายแล้ว" คงเดิม · "รอดำเนินการ" ที่มีวันยังเป็นนัดหมายแล้วตามกติกาเดิม', async () => {
  const db = freshDb();
  await save(db, { planDate: '2026-09-12' });
  assert.deepEqual(r1(db), { plan: '2026-09-12', status: 'นัดหมายแล้ว' });

  await save(db, { planDate: '2026-09-13', status: 'รอดำเนินการ' });
  assert.deepEqual(r1(db), { plan: '2026-09-13', status: 'นัดหมายแล้ว' });
});

test('ไม่มีวันแต่เลือก "ยกเลิก" — คงยกเลิก ไม่ถูกเปลี่ยน', async () => {
  const db = freshDb();
  await save(db, { planDate: '', status: 'ยกเลิก' });
  assert.deepEqual(r1(db), { plan: '', status: 'ยกเลิก' });
});
