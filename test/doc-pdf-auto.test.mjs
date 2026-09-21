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
  saveCleaningPhoto, deleteCleaningPhoto
} from '../src/modules/cleaningform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
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
    save(docNo, date, base64) { calls.push(['save', docNo, date]); files.set(docNo, { date, base64 }); return { rel: docNo, bytes: 1 }; },
    read(docNo) { return files.has(docNo) ? files.get(docNo).base64 : null; },
    remove(docNo) { calls.push(['remove', docNo]); files.delete(docNo); }
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
    save(docNo, slot, index, dataUrl) {
      if (!byDoc.has(docNo)) byDoc.set(docNo, {});
      byDoc.get(docNo)[slot + '-' + index] = dataUrl;
      return { name: 'x', bytes: dataUrl.length };
    },
    remove(docNo, slot, index) { delete (byDoc.get(docNo) || {})[slot + '-' + index]; },
    removeAll(docNo) { byDoc.delete(docNo); },
    readAll(docNo) { return byDoc.get(docNo) || {}; }
  };
}

const ctxOf = (db, parts = {}) => {
  const c = new Ctx({}, state, db, parts);
  c.username = 'boss';
  return c;
};

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

test('บันทึกฟอร์มแล้ว ต้องได้ไฟล์ PDF เก็บไว้ทันทีโดยไม่ต้องกดปุ่ม', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  await saveCleaningForm(ctxOf(db, { pdf: fakePdf(), docs }), oneUnit());

  const [form] = await getCleaningForms(ctxOf(db));
  assert.deepEqual(docs.calls, [['save', form.DocNo, '2026-09-15']]);
  assert.ok(docs.read(form.DocNo), 'ต้องมีเนื้อไฟล์เก็บไว้จริง');
});

test('ไฟล์ต้องถูกเก็บตามวันที่ในเอกสาร ไม่ใช่วันที่กดบันทึก', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  await saveCleaningForm(ctxOf(db, { pdf: fakePdf(), docs }), oneUnit({ Date: '2026-08-13' }));

  assert.equal(docs.calls[0][2], '2026-08-13');
});

test('แนบรูปแล้ว ไฟล์ที่เก็บไว้ต้องถูกสร้างทับใหม่ ไม่ใช่ค้างของเก่า', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  const photos = fakePhotos();
  const parts = { pdf: fakePdf(), docs, photos };

  await saveCleaningForm(ctxOf(db, parts), oneUnit());
  const [form] = await getCleaningForms(ctxOf(db));
  const before = docs.read(form.DocNo);

  await saveCleaningPhoto(ctxOf(db, parts), { row: form._row, unitSlot: 1, index: 3, dataUrl: PNG });
  const after = docs.read(form.DocNo);

  assert.notEqual(after, before, 'หน้าเอกสารมีรูปเพิ่มแล้ว ไฟล์ต้องไม่เหมือนเดิม');

  await deleteCleaningPhoto(ctxOf(db, parts), { row: form._row, unitSlot: 1, index: 3 });
  assert.equal(docs.read(form.DocNo), before, 'ลบรูปแล้วต้องกลับไปเหมือนตอนยังไม่มีรูป');
});

test('ลบเอกสาร ต้องลบไฟล์ที่เก็บไว้ตามไปด้วย', async () => {
  const db = freshDb();
  const docs = fakeDocs();
  await saveCleaningForm(ctxOf(db, { pdf: fakePdf(), docs }), oneUnit());

  const [form] = await getCleaningForms(ctxOf(db));
  await deleteCleaningForm(ctxOf(db, { docs }), form._row);

  assert.equal(docs.read(form.DocNo), null, 'ไฟล์ต้องไม่ค้างอยู่ในดิสก์');
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
  assert.equal(docs.calls.length, 0, 'ไม่มีไฟล์ถูกเก็บ');
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
