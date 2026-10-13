/**
 * มอบหมายงานซ่อม/ติดตั้งให้ผู้รับเหมาประจำ + ลิงก์ใบติดตั้งสำหรับผู้รับเหมาที่ไม่มีบัญชี
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - เจ้าหน้าที่มอบหมายได้เฉพาะงานที่เปิดอยู่ (ซ่อม = "รอซ่อม" · ติดตั้ง = มีแถวรอเอกสาร)
 * - ผู้รับเหมากรอกเอกสารได้เฉพาะงานที่มอบหมายให้ตัวเองและยังเปิดอยู่
 * - เปลี่ยนผู้รับเหมา / ยกเลิก = เจ้าเดิมกรอกไม่ได้ทันที
 * - กรอกแล้วงานปิด การมอบหมายหมดผล แต่ผู้รับเหมายังเห็นงานนั้น (ทำเสร็จแล้ว + เปิดเอกสารได้)
 * - ผู้รับเหมามอบหมายงานเองไม่ได้
 * - ลิงก์ติดตั้ง: กรอกได้โดยไม่ล็อกอิน ปิดงานติดตั้งที่รอเอกสาร ส่งได้ครั้งเดียว ใช้แทนลิงก์ซ่อมไม่ได้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { INSTALL_PENDING_NOTE } from '../src/schema.js';
import { assignJob, getJobAssignments, getMyJobs, closeRepairSelf } from '../src/modules/assign.js';
import { saveRepairForm, getRepairForms } from '../src/modules/repairform.js';
import { saveInstallForm, getInstallForms } from '../src/modules/installform.js';
import {
  createRepairLink, getRepairLink, submitInstallLink, submitRepairLink, getRepairLinks
} from '../src/modules/repairlink.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  user.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x', '');
  user.run('r2', 'เจ้าหน้าที่ภาค 2', 'RegionAdmin', '2', '', 1, 'x', '');
  user.run('ctA', 'ช่างเจ้า A', 'Contractor', '', '', 1, 'x', 'CT001');
  user.run('ctB', 'ช่างเจ้า B', 'Contractor', '', '', 1, 'x', 'CT002');
  const ct = db.prepare('INSERT INTO contractors (ID, Name, Active) VALUES (?,?,?)');
  ct.run('CT001', 'บริษัท เอ แอร์', 1);
  ct.run('CT002', 'บริษัท บี คูล', 1);

  const unit = db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, Brand, BTU, IndoorSN, Note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  unit.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'รอซ่อม', 'Daikin', 18000, 'IN-1', 'ไม่เย็น');
  unit.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'Daikin', 18000, 'IN-2', '');

  const h = db.prepare(`INSERT INTO history (ID, CaseID, AirCode, Date, EventType, Detail, Note, CreatedAt)
                        VALUES (?,?,?,?,?,?,?,?)`);
  h.run('CM2609-01', 'IC2609-01', 'ATG-PMK-AIR-1', '2026-09-01', 'แจ้งซ่อม', 'ไม่เย็น', '', '2026-09-01 09:00:00');
  h.run('CM2609-02', 'IC2609-01', 'ATG-PMK-AIR-1', '2026-09-02', 'รอซ่อม', 'อนุมัติ', '', '2026-09-02 09:00:00');
  // เครื่องที่ 2 เพิ่งเปลี่ยนเครื่อง รอเอกสารติดตั้ง
  h.run('CM2609-03', '', 'ATG-PMK-AIR-2', '2026-09-03', 'เปลี่ยนเครื่อง', 'เปลี่ยนเครื่อง', INSTALL_PENDING_NOTE, '2026-09-03 09:00:00');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };
const as = (db, username) => { const c = new Ctx({}, state, db, {}); c.username = username; return c; };
const anon = db => new Ctx({}, state, db, {});

const repairRecord = { AirCode: 'ATG-PMK-AIR-1', Date: '2026-09-05', Symptom: 'ไม่เย็น', Fix: 'เติมน้ำยา', CompanyName: 'พิมพ์เอง' };

test('มอบหมายงานซ่อม → ผู้รับเหมาเห็นในงานของตัวเอง กรอกใบซ่อมได้ งานปิดแล้วยังเห็นเป็นงานที่เสร็จ', async () => {
  const db = freshDb();
  await assignJob(as(db, 'boss'), 'repair', 'ATG-PMK-AIR-1', 'CT001', '2026-09-05', 'เข้าหลังบ่ายสอง');

  const staffView = await getJobAssignments(as(db, 'boss'));
  assert.equal(staffView.length, 1);
  assert.equal(staffView[0].contractorName, 'บริษัท เอ แอร์');
  assert.equal(staffView[0].apptDate, '2026-09-05');

  let mine = await getMyJobs(as(db, 'ctA'));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].state, 'open');
  assert.equal(mine[0].unit.Note, 'ไม่เย็น', 'อาการที่แจ้งไว้ใช้เติมช่องอาการเสีย');
  assert.deepEqual(await getMyJobs(as(db, 'ctB')), [], 'เจ้า B ไม่มีงาน');

  const r = await saveRepairForm(as(db, 'ctA'), repairRecord);
  assert.equal(r.caseId, 'IC2609-01', 'ใบซ่อมผูกกับเคสเดิม');
  const form = (await getRepairForms(as(db, 'boss')))[0];
  assert.equal(form.CompanyName, 'บริษัท เอ แอร์', 'ชื่อบริษัทต้องเป็นชื่อที่ Admin ตั้ง');

  mine = await getMyJobs(as(db, 'ctA'));
  assert.equal(mine[0].state, 'done');
  assert.equal(mine[0].doc.docNo, form.DocNo);
  assert.equal(mine[0].doc.waiting, true, 'ใบใหม่ยังรออนุมัติ');
  assert.deepEqual(await getJobAssignments(as(db, 'boss')), [], 'งานปิดแล้ว ไม่ต้องโชว์ในหน้างานซ่อมอีก');
  assert.equal((await getRepairForms(as(db, 'ctA'))).length, 1, 'เห็นใบที่ตัวเองกรอก');
});

test('ผู้รับเหมากรอกงานที่ไม่ได้มอบหมายให้ไม่ได้ · เปลี่ยนผู้รับเหมาแล้วเจ้าเดิมกรอกไม่ได้', async () => {
  const db = freshDb();
  await assignJob(as(db, 'boss'), 'repair', 'ATG-PMK-AIR-1', 'CT001', '', '');
  await assert.rejects(() => saveRepairForm(as(db, 'ctB'), repairRecord), /ไม่ได้มอบหมายงานซ่อมให้บริษัทของคุณ|ไม่ได้มอบหมายให้คุณ/);

  await assignJob(as(db, 'boss'), 'repair', 'ATG-PMK-AIR-1', 'CT002', '', '');
  await assert.rejects(() => saveRepairForm(as(db, 'ctA'), repairRecord), /ไม่ได้มอบหมายงานซ่อมให้บริษัทของคุณ|ไม่ได้มอบหมายให้คุณ/);
  await saveRepairForm(as(db, 'ctB'), repairRecord);   // เจ้าใหม่กรอกได้
});

test('ยกเลิกการมอบหมาย = ไม่มีใครกรอกผ่านบัญชีได้ · ผู้รับเหมามอบหมายงานเองไม่ได้', async () => {
  const db = freshDb();
  await assignJob(as(db, 'boss'), 'repair', 'ATG-PMK-AIR-1', 'CT001', '', '');
  await assignJob(as(db, 'boss'), 'repair', 'ATG-PMK-AIR-1', '', '', '');
  assert.deepEqual(await getJobAssignments(as(db, 'boss')), []);
  await assert.rejects(() => saveRepairForm(as(db, 'ctA'), repairRecord));

  await assert.rejects(() => assignJob(as(db, 'ctA'), 'repair', 'ATG-PMK-AIR-1', 'CT001', '', ''), /Subcontract/);
});

test('มอบหมายได้เฉพาะงานที่เปิดอยู่ และเฉพาะเครื่องในภูมิภาคของตัวเอง', async () => {
  const db = freshDb();
  // เครื่อง 2 ไม่ได้รอซ่อม
  await assert.rejects(() => assignJob(as(db, 'boss'), 'repair', 'ATG-PMK-AIR-2', 'CT001', '', ''), /รอซ่อม/);
  // เครื่อง 1 ไม่มีงานติดตั้งรอเอกสาร
  await assert.rejects(() => assignJob(as(db, 'boss'), 'install', 'ATG-PMK-AIR-1', 'CT001', '', ''), /ไม่มีงานติดตั้ง/);
  // เจ้าหน้าที่ภาค 2 มอบหมายเครื่องภาค 1 ไม่ได้
  await assert.rejects(() => assignJob(as(db, 'r2'), 'install', 'ATG-PMK-AIR-2', 'CT001', '', ''), /ไม่มีสิทธิ์|ไม่พบเครื่อง/);
});

test('มอบหมายงานติดตั้ง → ผู้รับเหมากรอกใบติดตั้ง แถวที่รอเอกสารได้เลขเอกสาร และงานนั้นย้ายไปเป็นเสร็จ', async () => {
  const db = freshDb();
  await assignJob(as(db, 'boss'), 'install', 'ATG-PMK-AIR-2', 'CT001', '2026-09-06', '');
  assert.equal((await getMyJobs(as(db, 'ctA')))[0].kind, 'install');

  const r = await saveInstallForm(as(db, 'ctA'), { AirCode2: 'ATG-PMK-AIR-2', Date: '2026-09-06' });
  const note = db.prepare("SELECT Note FROM history WHERE ID = 'CM2609-03'").get().Note;
  assert.equal(note, 'เอกสาร ' + r.docNo2);

  const mine = await getMyJobs(as(db, 'ctA'));
  assert.equal(mine[0].state, 'done');
  assert.equal(mine[0].doc.docNo, r.docNo);
  assert.equal((await getInstallForms(as(db, 'ctA'))).length, 1);
});

test('ใบติดตั้งของงานที่รอเอกสาร ใช้เลขเดียวกับแถวประวัตินั้น — กดเลขในหน้าประวัติได้ใบเลขเดียวกัน', async () => {
  const db = freshDb();
  // แถวรอเอกสารของเครื่อง 2 คือ CM2609-03 (ดู freshDb)
  const r = await saveInstallForm(as(db, 'boss'), { AirCode2: 'ATG-PMK-AIR-2', Date: '2026-09-06' });
  assert.equal(r.docNo2, 'CM2609-03');
  assert.equal(db.prepare("SELECT Note FROM history WHERE ID = 'CM2609-03'").get().Note, 'เอกสาร CM2609-03');
});

test('ใบติดตั้ง — เลขของแถวรอเอกสารมีเอกสารใบอื่นใช้อยู่แล้ว ออกเลขใหม่ ไม่ให้เลขซ้ำ', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO repair_forms (ID, DocNo, AirCode, Date) VALUES ('RF1', 'CM2609-03', 'ATG-PMK-AIR-1', '2026-09-03')").run();
  const r = await saveInstallForm(as(db, 'boss'), { AirCode2: 'ATG-PMK-AIR-2', Date: '2026-09-06' });
  assert.notEqual(r.docNo2, 'CM2609-03');
  assert.equal(db.prepare("SELECT Note FROM history WHERE ID = 'CM2609-03'").get().Note, 'เอกสาร ' + r.docNo2);
});

/* ==================== ลิงก์ใบติดตั้ง ==================== */

