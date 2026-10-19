/**
 * ขั้นอนุมัติเอกสาร — Subcontract → Staff → Supervisor/Regional → Infrastructure
 *
 * ล็อกกติกาที่เจ้าของงานกำหนด (ดูหัวไฟล์ src/modules/approval.js):
 * - ขั้น 1 ไม่ต้องกด: บัญชี Subcontract ที่กรอก = ชื่อในช่องผู้ดำเนินการ
 * - ขั้น 3 เป็น Supervisor หรือ Regional ก็ได้ ชื่อคนที่กดลงเอกสาร
 * - อนุมัติทีละขั้น ข้ามไม่ได้ ผิดบทบาทไม่ได้ นอกภูมิภาคไม่ได้
 * - ระหว่างรอ PDF เป็นฉบับร่างมีลายน้ำ ลายน้ำหายตั้งแต่ขั้น 3 (Supervisor) อนุมัติ
 * - ใบเก่าไม่ต้องอนุมัติ · แก้รูปแล้วต้องอนุมัติใหม่
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { approveDoc, startApproval } from '../src/modules/approval.js';
import {
  saveRepairForm, getRepairForms, getRepairDocHtml, deleteRepairForm, saveRepairPhoto
} from '../src/modules/repairform.js';
import { saveCleaningForm, getCleaningForms } from '../src/modules/cleaningform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  user.run('infra', 'อินฟรา ใหญ่', 'Admin', '', '', 1, 'x', '');
  user.run('reg', 'รีเจียน ภาคหนึ่ง', 'RegionAdmin', '1', '', 1, 'x', '');
  user.run('staff', 'สตาฟ ภาคหนึ่ง', 'Staff', '1', '', 1, 'x', '');
  user.run('staff2', 'สตาฟ ภาคสอง', 'Staff', '2', '', 1, 'x', '');
  user.run('sup', 'ซุป ภาคหนึ่ง', 'Supervisor', '1', '', 1, 'x', '');
  user.run('sub', 'ช่างเอ บัญชี', 'Contractor', '', '', 1, 'x', 'CT001');
  db.prepare("INSERT INTO contractors (ID, Name, Active) VALUES ('CT001','บริษัท เอ',1)").run();
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU)
    VALUES (?,?,?,?,?,?,?,?)`).run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'ใช้งานปกติ', 'Daikin', 18000);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, u, parts = {}) => { const c = new Ctx({}, state, db, parts); c.username = u; return c; };

const repair = () => ({
  AirCode: 'AYA-WNI-AIR-1', Date: '2026-09-20', Symptom: 'ไม่เย็น', Fix: 'เติมน้ำยา',
  CompanyName: 'บริษัท เอ', TechnicianName: 'ช่างสมชาย', SupervisorName: 'ชื่อที่พิมพ์เอง'
});

async function newRepair(db) {
  // ส่งเอกสารซ่อมได้เฉพาะงานที่อนุมัติซ่อมแล้ว
  db.exec("UPDATE air_units SET Status = 'รอซ่อม' WHERE AirCode = 'AYA-WNI-AIR-1'");
  await saveRepairForm(as(db, 'infra'), repair());
  const [form] = await getRepairForms(as(db, 'infra'));
  return form;
}

const approvalOf = async (db, u = 'infra') => (await getRepairForms(as(db, u)))[0].Approval;
const today = () => { const d = new Date(); return [d.getDate(), d.getMonth() + 1].map(n => String(n).padStart(2, '0')).join('/') + '/' + d.getFullYear(); };

test('ใบใหม่เริ่มที่ขั้น 2 และแต่ละคนเห็นว่าตัวเองกดได้หรือไม่', async () => {
  const db = freshDb();
  await newRepair(db);
  const a = await approvalOf(db, 'staff');
  assert.equal(a.next, 2);
  assert.equal(a.done, false);
  assert.equal(a.canApprove, true, 'Staff กดขั้น 2 ได้');
  assert.equal((await approvalOf(db, 'sup')).canApprove, false, 'Supervisor ยังไม่ถึงคิว');
  assert.equal((await approvalOf(db, 'infra')).canApprove, false, 'Infrastructure ยังไม่ถึงคิว');
});

test('อนุมัติตามลำดับครบ 4 ขั้น — ผิดบทบาทหรือข้ามขั้นไม่ได้', async () => {
  const db = freshDb();
  const form = await newRepair(db);

  await assert.rejects(() => approveDoc(as(db, 'sup'), 'repair', form.ID), /ขั้น 2.*Staff/);
  await assert.rejects(() => approveDoc(as(db, 'infra'), 'repair', form.ID), /ขั้น 2/);
  await approveDoc(as(db, 'staff'), 'repair', form.ID);

  await assert.rejects(() => approveDoc(as(db, 'staff'), 'repair', form.ID), /ขั้น 3.*Supervisor หรือ Regional/);
  await assert.rejects(() => approveDoc(as(db, 'infra'), 'repair', form.ID), /ขั้น 3/);
  await approveDoc(as(db, 'sup'), 'repair', form.ID);

  await assert.rejects(() => approveDoc(as(db, 'reg'), 'repair', form.ID), /ขั้น 4.*Infrastructure/);
  const { approval } = await approveDoc(as(db, 'infra'), 'repair', form.ID);
  assert.equal(approval.done, true);
  assert.deepEqual([approval.s2.name, approval.s3.name, approval.s3.role, approval.s4.name],
    ['สตาฟ ภาคหนึ่ง', 'ซุป ภาคหนึ่ง', 'Supervisor', 'อินฟรา ใหญ่']);

  await assert.rejects(() => approveDoc(as(db, 'infra'), 'repair', form.ID), /ครบทุกขั้นแล้ว/);
});

test('ขั้น 3 ให้ Regional กดแทน Supervisor ได้ — ชื่อของคนกดลงเอกสาร', async () => {
  const db = freshDb();
  const form = await newRepair(db);
  await approveDoc(as(db, 'staff'), 'repair', form.ID);
  const { approval } = await approveDoc(as(db, 'reg'), 'repair', form.ID);
  assert.equal(approval.s3.name, 'รีเจียน ภาคหนึ่ง');
  assert.equal(approval.s3.role, 'RegionAdmin');
  assert.equal(approval.next, 4);
});

test('นอกภูมิภาคของตัวเอง / บัญชี Subcontract — อนุมัติไม่ได้', async () => {
  const db = freshDb();
  const form = await newRepair(db);
  await assert.rejects(() => approveDoc(as(db, 'staff2'), 'repair', form.ID), /ภูมิภาค/);
  await assert.rejects(() => approveDoc(as(db, 'sub'), 'repair', form.ID));
  assert.equal((await approvalOf(db)).next, 2, 'ต้องไม่มีขั้นไหนถูกบันทึก');
});

test('เอกสาร: ระหว่างรอเป็นฉบับร่างมีลายน้ำ ชื่อขึ้นเฉพาะขั้นที่อนุมัติแล้ว — ครบแล้วลายน้ำหาย', async () => {
  const db = freshDb();
  const form = await newRepair(db);

  let html = await getRepairDocHtml(as(db, 'infra'), form._row);
  assert.ok(html.includes('class="draft-mark"'), 'ฉบับร่างต้องมีลายน้ำ');
  assert.ok(html.includes('ช่างสมชาย'), 'ขั้น 1 คนกรอกไม่ใช่ Subcontract = ใช้ชื่อช่างในฟอร์ม');
  assert.ok(!html.includes('ชื่อที่พิมพ์เอง'), 'ช่องผู้ควบคุมงานต้องรอ Staff อนุมัติ ไม่ใช้ชื่อที่พิมพ์ไว้');

  await approveDoc(as(db, 'staff'), 'repair', form.ID);
  html = await getRepairDocHtml(as(db, 'infra'), form._row);
  assert.ok(html.includes('สตาฟ ภาคหนึ่ง') && html.includes(today()));
  assert.ok(!html.includes('ซุป ภาคหนึ่ง'));
  assert.ok(html.includes('class="draft-mark"'), 'ขั้น 3 ยังไม่อนุมัติ ต้องยังมีลายน้ำ');

  // ขั้น 3 อนุมัติแล้ว ลายน้ำหาย — Supervisor ปริ้นไปให้ Infrastructure อนุมัติ (เจ้าของงานขอ)
  await approveDoc(as(db, 'sup'), 'repair', form.ID);
  html = await getRepairDocHtml(as(db, 'infra'), form._row);
  assert.ok(!html.includes('class="draft-mark"'), 'ขั้น 3 อนุมัติแล้วต้องไม่มีลายน้ำ');
  assert.ok(html.includes('ซุป ภาคหนึ่ง'));
  assert.ok(!html.includes('อินฟรา ใหญ่'), 'ขั้น 4 ยังไม่อนุมัติ ยังไม่มีชื่อ Infrastructure');

  await approveDoc(as(db, 'infra'), 'repair', form.ID);
  html = await getRepairDocHtml(as(db, 'infra'), form._row);
  assert.ok(!html.includes('class="draft-mark"'), 'อนุมัติครบแล้วต้องไม่มีลายน้ำ');
  for (const n of ['สตาฟ ภาคหนึ่ง', 'ซุป ภาคหนึ่ง', 'อินฟรา ใหญ่']) assert.ok(html.includes(n), n);
});

test('ขั้น 1: บัญชี Subcontract ที่กรอก — ชื่อบัญชีลงช่องผู้ดำเนินการเลย ไม่ต้องกด', async () => {
  const db = freshDb();
  const c = as(db, 'sub');
  await c.ensureBase();
  await startApproval(c, 'repair', 'RF-X');
  await c.ss.flush();
  const row = db.prepare("SELECT S1Name, S1By FROM doc_approvals WHERE FormID = 'RF-X'").get();
  assert.deepEqual({ ...row }, { S1Name: 'ช่างเอ บัญชี', S1By: 'sub' });
});

test('แก้รูปหลังอนุมัติไปแล้ว — ต้องเริ่มอนุมัติใหม่ที่ขั้น 2', async () => {
  const db = freshDb();
  const form = await newRepair(db);
  await approveDoc(as(db, 'staff'), 'repair', form.ID);
  await approveDoc(as(db, 'sup'), 'repair', form.ID);

  const photos = { save: () => ({ bytes: 1 }), readAll: () => ({}) };
  await saveRepairPhoto(as(db, 'infra', { photos }), { row: form._row, index: 1, dataUrl: 'data:image/png;base64,AA==' });

  const a = await approvalOf(db);
  assert.equal(a.next, 2);
  assert.equal(a.s2.name, '');
  assert.equal(a.s3.name, '');
});

test('ใบเก่า (ก่อนมีขั้นอนุมัติ) — ไม่ต้องอนุมัติ เอกสารไม่มีลายน้ำ', async () => {
  const db = freshDb();
  const form = await newRepair(db);
  db.exec('DELETE FROM doc_approvals');

  assert.equal((await approvalOf(db)), null);
  await assert.rejects(() => approveDoc(as(db, 'staff'), 'repair', form.ID), /ไม่ต้องอนุมัติ/);
  const html = await getRepairDocHtml(as(db, 'infra'), form._row);
  assert.ok(!html.includes('class="draft-mark"'));
  assert.ok(html.includes('ชื่อที่พิมพ์เอง'), 'ใบเก่าแสดงชื่อผู้ควบคุมงานที่พิมพ์ไว้เหมือนเดิม');
});

test('ลบเอกสาร — แถวขั้นอนุมัติถูกลบตาม', async () => {
  const db = freshDb();
  const form = await newRepair(db);
  await deleteRepairForm(as(db, 'infra'), form._row, form.ID);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM doc_approvals').get().n, 0);
});

test('ใบล้าง: เพิ่มเครื่องเข้าใบเดิม — ล้างชื่อผู้อนุมัติ เริ่มใหม่ที่ขั้น 2', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status)
    VALUES ('AYA-WNI-AIR-2','วังน้อย','AYA-WNI','1','อยุธยา','ใช้งานปกติ')`).run();
  const base = { NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Date: '2026-09-20', PlanYear: 2026, PlanRound: 2, TechnicianName: 'ช่าง', Checklist: [] };

  await saveCleaningForm(as(db, 'infra'), { ...base, AirCode1: 'AYA-WNI-AIR-1' });
  const [form] = await getCleaningForms(as(db, 'infra'));
  assert.equal(form.Approval.next, 2);
  await approveDoc(as(db, 'staff'), 'cleaning', form.ID);

  const res = await saveCleaningForm(as(db, 'infra'), { ...base, AirCode2: 'AYA-WNI-AIR-2' });
  assert.ok(res.mergedInto, 'ต้องรวมเข้าใบเดิม');
  const [after] = await getCleaningForms(as(db, 'infra'));
  assert.equal(after.ID, form.ID);
  assert.equal(after.Approval.next, 2);
  assert.equal(after.Approval.s2.name, '');
});

test('ตัวเลขบนเมนูเอกสารรออนุมัติ — นับเฉพาะที่ถึงขั้นของบัญชีนั้น · เคสชำรุดนับให้ Infrastructure เท่านั้น', async () => {
  const { getApprovalCount } = await import('../src/modules/approval.js');
  const db = freshDb();
  const form = await newRepair(db);
  const count = async u => (await getApprovalCount(as(db, u))).total;

  assert.deepEqual([await count('staff'), await count('sup'), await count('reg'), await count('infra')], [1, 0, 0, 0]);
  await approveDoc(as(db, 'staff'), 'repair', form.ID);
  assert.deepEqual([await count('staff'), await count('sup'), await count('reg'), await count('infra')], [0, 1, 1, 0]);
  assert.equal(await count('staff2'), 0, 'นอกภูมิภาคไม่นับ');

  db.exec("UPDATE air_units SET Status = 'ชำรุด' WHERE AirCode = 'AYA-WNI-AIR-1'");
  // เคสชำรุด (รออนุมัติซ่อม) อยู่ที่หน้างานซ่อมที่เดียว — ไม่นับบนเมนูเอกสารรออนุมัติแล้ว (เจ้าของงานขอ)
  assert.deepEqual(await getApprovalCount(as(db, 'infra')), { docs: 0, cleaning: 0, install: 0, total: 0 });
  assert.equal(await count('sup'), 1, 'เคสชำรุดไม่นับให้บทบาทอื่น');
});

test('ตัวเลขบนเมนูนับใบล้างแอร์ที่รออนุมัติด้วย (แยกจากใบซ่อม)', async () => {
  const { getApprovalCount } = await import('../src/modules/approval.js');
  const db = freshDb();
  await saveCleaningForm(as(db, 'infra'), { NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Date: '2026-09-20',
    AirCode1: 'AYA-WNI-AIR-1', TechnicianName: 'ช่าง', Checklist: [] });
  assert.deepEqual(await getApprovalCount(as(db, 'staff')), { docs: 0, cleaning: 1, install: 0, total: 1 });
  const [form] = await getCleaningForms(as(db, 'infra'));
  await approveDoc(as(db, 'staff'), 'cleaning', form.ID);
  assert.equal((await getApprovalCount(as(db, 'staff'))).total, 0);
  assert.equal((await getApprovalCount(as(db, 'sup'))).cleaning, 1);
});

test('ตัวเลขบนเมนูนับใบติดตั้งที่รออนุมัติด้วย (แยกจากใบซ่อม/ใบล้าง)', async () => {
  const { getApprovalCount } = await import('../src/modules/approval.js');
  const { saveInstallForm, getInstallForms } = await import('../src/modules/installform.js');
  const db = freshDb();
  await saveInstallForm(as(db, 'infra'), { AirCode1: 'AYA-WNI-AIR-1', Date: '2026-09-20', TechnicianName: 'ช่าง', Checklist: [] });
  assert.deepEqual(await getApprovalCount(as(db, 'staff')), { docs: 0, cleaning: 0, install: 1, total: 1 });
  const [form] = await getInstallForms(as(db, 'infra'));
  await approveDoc(as(db, 'staff'), 'install', form.ID);
  assert.equal((await getApprovalCount(as(db, 'staff'))).total, 0);
  assert.equal((await getApprovalCount(as(db, 'reg'))).install, 1, 'ขั้น 3 ถึงคิว Regional/Supervisor');
});
