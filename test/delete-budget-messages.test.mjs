/**
 * กติกาที่เจ้าของงานกำหนดหลังลองใช้ทุกบทบาท (14/10/2569)
 *
 * 1. ลบเอกสาร (ใบล้าง ใบซ่อม ใบติดตั้ง) ได้เฉพาะ Infrastructure
 *    เดิม Staff ลบใบที่อนุมัติครบแล้วได้ ประวัติและค่าใช้จ่ายค้างอยู่โดยไม่มีเอกสาร
 * 2. งบประมาณติดลบไม่ได้
 * 3. ข้อความแจ้งเตือนต้องตรงกับสาเหตุ
 * 4. ลบเอกสารแล้วต้องย้อนสิ่งที่ใบนั้นทำไว้ เพราะต้องกรอกเอกสารใหม่
 *    ใบล้าง: รอบในแผนกลับเป็น "รอดำเนินการ" ประวัติ+ค่าล้างหาย
 *    ใบซ่อม: ประวัติ "ซ่อมแล้ว"+ค่าซ่อมหาย เครื่องกลับเป็น "รอซ่อม" พร้อมอาการที่แจ้งไว้
 *    ใบติดตั้ง: งานกลับเป็น "รอเอกสารติดตั้ง" เครื่องใหม่กลับเป็น "รอติดตั้ง"
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { approveDoc } from '../src/modules/approval.js';
import { saveRepairForm, getRepairForms, deleteRepairForm } from '../src/modules/repairform.js';
import { saveCleaningForm, getCleaningForms, deleteCleaningForm } from '../src/modules/cleaningform.js';
import { saveInstallForm, getInstallForms, deleteInstallForm } from '../src/modules/installform.js';
import { saveAirUnit, getAirList } from '../src/modules/airlist.js';
import { reportRepair } from '../src/modules/history.js';
import { saveBudgetRecord } from '../src/modules/budget.js';
import { addHistoryRecord } from '../src/modules/history.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  user.run('infra', 'อินฟรา ใหญ่', 'Admin', '', '', 1, 'x', '');
  user.run('staff', 'สตาฟ ภาคหนึ่ง', 'Staff', '1', '', 1, 'x', '');
  user.run('sub', 'ช่างเอ บัญชี', 'Contractor', '', '', 1, 'x', 'CT001');
  db.prepare("INSERT INTO contractors (ID, Name, Active) VALUES ('CT001','บริษัท เอ',1)").run();
  const a = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU)
    VALUES (?,?,?,?,?,?,?,?)`);
  a.run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'รอซ่อม', 'Daikin', 18000);
  a.run('KKN-MNG-AIR-1', 'เมืองขอนแก่น', 'KKN-MNG', '3', 'ขอนแก่น', 'ใช้งานปกติ', 'Carrier', 24000);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };
const as = (db, u) => { const c = new Ctx({}, state, db); c.username = u; return c; };

test('ลบเอกสาร: Staff ลบไม่ได้ · Infrastructure ลบได้', async () => {
  const db = freshDb();
  await saveRepairForm(as(db, 'staff'), { AirCode: 'AYA-WNI-AIR-1', Date: '2026-10-14', Cost: 1800 });
  const [form] = await getRepairForms(as(db, 'infra'));

  await assert.rejects(() => deleteRepairForm(as(db, 'staff'), form._row, form.ID), /เฉพาะบทบาท Infrastructure/);
  assert.equal((await getRepairForms(as(db, 'infra'))).length, 1, 'Staff กดแล้วใบต้องยังอยู่');

  await deleteRepairForm(as(db, 'infra'), form._row, form.ID);
  assert.equal((await getRepairForms(as(db, 'infra'))).length, 0);
});

test('งบประมาณ: ติดลบไม่ได้ · 0 และค่าว่างได้', async () => {
  const db = freshDb();
  await assert.rejects(() => saveBudgetRecord(as(db, 'infra'), 2026, -500, 1000, ''), /งบล้างแอร์ต้องเป็นตัวเลขตั้งแต่ 0/);
  await assert.rejects(() => saveBudgetRecord(as(db, 'infra'), 2026, 1000, -1, ''), /งบซ่อมแอร์ต้องเป็นตัวเลขตั้งแต่ 0/);
  await saveBudgetRecord(as(db, 'infra'), 2026, 0, '', '');
});

test('ข้อความ: ผู้รับเหมากดอนุมัติ บอกว่าผู้รับเหมาอนุมัติไม่ได้ (ไม่ใช่เรื่องภูมิภาค)', async () => {
  const db = freshDb();
  await saveRepairForm(as(db, 'staff'), { AirCode: 'AYA-WNI-AIR-1', Date: '2026-10-14' });
  const [form] = await getRepairForms(as(db, 'infra'));
  await assert.rejects(() => approveDoc(as(db, 'sub'), 'repair', form.ID), /ผู้รับเหมา\) อนุมัติเอกสารไม่ได้/);
});

test('ข้อความ: Staff ลงประวัติเครื่องนอกภาค ไม่พูดถึงแผนล้างแอร์', async () => {
  const db = freshDb();
  await assert.rejects(
    () => addHistoryRecord(as(db, 'staff'), { AirCode: 'KKN-MNG-AIR-1', Date: '2026-10-14', EventType: 'ซ่อมแล้ว' }),
    err => /ไม่มีสิทธิ์จัดการข้อมูลของเครื่อง KKN-MNG-AIR-1/.test(err.message) && !/แผนล้าง/.test(err.message)
  );
});

/** อนุมัติครบ 4 ขั้น — ขั้น 2 Staff · ขั้น 3 Supervisor · ขั้น 4 Infrastructure */
async function approveAll(db, kind, id) {
  db.prepare("INSERT OR IGNORE INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES ('sup','ซุป','Supervisor','1','',1,'x','')").run();
  await approveDoc(as(db, 'staff'), kind, id);
  await approveDoc(as(db, 'sup'), kind, id);
  await approveDoc(as(db, 'infra'), kind, id);
}
const unitOf = (db, code) => ({ ...db.prepare('SELECT Status, Note FROM air_units WHERE AirCode = ?').get(code) });
const historyOf = (db, code) => db.prepare('SELECT ID, EventType, Cost, Note, CaseID FROM history WHERE AirCode = ? ORDER BY rowid').all(code);

