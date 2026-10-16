/**
 * รวมใบล้างได้เฉพาะเมื่อผู้รับเหมาของรอบนั้นเป็นเจ้าเดียวกัน (เจ้าของงานกำหนด 16/10/2569)
 *
 * เดิมรวมด้วย ไซต์ + รอบ + วัน อย่างเดียว — เครื่องใน Node เดียวกันที่มอบให้คนละเจ้า
 * กรอกวันเดียวกัน งานของเจ้า B ไปอยู่ในใบของเจ้า A (ขึ้นชื่อบริษัท A บนเอกสาร)
 * และทั้งสองเจ้าเปิดใบนั้นเห็นราคาของอีกฝ่าย
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm, getCleaningForms } from '../src/modules/cleaningform.js';

function freshDb(cid2 = 'CT002') {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  user.run('ctA', 'ช่าง A', 'Contractor', '', '', 1, 'x', 'CT001');
  user.run('ctB', 'ช่าง B', 'Contractor', '', '', 1, 'x', 'CT002');
  const ct = db.prepare('INSERT INTO contractors (ID, Name, Active) VALUES (?,?,?)');
  ct.run('CT001', 'บริษัท เอ', 1);
  ct.run('CT002', 'บริษัท บี', 1);
  const unit = db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, Brand, BTU, CleaningPricePerRound)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
  unit.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'Daikin', 18000, 500);
  unit.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'Daikin', 18000, 500);
  const plan = db.prepare(`INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_PlanDate, R1_Status, R1_Price, R1_ContractorID)
      VALUES (?,?,?,?,?,?,?,?)`);
  plan.run(2026, 'ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '2026-09-10', 'นัดหมายแล้ว', 480, 'CT001');
  plan.run(2026, 'ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '2026-09-10', 'นัดหมายแล้ว', 520, cid2);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, username) => { const c = new Ctx({}, state, db, {}); c.username = username; return c; };

const slot1 = { NodeName: 'ป่าโมก', SiteCode: 'ATG-PMK', Region: '1', Date: '2026-09-15', PlanYear: 2026, PlanRound: 1,
  AirCode1: 'ATG-PMK-AIR-1', TechnicianName: 'ช่าง', Checklist: [] };
const slot2 = { ...slot1, AirCode1: '', AirCode2: 'ATG-PMK-AIR-2' };
const forms = db => db.prepare('SELECT DocNo, DocNo2, AirCode1, AirCode2, CompanyName, Price1, Price2 FROM cleaning_forms').all();

test('ผู้รับเหมาคนละเจ้า กรอกวันเดียวกัน — ได้คนละใบ ชื่อบริษัทตรงเจ้าของงาน', async () => {
  const db = freshDb();
  await saveCleaningForm(as(db, 'ctA'), slot1);
  const res = await saveCleaningForm(as(db, 'ctB'), slot2);

  assert.equal(res.mergedInto, '', 'ต้องไม่รวมเข้าใบของเจ้า A');
  const rows = forms(db);
  assert.equal(rows.length, 2);
  const a = rows.find(f => f.AirCode1 === 'ATG-PMK-AIR-1');
  const b = rows.find(f => f.AirCode2 === 'ATG-PMK-AIR-2');
  assert.equal(a.CompanyName, 'บริษัท เอ');
  assert.equal(a.AirCode2, '');
  assert.equal(b.CompanyName, 'บริษัท บี');
  assert.equal(b.AirCode1, '');
});

test('ผู้รับเหมาคนละเจ้า — ต่างคนต่างไม่เห็นราคาของอีกเจ้าในตารางเอกสาร', async () => {
  const db = freshDb();
  await saveCleaningForm(as(db, 'ctA'), slot1);
  await saveCleaningForm(as(db, 'ctB'), slot2);

  const seenByA = await getCleaningForms(as(db, 'ctA'));
  const seenByB = await getCleaningForms(as(db, 'ctB'));
  assert.deepEqual(seenByA.map(f => [f.AirCode1, f.AirCode2, f.Price2]), [['ATG-PMK-AIR-1', '', '']]);
  assert.deepEqual(seenByB.map(f => [f.AirCode1, f.AirCode2, f.Price1]), [['', 'ATG-PMK-AIR-2', '']]);
});

test('ผู้รับเหมาเจ้าเดียวกันทั้งสองเครื่อง — ยังรวมเป็นใบเดียวเหมือนเดิม', async () => {
  const db = freshDb('CT001');
  await saveCleaningForm(as(db, 'ctA'), slot1);
  const res = await saveCleaningForm(as(db, 'ctA'), slot2);

  assert.equal(res.mergedInto, 'PM2609-01');
  const rows = forms(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].AirCode2, 'ATG-PMK-AIR-2');
});
