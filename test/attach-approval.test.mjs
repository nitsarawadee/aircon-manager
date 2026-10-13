/**
 * ใบแนบไฟล์ต้องรออนุมัติเหมือนใบที่กรอกในระบบ — ทั้งใบล้าง ใบซ่อม ใบติดตั้ง
 *
 * ============================================================================
 * กติกาที่เจ้าของงานกำหนด
 * ============================================================================
 * แนบไฟล์ (เขียนมือ/กรอก Excel มา) ต้องทำงานเหมือนกรอกในระบบทุกอย่าง ต่างกันแค่ตัวเอกสาร
 * - ปิดงานทันทีเหมือนกรอกในระบบ (ปิดรอบในแผน / ปิดเคสซ่อม · ใบติดตั้ง เครื่องใหม่รออนุมัติครบ)
 * - เข้าขั้นอนุมัติ 4 ขั้นทุกใบ
 * - อนุมัติครบแล้วไม่สร้าง PDF จากข้อมูลในระบบ เพราะตัวไฟล์ที่แนบคือเอกสาร
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { approveDoc } from '../src/modules/approval.js';
import { uploadNodeDocuments, getCleaningForms } from '../src/modules/cleaningform.js';
import {
  attachRepairDocument, getRepairForms, getRepairAttachments, getRepairAttachment, deleteRepairForm
} from '../src/modules/repairform.js';
import {
  attachInstallDocument, getInstallForms, getInstallAttachments, getInstallAttachment
} from '../src/modules/installform.js';
import { saveAirUnit } from '../src/modules/airlist.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  user.run('infra', 'อินฟรา ใหญ่', 'Admin', '', '', 1, 'x', '');
  user.run('staff', 'สตาฟ ภาคหนึ่ง', 'Staff', '1', '', 1, 'x', '');
  user.run('sup', 'ซุป ภาคหนึ่ง', 'Supervisor', '1', '', 1, 'x', '');
  user.run('sub', 'ช่างเอ บัญชี', 'Contractor', '', '', 1, 'x', 'CT001');
  db.prepare("INSERT INTO contractors (ID, Name, Active) VALUES ('CT001','บริษัท เอ',1)").run();
  const a = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU, Note, CleaningPricePerRound)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  a.run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'รอซ่อม', 'Daikin', 18000, 'ไม่เย็น', 450);
  a.run('AYA-WNI-AIR-2', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'ใช้งานปกติ', 'Carrier', 24000, '', 450);
  db.prepare('INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_Status, R1_Price) VALUES (?,?,?,?,?,?)')
    .run(2026, 'AYA-WNI-AIR-2', 'วังน้อย', 'AYA-WNI', 'รอดำเนินการ', 450);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };

/** ที่เก็บไฟล์แนบปลอม (หน่วยความจำ) */
function fakeAttachments() {
  const byDoc = new Map();
  return {
    save(docNo, date, files) {
      const list = byDoc.get(docNo) || [];
      const saved = files.map((f, i) => ({ name: (list.length + i + 1) + '-' + f.name, bytes: f.data.length, data: f.data }));
      byDoc.set(docNo, list.concat(saved));
      return saved.map(s => ({ name: s.name, bytes: s.bytes }));
    },
    list(docNo) { return (byDoc.get(docNo) || []).map(s => ({ name: s.name, bytes: s.bytes, mime: 'image/jpeg' })); },
    read(docNo, name) {
      const f = (byDoc.get(docNo) || []).find(x => x.name === name);
      return f ? { name: f.name, mime: 'image/jpeg', base64: f.data } : null;
    },
    removeAll(docNo) { byDoc.delete(docNo); }
  };
}

/** ที่เก็บ PDF ปลอม — จดว่ามีการสร้าง/เก็บ PDF หรือไม่ */
function fakeDocs() {
  const saved = [];
  return { saved, save(kind, docNo) { saved.push(kind + ':' + docNo); }, remove() {}, has() { return false; } };
}

/** ตัวแปลง PDF ปลอม */
const fakePdf = () => ({ baseUrl: '', async render() { return 'UERG'; } });

const FILE = [{ name: 'ใบงาน.jpg', mimeType: 'image/jpeg', data: 'QUJD' }];
const as = (db, u, parts) => { const c = new Ctx({}, state, db, parts); c.username = u; return c; };

