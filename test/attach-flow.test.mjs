/**
 * แนบเอกสารที่ช่างเขียนด้วยมือ — เก็บไฟล์ไว้ในเครื่อง ไม่ได้ส่งออกไปไหน
 *
 * ============================================================================
 * ปัญหาที่ชุดนี้แก้
 * ============================================================================
 * เดิมไฟล์ถูกส่งไปเก็บบน Google Drive แล้วจำแค่ลิงก์ไว้ ซึ่งเป็นสิ่งสุดท้าย
 * ที่ทำให้ระบบยังต้องออกเน็ต
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - แนบไฟล์ต้องได้แถวในตารางเอกสารเสมอ แม้ไม่ได้ติ๊กปิดงานในแผน
 *   ไม่งั้นไฟล์จะอยู่ในดิสก์โดยไม่มีใครเปิดได้ (เดิมยังเดินดูโฟลเดอร์ใน Drive ได้)
 * - ไฟล์ผูกกับเลขที่เอกสารของแถวนั้น ลบเอกสารแล้วไฟล์ต้องหายตาม
 * - เปิดไฟล์ได้เฉพาะคนที่มีสิทธิ์ในภูมิภาคของเอกสารใบนั้น
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import {
  uploadNodeDocuments, getCleaningForms, deleteCleaningForm,
  getCleaningAttachments, getCleaningAttachment
} from '../src/modules/cleaningform.js';
import { getHistory } from '../src/modules/history.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  const addUser = db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  );
  addUser.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  addUser.run('north', 'ดูแลภาคเหนือ', 'RegionAdmin', '9', JSON.stringify({ cleaningform: 'edit' }), 1, 'x');

  db.prepare(
    'INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU, IndoorSN, OutdoorSN)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'ใช้งานปกติ', 'Daikin', 18000, 'IN-1', 'OUT-1');

  db.prepare('INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R2_PlanDate, R2_Status) VALUES (?,?,?,?,?,?)')
    .run(2026, 'AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '2026-09-10', 'รอดำเนินการ');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };

/** ที่เก็บไฟล์แนบปลอม เก็บในหน่วยความจำ */
function fakeAttachments() {
  const byDoc = new Map();
  return {
    save(docNo, date, files) {
      const list = byDoc.get(docNo) || [];
      const saved = files.map((f, i) => ({
        name: (list.length + i + 1) + '-' + f.name,
        bytes: f.data.length,
        data: f.data
      }));
      byDoc.set(docNo, list.concat(saved));
      return saved.map(s => ({ name: s.name, bytes: s.bytes }));
    },
    list(docNo) {
      return (byDoc.get(docNo) || []).map(s => ({ name: s.name, bytes: s.bytes, mime: 'image/jpeg' }));
    },
    read(docNo, name) {
      const f = (byDoc.get(docNo) || []).find(x => x.name === name);
      return f ? { name: f.name, mime: 'image/jpeg', base64: f.data } : null;
    },
    removeAll(docNo) { byDoc.delete(docNo); }
  };
}

const ctxOf = (db, parts = {}) => {
  const c = new Ctx({}, state, db, null, null, null, parts.attachments || null);
  c.username = parts.user || 'boss';
  return c;
};

const b64 = text => Buffer.from(text).toString('base64');
const payloadOf = (over = {}) => ({
  nodeName: 'วังน้อย',
  files: [{ name: 'ใบงาน.jpg', mimeType: 'image/jpeg', data: b64('รูปใบงาน') }],
  ...over
});

const closeout = {
  year: 2026, round: 2, date: '2026-09-15',
  technician: 'ช่างสมชาย', condition: 'สภาพเครื่องสมบูรณ์',
  units: [{ airCode: 'AYA-WNI-AIR-1', price: 450 }]
};

/* ==================== แนบแล้วต้องเปิดเจอ ==================== */

test('แนบไฟล์แล้วต้องได้แถวในตารางเอกสาร และไฟล์ผูกกับเลขที่ใบนั้น', async () => {
  const db = freshDb();
  const attachments = fakeAttachments();

  const res = await uploadNodeDocuments(ctxOf(db, { attachments }), payloadOf({ closeout }));
  const [form] = await getCleaningForms(ctxOf(db, { attachments }));

  assert.equal(res.count, 1);
  assert.equal(res.docNo, form.DocNo, 'ไฟล์ต้องผูกกับเลขที่ของแถวที่เพิ่งสร้าง');
  assert.equal(form.Source, 'attach');
  assert.deepEqual(attachments.list(form.DocNo).map(f => f.name), ['1-ใบงาน.jpg']);
});

test('ไม่ได้ติ๊กปิดงานในแผน ก็ต้องได้แถวในตารางเอกสารอยู่ดี', async () => {
  // ไม่งั้นไฟล์จะอยู่ในดิสก์โดยไม่มีอะไรอ้างถึง แล้วไม่มีใครเปิดได้อีกเลย
  const db = freshDb();
  const attachments = fakeAttachments();

  const res = await uploadNodeDocuments(ctxOf(db, { attachments }), payloadOf());
  const forms = await getCleaningForms(ctxOf(db, { attachments }));

  assert.equal(forms.length, 1, 'ต้องมีแถวให้เปิดไฟล์ได้');
  assert.equal(res.planClosed, 0, 'แต่ต้องไม่ไปปิดงานในแผน');
  assert.equal((await getHistory(ctxOf(db))).length, 0, 'และต้องไม่ลงประวัติ');
  assert.equal(attachments.list(forms[0].DocNo).length, 1);
});

