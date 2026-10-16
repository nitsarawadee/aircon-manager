/**
 * ใบล้างไม่ใส่ราคา + ผูกรอบในแผน = ใช้ราคาของรอบนั้น (16/10/2569)
 *
 * เดิมราคาว่างลงประวัติเป็น 0 แต่แผนคงราคาเดิมไว้ — สรุปแผนนับ 480 บาท งบนับ 0 บาท สองหน้าไม่ตรงกัน
 * ตอนนี้ใช้ราคาของรอบในแผน (ไม่ได้ตั้ง = ราคาต่อรอบในทะเบียน) ทั้งในประวัติและแผน
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm, uploadNodeDocuments } from '../src/modules/cleaningform.js';
import { getCleaningSummary } from '../src/modules/plan.js';
import { getBudgetSummary } from '../src/modules/budget.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const unit = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, CleaningPricePerRound)
      VALUES (?,?,?,?,?,?,?,?)`);
  unit.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 500);
  unit.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 650);
  const plan = db.prepare("INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_Status, R1_Price) VALUES (2026, ?, 'ป่าโมก', 'ATG-PMK', 'นัดหมายแล้ว', ?)");
  plan.run('ATG-PMK-AIR-1', 480);   // ราคาในแผนต่างจากทะเบียน
  plan.run('ATG-PMK-AIR-2', '');    // ไม่ได้ตั้งราคาในแผน
  return db;
}
const state = { async acquireLock() { return true; }, async releaseLock() {} };
const store = { save: () => [{ name: 'a.jpg' }], list: () => [], read: () => null, removeAll() {} };
const ctxOf = db => { const c = new Ctx({}, state, db, { attachments: store }); c.username = 'boss'; return c; };
const form = (over = {}) => ({ NodeName: 'ป่าโมก', SiteCode: 'ATG-PMK', Region: '1', Date: '2026-09-15', PlanYear: 2026, PlanRound: 1,
  TechnicianName: 'ช่าง', Checklist: [], ...over });
const histCost = (db, code) => db.prepare("SELECT Cost FROM history WHERE EventType = 'ล้างแอร์' AND AirCode = ?").get(code).Cost;

test('กรอกฟอร์มไม่ใส่ราคา — ใช้ราคาในแผน (ไม่ได้ตั้ง = ราคาในทะเบียน) · สรุปแผนกับงบตรงกัน', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), form({ AirCode1: 'ATG-PMK-AIR-1', Price1: '', AirCode2: 'ATG-PMK-AIR-2', Price2: '' }));

  assert.equal(histCost(db, 'ATG-PMK-AIR-1'), 480);
  assert.equal(histCost(db, 'ATG-PMK-AIR-2'), 650);
  const plan = (await getCleaningSummary(ctxOf(db), 2026)).cost;
  const budget = (await getBudgetSummary(ctxOf(db), 2026)).expenseCleaning;
  assert.equal(plan, 1130);
  assert.equal(budget, plan, 'สรุปแผนกับงบต้องเป็นตัวเลขเดียวกัน');
});

test('ใส่ราคาเอง — ใช้ราคาที่ใส่ ไม่ทับด้วยราคาในแผน', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), form({ AirCode1: 'ATG-PMK-AIR-1', Price1: 700 }));
  assert.equal(histCost(db, 'ATG-PMK-AIR-1'), 700);
  assert.equal(db.prepare("SELECT R1_Price FROM plans WHERE AirCode = 'ATG-PMK-AIR-1'").get().R1_Price, 700);
});

test('แนบเอกสารไม่ใส่ราคา — กติกาเดียวกัน', async () => {
  const db = freshDb();
  await uploadNodeDocuments(ctxOf(db), { nodeName: 'ป่าโมก', files: [{ name: 'a.jpg', mimeType: 'image/jpeg', data: 'AA==' }],
    closeout: { date: '2026-09-15', year: 2026, round: 1, units: [{ airCode: 'ATG-PMK-AIR-1', price: '', condition: 'ปกติ' }] } });
  assert.equal(histCost(db, 'ATG-PMK-AIR-1'), 480);
});
