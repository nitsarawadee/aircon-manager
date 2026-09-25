/**
 * บัญชีผู้รับเหมา — เห็นและกรอกได้เฉพาะงานล้างที่มอบหมายให้ในแผน
 *
 * ============================================================================
 * การทำงานตามที่เจ้าของงานกำหนด
 * ============================================================================
 * Admin สร้างบัญชีผู้รับเหมา → ชื่อบริษัทไปโผล่เป็นตัวเลือกในช่อง "ผู้รับเหมา"
 * ของแต่ละรอบในแผนล้าง → ผู้รับเหมาล็อกอินแล้วเห็นเฉพาะรอบที่เลือกให้ตัวเอง
 *
 * ============================================================================
 * ทำไมชุดนี้สำคัญที่สุดของระบบสิทธิ์
 * ============================================================================
 * ผู้รับเหมาหลายเจ้าใช้ระบบเดียวกัน และเป็นคนนอกบริษัท ถ้ากรองพลาดสักหน้า
 * ผู้รับเหมาเจ้าหนึ่งจะเห็นงานและราคาของคู่แข่ง หรือเขียนเอกสารลงงานของเจ้าอื่นได้
 *
 * เทสต์ใช้ผู้รับเหมาสองเจ้า (A / B) บนเครื่องชุดเดียวกัน และเครื่องเดียวกันมีรอบของ
 * ทั้งสองเจ้าปนกัน เพื่อพิสูจน์ว่ากรองระดับ "รอบ" ไม่ใช่แค่ระดับเครื่อง
 * ทุกข้อพิสูจน์ที่ฝั่งเซิร์ฟเวอร์ ไม่ใช่แค่ว่าหน้าเว็บซ่อนปุ่มไว้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx, contractorPermissions } from '../src/context.js';
import { MODULES } from '../src/schema.js';
import {
  getCleaningFormNodes, getCleaningForms, saveCleaningForm, deleteCleaningForm,
  getCleaningDocHtml, uploadNodeDocuments
} from '../src/modules/cleaningform.js';
import { getInstallForms, saveInstallForm, deleteInstallForm } from '../src/modules/installform.js';
import { getCleaningPlan, updateCleaningRound, updatePlanDatesByNode } from '../src/modules/plan.js';
import { getAirList, saveAirUnit } from '../src/modules/airlist.js';
import { getHistory } from '../src/modules/history.js';
import { getBudgetSummary } from '../src/modules/budget.js';
import { getRepairForms } from '../src/modules/repairform.js';
import { saveUser, getUsers } from '../src/modules/users.js';
import { getContractors } from '../src/modules/contractors.js';

/* ==================== ข้อมูลตั้งต้น ==================== */

/**
 * ป่าโมก 2 เครื่อง / วังน้อย 1 เครื่อง / แสวงหา 1 เครื่อง (ไม่มีงานของใคร)
 * - ป่าโมก-1 รอบ 2 = A, รอบ 3 = B  ← เครื่องเดียวกัน คนละเจ้า
 * - ป่าโมก-2 รอบ 2 = A
 * - วังน้อย-1 รอบ 2 = B
 */