test('แนบใบซ่อม: ปิดเคสทันทีเหมือนกรอกในระบบ และรออนุมัติขั้น 2', async () => {
  const db = freshDb();
  const parts = { attachments: fakeAttachments() };
  const res = await attachRepairDocument(as(db, 'staff', parts), {
    record: { AirCode: 'AYA-WNI-AIR-1', Date: '2026-10-14', TechnicianName: 'ช่างสมชาย', Cost: 1200 },
    files: FILE
  });

  const [form] = await getRepairForms(as(db, 'infra', parts));
  assert.equal(form.Source, 'attach');
  assert.equal(form.DocNo, res.docNo);
  assert.equal(form.Approval.next, 2, 'ต้องเข้าขั้นอนุมัติ เริ่มที่ขั้น 2');

  const unit = db.prepare("SELECT Status, Note FROM air_units WHERE AirCode = 'AYA-WNI-AIR-1'").get();
  assert.deepEqual([unit.Status, unit.Note], ['ใช้งานปกติ', ''], 'ปิดงานซ่อมทันที คืนสถานะเครื่อง');
  const h = db.prepare("SELECT EventType, Cost FROM history WHERE AirCode = 'AYA-WNI-AIR-1' ORDER BY rowid DESC").get();
  assert.deepEqual([h.EventType, h.Cost], ['ซ่อมแล้ว', 1200]);

  const files = await getRepairAttachments(as(db, 'sup', parts), form._row);
  assert.deepEqual(files.map(f => f.name), ['1-ใบงาน.jpg']);
  const file = await getRepairAttachment(as(db, 'sup', parts), { row: form._row, name: '1-ใบงาน.jpg' });
  assert.equal(file.base64, 'QUJD');
});

test('แนบใบซ่อม: อนุมัติครบ 4 ขั้นแล้วไม่สร้าง PDF จากข้อมูลในระบบ', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  // มีตัวแปลง PDF จริงจังพร้อม (ปลอม) — ถ้าไม่มี การเก็บ PDF จะข้ามเองอยู่แล้ว เทสต์จะผ่านแบบไม่ได้พิสูจน์อะไร
  const parts = { attachments: fakeAttachments(), docs, pdf: fakePdf() };
  await attachRepairDocument(as(db, 'staff', parts), {
    record: { AirCode: 'AYA-WNI-AIR-1', Date: '2026-10-14' }, files: FILE
  });
  const [form] = await getRepairForms(as(db, 'infra', parts));
  await approveDoc(as(db, 'staff', parts), 'repair', form.ID);
  await approveDoc(as(db, 'sup', parts), 'repair', form.ID);
  const { approval } = await approveDoc(as(db, 'infra', parts), 'repair', form.ID);
  assert.equal(approval.done, true);
  assert.deepEqual(docs.saved, [], 'ใบแนบไม่มีหน้าเอกสาร ห้ามสร้าง PDF ที่ช่องว่างเกือบทั้งใบมาเก็บ');
});

test('แนบใบซ่อม: ต้องมีไฟล์ · ลบใบแล้วไฟล์หายตาม', async () => {
  const db = freshDb();
  const attachments = fakeAttachments();
  await assert.rejects(() => attachRepairDocument(as(db, 'staff', { attachments }), {
    record: { AirCode: 'AYA-WNI-AIR-1', Date: '2026-10-14' }, files: []
  }), /ไฟล์/);

  const res = await attachRepairDocument(as(db, 'staff', { attachments }), {
    record: { AirCode: 'AYA-WNI-AIR-1', Date: '2026-10-14' }, files: FILE
  });
  const [form] = await getRepairForms(as(db, 'infra', { attachments }));
  await deleteRepairForm(as(db, 'infra', { attachments }), form._row, form.ID);
  assert.deepEqual(attachments.list(res.docNo), []);
});

test('แนบใบซ่อม: ผู้รับเหมาแนบได้เฉพาะงานที่มอบหมายให้ตัวเอง', async () => {
  const db = freshDb();
  await assert.rejects(() => attachRepairDocument(as(db, 'sub', { attachments: fakeAttachments() }), {
    record: { AirCode: 'AYA-WNI-AIR-1', Date: '2026-10-14' }, files: FILE
  }));
});