test('ลบใบซ่อมที่อนุมัติครบแล้ว: ประวัติซ่อมแล้ว+ค่าซ่อมหาย เครื่องกลับเป็นรอซ่อม แล้วกรอกใบใหม่ได้', async () => {
  const db = freshDb();
  db.exec("UPDATE air_units SET Status = 'ใช้งานปกติ', Note = '' WHERE AirCode = 'AYA-WNI-AIR-1'");
  await reportRepair(as(db, 'staff'), { AirCode: 'AYA-WNI-AIR-1', Detail: 'คอมไม่ติด', Date: '2026-10-10' });
  // Infrastructure อนุมัติซ่อม (ทางเดียวกับหน้าเว็บ — แก้สถานะเครื่อง)
  const unit = (await getAirList(as(db, 'infra'))).find(a => a.AirCode === 'AYA-WNI-AIR-1');
  await saveAirUnit(as(db, 'infra'), { ...unit, Status: 'รอซ่อม' });

  await saveRepairForm(as(db, 'staff'), { AirCode: 'AYA-WNI-AIR-1', Date: '2026-10-14', Cost: 1800 });
  const [form] = await getRepairForms(as(db, 'infra'));
  await approveAll(db, 'repair', form.ID);
  assert.equal(unitOf(db, 'AYA-WNI-AIR-1').Status, 'ใช้งานปกติ');

  await deleteRepairForm(as(db, 'infra'), form._row, form.ID);

  const h = historyOf(db, 'AYA-WNI-AIR-1');
  assert.equal(h.filter(x => x.EventType === 'ซ่อมแล้ว').length, 0, 'ประวัติซ่อมแล้วและค่าซ่อมต้องหาย');
  assert.deepEqual(h.map(x => x.EventType), ['แจ้งซ่อม', 'รอซ่อม'], 'ประวัติก่อนส่งเอกสารต้องอยู่ครบ');
  assert.deepEqual(unitOf(db, 'AYA-WNI-AIR-1'), { Status: 'รอซ่อม', Note: 'คอมไม่ติด' });

  // กรอกใบใหม่ได้ และอยู่ในเคสเดิม
  await saveRepairForm(as(db, 'staff'), { AirCode: 'AYA-WNI-AIR-1', Date: '2026-10-15', Cost: 1500 });
  const cases = new Set(historyOf(db, 'AYA-WNI-AIR-1').map(x => x.CaseID));
  assert.equal(cases.size, 1, 'ใบใหม่ต้องเกาะเคสเดิม');
});