function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  const user = db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  user.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x', '');
  user.run('staff1', 'เจ้าหน้าที่ภาค 1', 'RegionAdmin', '1', '', 1, 'x', '');
  user.run('ctA', 'ช่างเจ้า A', 'Contractor', '', '', 1, 'x', 'CT001');
  user.run('ctB', 'ช่างเจ้า B', 'Contractor', '', '', 1, 'x', 'CT002');

  const ct = db.prepare('INSERT INTO contractors (ID, Name, Active) VALUES (?,?,?)');
  ct.run('CT001', 'บริษัท เอ แอร์', 1);
  ct.run('CT002', 'บริษัท บี คูล', 1);

  const unit = db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, Brand, BTU, IndoorSN, CleaningPricePerRound)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  unit.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'Daikin', 18000, 'IN-A1', 500);
  unit.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'Daikin', 18000, 'IN-A2', 500);
  unit.run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'Container', 'ใช้งานปกติ', 'Carrier', 24000, 'IN-B1', 700);
  unit.run('ATG-SWH-AIR-1', 'แสวงหา', 'ATG-SWH', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'LG', 12000, 'IN-X', 450);

  const plan = db.prepare(`INSERT INTO plans
      (Year, AirCode, NodeName, SiteCode, R2_PlanDate, R2_Status, R2_Price, R2_ContractorID, R3_Status, R3_Price, R3_ContractorID)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  plan.run(2026, 'ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '2026-09-10', 'รอดำเนินการ', 480, 'CT001', 'รอดำเนินการ', 520, 'CT002');
  plan.run(2026, 'ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '2026-09-10', 'รอดำเนินการ', 480, 'CT001', 'รอดำเนินการ', '', '');
  plan.run(2026, 'AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '2026-09-10', 'รอดำเนินการ', 700, 'CT002', 'รอดำเนินการ', '', '');
  plan.run(2026, 'ATG-SWH-AIR-1', 'แสวงหา', 'ATG-SWH', '2026-09-10', 'รอดำเนินการ', 450, '', 'รอดำเนินการ', '', '');
  return db;
}

const state = {
  async acquireLock() { return true; },
  async releaseLock() {},
  async destroySessionsOf() {}
};
const as = (db, username, services = {}) => {
  const c = new Ctx({}, state, db, services);
  c.username = username;
  return c;
};

/** ใบล้างของเครื่องหนึ่งตัว แบบที่หน้าแผนส่งมา */
const cleaning = (code, over = {}) => ({
  NodeName: 'ป่าโมก', SiteCode: 'ATG-PMK', Region: '1', Province: 'อ่างทอง',
  Date: '2026-09-15', PlanYear: 2026, PlanRound: 2,
  AirCode1: code, Price1: 500, TechnicianName: 'ช่างเอ', Checklist: [],
  ...over
});
const planRow = (db, code) => db.prepare('SELECT * FROM plans WHERE AirCode = ?').get(code);

/* ==================== บทบาทและสิทธิ์ ==================== */

test('บัญชีผู้รับเหมาได้รายการงานจากช่องผู้รับเหมาในแผน รายรอบ', async () => {
  const info = await as(freshDb(), 'ctA').userInfo();

  assert.equal(info.role, 'Contractor');
  assert.equal(info.contractorName, 'บริษัท เอ แอร์');
  assert.deepEqual(info.jobs.sort(), ['2026|2|ATG-PMK-AIR-1', '2026|2|ATG-PMK-AIR-2']);
  assert.deepEqual(info.regions, [], 'ผู้รับเหมาต้องไม่ได้ขอบเขตรายภาค');
});

test('สิทธิ์ผู้รับเหมาครบทุกโมดูล และโมดูลที่ไม่ได้ระบุเป็น none', () => {
  const p = contractorPermissions();

  assert.deepEqual(Object.keys(p).sort(), [...MODULES].sort());
  assert.equal(p.cleaningform, 'edit');
  assert.equal(p.installform, 'edit');
  assert.equal(p.plan, 'view');
  for (const m of ['airlist', 'history', 'repair', 'repairform', 'budget']) {
    assert.equal(p[m], 'none', m + ' ต้องปิดสำหรับผู้รับเหมา');
  }
});

test('ช่อง Permissions ของผู้รับเหมาไม่มีผล แม้ในฐานข้อมูลจะเขียนว่าแก้ไขได้ทุกอย่าง', async () => {
  const db = freshDb();
  db.prepare("UPDATE users SET Permissions = 'budget:edit,airlist:edit' WHERE Username = 'ctA'").run();

  const info = await as(db, 'ctA').userInfo();
  assert.equal(info.permissions.budget, 'none');
  assert.equal(info.permissions.airlist, 'none');
});

test('ผูกผู้รับเหมาไว้แต่ช่อง Role เขียนว่า Admin — ต้องเป็นผู้รับเหมา ไม่ใช่ Admin', async () => {
  const db = freshDb();
  db.prepare("UPDATE users SET Role = 'Admin' WHERE Username = 'ctA'").run();

  assert.equal((await as(db, 'ctA').userInfo()).role, 'Contractor');
});

test('ผู้รับเหมาถูกปิดใช้งาน — บัญชีของเจ้านั้นเข้าระบบไม่ได้ทันที', async () => {
  const db = freshDb();
  db.prepare("UPDATE contractors SET Active = 0 WHERE ID = 'CT001'").run();

  assert.equal((await as(db, 'ctA').userInfo()).role, 'NoAccess');
  await assert.rejects(() => getCleaningFormNodes(as(db, 'ctA')), /ยังไม่ได้รับสิทธิ์/);
});

test('บทบาทผู้รับเหมาแต่ไม่ได้ผูกรหัส / รหัสไม่มีอยู่จริง — เข้าระบบไม่ได้ ไม่ถอยไปเป็นเจ้าหน้าที่', async () => {
  const db = freshDb();
  db.prepare("UPDATE users SET ContractorID = '' WHERE Username = 'ctA'").run();
  db.prepare("UPDATE users SET ContractorID = 'CT999' WHERE Username = 'ctB'").run();

  assert.equal((await as(db, 'ctA').userInfo()).role, 'NoAccess');
  assert.equal((await as(db, 'ctB').userInfo()).role, 'NoAccess');
});

/* ==================== มอบหมายงานจากแผน ==================== */

test('เลือกผู้รับเหมาในช่องรอบของแผน = มอบหมายงาน มีผลทันที', async () => {
  const db = freshDb();
  const row = planRow(db, 'ATG-SWH-AIR-1');
  // แถวของตารางที่โมดูลเห็นนับหัวตารางเป็นแถว 1
  const sheetRow = (await getCleaningPlan(as(db, 'boss'), 2026)).find(p => p.AirCode === 'ATG-SWH-AIR-1')._row;
  assert.ok(row);

  await updateCleaningRound(as(db, 'boss'), 2026, sheetRow, 2, {
    planDate: '2026-09-10', price: 450, status: 'รอดำเนินการ', contractorId: 'CT001'
  });

  assert.equal(planRow(db, 'ATG-SWH-AIR-1').R2_ContractorID, 'CT001');
  assert.ok((await as(db, 'ctA').userInfo()).jobs.includes('2026|2|ATG-SWH-AIR-1'));
});

test('หน้าเว็บรุ่นเก่าที่ไม่ส่งช่องผู้รับเหมามา ต้องไม่ล้างการมอบหมายเดิมทิ้ง', async () => {
  const db = freshDb();
  const sheetRow = (await getCleaningPlan(as(db, 'boss'), 2026)).find(p => p.AirCode === 'ATG-PMK-AIR-1')._row;

  await updateCleaningRound(as(db, 'boss'), 2026, sheetRow, 2, { planDate: '2026-09-11', price: 480, status: 'นัดหมายแล้ว' });
  assert.equal(planRow(db, 'ATG-PMK-AIR-1').R2_ContractorID, 'CT001');
});

test('มอบหมายให้ผู้รับเหมาที่ถูกปิด หรือไม่มีอยู่จริง ไม่ได้', async () => {
  const db = freshDb();
  db.prepare("UPDATE contractors SET Active = 0 WHERE ID = 'CT002'").run();
  const sheetRow = (await getCleaningPlan(as(db, 'boss'), 2026)).find(p => p.AirCode === 'ATG-SWH-AIR-1')._row;

  await assert.rejects(() => updateCleaningRound(as(db, 'boss'), 2026, sheetRow, 2, { status: 'รอดำเนินการ', contractorId: 'CT002' }), /ปิดใช้งาน/);
  await assert.rejects(() => updateCleaningRound(as(db, 'boss'), 2026, sheetRow, 2, { status: 'รอดำเนินการ', contractorId: 'CT404' }), /ไม่พบผู้รับเหมา/);
});

test('ตั้งทั้ง Node ทีเดียว — มอบหมายทุกเครื่องใน Node ให้เจ้าเดียว เฉพาะรอบที่ระบุ', async () => {
  const db = freshDb();
  await updatePlanDatesByNode(as(db, 'boss'), 2026, 'ป่าโมก', {}, { r3: 'CT001' });

  assert.equal(planRow(db, 'ATG-PMK-AIR-1').R3_ContractorID, 'CT001');
  assert.equal(planRow(db, 'ATG-PMK-AIR-2').R3_ContractorID, 'CT001');
  assert.equal(planRow(db, 'ATG-PMK-AIR-1').R2_ContractorID, 'CT001', 'รอบที่ไม่ได้ระบุต้องไม่ถูกแตะ');
  assert.equal(planRow(db, 'AYA-WNI-AIR-1').R3_ContractorID, '', 'Node อื่นต้องไม่ถูกแตะ');
});

test('ผู้รับเหมามอบหมายงานเองไม่ได้', async () => {
  const db = freshDb();
  const sheetRow = (await getCleaningPlan(as(db, 'boss'), 2026)).find(p => p.AirCode === 'AYA-WNI-AIR-1')._row;

  await assert.rejects(() => updateCleaningRound(as(db, 'ctA'), 2026, sheetRow, 2, { contractorId: 'CT001' }), /แผนล้างแอร์/);
  await assert.rejects(() => updatePlanDatesByNode(as(db, 'ctA'), 2026, 'วังน้อย', {}, { r2: 'CT001' }), /แผนล้างแอร์/);
  await assert.rejects(() => getContractors(as(db, 'ctA')), /ผู้รับเหมา/, 'ไม่ต้องเห็นรายชื่อคู่แข่ง');
});

/* ==================== เห็นเฉพาะของตัวเอง ==================== */

test('แผนล้าง — เห็นเฉพาะเครื่องที่มีงานของตัวเอง', async () => {
  const plan = await getCleaningPlan(as(freshDb(), 'ctA'), 2026);
  assert.deepEqual(plan.map(p => p.AirCode).sort(), ['ATG-PMK-AIR-1', 'ATG-PMK-AIR-2']);
});

test('แผนล้าง — รอบของเจ้าอื่นบนเครื่องเดียวกัน ไม่เห็นราคาและชื่อผู้รับเหมา', async () => {
  const row = (await getCleaningPlan(as(freshDb(), 'ctA'), 2026)).find(p => p.AirCode === 'ATG-PMK-AIR-1');

  assert.equal(row.R2_Mine, true);
  assert.equal(Number(row.R2_Price), 480, 'รอบของตัวเองต้องเห็นราคา');
  assert.equal(row.R2_ContractorName, 'บริษัท เอ แอร์');

  assert.equal(row.R3_Mine, false);
  assert.equal(row.R3_Price, '', 'ราคารอบ 3 เป็นค่าจ้างของเจ้า B');
  assert.equal(row.R3_ContractorID, '');
  assert.equal(row.R3_ContractorName, '');
});

test('เจ้าหน้าที่เห็นชื่อผู้รับเหมาของทุกรอบ', async () => {
  const row = (await getCleaningPlan(as(freshDb(), 'boss'), 2026)).find(p => p.AirCode === 'ATG-PMK-AIR-1');
  assert.equal(row.R2_ContractorName, 'บริษัท เอ แอร์');
  assert.equal(row.R3_ContractorName, 'บริษัท บี คูล');
});

test('รายชื่อ Node ในฟอร์ม — เห็นเฉพาะเครื่องที่มีงานของตัวเอง', async () => {
  const nodes = await getCleaningFormNodes(as(freshDb(), 'ctB'));

  assert.deepEqual(nodes.map(n => n.SiteCode).sort(), ['ATG-PMK', 'AYA-WNI']);
  const pmk = nodes.find(n => n.SiteCode === 'ATG-PMK');
  assert.deepEqual(pmk.units.map(u => u.AirCode), ['ATG-PMK-AIR-1'], 'ป่าโมก-2 ไม่มีงานของเจ้า B');
});

test('รายการใบล้าง — เห็นเฉพาะใบของรอบที่เป็นของตัวเอง แม้เป็นเครื่องเดียวกัน', async () => {
  const db = freshDb();
  await saveCleaningForm(as(db, 'boss'), cleaning('ATG-PMK-AIR-1'));                                   // รอบ 2 = A
  await saveCleaningForm(as(db, 'boss'), cleaning('ATG-PMK-AIR-1', { PlanRound: 3, Date: '2026-12-01' })); // รอบ 3 = B

  const a = await getCleaningForms(as(db, 'ctA'));
  assert.deepEqual(a.map(f => String(f.PlanRound)), ['2']);
  const b = await getCleaningForms(as(db, 'ctB'));
  assert.deepEqual(b.map(f => String(f.PlanRound)), ['3']);
});

test('เปิดใบล้างของเจ้าอื่นด้วยเลขแถวตรงๆ ไม่ได้ แม้เป็นเครื่องที่ตัวเองก็มีงาน', async () => {
  const db = freshDb();
  await saveCleaningForm(as(db, 'boss'), cleaning('ATG-PMK-AIR-1', { PlanRound: 3, Date: '2026-12-01' }));
  const row = (await getCleaningForms(as(db, 'boss')))[0]._row;

  await assert.rejects(() => getCleaningDocHtml(as(db, 'ctA'), row), /ไม่มีสิทธิ์/);
});

test('เมนูที่ปิดไว้ คืนค่าว่างทั้งหมด ไม่ใช่แค่ซ่อนเมนู', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO repair_forms (ID, AirCode, SiteCode, Region, Date) VALUES ('RF1','ATG-PMK-AIR-1','ATG-PMK','1','2026-09-24')").run();
  const ctx = as(db, 'ctA');

  assert.deepEqual(await getAirList(ctx), []);
  assert.deepEqual(await getHistory(ctx), [], 'ประวัติมีราคางานของเจ้าอื่นปนอยู่');
  assert.deepEqual(await getRepairForms(ctx), []);
  const budget = await getBudgetSummary(ctx, 2026);
  assert.equal(budget.totalExpense, 0, 'งบประมาณเป็นยอดรวมทั้งบริษัท ต้องได้ตัวเลขศูนย์');
  assert.equal(budget.monthly.length, 12, 'แต่รูปร่างข้อมูลต้องครบ ไม่งั้นหน้ากราฟพัง');
});

/* ==================== กรอกได้เฉพาะงานของตัวเอง ==================== */

test('กรอกใบล้างของรอบที่มอบหมายได้ และปิดรอบในแผนให้', async () => {
  const db = freshDb();
  const r = await saveCleaningForm(as(db, 'ctA'), cleaning('ATG-PMK-AIR-1'));

  assert.equal(r.planClosed, 1);
  assert.equal(planRow(db, 'ATG-PMK-AIR-1').R2_Status, 'ล้างเสร็จสิ้น');
});

test('กรอกใบล้างของรอบที่เป็นของเจ้าอื่นไม่ได้ แม้เครื่องเดียวกัน', async () => {
  const db = freshDb();

  await assert.rejects(() => saveCleaningForm(as(db, 'ctA'), cleaning('ATG-PMK-AIR-1', { PlanRound: 3 })), /ไม่ได้มอบหมายให้คุณ/);
  await assert.rejects(() => saveCleaningForm(as(db, 'ctA'), cleaning('AYA-WNI-AIR-1')), /ไม่พบเครื่อง/);
  await assert.rejects(() => saveCleaningForm(as(db, 'ctA'), cleaning('ATG-SWH-AIR-1')), /ไม่พบเครื่อง/);

  assert.equal(planRow(db, 'ATG-PMK-AIR-1').R3_Status, 'รอดำเนินการ', 'งานของเจ้า B ต้องไม่ถูกปิด');
  assert.equal(planRow(db, 'AYA-WNI-AIR-1').R2_Status, 'รอดำเนินการ');
});

test('ผู้รับเหมาบันทึกใบล้างที่ไม่ผูกกับรอบไหนไม่ได้', async () => {
  await assert.rejects(
    () => saveCleaningForm(as(freshDb(), 'ctA'), cleaning('ATG-PMK-AIR-1', { PlanYear: '', PlanRound: '' })),
    /หน้าแผนล้างแอร์/);
});

test('ส่ง SiteCode ของเจ้าอื่นมา ต้องไม่ถูกรวมเข้าใบของเจ้าอื่น', async () => {
  // ด่านรวมใบหาใบเดิมด้วย SiteCode + รอบ + วัน ถ้าเชื่อค่าที่ส่งมา
  // เจ้า A จะเขียนเครื่องของตัวเองลงไปในใบของเจ้า B ได้
  const db = freshDb();
  await saveCleaningForm(as(db, 'ctB'), cleaning('AYA-WNI-AIR-1', { NodeName: 'วังน้อย', SiteCode: 'AYA-WNI' }));

  const r = await saveCleaningForm(as(db, 'ctA'),
    cleaning('ATG-PMK-AIR-2', { AirCode1: '', AirCode2: 'ATG-PMK-AIR-2', SiteCode: 'AYA-WNI', NodeName: 'วังน้อย' }));

  assert.equal(r.mergedInto, '', 'ต้องได้ใบใหม่ ไม่ใช่ไปรวมกับใบของเจ้า B');
  const forms = await getCleaningForms(as(db, 'boss'));
  assert.equal(forms.find(f => f.AirCode1 === 'AYA-WNI-AIR-1').AirCode2, '');
  assert.equal(forms.find(f => f.AirCode2 === 'ATG-PMK-AIR-2').SiteCode, 'ATG-PMK', 'ข้อมูล Node ต้องมาจากทะเบียน');
});

test('ราคาของผู้รับเหมามาจากราคารอบในแผน ไม่ใช่ตัวเลขที่กรอกมา', async () => {
  const db = freshDb();
  await saveCleaningForm(as(db, 'ctA'), cleaning('ATG-PMK-AIR-1', { Price1: 99999, Price: 99999 }));

  assert.equal(Number(planRow(db, 'ATG-PMK-AIR-1').R2_Price), 480, 'ราคาที่ตั้งตอนเปิดงาน');
  const form = (await getCleaningForms(as(db, 'boss')))[0];
  assert.equal(Number(form.Price1), 480);
  assert.equal(form.CompanyName, 'บริษัท เอ แอร์', 'ชื่อบริษัทต้องเป็นชื่อที่ Admin ตั้ง');
});

test('รอบที่ยังไม่ได้ตั้งราคาในแผน ใช้ราคาต่อรอบจากทะเบียน', async () => {
  const db = freshDb();
  db.prepare("UPDATE plans SET R2_Price = NULL WHERE AirCode = 'ATG-PMK-AIR-2'").run();
  await saveCleaningForm(as(db, 'ctA'), cleaning('ATG-PMK-AIR-2', { AirCode1: '', AirCode2: 'ATG-PMK-AIR-2', Price2: 99999 }));

  assert.equal(Number(planRow(db, 'ATG-PMK-AIR-2').R2_Price), 500);
});

test('เจ้าหน้าที่ยังกรอกราคาเองได้เหมือนเดิม', async () => {
  const db = freshDb();
  await saveCleaningForm(as(db, 'boss'), cleaning('ATG-PMK-AIR-1', { Price1: 650 }));
  assert.equal(Number(planRow(db, 'ATG-PMK-AIR-1').R2_Price), 650);
});

test('แนบเอกสารเขียนมือ — เฉพาะงานของตัวเอง ราคามาจากแผน และต้องผูกกับรอบเสมอ', async () => {
  const db = freshDb();
  const attachments = { save: () => [{ name: 'a.jpg', size: 1 }] };
  const file = [{ name: 'a.jpg', mimeType: 'image/jpeg', data: 'AAAA' }];
  const up = (closeout, nodeName = 'ป่าโมก') =>
    uploadNodeDocuments(as(db, 'ctA', { attachments }), { nodeName, files: file, closeout });

  await up({ date: '2026-09-15', year: 2026, round: 2, units: [{ airCode: 'ATG-PMK-AIR-1', price: 99999 }] });
  assert.equal(Number(planRow(db, 'ATG-PMK-AIR-1').R2_Price), 480);

  await assert.rejects(() => up({ date: '2026-12-01', year: 2026, round: 3, units: [{ airCode: 'ATG-PMK-AIR-1' }] }),
    /ไม่ได้มอบหมายให้คุณ/);
  await assert.rejects(() => up(null), /หน้าแผนล้างแอร์/);
  await assert.rejects(() => up(null, 'วังน้อย'), /ไม่พบ Node/);
});

test('ใบติดตั้ง — กรอกได้เฉพาะเครื่องที่มีงานของตัวเอง', async () => {
  const db = freshDb();

  const r = await saveInstallForm(as(db, 'ctA'), { AirCode1: 'ATG-PMK-AIR-1', Date: '2026-09-20', CompanyName: 'พิมพ์เอง' });
  assert.ok(r.docNo);
  assert.equal((await getInstallForms(as(db, 'boss')))[0].CompanyName, 'บริษัท เอ แอร์');
  assert.deepEqual((await getInstallForms(as(db, 'ctA'))).length, 1);
  assert.deepEqual((await getInstallForms(as(db, 'ctB'))).length, 1, 'เจ้า B ก็มีงานบนเครื่องนี้ (รอบ 3)');

  await assert.rejects(
    () => saveInstallForm(as(db, 'ctA'), { AirCode1: 'AYA-WNI-AIR-1', Date: '2026-09-20' }), /ไม่พบเครื่อง/);
});

test('ใบติดตั้งใบเดียว ใส่เครื่องจากสอง Node ไม่ได้', async () => {
  await assert.rejects(
    () => saveInstallForm(as(freshDb(), 'boss'), { AirCode1: 'ATG-PMK-AIR-1', AirCode2: 'AYA-WNI-AIR-1', Date: '2026-09-20' }),
    /คนละ Node/);
});

test('ผู้รับเหมาลบเอกสารไม่ได้ แม้เป็นใบของตัวเอง', async () => {
  const db = freshDb();
  await saveCleaningForm(as(db, 'ctA'), cleaning('ATG-PMK-AIR-1'));
  await saveInstallForm(as(db, 'ctA'), { AirCode1: 'ATG-PMK-AIR-1', Date: '2026-09-20' });
  const cf = (await getCleaningForms(as(db, 'ctA')))[0];
  const inf = (await getInstallForms(as(db, 'ctA')))[0];

  await assert.rejects(() => deleteCleaningForm(as(db, 'ctA'), cf._row, cf.ID), /ผู้รับเหมา/);
  await assert.rejects(() => deleteInstallForm(as(db, 'ctA'), inf._row, inf.ID), /ผู้รับเหมา/);
});

test('แก้ทะเบียนเครื่องเองไม่ได้', async () => {
  await assert.rejects(() => saveAirUnit(as(freshDb(), 'ctA'), { AirCode: 'ATG-PMK-AIR-1', Region: '1', Status: 'ใช้งานปกติ' }));
});

/* ==================== สร้างบัญชีผู้รับเหมา ==================== */

test('สร้างบัญชีผู้รับเหมาด้วยชื่อบริษัทใหม่ — ชื่อไปโผล่ในรายชื่อให้เลือกในแผนทันที', async () => {
  const db = freshDb();
  await saveUser(as(db, 'boss'), {
    Username: 'tn01', Name: 'ช่างทีแอนด์เอ็น', Password: 'secret1', Role: 'Contractor', NewContractorName: '  T&N  แอร์ '
  });

  const list = await getContractors(as(db, 'boss'));
  const tn = list.find(c => c.Name === 'T&N แอร์');
  assert.ok(tn, 'ต้องได้ผู้รับเหมาใหม่ (ช่องว่างถูกเก็บให้เรียบร้อย)');
  assert.equal(tn.ID, 'CT003');
  assert.equal(tn.UserCount, 1);
  assert.equal((await getUsers(as(db, 'boss'))).find(u => u.Username === 'tn01').ContractorID, 'CT003');
});

test('พิมพ์ชื่อบริษัทที่มีอยู่แล้ว (ต่างแค่ตัวพิมพ์/ช่องว่าง) — ใช้เจ้าเดิม ไม่สร้างซ้ำ', async () => {
  const db = freshDb();
  await saveUser(as(db, 'boss'), {
    Username: 'ctA2', Password: 'secret1', Role: 'Contractor', NewContractorName: 'บริษัท  เอแอร์'
  });

  assert.equal((await getContractors(as(db, 'boss'))).length, 2);
  const info = await as(db, 'ctA2').userInfo();
  assert.equal(info.contractorId, 'CT001', 'ช่างคนที่สองของบริษัทเดียวกัน เห็นงานชุดเดียวกัน');
  assert.equal(info.jobs.length, 2);
});

test('สร้างบัญชีผู้รับเหมาต้องระบุบริษัท และภูมิภาค/สิทธิ์รายเมนูถูกล้าง', async () => {
  const db = freshDb();
  const base = { Username: 'ctX', Password: 'secret1', Role: 'Contractor' };

  await assert.rejects(() => saveUser(as(db, 'boss'), base), /ชื่อบริษัทผู้รับเหมา/);
  await assert.rejects(() => saveUser(as(db, 'boss'), { ...base, ContractorID: 'CT404' }), /ไม่พบผู้รับเหมา/);

  await saveUser(as(db, 'boss'), { ...base, ContractorID: 'CT002', Regions: ['1', '2'], Permissions: { budget: 'edit' } });
  const u = (await getUsers(as(db, 'boss'))).find(x => x.Username === 'ctX');
  assert.equal(u.Role, 'Contractor');
  assert.equal(u.Regions, '');
  assert.ok(!/edit|view/.test(u.Permissions), 'สิทธิ์รายเมนูต้องเป็น none ทั้งหมด ไม่ใช่ช่องว่าง (= แก้ไขได้ทุกอย่าง)');
});

test('เปลี่ยนบัญชีผู้รับเหมากลับเป็นเจ้าหน้าที่ — ล้างรหัสผู้รับเหมาออก', async () => {
  const db = freshDb();
  const row = (await getUsers(as(db, 'boss'))).find(x => x.Username === 'ctA');

  await saveUser(as(db, 'boss'), {
    _row: row._row, _expectUsername: 'ctA', Username: 'ctA', Name: 'ช่างเจ้า A',
    Role: 'RegionAdmin', ContractorID: 'CT001', Regions: ['1'], Permissions: { plan: 'view' }
  });
  assert.equal((await as(db, 'ctA').userInfo()).role, 'RegionAdmin');
  assert.equal((await getUsers(as(db, 'boss'))).find(x => x.Username === 'ctA').ContractorID, '');
});

test('เจ้าหน้าที่ภาคดึงรายชื่อผู้รับเหมาได้ (ใช้เลือกในแผน)', async () => {
  const list = await getContractors(as(freshDb(), 'staff1'));
  assert.deepEqual(list.map(c => c.ID).sort(), ['CT001', 'CT002']);
});

test('สรุปแผนของผู้รับเหมา นับเฉพาะรอบที่เป็นงานของตัวเอง', async () => {
  const { getCleaningSummary } = await import('../src/modules/plan.js');
  const sum = await getCleaningSummary(as(freshDb(), 'ctA'), 2026);

  assert.equal(sum.done + sum.pending + sum.cancelled, 2, 'งานของเจ้า A มีแค่รอบ 2 ของป่าโมก 2 เครื่อง');
});

test('ปฏิทินของผู้รับเหมา มีเฉพาะนัดของรอบที่เป็นงานของตัวเอง', async () => {
  const { getPlanCalendar } = await import('../src/modules/plan.js');
  const db = freshDb();
  // ป่าโมก-1 รอบ 3 เป็นของเจ้า B — ตั้งวันให้ตรงเดือนเดียวกัน จะได้เห็นว่าถูกกรองจริง
  db.prepare("UPDATE plans SET R3_PlanDate = '2026-09-20' WHERE AirCode = 'ATG-PMK-AIR-1'").run();

  const items = cal => Object.values(cal.days).flat().map(i => i.AirCode + '/' + i.round).sort();

  const a = await getPlanCalendar(as(db, 'ctA'), 2026, 9);
  assert.deepEqual(items(a), ['ATG-PMK-AIR-1/2', 'ATG-PMK-AIR-2/2']);
  const b = await getPlanCalendar(as(db, 'ctB'), 2026, 9);
  assert.deepEqual(items(b), ['ATG-PMK-AIR-1/3', 'AYA-WNI-AIR-1/2']);
  const boss = await getPlanCalendar(as(db, 'boss'), 2026, 9);
  assert.equal(boss.total, 5, 'เจ้าหน้าที่เห็นนัดครบทุกเจ้า');
});

test('นัดหมาย 30 วันของผู้รับเหมา มีเฉพาะรอบของตัวเองที่ยังไม่เสร็จ', async () => {
  const { getUpcomingCleanings } = await import('../src/modules/plan.js');
  const { ymd } = await import('../src/values.js');
  const db = freshDb();
  const soon = ymd(new Date(Date.now() + 5 * 86400000));
  db.prepare('UPDATE plans SET R2_PlanDate = ?, R3_PlanDate = ?').run(soon, soon);

  const codes = list => list.map(u => u.AirCode + '/' + u.Round).sort();
  assert.deepEqual(codes(await getUpcomingCleanings(as(db, 'ctA'))), ['ATG-PMK-AIR-1/2', 'ATG-PMK-AIR-2/2']);
  assert.deepEqual(codes(await getUpcomingCleanings(as(db, 'ctB'))), ['ATG-PMK-AIR-1/3', 'AYA-WNI-AIR-1/2']);

  // ปิดงานไปแล้ว ต้องหายจากรายการนัด
  await saveCleaningForm(as(db, 'ctA'), cleaning('ATG-PMK-AIR-1', { Date: soon }));
  assert.deepEqual(codes(await getUpcomingCleanings(as(db, 'ctA'))), ['ATG-PMK-AIR-2/2']);
});
