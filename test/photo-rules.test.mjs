/**
 * กติกาเรื่องรูปถ่ายประกอบเอกสาร
 *
 * ============================================================================
 * ที่มา
 * ============================================================================
 * เอกสาร 25 ใบในระบบ มีรูปแนบอยู่แค่ 4 ใบ และทั้ง 4 ใบนั้นแนบครบ 9/9
 * ไม่มีใบไหนอยู่ระหว่างกลาง แปลว่าคนไม่ได้ "แนบไปครึ่งเดียวแล้วลืม"
 * แต่เป็น "แนบก็แนบครบ ไม่แนบก็ไม่แนบเลย"
 *
 * เจ้าของงานจึงให้บังคับแนบตอนบันทึก แต่รูป 3 ช่องสุดท้าย (กระแส แรงดันไฟ
 * แรงดันน้ำยา) ต้องใช้เครื่องมือวัด ถ้าวันนั้นช่างไม่ได้เอาไป ก็ถ่ายย้อนหลังไม่ได้
 * บังคับให้ครบทั้ง 9 = คนที่ลืมบันทึกเอกสารไม่ได้เลยสักใบ ทั้งที่ล้างไปแล้วจริง
 *
 * ทางออกคือให้ขาดได้ แต่ต้องบอกเหตุผล แล้วเหตุผลไปขึ้นบนเอกสารให้คนอ่านเห็น
 * ว่ากรอบที่ว่างอยู่นั้นว่างเพราะอะไร ไม่ใช่ว่างเฉยๆ โดยไม่มีใครรู้
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - เหตุผลที่รูปวัดค่าไม่ครบ ต้องถูกเก็บลงฐานข้อมูล และขึ้นบนหน้ารูปของเอกสาร
 * - กรอกครบไม่ต้องใส่เหตุผล เอกสารต้องไม่มีบรรทัดนั้นโผล่มา
 * - รวมใบ (กรอกทีละเครื่องแล้วรวมเป็นใบเดียว) เหตุผลต้องไม่หายไป
 * - อ่านรูปของเอกสารมาแก้ได้ แม้ปิดงานในแผนไปแล้ว
 * - ใบที่เป็นเอกสารแนบ (ถ่ายฟอร์มที่เขียนมือมา) แก้รูปแบบนี้ไม่ได้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { CLEANFORM_HEADERS } from '../src/schema.js';
import { Ctx } from '../src/context.js';
import { buildCleaningDocHtml } from '../src/modules/cleaning-doc.js';
import { saveCleaningForm, getCleaningPhotos, saveCleaningPhoto } from '../src/modules/cleaningform.js';

/* ==================== เหตุผลต้องขึ้นบนเอกสาร ==================== */

const docForm = (over = {}) => ({
  DocNo: 'PM2609-07', ID: 'CF123', Date: '2026-09-15',
  NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Province: 'อยุธยา',
  AirCode1: 'AYA-WNI-AIR-1', Unit1_Brand: 'Daikin', Unit1_BTU: '18000',
  Price1: 450, EquipmentCondition: 'สภาพเครื่องสมบูรณ์',
  TechnicianName: 'ช่างสมชาย', ChecklistJSON: '[]',
  ...over
});

test('เหตุผลที่รูปวัดค่าไม่ครบ ต้องขึ้นบนหน้ารูปของเอกสาร', () => {
  // คนที่เปิดเอกสารมาดูต้องรู้ว่ากรอบที่ว่างอยู่ ว่างเพราะอะไร
  const html = buildCleaningDocHtml(docForm({ MissingPhotoNote: 'ไม่ได้นำเกจวัดน้ำยาไปหน้างาน' }), {});

  assert.ok(html.includes('ไม่ได้นำเกจวัดน้ำยาไปหน้างาน'), 'ต้องเห็นเหตุผลบนเอกสาร');
  assert.ok(html.includes('เหตุที่รูปวัดค่าไม่ครบ'), 'ต้องมีหัวข้อกำกับให้รู้ว่านี่คืออะไร');
});

test('ไม่มีเหตุผล เอกสารต้องไม่มีบรรทัดนั้นโผล่มา', () => {
  const html = buildCleaningDocHtml(docForm({}), {});
  assert.ok(!html.includes('เหตุที่รูปวัดค่าไม่ครบ'));
});

test('เหตุผลเป็นช่องว่างล้วน ต้องนับว่าไม่มี', () => {
  const html = buildCleaningDocHtml(docForm({ MissingPhotoNote: '   ' }), {});
  assert.ok(!html.includes('เหตุที่รูปวัดค่าไม่ครบ'));
});

