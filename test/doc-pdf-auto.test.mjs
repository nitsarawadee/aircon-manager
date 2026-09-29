/**
 * ไฟล์ PDF ของเอกสาร ถูกเก็บไว้บนเซิร์ฟเวอร์ให้เองโดยไม่ต้องกดปุ่ม
 *
 * ============================================================================
 * ปัญหาที่ชุดนี้แก้
 * ============================================================================
 * เดิมเอกสารถูกประกอบสดทุกครั้งที่เปิด และไม่เก็บไฟล์ไว้เลย ใครอยากได้ไฟล์
 * ต้องกดปุ่ม PDF ทีละใบ ซึ่งคัดลอกไปเก็บหรือสำรองเป็นชุดไม่ได้
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - บันทึกฟอร์มแล้วต้องได้ไฟล์เก็บไว้ทันที ไม่ต้องรอใครกดปุ่ม
 *   (ตั้งแต่มีขั้นอนุมัติ: เก็บทันทีที่อนุมัติครบ — ใบที่ยังรออนุมัติไม่มีสำเนาบนเซิร์ฟเวอร์
 *    เทสต์กลไกเก็บไฟล์ที่เหลือจึงใช้ "ใบเก่า" ที่ไม่มีขั้นอนุมัติ ดู asLegacy)
 * - แนบหรือลบรูป ไฟล์ต้องถูกสร้างทับใหม่ ไม่งั้นไฟล์ที่เก็บไว้จะเก่ากว่าของจริง
 * - ลบเอกสาร ต้องลบไฟล์ตามไปด้วย ไม่ปล่อยค้างในดิสก์
 * - แปลงไฟล์ไม่ได้ ต้องไม่ทำให้การบันทึกที่ลงฐานข้อมูลแล้วกลายเป็นล้มเหลว
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import {
  saveCleaningForm, getCleaningForms, deleteCleaningForm,
  saveCleaningPhoto, deleteCleaningPhoto, settleDocPdfQueue
} from '../src/modules/cleaningform.js';
import { approveDoc } from '../src/modules/approval.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const u = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  u.run('staff', 'สตาฟ', 'Staff', '1', '', 1, 'x');
  u.run('sup', 'ซุปเปอร์', 'Supervisor', '1', '', 1, 'x');
  db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU, IndoorSN, OutdoorSN)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'ใช้งานปกติ', 'Daikin', 18000, 'IN-1', 'OUT-1');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };

/** ที่เก็บไฟล์ปลอม เก็บไว้ในหน่วยความจำ พร้อมบันทึกว่าถูกเรียกอะไรไปบ้าง */
function fakeDocs() {
  const files = new Map();
  const calls = [];
  return {
    files, calls,
    // อาร์กิวเมนต์แรกคือชนิดเอกสาร บอกที่เก็บว่าไฟล์ไปอยู่โฟลเดอร์ไหน
    save(kind, docNo, date, base64) { calls.push(['save', docNo, date]); files.set(docNo, { date, base64, kind }); return { rel: docNo, bytes: 1 }; },
    read(kind, docNo) { return files.has(docNo) ? files.get(docNo).base64 : null; },
    remove(kind, docNo) { calls.push(['remove', docNo]); files.delete(docNo); }
  };
}

/** ตัวแปลง PDF ปลอม — คืนเนื้อไฟล์ที่บอกได้ว่าหน้าเอกสารตอนนั้นมีอะไรอยู่ */
const fakePdf = (over = {}) => ({
  baseUrl: '',
  async render(html) { return Buffer.from('PDF:' + html.length).toString('base64'); },
  ...over
});

/** ที่เก็บรูปปลอม */
function fakePhotos() {
  const byDoc = new Map();
  return {
    // อาร์กิวเมนต์แรกคือชนิดเอกสาร บอกที่เก็บว่าไฟล์ไปอยู่โฟลเดอร์ไหน
    save(kind, docNo, slot, index, dataUrl) {
      if (!byDoc.has(docNo)) byDoc.set(docNo, {});
      byDoc.get(docNo)[slot + '-' + index] = dataUrl;
      return { name: 'x', bytes: dataUrl.length };
    },
    remove(kind, docNo, slot, index) { delete (byDoc.get(docNo) || {})[slot + '-' + index]; },
    removeAll(kind, docNo) { byDoc.delete(docNo); },
    readAll(kind, docNo) { return byDoc.get(docNo) || {}; }
  };
}

