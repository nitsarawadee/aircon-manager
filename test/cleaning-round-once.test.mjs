/**
 * ล้างรอบเดิมซ้ำไม่ได้ (เจ้าของงานกำหนด 16/10/2569)
 *
 * เดิมกรอกใบล้างหรือแนบเอกสารของรอบที่ปิดไปแล้วได้อีก ถ้าคนละวันก็ได้ใบใหม่
 * ปิดรอบทับวันเดิม และลงประวัติค่าล้างอีกแถว — งบนับค่าล้างครั้งเดียวกันเป็นสองเท่า
 *
 * ตอนนี้ (assertRoundNotCleaned ใน plan.js)
 *   มีใบของเครื่อง-ปี-รอบนี้อยู่แล้ว  ปฏิเสธพร้อมบอกเลขใบเดิม ทั้งกรอกฟอร์มและแนบเอกสาร
 *   ไม่มีใบแต่รอบปิดแล้ว (นำเข้าจากระบบเดิม)  ปฏิเสธเหมือนกัน เพราะรอบนั้นล้างไปแล้ว
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm, uploadNodeDocuments, deleteCleaningForm } from '../src/modules/cleaningform.js';
import { getBudgetSummary } from '../src/modules/budget.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const unit = db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, Brand, BTU, CleaningPricePerRound)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
  unit.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'Daikin', 18000, 500);
  unit.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'Daikin', 18000, 500);
  const plan = db.prepare(`INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_PlanDate, R1_Status, R1_ActualDate, R1_Price)
      VALUES (?,?,?,?,?,?,?,?)`);
  plan.run(2026, 'ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '2026-09-10', 'นัดหมายแล้ว', '', 500);
  plan.run(2026, 'ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '2026-09-10', 'นัดหมายแล้ว', '', 500);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const store = { save: () => [{ name: 'a.jpg' }], list: () => [], read: () => null, removeAll() {} };
const ctxOf = db => {
  const c = new Ctx({}, state, db, { attachments: store });
  c.username = 'boss';
  return c;
};

const form = (code, over = {}) => ({
  NodeName: 'ป่าโมก', SiteCode: 'ATG-PMK', Region: '1', Province: 'อ่างทอง',
  Date: '2026-09-15', PlanYear: 2026, PlanRound: 1,
  AirCode1: code, Price1: 500, TechnicianName: 'ช่าง', Checklist: [], ...over
});
const attach = (code, date) => ({
  nodeName: 'ป่าโมก', files: [{ name: 'a.jpg', mimeType: 'image/jpeg', data: 'AA==' }],
  closeout: { date, year: 2026, round: 1, units: [{ airCode: code, price: 500, condition: 'ปกติ' }] }
});
const cleanRows = db => db.prepare("SELECT ID, Cost FROM history WHERE EventType = 'ล้างแอร์'").all();
const formCount = db => db.prepare('SELECT COUNT(*) AS n FROM cleaning_forms').get().n;

test('กรอกใบล้างรอบเดิมซ้ำคนละวัน — ปฏิเสธพร้อมบอกเลขใบเดิม ค่าล้างไม่นับซ้ำ', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), form('ATG-PMK-AIR-1'));

  await assert.rejects(
    () => saveCleaningForm(ctxOf(db), form('ATG-PMK-AIR-1', { Date: '2026-09-20' })),
    /ATG-PMK-AIR-1 รอบที่ 1\/2026 มีใบล้างเลขที่ PM2609-01 อยู่แล้ว/
  );
  assert.equal(formCount(db), 1);
  assert.equal(cleanRows(db).length, 1);
  assert.equal((await getBudgetSummary(ctxOf(db), 2026)).expenseCleaning, 500);
});

test('แนบเอกสารรอบเดิมซ้ำ — ปฏิเสธพร้อมบอกเลขใบเดิม (ทั้งใบที่กรอกและใบที่แนบ)', async () => {
  const db = freshDb();
  await uploadNodeDocuments(ctxOf(db), attach('ATG-PMK-AIR-1', '2026-09-15'));

  await assert.rejects(() => uploadNodeDocuments(ctxOf(db), attach('ATG-PMK-AIR-1', '2026-09-16')),
    /มีใบล้างเลขที่ PM2609-01 อยู่แล้ว/);
  // ข้ามทาง: แนบไปแล้ว มากรอกฟอร์มของรอบเดียวกันก็ไม่ได้
  await assert.rejects(() => saveCleaningForm(ctxOf(db), form('ATG-PMK-AIR-1', { Date: '2026-09-20' })),
    /มีใบล้างเลขที่ PM2609-01 อยู่แล้ว/);
  assert.equal(formCount(db), 1);
  assert.equal(cleanRows(db).length, 1);
});

test('รอบที่ปิดจากระบบเดิม (ล้างเสร็จสิ้น ไม่มีใบ) — กรอกฟอร์มและแนบเอกสารไม่ได้', async () => {
  const db = freshDb();
  db.prepare("UPDATE plans SET R1_Status = 'ล้างเสร็จสิ้น', R1_ActualDate = '2026-08-01' WHERE AirCode = 'ATG-PMK-AIR-1'").run();

  await assert.rejects(() => saveCleaningForm(ctxOf(db), form('ATG-PMK-AIR-1')),
    /ATG-PMK-AIR-1 รอบที่ 1\/2026 ปิดงานไปแล้ว \(ล้างเมื่อ 2026-08-01\)/);
  await assert.rejects(() => uploadNodeDocuments(ctxOf(db), attach('ATG-PMK-AIR-1', '2026-09-15')),
    /ปิดงานไปแล้ว/);
  assert.equal(formCount(db), 0);
  assert.equal(cleanRows(db).length, 0);
});

test('ยังกรอกเครื่องที่ 2 รวมเข้าใบเดิมได้ตามปกติ และลบใบแล้วกรอกรอบนั้นใหม่ได้', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), form('ATG-PMK-AIR-1'));
  const merged = await saveCleaningForm(ctxOf(db), form('', { AirCode1: '', Price1: '', AirCode2: 'ATG-PMK-AIR-2', Price2: 500 }));
  assert.equal(merged.mergedInto, 'PM2609-01');
  assert.equal(formCount(db), 1);

  const f = db.prepare('SELECT ID FROM cleaning_forms').get();
  await deleteCleaningForm(ctxOf(db), 2, f.ID);
  await saveCleaningForm(ctxOf(db), form('ATG-PMK-AIR-1', { Date: '2026-09-20' }));
  assert.equal(formCount(db), 1);
});