test('เหตุผลที่มีอักขระพิเศษ ต้องไม่หลุดเป็น HTML', () => {
  const html = buildCleaningDocHtml(docForm({ MissingPhotoNote: '<b>ลืม</b> เกจ & มิเตอร์' }), {});
  assert.ok(!html.includes('<b>ลืม</b>'), 'แท็กต้องถูกแปลงเป็นตัวหนังสือ');
  assert.ok(html.includes('&lt;b&gt;'), 'ต้องเห็นข้อความตามที่พิมพ์มา');
});

test('เหตุผลต้องขึ้นบนหน้ารูปของทุกเครื่องในใบ', () => {
  // ใบที่ครอบสองเครื่องมีหน้ารูปสองหน้า ทั้งสองหน้าต้องบอกเหตุผลเหมือนกัน
  // ไม่งั้นคนที่เปิดมาเจอหน้าเครื่องที่ 2 ก่อน จะเห็นกรอบว่างโดยไม่มีคำอธิบาย
  const html = buildCleaningDocHtml(docForm({
    AirCode2: 'AYA-WNI-AIR-2', Unit2_Brand: 'Carrier', Price2: 500,
    MissingPhotoNote: 'มิเตอร์เสีย'
  }), {});

  assert.equal((html.match(/เหตุที่รูปวัดค่าไม่ครบ/g) || []).length, 2);
});

/* ==================== คอลัมน์ใหม่ต้องถูกเก็บจริง ==================== */

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');

  for (const code of ['AYA-WNI-AIR-1', 'AYA-WNI-AIR-2']) {
    db.prepare(
      'INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status)' +
      ' VALUES (?,?,?,?,?,?,?)'
    ).run(code, 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'Container', 'ใช้งานปกติ');
  }
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };

/** ที่เก็บรูปปลอม เก็บไว้ในหน่วยความจำ ไม่แตะดิสก์ */
function fakePhotoStore() {
  const files = new Map();
  const key = (doc, slot, i) => doc + '|' + slot + '-' + i;
  return {
    save(doc, slot, i, dataUrl) { files.set(key(doc, slot, i), dataUrl); return { bytes: 10 }; },
    remove(doc, slot, i) { files.delete(key(doc, slot, i)); },
    removeAll(doc) { for (const k of [...files.keys()]) if (k.startsWith(doc + '|')) files.delete(k); },
    readAll(doc) {
      const out = {};
      for (const [k, v] of files) if (k.startsWith(doc + '|')) out[k.split('|')[1]] = v;
      return out;
    }
  };
}

function ctxOf(db, services = {}) {
  const c = new Ctx({}, state, db, services);
  c.username = 'boss';
  return c;
}

const formPayload = (over = {}) => ({
  NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Region: '1', Province: 'อยุธยา',
  Date: '2026-09-15', AirCode1: 'AYA-WNI-AIR-1', Price1: 450, Unit1_Brand: 'Daikin',
  TechnicianName: 'ช่างสมชาย', EquipmentCondition: 'สภาพเครื่องสมบูรณ์',
  Checklist: [],
  ...over
});

test('คอลัมน์เหตุผลต้องอยู่ท้ายสุดของรายการคอลัมน์', () => {
  // ระบบเติมคอลัมน์ที่ขาดด้วยการต่อท้าย ถ้าวางไว้กลาง ข้อมูลจะลงผิดช่องทั้งตาราง
  assert.equal(CLEANFORM_HEADERS[CLEANFORM_HEADERS.length - 1], 'MissingPhotoNote');
});

test('เหตุผลที่กรอกมา ต้องถูกเก็บลงฐานข้อมูล', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), formPayload({ MissingPhotoNote: 'ไม่ได้นำแคลมป์มิเตอร์ไป' }));

  const row = db.prepare('SELECT MissingPhotoNote n FROM cleaning_forms').get();
  assert.equal(row.n, 'ไม่ได้นำแคลมป์มิเตอร์ไป');
});

test('กรอกทีละเครื่องแล้วรวมเป็นใบเดียว เหตุผลต้องไม่หายไป', async () => {
  // ใบที่รวมกันเขียนทับเฉพาะช่องของเครื่องที่เพิ่งกรอก ช่องส่วนกลางต้องถูกเติมให้ด้วย
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), formPayload({ PlanYear: 2026, PlanRound: 2 }));
  await saveCleaningForm(ctxOf(db), formPayload({
    AirCode1: '', AirCode2: 'AYA-WNI-AIR-2', Price1: '', Price2: 500,
    PlanYear: 2026, PlanRound: 2, MissingPhotoNote: 'เกจวัดน้ำยาเสีย'
  }));

  const rows = db.prepare('SELECT MissingPhotoNote n FROM cleaning_forms').all();
  assert.equal(rows.length, 1, 'ต้องรวมเป็นใบเดียว');
  assert.equal(rows[0].n, 'เกจวัดน้ำยาเสีย');
});