const ctxOf = (db, parts = {}, user = 'boss') => {
  const c = new Ctx({}, state, db, parts);
  c.username = user;
  return c;
};

/** อนุมัติครบทุกขั้น (Staff → Supervisor → Infrastructure) */
async function approveAll(db, parts, formId) {
  for (const u of ['staff', 'sup', 'boss']) await approveDoc(ctxOf(db, parts, u), 'cleaning', formId);
}

/** ทำให้ใบที่มีอยู่เป็น "ใบเก่า" ที่ไม่มีขั้นอนุมัติ — สำหรับเทสต์กลไกเก็บไฟล์ล้วนๆ */
const asLegacy = db => db.exec('DELETE FROM doc_approvals');

const saves = docs => docs.calls.filter(c => c[0] === 'save');

const oneUnit = (over = {}) => ({
  NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Region: '1', Province: 'อยุธยา',
  Date: '2026-09-15', PlanYear: 2026, PlanRound: 2,
  TechnicianName: 'ช่างสมชาย',
  AirCode1: 'AYA-WNI-AIR-1', Price1: 450, Unit1_Brand: 'Daikin',
  EquipmentCondition: 'สภาพเครื่องสมบูรณ์',
  Checklist: [{ no: 1, label: 'ตรวจเช็คสภาพทั่วไป', val1: 'ผ่าน', val2: '', note: '' }],
  ...over
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* ==================== เก็บไฟล์ให้เอง ==================== */

test('อนุมัติครบแล้ว ต้องได้ไฟล์ PDF เก็บไว้ทันทีโดยไม่ต้องกดปุ่ม — ระหว่างรอยังไม่เก็บ', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  const parts = { pdf: fakePdf(), docs };
  await saveCleaningForm(ctxOf(db, parts), oneUnit());

  const [form] = await getCleaningForms(ctxOf(db));
  assert.deepEqual(saves(docs), [], 'ยังรออนุมัติ ต้องยังไม่มีสำเนาบนเซิร์ฟเวอร์');

  await approveAll(db, parts, form.ID);
  assert.deepEqual(saves(docs), [['save', form.DocNo, '2026-09-15']]);
  assert.ok(docs.read('cleaning', form.DocNo), 'ต้องมีเนื้อไฟล์เก็บไว้จริง');
});

test('ไฟล์ต้องถูกเก็บตามวันที่ในเอกสาร ไม่ใช่วันที่กดบันทึก', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  const parts = { pdf: fakePdf(), docs };
  await saveCleaningForm(ctxOf(db, parts), oneUnit({ Date: '2026-08-13' }));
  const [form] = await getCleaningForms(ctxOf(db));
  await approveAll(db, parts, form.ID);

  assert.equal(saves(docs)[0][2], '2026-08-13');
});

test('แนบรูปแล้ว ไฟล์ที่เก็บไว้ต้องถูกสร้างทับใหม่ ไม่ใช่ค้างของเก่า', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  const photos = fakePhotos();
  const parts = { pdf: fakePdf(), docs, photos };

  await saveCleaningForm(ctxOf(db, parts), oneUnit());
  asLegacy(db);
  const [form] = await getCleaningForms(ctxOf(db));
  await saveCleaningPhoto(ctxOf(db, parts), { row: form._row, unitSlot: 1, index: 3, dataUrl: PNG });
  await deleteCleaningPhoto(ctxOf(db, parts), { row: form._row, unitSlot: 1, index: 3 });
  await settleDocPdfQueue();
  const before = docs.read('cleaning', form.DocNo);

  await saveCleaningPhoto(ctxOf(db, parts), { row: form._row, unitSlot: 1, index: 3, dataUrl: PNG });
  await settleDocPdfQueue();
  const after = docs.read('cleaning', form.DocNo);

  assert.notEqual(after, before, 'หน้าเอกสารมีรูปเพิ่มแล้ว ไฟล์ต้องไม่เหมือนเดิม');

  await deleteCleaningPhoto(ctxOf(db, parts), { row: form._row, unitSlot: 1, index: 3 });
  await settleDocPdfQueue();
  assert.equal(docs.read('cleaning', form.DocNo), before, 'ลบรูปแล้วต้องกลับไปเหมือนตอนยังไม่มีรูป');
});

