/**
 * บัญชีผู้รับเหมา — เห็นและแก้ได้เฉพาะ Node ที่ได้รับมอบหมาย
 *
 * ============================================================================
 * ทำไมชุดนี้สำคัญที่สุดของระบบสิทธิ์
 * ============================================================================
 * ผู้รับเหมาหลายเจ้าใช้ระบบเดียวกัน และเป็นคนนอกบริษัท ถ้ากรองพลาดสักหน้า
 * ผู้รับเหมาเจ้าหนึ่งจะเห็นงานและราคาของคู่แข่ง หรือเขียนเอกสารลงงานของเจ้าอื่นได้
 *
 * เทสต์ทุกตัวในชุดนี้ใช้ผู้รับเหมาสองเจ้าคู่กัน (A ดูแลอ่างทอง / B ดูแลอยุธยา)
 * แล้วพิสูจน์ที่ฝั่งเซิร์ฟเวอร์ ไม่ใช่แค่ว่าหน้าเว็บซ่อนปุ่มไว้
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - เห็นเฉพาะเครื่อง เอกสาร และแผนของ Node ที่มอบหมายให้เจ้าตัวเอง
 * - กรอกใบล้าง / ใบติดตั้งได้เฉพาะเครื่องของ Node ตัวเอง แม้แก้ค่า Region/SiteCode ที่ส่งมา
 * - ราคาค่าล้างมาจากทะเบียนเสมอ ผู้รับเหมากรอกราคาเองไม่ได้
 * - ลบเอกสาร / แก้ทะเบียนเครื่อง / แก้แผน / ดูงบประมาณ ไม่ได้
 * - ผู้รับเหมาถูกปิด หรือบัญชีไม่ได้ผูกผู้รับเหมา = เข้าระบบไม่ได้เลย
 * - เปลี่ยนการมอบหมายแล้วมีผลทันที ไม่ต้องล็อกอินใหม่
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
import { getCleaningPlan, updateCleaningRound } from '../src/modules/plan.js';
import { getAirList, saveAirUnit } from '../src/modules/airlist.js';
import { getHistory } from '../src/modules/history.js';
import { getBudgetSummary } from '../src/modules/budget.js';
import { getRepairForms } from '../src/modules/repairform.js';
import { getDashboardSummary } from '../src/modules/dashboard.js';
import { saveUser, getUsers } from '../src/modules/users.js';
import {
  getContractors, saveContractor, getNodeAssignments, assignNodes
} from '../src/modules/contractors.js';

/* ==================== ข้อมูลตั้งต้น ==================== */

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
  // A: อ่างทอง 2 เครื่อง / B: อยุธยา 1 เครื่อง — อยู่ภาคเดียวกัน เพื่อพิสูจน์ว่ากรองราย Node ไม่ใช่รายภาค
  unit.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'Daikin', 18000, 'IN-A1', 500);
  unit.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'Daikin', 18000, 'IN-A2', 500);
  unit.run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'Container', 'ใช้งานปกติ', 'Carrier', 24000, 'IN-B1', 700);
  // Node ที่ยังไม่ได้มอบหมายให้ใคร
  unit.run('ATG-SWH-AIR-1', 'แสวงหา', 'ATG-SWH', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'LG', 12000, 'IN-X', 450);

  const assign = db.prepare('INSERT INTO node_assignments (SiteCode, ContractorID) VALUES (?,?)');
  assign.run('ATG-PMK', 'CT001');
  assign.run('AYA-WNI', 'CT002');

  const plan = db.prepare('INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R2_PlanDate, R2_Status) VALUES (?,?,?,?,?,?)');
  plan.run(2026, 'ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '2026-09-10', 'รอดำเนินการ');
  plan.run(2026, 'AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '2026-09-10', 'รอดำเนินการ');
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

/** บันทึกใบล้างของทั้งสองเจ้าไว้ก่อน ด้วยบัญชี Admin */
async function withBothDocs(db) {
  await saveCleaningForm(as(db, 'boss'), cleaning('ATG-PMK-AIR-1'));
  await saveCleaningForm(as(db, 'boss'), cleaning('AYA-WNI-AIR-1', {
    NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Province: 'อยุธยา', Price1: 700
  }));
  await saveInstallForm(as(db, 'boss'), { AirCode1: 'ATG-PMK-AIR-1', Date: '2026-09-20' });
  await saveInstallForm(as(db, 'boss'), { AirCode1: 'AYA-WNI-AIR-1', Date: '2026-09-20' });
}

/* ==================== บทบาทและสิทธิ์ ==================== */

test('บัญชีที่ผูกผู้รับเหมา ได้บทบาทผู้รับเหมา พร้อม Node ของเจ้าตัวเอง', async () => {
  const info = await as(freshDb(), 'ctA').userInfo();

  assert.equal(info.role, 'Contractor');
  assert.equal(info.contractorName, 'บริษัท เอ แอร์');
  assert.deepEqual(info.sites, ['ATG-PMK']);
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

/* ==================== เห็นเฉพาะของตัวเอง ==================== */

test('รายชื่อ Node ในฟอร์ม — เห็นเฉพาะ Node ที่มอบหมาย', async () => {
  const nodes = await getCleaningFormNodes(as(freshDb(), 'ctA'));

  assert.deepEqual(nodes.map(n => n.SiteCode), ['ATG-PMK'],
    'ต้องไม่เห็นอยุธยาของเจ้า B และไม่เห็นแสวงหาที่ยังไม่มีเจ้าของ');
  assert.equal(nodes[0].units.length, 2);
});

test('รายการเอกสารล้างและติดตั้ง — เห็นเฉพาะใบของ Node ตัวเอง', async () => {
  const db = freshDb();
  await withBothDocs(db);

  const cf = await getCleaningForms(as(db, 'ctA'));
  assert.deepEqual(cf.map(f => f.SiteCode), ['ATG-PMK']);

  const inf = await getInstallForms(as(db, 'ctB'));
  assert.deepEqual(inf.map(f => f.SiteCode), ['AYA-WNI']);
});

test('แผนล้าง — เห็นเฉพาะเครื่องของ Node ตัวเอง', async () => {
  const plan = await getCleaningPlan(as(freshDb(), 'ctA'), 2026);
  assert.deepEqual(plan.map(p => p.AirCode), ['ATG-PMK-AIR-1']);
});

test('เปิดเอกสารของเจ้าอื่นด้วยเลขแถวตรงๆ ไม่ได้', async () => {
  const db = freshDb();
  await withBothDocs(db);
  const rowB = (await getCleaningForms(as(db, 'boss'))).find(f => f.SiteCode === 'AYA-WNI')._row;

  await assert.rejects(() => getCleaningDocHtml(as(db, 'ctA'), rowB), /ไม่มีสิทธิ์/);
});

test('เมนูที่ปิดไว้ คืนค่าว่างทั้งหมด ไม่ใช่แค่ซ่อนเมนู', async () => {
  const db = freshDb();
  await withBothDocs(db);
  db.prepare("INSERT INTO repair_forms (ID, AirCode, SiteCode, Region, Date) VALUES ('RF1','ATG-PMK-AIR-1','ATG-PMK','1','2026-09-24')").run();
  const ctx = as(db, 'ctA');

  assert.deepEqual(await getAirList(ctx), []);
  assert.deepEqual(await getHistory(ctx), [], 'ประวัติมีราคางานของเจ้าอื่นปนอยู่');
  assert.deepEqual(await getRepairForms(ctx), []);
  const budget = await getBudgetSummary(ctx, 2026);
  assert.equal(budget.totalExpense, 0, 'งบประมาณเป็นยอดรวมทั้งบริษัท ต้องได้ตัวเลขศูนย์');
  assert.equal(budget.monthly.length, 12, 'แต่รูปร่างข้อมูลต้องครบ ไม่งั้นหน้ากราฟพัง');
});

test('แดชบอร์ด — นับเฉพาะเครื่องของตัวเอง และไม่มียอดค่าใช้จ่ายของใคร', async () => {
  const db = freshDb();
  await withBothDocs(db);
  const d = await getDashboardSummary(as(db, 'ctA'), 2026);

  assert.equal(d.totalUnits, 2);
  assert.equal(d.totalCleaningCost, 0, 'ยอดค่าล้างมาจากประวัติ ซึ่งผู้รับเหมาไม่มีสิทธิ์ดู');
});

/* ==================== เขียนได้เฉพาะของตัวเอง ==================== */

test('กรอกใบล้างของ Node ตัวเองได้ และปิดรอบในแผนให้', async () => {
  const db = freshDb();
  const r = await saveCleaningForm(as(db, 'ctA'), cleaning('ATG-PMK-AIR-1'));

  assert.equal(r.planClosed, 1);
  const row = db.prepare("SELECT R2_Status FROM plans WHERE AirCode = 'ATG-PMK-AIR-1'").get();
  assert.equal(row.R2_Status, 'ล้างเสร็จสิ้น');
});

test('กรอกใบล้างของเครื่องเจ้าอื่นไม่ได้ แม้ส่ง Region/SiteCode ของตัวเองมาด้วย', async () => {
  const db = freshDb();

  await assert.rejects(
    () => saveCleaningForm(as(db, 'ctA'), cleaning('AYA-WNI-AIR-1')),
    /ไม่พบเครื่อง/);
  // Node ที่ยังไม่มีเจ้าของ ก็ต้องไม่ได้เหมือนกัน
  await assert.rejects(
    () => saveCleaningForm(as(db, 'ctA'), cleaning('ATG-SWH-AIR-1')),
    /ไม่พบเครื่อง/);

  const closed = db.prepare("SELECT R2_Status FROM plans WHERE AirCode = 'AYA-WNI-AIR-1'").get();
  assert.equal(closed.R2_Status, 'รอดำเนินการ', 'แผนของเจ้า B ต้องไม่ถูกปิด');
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
  const b = forms.find(f => f.AirCode1 === 'AYA-WNI-AIR-1');
  assert.equal(b.AirCode2, '', 'ใบของเจ้า B ต้องไม่มีเครื่องของเจ้า A โผล่มา');
  const a = forms.find(f => f.AirCode2 === 'ATG-PMK-AIR-2');
  assert.equal(a.SiteCode, 'ATG-PMK', 'ข้อมูล Node ต้องมาจากทะเบียน ไม่ใช่ค่าที่ส่งมา');
});

test('ราคาค่าล้างของผู้รับเหมามาจากทะเบียน ไม่ใช่ตัวเลขที่กรอกมา', async () => {
  const db = freshDb();
  await saveCleaningForm(as(db, 'ctA'), cleaning('ATG-PMK-AIR-1', { Price1: 99999, Price: 99999 }));

  const plan = db.prepare("SELECT R2_Price FROM plans WHERE AirCode = 'ATG-PMK-AIR-1'").get();
  assert.equal(Number(plan.R2_Price), 500, 'ราคาในแผน (= งบประมาณ) ต้องเป็นราคาจากทะเบียน');
  const form = (await getCleaningForms(as(db, 'boss')))[0];
  assert.equal(Number(form.Price1), 500);
  assert.equal(form.CompanyName, 'บริษัท เอ แอร์', 'ชื่อบริษัทต้องเป็นชื่อที่ Admin ตั้ง');
});

test('เจ้าหน้าที่ยังกรอกราคาเองได้เหมือนเดิม', async () => {
  const db = freshDb();
  await saveCleaningForm(as(db, 'boss'), cleaning('ATG-PMK-AIR-1', { Price1: 650 }));

  const plan = db.prepare("SELECT R2_Price FROM plans WHERE AirCode = 'ATG-PMK-AIR-1'").get();
  assert.equal(Number(plan.R2_Price), 650);
});

test('แนบเอกสารเขียนมือ — ราคาของผู้รับเหมาก็มาจากทะเบียน และแนบให้ Node เจ้าอื่นไม่ได้', async () => {
  const db = freshDb();
  const attachments = { save: () => [{ name: 'a.jpg', size: 1 }] };
  const file = [{ name: 'a.jpg', mimeType: 'image/jpeg', data: 'AAAA' }];

  await uploadNodeDocuments(as(db, 'ctA', { attachments }), {
    nodeName: 'ป่าโมก', files: file,
    closeout: { date: '2026-09-15', year: 2026, round: 2, units: [{ airCode: 'ATG-PMK-AIR-1', price: 99999 }] }
  });
  const plan = db.prepare("SELECT R2_Price FROM plans WHERE AirCode = 'ATG-PMK-AIR-1'").get();
  assert.equal(Number(plan.R2_Price), 500);

  await assert.rejects(() => uploadNodeDocuments(as(db, 'ctA', { attachments }), {
    nodeName: 'วังน้อย', files: file
  }), /ไม่พบ Node/);
});

test('กรอกใบติดตั้งได้เฉพาะเครื่องของ Node ตัวเอง', async () => {
  const db = freshDb();

  const r = await saveInstallForm(as(db, 'ctA'), { AirCode1: 'ATG-PMK-AIR-1', Date: '2026-09-20', CompanyName: 'พิมพ์เอง' });
  assert.ok(r.docNo);
  const form = (await getInstallForms(as(db, 'boss')))[0];
  assert.equal(form.CompanyName, 'บริษัท เอ แอร์');

  await assert.rejects(
    () => saveInstallForm(as(db, 'ctA'), { AirCode1: 'AYA-WNI-AIR-1', Date: '2026-09-20' }),
    /ไม่พบเครื่อง/);
});

test('ใบติดตั้งใบเดียว ใส่เครื่องจากสอง Node ไม่ได้', async () => {
  await assert.rejects(
    () => saveInstallForm(as(freshDb(), 'boss'), { AirCode1: 'ATG-PMK-AIR-1', AirCode2: 'AYA-WNI-AIR-1', Date: '2026-09-20' }),
    /คนละ Node/);
});

test('ผู้รับเหมาลบเอกสารไม่ได้ แม้เป็นใบของตัวเอง', async () => {
  const db = freshDb();
  await withBothDocs(db);
  const cf = (await getCleaningForms(as(db, 'ctA')))[0];
  const inf = (await getInstallForms(as(db, 'ctA')))[0];

  await assert.rejects(() => deleteCleaningForm(as(db, 'ctA'), cf._row, cf.ID), /ผู้รับเหมา/);
  await assert.rejects(() => deleteInstallForm(as(db, 'ctA'), inf._row, inf.ID), /ผู้รับเหมา/);
});

test('แก้ทะเบียนเครื่องและแก้แผนเองไม่ได้', async () => {
  const db = freshDb();
  const ctx = as(db, 'ctA');

  await assert.rejects(() => saveAirUnit(ctx, { AirCode: 'ATG-PMK-AIR-1', Region: '1', Status: 'ใช้งานปกติ' }));
  await assert.rejects(() => updateCleaningRound(ctx, 2026, 2, 2, {
    actualDate: '2026-09-15', price: 99999, status: 'ล้างเสร็จสิ้น'
  }), /แผนล้างแอร์/);
});

/* ==================== มอบหมาย Node ==================== */

test('เปลี่ยนการมอบหมายแล้วมีผลทันที — เจ้าเดิมหายสิทธิ์ เจ้าใหม่เห็นทันที', async () => {
  const db = freshDb();
  await assignNodes(as(db, 'boss'), ['ATG-PMK'], 'CT002');

  assert.deepEqual((await getCleaningFormNodes(as(db, 'ctA'))).map(n => n.SiteCode), []);
  assert.deepEqual((await getCleaningFormNodes(as(db, 'ctB'))).map(n => n.SiteCode).sort(),
    ['ATG-PMK', 'AYA-WNI']);
});

test('มอบหมายทีละหลาย Node และยกเลิกการมอบหมายได้', async () => {
  const db = freshDb();
  await assignNodes(as(db, 'boss'), ['ATG-PMK', 'ATG-SWH'], 'CT001');
  assert.deepEqual((await as(db, 'ctA').userInfo()).sites.sort(), ['ATG-PMK', 'ATG-SWH']);

  const list = await assignNodes(as(db, 'boss'), ['ATG-PMK'], '');
  assert.equal(list.find(n => n.SiteCode === 'ATG-PMK').ContractorID, '');
  assert.deepEqual((await as(db, 'ctA').userInfo()).sites, ['ATG-SWH']);
});

test('เจ้าหน้าที่ภาคมอบหมายได้เฉพาะ Node ในภาคตัวเอง', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status)
              VALUES ('KKN-CPE-AIR-1','ชุมแพ','KKN-CPE','3','ขอนแก่น','ใช้งานปกติ')`).run();

  await assignNodes(as(db, 'staff1'), ['ATG-SWH'], 'CT001');
  await assert.rejects(() => assignNodes(as(db, 'staff1'), ['KKN-CPE'], 'CT001'), /KKN-CPE/);
  assert.equal((await getNodeAssignments(as(db, 'staff1'))).some(n => n.SiteCode === 'KKN-CPE'), false);
});

test('มอบหมายให้ผู้รับเหมาที่ถูกปิด หรือไม่มีอยู่จริง ไม่ได้', async () => {
  const db = freshDb();
  db.prepare("UPDATE contractors SET Active = 0 WHERE ID = 'CT002'").run();

  await assert.rejects(() => assignNodes(as(db, 'boss'), ['ATG-SWH'], 'CT002'), /ปิดใช้งาน/);
  await assert.rejects(() => assignNodes(as(db, 'boss'), ['ATG-SWH'], 'CT404'), /ไม่พบผู้รับเหมา/);
});

test('ผู้รับเหมาเปิดหน้ารายชื่อผู้รับเหมาหรือมอบหมายงานเองไม่ได้', async () => {
  const db = freshDb();
  await assert.rejects(() => getContractors(as(db, 'ctA')), /ผู้รับเหมา/);
  await assert.rejects(() => getNodeAssignments(as(db, 'ctA')), /ผู้รับเหมา/);
  await assert.rejects(() => assignNodes(as(db, 'ctA'), ['ATG-SWH'], 'CT001'), /ผู้รับเหมา/);
});

/* ==================== รายชื่อผู้รับเหมา ==================== */

test('เพิ่มผู้รับเหมาได้รหัสถัดไป และชื่อซ้ำ (ต่างแค่ตัวพิมพ์/ช่องว่าง) ไม่ได้', async () => {
  const db = freshDb();
  const list = await saveContractor(as(db, 'staff1'), { Name: 'ที แอนด์ เอ็น' });
  assert.ok(list.find(c => c.ID === 'CT003' && c.Name === 'ที แอนด์ เอ็น'));

  await assert.rejects(() => saveContractor(as(db, 'boss'), { Name: 'บริษัท  เอ แอร์ ' }), /มีผู้รับเหมาชื่อ/);
});

test('แก้ชื่อหรือปิดผู้รับเหมาได้เฉพาะ Admin', async () => {
  const db = freshDb();
  await assert.rejects(() => saveContractor(as(db, 'staff1'), { ID: 'CT001', Name: 'ชื่อใหม่' }), /Admin/);

  const list = await saveContractor(as(db, 'boss'), { ID: 'CT001', Name: 'บริษัท เอ แอร์', Active: false });
  assert.equal(list.find(c => c.ID === 'CT001').Active, false);
});

/* ==================== สร้างบัญชีผู้รับเหมา ==================== */

test('สร้างบัญชีผู้รับเหมาต้องเลือกผู้รับเหมาที่มีอยู่จริง', async () => {
  const db = freshDb();
  const base = { Username: 'ctA2', Name: 'ช่าง A คนที่สอง', Password: 'secret1', Role: 'Contractor' };

  await assert.rejects(() => saveUser(as(db, 'boss'), base), /เลือกผู้รับเหมา/);
  await assert.rejects(() => saveUser(as(db, 'boss'), { ...base, ContractorID: 'CT404' }), /ไม่พบผู้รับเหมา/);

  await saveUser(as(db, 'boss'), { ...base, ContractorID: 'CT001', Regions: ['1', '2'], Permissions: { budget: 'edit' } });
  const u = (await getUsers(as(db, 'boss'))).find(x => x.Username === 'ctA2');
  assert.equal(u.Role, 'Contractor');
  assert.equal(u.ContractorID, 'CT001');
  assert.equal(u.Regions, '', 'ภูมิภาคต้องถูกล้าง');
  assert.ok(!/edit|view/.test(u.Permissions), 'สิทธิ์รายเมนูต้องเป็น none ทั้งหมด ไม่ใช่ช่องว่าง (= แก้ไขได้ทุกอย่าง)');

  assert.deepEqual((await as(db, 'ctA2').userInfo()).sites, ['ATG-PMK']);
});

test('เปลี่ยนบัญชีผู้รับเหมากลับเป็นเจ้าหน้าที่ — ล้างรหัสผู้รับเหมาออก', async () => {
  const db = freshDb();
  const row = (await getUsers(as(db, 'boss'))).find(x => x.Username === 'ctA');

  await saveUser(as(db, 'boss'), {
    _row: row._row, _expectUsername: 'ctA', Username: 'ctA', Name: 'ช่างเจ้า A',
    Role: 'RegionAdmin', ContractorID: 'CT001', Regions: ['1'], Permissions: { plan: 'view' }
  });
  const info = await as(db, 'ctA').userInfo();
  assert.equal(info.role, 'RegionAdmin');
  assert.equal((await getUsers(as(db, 'boss'))).find(x => x.Username === 'ctA').ContractorID, '');
});