test('ลบใบล้าง: รอบในแผนกลับเป็นรอดำเนินการ ประวัติ+ค่าล้างหาย', async () => {
  const db = freshDb();
  db.exec("UPDATE air_units SET Status = 'ใช้งานปกติ' WHERE AirCode = 'AYA-WNI-AIR-1'");
  db.prepare('INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_PlanDate, R1_Price, R1_Status) VALUES (?,?,?,?,?,?,?)')
    .run(2026, 'AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '2026-10-01', 550, 'รอดำเนินการ');
  await saveCleaningForm(as(db, 'staff'), {
    NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Region: '1', Province: 'อยุธยา',
    Date: '2026-10-09', PlanYear: 2026, PlanRound: 1, AirCode1: 'AYA-WNI-AIR-1', Price1: 550, Checklist: []
  });
  const plan = () => db.prepare('SELECT R1_Status s, R1_ActualDate d, R1_Price p FROM plans WHERE AirCode = ?').get('AYA-WNI-AIR-1');
  assert.equal(plan().s, 'ล้างเสร็จสิ้น');
  const [form] = await getCleaningForms(as(db, 'infra'));
  await approveAll(db, 'cleaning', form.ID);

  await deleteCleaningForm(as(db, 'infra'), form._row, form.ID);

  assert.deepEqual({ ...plan() }, { s: 'รอดำเนินการ', d: '', p: 550 });
  assert.equal(historyOf(db, 'AYA-WNI-AIR-1').filter(x => x.EventType === 'ล้างแอร์').length, 0);
});

test('ลบใบติดตั้งที่อนุมัติครบแล้ว: งานกลับเป็นรอเอกสารติดตั้ง เครื่องกลับเป็นรอติดตั้ง', async () => {
  const db = freshDb();
  await saveAirUnit(as(db, 'infra'), {
    AirCode: 'AYA-WNI-AIR-2', NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Region: '1', Province: 'อยุธยา',
    Status: 'ใช้งานปกติ', BTU: 24000
  });
  const before = historyOf(db, 'AYA-WNI-AIR-2');
  assert.equal(unitOf(db, 'AYA-WNI-AIR-2').Status, 'รอติดตั้ง');

  await saveInstallForm(as(db, 'staff'), { AirCode1: 'AYA-WNI-AIR-2', Date: '2026-10-14', TechnicianName: 'ช่าง', Checklist: [] });
  const [form] = await getInstallForms(as(db, 'infra'));
  await approveAll(db, 'install', form.ID);
  assert.equal(unitOf(db, 'AYA-WNI-AIR-2').Status, 'ใช้งานปกติ');

  await deleteInstallForm(as(db, 'infra'), form._row, form.ID);

  assert.equal(unitOf(db, 'AYA-WNI-AIR-2').Status, 'รอติดตั้ง');
  assert.deepEqual(historyOf(db, 'AYA-WNI-AIR-2').map(x => [x.ID, x.EventType, x.Note]),
    before.map(x => [x.ID, x.EventType, x.Note]), 'ประวัติต้องกลับเป็นเหมือนก่อนกรอกใบติดตั้ง');
});