test('ลิงก์ใบติดตั้ง — กรอกได้โดยไม่ล็อกอิน ปิดงานที่รอเอกสาร และส่งได้ครั้งเดียว', async () => {
  const db = freshDb();
  const created = await createRepairLink(as(db, 'boss'), 'ATG-PMK-AIR-2', 7, 'install');
  assert.equal(created.kind, 'install');

  const info = await getRepairLink(anon(db), created.token);
  assert.equal(info.state, 'open');
  assert.equal(info.kind, 'install');
  assert.deepEqual([info.slot, info.base], [2, 0], 'AIR-2 = ช่องที่ 2 ของใบคู่ 1–2');

  // ใช้ลิงก์ติดตั้งไปส่งใบซ่อมไม่ได้
  await assert.rejects(() => submitRepairLink(anon(db), created.token, { Date: '2026-09-07', Symptom: 'x', Fix: 'y' }));

  const res = await submitInstallLink(anon(db), created.token,
    { Date: '2026-09-07', AcceptResult: 'ผ่าน', CompanyName: 'ช่างขาจร', AirCode1: 'ATG-PMK-AIR-1' });
  const form = (await getInstallForms(as(db, 'boss')))[0];
  assert.equal(form.AirCode2, 'ATG-PMK-AIR-2', 'เครื่องมาจากลิงก์');
  assert.equal(form.AirCode1, '', 'ส่งเครื่องอื่นเข้ามาเองไม่ได้');
  assert.equal(form.AcceptResult2, 'ผ่าน');
  assert.equal(form.CompanyName, 'ช่างขาจร');
  assert.match(form.RecordedBy, /^ลิงก์ /);
  assert.equal(db.prepare("SELECT Note FROM history WHERE ID = 'CM2609-03'").get().Note, 'เอกสาร ' + res.docNo);

  assert.equal((await getRepairLink(anon(db), created.token)).state, 'done');
  await assert.rejects(() => submitInstallLink(anon(db), created.token, { Date: '2026-09-07' }), /ส่งเอกสารไปแล้ว/);

  const links = await getRepairLinks(as(db, 'boss'));
  assert.equal(links[0].Kind, 'install');
});