test('แนบรูปรวดเดียวหลายใบ ต้องแปลงไฟล์แค่รอบเดียว ไม่ใช่รอบละรูป', async () => {
  // แปลงหนึ่งรอบใช้เวลาราว 2 วินาที (จับเวลาจริงด้วย Chrome ในเครื่อง)
  // ถ้าทำทุกครั้งที่แนบ ช่างจะรอรวมกันเกิน 40 วินาทีต่อเอกสารหนึ่งใบ
  // ทั้งที่ไฟล์รอบก่อนๆ ถูกทับทิ้งหมดอยู่ดี
  const db = freshDb();
  const docs = fakeDocs();
  const photos = fakePhotos();
  const parts = { pdf: fakePdf(), docs, photos };

  await saveCleaningForm(ctxOf(db, parts), oneUnit());
  asLegacy(db);
  const [form] = await getCleaningForms(ctxOf(db));
  docs.calls.length = 0;

  for (let i = 1; i <= 9; i++) {
    await saveCleaningPhoto(ctxOf(db, parts), { row: form._row, unitSlot: 1, index: i, dataUrl: PNG });
  }
  assert.equal(docs.calls.length, 0, 'ระหว่างแนบต้องยังไม่แปลงไฟล์เลย คนแนบจะได้ไม่ต้องรอ');

  await settleDocPdfQueue();
  assert.equal(docs.calls.length, 1, 'แนบ 9 รูป ต้องแปลงครั้งเดียว');
  assert.equal(Object.keys(photos.readAll('cleaning', form.DocNo)).length, 9, 'และรูปต้องครบทั้ง 9 ช่อง');
});

test('ลบเอกสารแล้ว ไฟล์ต้องไม่ถูกสร้างกลับมาจากงานที่ค้างอยู่', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  const photos = fakePhotos();
  const parts = { pdf: fakePdf(), docs, photos };

  await saveCleaningForm(ctxOf(db, parts), oneUnit());
  const [form] = await getCleaningForms(ctxOf(db));

  await saveCleaningPhoto(ctxOf(db, parts), { row: form._row, unitSlot: 1, index: 1, dataUrl: PNG });
  await deleteCleaningForm(ctxOf(db, parts), form._row, form.ID);
  await settleDocPdfQueue();

  assert.equal(docs.read('cleaning', form.DocNo), null, 'ไฟล์ต้องไม่ค้างอยู่ในดิสก์');
});

test('ลบเอกสาร ต้องลบไฟล์ที่เก็บไว้ตามไปด้วย', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  await saveCleaningForm(ctxOf(db, { pdf: fakePdf(), docs }), oneUnit());

  const [form] = await getCleaningForms(ctxOf(db));
  await deleteCleaningForm(ctxOf(db, { docs }), form._row, form.ID);

  assert.equal(docs.read('cleaning', form.DocNo), null, 'ไฟล์ต้องไม่ค้างอยู่ในดิสก์');
});

/* ==================== ล้มแล้วต้องไม่ลามไปถึงข้อมูล ==================== */

test('แปลงไฟล์ไม่สำเร็จ ต้องไม่ทำให้การบันทึกล้มเหลว', async () => {
  // ข้อมูลลงฐานข้อมูลไปแล้ว ถ้าโยน error ออกไป ผู้ใช้จะเข้าใจว่ายังไม่ได้บันทึก
  // แล้วกดซ้ำจนได้เอกสารซ้ำ ซึ่งแย่กว่าการไม่มีไฟล์สำเนา
  const db = freshDb();
  const docs = fakeDocs();
  const pdf = fakePdf({ async render() { throw new Error('เบราว์เซอร์ไม่ตอบ'); } });

  const res = await saveCleaningForm(ctxOf(db, { pdf, docs }), oneUnit());
  assert.equal(res.forms.length, 1, 'ข้อมูลต้องถูกบันทึกตามปกติ');
  assert.equal(saves(docs).length, 0, 'ไม่มีไฟล์ถูกเก็บ');
});

test('เขียนไฟล์ไม่ได้ (ดิสก์เต็ม) ก็ต้องไม่ทำให้การบันทึกล้มเหลว', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  docs.save = () => { throw new Error('ดิสก์เต็ม'); };

  const res = await saveCleaningForm(ctxOf(db, { pdf: fakePdf(), docs }), oneUnit());
  assert.equal(res.forms.length, 1);
});

test('เครื่องที่ไม่มีเบราว์เซอร์ ต้องยังบันทึกฟอร์มได้ แค่ไม่มีไฟล์สำเนา', async () => {
  const db = freshDb();
  const docs = fakeDocs();

  const res = await saveCleaningForm(ctxOf(db, { docs }), oneUnit());
  assert.equal(res.forms.length, 1);
  assert.equal(docs.calls.length, 0);
});
