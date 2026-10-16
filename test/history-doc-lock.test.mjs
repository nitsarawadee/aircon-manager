/**
 * แถวประวัติที่เอกสารสร้างไว้ ลบที่หน้าประวัติไม่ได้ (เจ้าของงานกำหนด 16/10/2569)
 *
 * เดิมลบได้ แต่ตัวเอกสารยังอยู่ — ลบแถว "ล้างแอร์" งบลดทั้งที่รอบในแผนยังเสร็จ
 * ลบแถว "ซ่อมแล้ว" เคสกลับมาเปิด (เคสอ่านจากประวัติ) ทั้งที่เครื่องใช้งานปกติและใบซ่อมยังอยู่
 * ทางที่ถูกคือลบเอกสาร ซึ่งย้อนแผน ประวัติ และสถานะเครื่องให้ครบในทีเดียว
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { getHistory, deleteHistoryRecord, reportRepair } from '../src/modules/history.js';
import { saveCleaningForm, deleteCleaningForm } from '../src/modules/cleaningform.js';
import { saveRepairForm } from '../src/modules/repairform.js';
import { getBudgetSummary } from '../src/modules/budget.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const unit = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status)
      VALUES (?,?,?,?,?,?,?)`);
  unit.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ');
  unit.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ');
  db.prepare("INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_Status, R1_Price) VALUES (2026, 'ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', 'นัดหมายแล้ว', 500)").run();
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => { const c = new Ctx({}, state, db, {}); c.username = 'boss'; return c; };
const rowOf = async (db, pred) => (await getHistory(ctxOf(db))).find(pred);

async function cleanForm(db) {
  await saveCleaningForm(ctxOf(db), {
    NodeName: 'ป่าโมก', SiteCode: 'ATG-PMK', Region: '1', Date: '2026-09-15', PlanYear: 2026, PlanRound: 1,
    AirCode1: 'ATG-PMK-AIR-1', Price1: 500, TechnicianName: 'ช่าง', Checklist: []
  });
}

async function repairForm(db) {
  await reportRepair(ctxOf(db), { AirCode: 'ATG-PMK-AIR-2', Detail: 'ไม่เย็น', Date: '2026-09-10' });
  db.exec("UPDATE air_units SET Status = 'รอซ่อม' WHERE AirCode = 'ATG-PMK-AIR-2'");   // Infrastructure อนุมัติซ่อม
  return saveRepairForm(ctxOf(db), { AirCode: 'ATG-PMK-AIR-2', Date: '2026-09-20', Cost: 1200, TechnicianName: 'ช่าง', Checklist: [], Parts: [] });
}

test('แถว "ล้างแอร์" ของใบล้าง — ลบไม่ได้ บอกเลขเอกสาร งบไม่ลด', async () => {
  const db = freshDb();
  await cleanForm(db);
  const h = await rowOf(db, x => x.EventType === 'ล้างแอร์');
  assert.equal(h.DocLink, 'PM2609-01', 'หน้าเว็บต้องรู้ว่าแถวนี้เป็นของเอกสาร (ซ่อนปุ่มลบ)');

  await assert.rejects(() => deleteHistoryRecord(ctxOf(db), h._row, h.ID),
    /เป็นประวัติของเอกสารเลขที่ PM2609-01 ลบที่หน้าประวัติไม่ได้/);
  assert.equal((await getBudgetSummary(ctxOf(db), 2026)).expenseCleaning, 500);
});

test('แถว "ซ่อมแล้ว" ของใบซ่อม — ลบไม่ได้ · แถว "แจ้งซ่อม" (เลขเดียวกับใบ) ไม่ใช่ของใบ ลบได้ตามเดิม', async () => {
  const db = freshDb();
  const { docNo } = await repairForm(db);

  const done = await rowOf(db, x => x.EventType === 'ซ่อมแล้ว');
  assert.equal(done.DocLink, docNo);
  await assert.rejects(() => deleteHistoryRecord(ctxOf(db), done._row, done.ID),
    new RegExp('เป็นประวัติของเอกสารเลขที่ ' + docNo));

  const report = await rowOf(db, x => x.EventType === 'แจ้งซ่อม');
  assert.equal(report.DocLink, '');
  await deleteHistoryRecord(ctxOf(db), report._row, report.ID);
});

test('แถวที่ไม่ใช่ของเอกสาร และแถวของเอกสารที่ถูกลบไปแล้ว — ลบได้ตามปกติ', async () => {
  const db = freshDb();
  await cleanForm(db);
  const f = db.prepare('SELECT ID FROM cleaning_forms').get();
  await deleteCleaningForm(ctxOf(db), 2, f.ID);   // ลบใบ = ระบบย้อนประวัติของใบให้เอง

  // แถวค้างที่ใช้เลขของใบที่ไม่มีแล้ว (เช่นข้อมูลเก่า) ไม่มีเอกสารให้ไปลบแทน ต้องลบที่นี่ได้
  db.prepare("INSERT INTO history (ID, AirCode, Date, EventType, Cost) VALUES ('PM2609-01', 'ATG-PMK-AIR-1', '2026-09-15', 'ล้างแอร์', 500)").run();
  const orphan = await rowOf(db, x => x.ID === 'PM2609-01');
  assert.equal(orphan.DocLink, '');
  await deleteHistoryRecord(ctxOf(db), orphan._row, orphan.ID);
  assert.equal((await getHistory(ctxOf(db))).filter(x => x.EventType === 'ล้างแอร์').length, 0);
});