test('ลิงก์ใบติดตั้ง — เลขเครื่องในใบนับตามลำดับใน Node เหมือนกรอกในระบบ ไม่ใช่เลขท้ายรหัส', async () => {
  const db = freshDb();
  // Node มี 2 เครื่อง แล้วเพิ่ม AIR-7 (รหัสไม่เรียงต่อ) = เครื่องตัวที่ 3 ของ Node → ช่อง 1 ของใบคู่ 3–4
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status) VALUES (?,?,?,?,?)`)
    .run('ATG-PMK-AIR-7', 'ป่าโมก', 'ATG-PMK', '1', 'ใช้งานปกติ');
  db.prepare(`INSERT INTO history (ID, AirCode, Date, EventType, Detail, Note) VALUES (?,?,?,?,?,?)`)
    .run('CM2609-09', 'ATG-PMK-AIR-7', '2026-09-09', 'ติดตั้ง', 'ติดตั้งเครื่องใหม่', INSTALL_PENDING_NOTE);

  const created = await createRepairLink(as(db, 'boss'), 'ATG-PMK-AIR-7', 7, 'install');
  const info = await getRepairLink(anon(db), created.token);
  assert.deepEqual([info.slot, info.base], [1, 2], 'ตัวที่ 3 ของ Node = ช่องที่ 1 ของใบคู่ 3–4 (ไม่ใช่เครื่องที่ 7)');

  await submitInstallLink(anon(db), created.token, { Date: '2026-09-10', AcceptResult: 'ผ่าน' });
  const form = (await getInstallForms(as(db, 'boss')))[0];
  assert.equal(form.AirCode1, 'ATG-PMK-AIR-7');
  assert.equal(Number(form.SlotBase), 2);
});

test('วันนัดของลิงก์ — เจ้าหน้าที่ใส่ตอนสร้าง ช่างที่เปิดลิงก์เห็น · สร้างลิงก์ใหม่ = วันนัดใหม่', async () => {
  const db = freshDb();
  const first = await createRepairLink(as(db, 'boss'), 'ATG-PMK-AIR-1', 7, 'repair', '2026-10-05');
  assert.equal(first.apptDate, '2026-10-05');
  assert.equal((await getRepairLink(anon(db), first.token)).apptDate, '2026-10-05');
  assert.equal((await getRepairLinks(as(db, 'boss')))[0].ApptDate, '2026-10-05');

  // เลื่อนนัด = สร้างลิงก์ใหม่ (ลิงก์เดิมถูกยกเลิก)
  const second = await createRepairLink(as(db, 'boss'), 'ATG-PMK-AIR-1', 7, 'repair', '2099-10-12');
  assert.equal((await getRepairLink(anon(db), second.token)).apptDate, '2099-10-12');
  // วันนัดไกลกว่าอายุลิงก์ → นับอายุจากวันนัด ลิงก์ต้องไม่หมดก่อนช่างเข้างาน
  assert.equal(second.expiresAt.slice(0, 10), '2099-10-19');
  assert.equal((await getRepairLink(anon(db), first.token)).state, 'revoked');

  // ไม่ใส่วันนัดก็ได้ · รูปแบบผิดต้องฟ้อง
  assert.equal((await createRepairLink(as(db, 'boss'), 'ATG-PMK-AIR-2', 7, 'install')).apptDate, '');
  await assert.rejects(() => createRepairLink(as(db, 'boss'), 'ATG-PMK-AIR-2', 7, 'install', '5/10/2026'), /วันนัด/);
  // ช่าง (บัญชีผู้รับเหมา) สร้างลิงก์ / ใส่วันนัดเองไม่ได้
  await assert.rejects(() => createRepairLink(as(db, 'ctA'), 'ATG-PMK-AIR-2', 7, 'install', '2026-10-05'), /Subcontract/);
});

test('ลิงก์ใบติดตั้งสร้างได้เฉพาะเครื่องที่มีงานติดตั้งรอเอกสาร · ลิงก์ซ่อมกับลิงก์ติดตั้งไม่ยกเลิกกันเอง', async () => {
  const db = freshDb();
  await assert.rejects(() => createRepairLink(as(db, 'boss'), 'ATG-PMK-AIR-1', 7, 'install'), /ไม่มีงานติดตั้ง/);

  // เครื่อง 1 มีทั้งงานซ่อมที่รออยู่ และงานติดตั้ง (จำลอง) — ลิงก์สองแบบอยู่คู่กันได้
  db.prepare(`INSERT INTO history (ID, AirCode, Date, EventType, Detail, Note) VALUES
              ('CM2609-09','ATG-PMK-AIR-1','2026-09-04','ติดตั้ง','x',?)`).run(INSTALL_PENDING_NOTE);
  const rep = await createRepairLink(as(db, 'boss'), 'ATG-PMK-AIR-1', 7, 'repair');
  await createRepairLink(as(db, 'boss'), 'ATG-PMK-AIR-1', 7, 'install');
  assert.equal((await getRepairLink(anon(db), rep.token)).state, 'open', 'ลิงก์ซ่อมต้องไม่ถูกยกเลิกเพราะสร้างลิงก์ติดตั้ง');
});

/* ==================== ซ่อมเอง (Infrastructure — ไม่ออกใบซ่อม) ==================== */

test('ซ่อมเอง — เฉพาะ Infrastructure ต้องบอกว่าซ่อมอะไร · ปิดเคส ประวัติติดป้ายไม่มีเอกสาร · ยกเลิกการมอบหมายผู้รับเหมา', async () => {
  const db = freshDb();
  await assignJob(as(db, 'boss'), 'repair', 'ATG-PMK-AIR-1', 'CT001', '2026-09-05', '');
  const rec = { AirCode: 'ATG-PMK-AIR-1', Date: '2026-09-06', Detail: 'เปลี่ยนคาปาซิเตอร์', Technician: 'ช่างพื้นที่' };

  await assert.rejects(() => closeRepairSelf(as(db, 'r2'), rec), /Infrastructure|ผู้ดูแลระบบ|สิทธิ์/);
  await assert.rejects(() => closeRepairSelf(as(db, 'boss'), { ...rec, Detail: ' ' }), /ซ่อมอะไร/);

  await closeRepairSelf(as(db, 'boss'), rec);
  assert.equal(db.prepare("SELECT Status FROM air_units WHERE AirCode = 'ATG-PMK-AIR-1'").get().Status, 'ใช้งานปกติ');
  const h = db.prepare("SELECT * FROM history WHERE AirCode = 'ATG-PMK-AIR-1' AND EventType = 'ซ่อมแล้ว'").get();
  assert.equal(h.CaseID, 'IC2609-01', 'ผูกเลขเคสเดิม');
  assert.ok(h.Detail.includes('ซ่อมเอง (ไม่มีเอกสาร) — เปลี่ยนคาปาซิเตอร์'), h.Detail);
  assert.ok(h.Detail.startsWith('อาการที่แจ้งไว้: ไม่เย็น'), 'อาการที่แจ้งไว้ยังอยู่ในประวัติ');
  assert.equal(h.Technician, 'ช่างพื้นที่');
  assert.equal((await getMyJobs(as(db, 'ctA'))).length, 0, 'ผู้รับเหมาต้องไม่เห็นเป็นงานที่ตัวเองทำเสร็จ');

  // ปิดไปแล้ว ปิดซ้ำไม่ได้
  await assert.rejects(() => closeRepairSelf(as(db, 'boss'), rec), /ยังปิดงานซ่อมไม่ได้/);
});