test('ใบที่รวมกันมีเหตุผลอยู่แล้ว ต้องไม่ถูกทับด้วยของใบทีหลัง', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), formPayload({ PlanYear: 2026, PlanRound: 2, MissingPhotoNote: 'เหตุผลเดิม' }));
  await saveCleaningForm(ctxOf(db), formPayload({
    AirCode1: '', AirCode2: 'AYA-WNI-AIR-2', Price1: '', Price2: 500,
    PlanYear: 2026, PlanRound: 2, MissingPhotoNote: 'เหตุผลใหม่'
  }));

  assert.equal(db.prepare('SELECT MissingPhotoNote n FROM cleaning_forms').get().n, 'เหตุผลเดิม');
});

/* ==================== อ่านรูปมาแก้ได้ ==================== */

test('อ่านรูปของเอกสารที่บันทึกไปแล้วได้ พร้อมตัวรูปจริง', async () => {
  // หน้าแก้รูปต้องเห็นรูปเดิมก่อน ถึงจะรู้ว่าใบไหนเบลอ ใบไหนถ่ายผิดเครื่อง
  const db = freshDb();
  const photos = fakePhotoStore();
  const ctx = () => ctxOf(db, { photos });

  const res = await saveCleaningForm(ctx(), formPayload());
  const row = res.forms[0]._row;

  const png = 'data:image/png;base64,iVBORw0KGgo=';
  await saveCleaningPhoto(ctx(), { row, unitSlot: 1, index: 3, dataUrl: png });

  const got = await getCleaningPhotos(ctx(), row);
  assert.equal(got.docNo, res.docNo);
  assert.deepEqual(got.photos, { '1-3': png }, 'ต้องได้ตัวรูปกลับมา ไม่ใช่แค่ชื่อช่อง');
});

test('ปิดงานในแผนไปแล้ว ก็ยังแก้รูปได้', async () => {
  // รูปไม่ได้เป็นฐานของการปิดงาน (วันที่ ราคา ช่าง สถานะ ประวัติ) จึงแก้ได้ไม่กระทบ
  const db = freshDb();
  db.prepare(
    'INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R2_PlanDate, R2_Status) VALUES (?,?,?,?,?,?)'
  ).run(2026, 'AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '2026-09-10', 'รอดำเนินการ');

  const photos = fakePhotoStore();
  const ctx = () => ctxOf(db, { photos });

  const res = await saveCleaningForm(ctx(), formPayload({ PlanYear: 2026, PlanRound: 2 }));
  assert.equal(res.planClosed, 1, 'ต้องปิดงานให้แล้ว');

  const row = res.forms[0]._row;
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  await saveCleaningPhoto(ctx(), { row, unitSlot: 1, index: 1, dataUrl: png });

  const got = await getCleaningPhotos(ctx(), row);
  assert.deepEqual(Object.keys(got.photos), ['1-1']);

  // สถานะในแผนต้องไม่ขยับเพราะการแก้รูป
  const s = db.prepare("SELECT R2_Status s FROM plans WHERE AirCode = ?").get('AYA-WNI-AIR-1').s;
  assert.equal(s, 'ล้างเสร็จสิ้น');
});

test('เอกสารที่แนบเข้ามา แก้รูปแบบนี้ไม่ได้', async () => {
  // ใบแนบคือรูปถ่ายฟอร์มที่เขียนด้วยมือ ไม่มีกรอบรูป 9 ช่องให้แก้
  const db = freshDb();
  const photos = fakePhotoStore();

  await saveCleaningForm(ctxOf(db, { photos }), formPayload());
  db.prepare("UPDATE cleaning_forms SET Source = 'attach'").run();

  const row = db.prepare('SELECT rowid r FROM cleaning_forms').get().r + 1;
  await assert.rejects(
    () => getCleaningPhotos(ctxOf(db, { photos }), row),
    /เอกสารที่แนบเข้ามา/
  );
});

test('ไม่มีที่เก็บรูป ต้องคืนค่าว่าง ไม่ใช่พัง', async () => {
  // ฝั่งที่ไม่มีดิสก์ (Cloudflare) ไม่มี ctx.photos
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), formPayload());
  assert.deepEqual(await getCleaningPhotos(ctxOf(db), 2), {});
});
