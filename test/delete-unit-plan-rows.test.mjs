/**
 * ลบเครื่องทีละเครื่อง — แถวในแผนล้างทุกปีลบตามไปด้วย (16/10/2569)
 *
 * เดิมปุ่มลบทีละเครื่องไม่ลบแถวแผน แถวค้างขึ้นป้าย "ถูกลบแล้ว" แต่ติ๊กลบตอนนำเข้าลบแถวแผนด้วย
 * สองทางให้ผลไม่เหมือนกัน — ตอนนี้ใช้กติกาเดียวกัน (removePlanRowsOf) ประวัติยังอยู่ครบ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { deleteAirUnit } from '../src/modules/airlist.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const unit = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status)
      VALUES (?,?,?,?,?,?,?)`);
  unit.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ');
  unit.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ');
  const plan = db.prepare("INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_Status) VALUES (?,?,'ป่าโมก','ATG-PMK','รอดำเนินการ')");
  for (const y of [2026, 2027]) for (const c of ['ATG-PMK-AIR-1', 'ATG-PMK-AIR-2']) plan.run(y, c);
  db.prepare("INSERT INTO history (ID, AirCode, Date, EventType) VALUES ('CM2609-01', 'ATG-PMK-AIR-1', '2026-09-01', 'ชำรุด')").run();
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => { const c = new Ctx({}, state, db, {}); c.username = 'boss'; return c; };

test('ลบเครื่อง — แถวแผนของเครื่องนั้นหายทุกปี เครื่องอื่นไม่ถูกแตะ ประวัติยังอยู่', async () => {
  const db = freshDb();
  await deleteAirUnit(ctxOf(db), 2, 'ATG-PMK-AIR-1');

  const plans = db.prepare('SELECT Year, AirCode FROM plans ORDER BY Year, AirCode').all().map(r => ({ ...r }));
  assert.deepEqual(plans, [
    { Year: 2026, AirCode: 'ATG-PMK-AIR-2' },
    { Year: 2027, AirCode: 'ATG-PMK-AIR-2' }
  ]);
  const hist = db.prepare("SELECT ID FROM history WHERE AirCode = 'ATG-PMK-AIR-1' ORDER BY ID").all().map(r => r.ID);
  assert.ok(hist.includes('CM2609-01'), 'ประวัติเดิมต้องอยู่ครบ');
  assert.equal(hist.length, 2, 'มีแถว "ลบข้อมูลเครื่อง" เพิ่มเป็นร่องรอย');
});