test('แนบใบติดตั้ง: เครื่องใหม่ยัง "รอติดตั้ง" จนอนุมัติครบ แล้วจึงใช้งานได้', async () => {
  const db = freshDb();
  const parts = { attachments: fakeAttachments(), docs: fakeDocs(), pdf: fakePdf() };
  await saveAirUnit(as(db, 'infra', parts), {
    AirCode: 'AYA-WNI-AIR-3', NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Region: '1', Province: 'อยุธยา',
    Status: 'ใช้งานปกติ', BTU: 36000, CleaningPricePerRound: 450
  });
  const statusOf = () => db.prepare("SELECT Status FROM air_units WHERE AirCode = 'AYA-WNI-AIR-3'").get().Status;
  assert.equal(statusOf(), 'รอติดตั้ง');

  await attachInstallDocument(as(db, 'staff', parts), {
    record: { AirCode1: 'AYA-WNI-AIR-3', Date: '2026-10-14', TechnicianName: 'ช่างสมชาย' }, files: FILE
  });
  const [form] = await getInstallForms(as(db, 'infra', parts));
  assert.equal(form.Source, 'attach');
  assert.equal(form.Approval.next, 2);
  assert.equal(statusOf(), 'รอติดตั้ง', 'ยังไม่อนุมัติครบ เครื่องต้องยังรออยู่ (เหมือนกรอกในระบบ)');

  const files = await getInstallAttachments(as(db, 'sup', parts), form._row);
  assert.equal(files.length, 1);
  assert.equal((await getInstallAttachment(as(db, 'sup', parts), { row: form._row, name: files[0].name })).base64, 'QUJD');

  await approveDoc(as(db, 'staff', parts), 'install', form.ID);
  await approveDoc(as(db, 'sup', parts), 'install', form.ID);
  await approveDoc(as(db, 'infra', parts), 'install', form.ID);
  assert.equal(statusOf(), 'ใช้งานปกติ');
  assert.deepEqual(parts.docs.saved, [], 'ใบแนบไม่สร้าง PDF');
});

test('แนบใบล้าง: ปิดรอบในแผนทันที และรออนุมัติขั้น 2 เหมือนใบที่กรอกในระบบ', async () => {
  const db = freshDb();
  const parts = { attachments: fakeAttachments() };
  await uploadNodeDocuments(as(db, 'staff', parts), {
    nodeName: 'วังน้อย', files: FILE,
    closeout: { year: 2026, round: 1, date: '2026-10-14', technician: 'ช่างสมชาย', units: [{ airCode: 'AYA-WNI-AIR-2', price: 450 }] }
  });
  const [form] = await getCleaningForms(as(db, 'infra', parts));
  assert.equal(form.Source, 'attach');
  assert.ok(form.Approval, 'ใบแนบใหม่ต้องมีขั้นอนุมัติ');
  assert.equal(form.Approval.next, 2);
  const plan = db.prepare("SELECT R1_Status FROM plans WHERE AirCode = 'AYA-WNI-AIR-2'").get();
  assert.equal(plan.R1_Status, 'ล้างเสร็จสิ้น');
});

test('แนบใบล้าง: ผู้รับเหมาเลือกเครื่องที่ไม่ได้มอบหมาย — บอกตรงๆ ว่าไม่ได้มอบหมาย ไม่ใช่ "ไม่อยู่ใน Node"', async () => {
  const db = freshDb();
  // CT001 ได้งานเฉพาะ AIR-2 · AIR-1 อยู่ Node เดียวกันแต่ไม่ได้มอบหมาย
  db.prepare("UPDATE plans SET R1_ContractorID = 'CT001' WHERE AirCode = 'AYA-WNI-AIR-2'").run();
  await assert.rejects(() => uploadNodeDocuments(as(db, 'sub', { attachments: fakeAttachments() }), {
    nodeName: 'วังน้อย', files: FILE,
    closeout: { year: 2026, round: 1, date: '2026-10-14', units: [{ airCode: 'AYA-WNI-AIR-1' }] }
  }), /AYA-WNI-AIR-1.*ไม่ได้มอบหมายให้บริษัทของคุณ/);
});