test('ติ๊กปิดงานในแผน ต้องปิดรอบของเครื่องนั้นให้ด้วย', async () => {
  const db = freshDb();
  const res = await uploadNodeDocuments(ctxOf(db, { attachments: fakeAttachments() }), payloadOf({ closeout }));

  assert.equal(res.planClosed, 1);
  const row = db.prepare('SELECT R2_Status s FROM plans WHERE AirCode = ?').get('AYA-WNI-AIR-1');
  assert.equal(row.s, 'ล้างเสร็จสิ้น');
});

test('ไม่เก็บลิงก์ไปที่ไหนอีกแล้ว ช่องไฟล์ของแถวต้องว่าง', async () => {
  const db = freshDb();
  await uploadNodeDocuments(ctxOf(db, { attachments: fakeAttachments() }), payloadOf({ closeout }));

  const [form] = await getCleaningForms(ctxOf(db));
  assert.equal(form.PdfUrl, '', 'ไฟล์อยู่ในเครื่องแล้ว ไม่มีลิงก์ให้เก็บ');
});

/* ==================== อ่านไฟล์กลับมา ==================== */

test('เปิดไฟล์ที่แนบไว้ได้ ผ่านคำสั่งที่ตรวจสิทธิ์แล้ว', async () => {
  const db = freshDb();
  const attachments = fakeAttachments();
  await uploadNodeDocuments(ctxOf(db, { attachments }), payloadOf({ closeout }));

  const [form] = await getCleaningForms(ctxOf(db, { attachments }));
  const list = await getCleaningAttachments(ctxOf(db, { attachments }), form._row);
  assert.deepEqual(list.map(f => f.name), ['1-ใบงาน.jpg']);

  const file = await getCleaningAttachment(ctxOf(db, { attachments }), { row: form._row, name: list[0].name });
  assert.equal(Buffer.from(file.base64, 'base64').toString(), 'รูปใบงาน');
});

test('ขอไฟล์ที่ไม่มีอยู่ ต้องบอกให้รู้ ไม่ใช่คืนค่าว่าง', async () => {
  const db = freshDb();
  const attachments = fakeAttachments();
  await uploadNodeDocuments(ctxOf(db, { attachments }), payloadOf({ closeout }));
  const [form] = await getCleaningForms(ctxOf(db, { attachments }));

  await assert.rejects(
    () => getCleaningAttachment(ctxOf(db, { attachments }), { row: form._row, name: 'ไม่มีไฟล์นี้.jpg' }),
    /ไม่พบไฟล์แนบ/
  );
});

test('คนที่ไม่มีสิทธิ์ในภูมิภาคนั้น ต้องเปิดไฟล์ไม่ได้', async () => {
  // การกันสิทธิ์ต้องอยู่ที่เซิร์ฟเวอร์ ไม่ใช่แค่ซ่อนปุ่มในหน้าเว็บ
  const db = freshDb();
  const attachments = fakeAttachments();
  await uploadNodeDocuments(ctxOf(db, { attachments }), payloadOf({ closeout }));
  const [form] = await getCleaningForms(ctxOf(db, { attachments }));

  const outsider = ctxOf(db, { attachments, user: 'north' });
  await assert.rejects(() => getCleaningAttachment(outsider, { row: form._row, name: '1-ใบงาน.jpg' }));
  await assert.rejects(() => getCleaningAttachments(outsider, form._row));
});

/* ==================== ลบ ==================== */

test('ลบเอกสาร ต้องลบไฟล์แนบตามไปด้วย', async () => {
  const db = freshDb();
  const attachments = fakeAttachments();
  await uploadNodeDocuments(ctxOf(db, { attachments }), payloadOf({ closeout }));

  const [form] = await getCleaningForms(ctxOf(db, { attachments }));
  await deleteCleaningForm(ctxOf(db, { attachments }), form._row);

  assert.deepEqual(attachments.list(form.DocNo), [], 'ไฟล์ต้องไม่ค้างอยู่ในดิสก์');
});

/* ==================== ไม่มีที่เก็บไฟล์ ==================== */

test('เครื่องที่เก็บไฟล์ไม่ได้ ต้องบอกให้รู้ ไม่ใช่รับไฟล์แล้วทิ้ง', async () => {
  const db = freshDb();
  await assert.rejects(
    () => uploadNodeDocuments(ctxOf(db), payloadOf({ closeout })),
    /เก็บไฟล์แนบไม่ได้/
  );
  assert.equal((await getCleaningForms(ctxOf(db))).length, 0, 'ต้องไม่มีแถวค้างไว้โดยไม่มีไฟล์');
});
