/**
 * เอกสารหนึ่งใบ = การไปล้างหนึ่งครั้ง ครอบคลุมเครื่องในไซต์ได้ถึงสองตัว
 *
 * ============================================================================
 * ปัญหาที่ชุดนี้แก้
 * ============================================================================
 * เดิมทุกครั้งที่กดบันทึกจะได้ใบใหม่เสมอ ช่างที่กรอกเครื่องที่ 1 แล้วกรอก
 * เครื่องที่ 2 ต่อ จึงได้เอกสารสองใบ ทั้งที่ไปล้างครั้งเดียว และแบบฟอร์มกระดาษ
 * ออกแบบมาให้มีสองคอลัมน์อยู่ในใบเดียว
 *
 * ในข้อมูลจริงเกิดขึ้นแล้วหลายคู่ รวมถึงใบซ้ำที่เป็นเครื่องเดียวกันทั้งสองใบ
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - ครั้งเดียวกัน = ไซต์เดียวกัน + รอบเดียวกัน + วันเดียวกัน ครบทั้งสามอย่าง
 * - ช่องของเครื่องยึดจากเลขท้ายรหัส ไม่ใช่ลำดับที่กรอก
 * - กรอกเครื่องเดิมซ้ำ ต้องถูกปฏิเสธพร้อมบอกเลขใบเดิม ไม่ใช่งอกใบใหม่เงียบๆ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm, getCleaningForms, unitSlotOf } from '../src/modules/cleaningform.js';
import { getHistory } from '../src/modules/history.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');

  const add = db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU, IndoorSN, OutdoorSN)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
  add.run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'ใช้งานปกติ', 'Daikin', 18000, 'IN-1', 'OUT-1');
  add.run('AYA-WNI-AIR-2', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'ใช้งานปกติ', 'Carrier', 24000, 'IN-2', 'OUT-2');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => {
  const c = new Ctx({}, state, db);
  c.username = 'boss';
  return c;
};

/** ใบบันทึกของเครื่องหนึ่งตัว แบบที่หน้าแผนส่งมา (กรอกทีละเครื่อง) */
const oneUnit = (slot, over = {}) => ({
  NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Region: '1', Province: 'อยุธยา',
  Date: '2026-09-15', PlanYear: 2026, PlanRound: 2,
  TechnicianName: 'ช่างสมชาย',
  ['AirCode' + slot]: 'AYA-WNI-AIR-' + slot,
  ['Price' + slot]: 450,
  ['Unit' + slot + '_Brand']: slot === 1 ? 'Daikin' : 'Carrier',
  ['Unit' + slot + '_IndoorSerial']: 'IN-' + slot,
  Checklist: [
    { no: 1, label: 'ตรวจเช็คสภาพทั่วไป', val1: slot === 1 ? 'ผ่าน' : '', val2: slot === 2 ? 'ผ่าน' : '', note: '' },
    { no: 10, label: 'อุณหภูมิที่ตั้งไว้', val1: slot === 1 ? '25' : '', val2: slot === 2 ? '26' : '', note: '' }
  ],
  ...over
});

/* ==================== ช่องของเครื่อง ==================== */

test('ช่องของเครื่องมาจากเลขท้ายรหัส ไม่ใช่ลำดับที่กรอก', () => {
  assert.equal(unitSlotOf('AYA-WNI-AIR-1'), 1);
  assert.equal(unitSlotOf('AYA-WNI-AIR-2'), 2);
  assert.equal(unitSlotOf('BKK-MBI-AIR-2'), 2, 'ไซต์ที่เครื่องเรียงกลับด้านก็ต้องได้ช่องถูก');
  assert.equal(unitSlotOf(''), 1, 'ไม่มีรหัส ถือเป็นเครื่องที่ 1');
  assert.equal(unitSlotOf('NODE-AIR-X'), 1, 'รหัสที่ไม่ลงท้ายด้วยเลข ถือเป็นเครื่องที่ 1');
});

test('กรอกเครื่องที่ 2 ตัวเดียว ต้องลงช่องที่ 2 ไม่ใช่เลื่อนมาช่องแรก', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(2));

  const [form] = await getCleaningForms(ctxOf(db));
  assert.equal(form.AirCode1, '', 'ช่องที่ 1 ต้องว่าง');
  assert.equal(form.AirCode2, 'AYA-WNI-AIR-2');
});

test('หน้าเว็บส่งเครื่องที่ 2 มาผิดช่อง เซิร์ฟเวอร์ต้องย้ายให้ถูก', async () => {
  // กันกรณีลำดับเครื่องในรายการไม่ตรงกับเลขเครื่อง (มีจริงที่ไซต์ BKK-MBI)
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), {
    ...oneUnit(1),
    AirCode1: 'AYA-WNI-AIR-2', Unit1_Brand: 'Carrier', Price1: 500
  });

  const [form] = await getCleaningForms(ctxOf(db));
  assert.equal(form.AirCode1, '');
  assert.equal(form.AirCode2, 'AYA-WNI-AIR-2');
  assert.equal(Number(form.Price2), 500, 'ราคาต้องย้ายตามไปช่องเดียวกัน');
  assert.equal(form.Unit2_Brand, 'Carrier', 'ข้อมูลเครื่องต้องย้ายตามไปด้วย');
});

/* ==================== รวมเข้าใบเดิม ==================== */

test('กรอกสองเครื่องแยกกัน ต้องได้เอกสารใบเดียว', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1));
  await saveCleaningForm(ctxOf(db), oneUnit(2));

  const forms = await getCleaningForms(ctxOf(db));
  assert.equal(forms.length, 1, 'ต้องมีใบเดียว ไม่ใช่สองใบ');
  assert.equal(forms[0].AirCode1, 'AYA-WNI-AIR-1');
  assert.equal(forms[0].AirCode2, 'AYA-WNI-AIR-2');
});

test('รวมแล้วเลขที่เอกสารต้องเป็นเลขเดิม ไม่ออกเลขใหม่', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1));
  const first = (await getCleaningForms(ctxOf(db)))[0].DocNo;

  const res = await saveCleaningForm(ctxOf(db), oneUnit(2));
  assert.equal(res.mergedInto, first, 'ต้องบอกกลับไปว่ารวมเข้าใบไหน');
  assert.equal((await getCleaningForms(ctxOf(db)))[0].DocNo, first);
});

test('รวมแล้วราคารวมทั้งใบต้องเป็นผลรวมของสองเครื่อง', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1, { Price1: 450 }));
  await saveCleaningForm(ctxOf(db), oneUnit(2, { Price2: 500 }));

  const [form] = await getCleaningForms(ctxOf(db));
  assert.equal(Number(form.Price1), 450);
  assert.equal(Number(form.Price2), 500);
  assert.equal(Number(form.Price), 950);
});

test('รวมแล้วผลตรวจของทั้งสองเครื่องต้องอยู่ครบในใบเดียว', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1));
  await saveCleaningForm(ctxOf(db), oneUnit(2));

  const raw = db.prepare('SELECT ChecklistJSON FROM cleaning_forms').get().ChecklistJSON;
  const items = JSON.parse(raw);
  const temp = items.find(i => String(i.no) === '10');

  assert.equal(temp.val1, '25', 'ค่าของเครื่องที่ 1 ต้องยังอยู่');
  assert.equal(temp.val2, '26', 'ค่าของเครื่องที่ 2 ต้องถูกเติมเข้ามา');
});

test('รวมแล้วไฟล์เดิมต้องถูกล้าง เพราะมีข้อมูลแค่เครื่องเดียว', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1));
  db.prepare("UPDATE cleaning_forms SET PdfUrl = 'https://example.com/old.pdf'").run();

  const res = await saveCleaningForm(ctxOf(db), oneUnit(2));
  assert.equal((await getCleaningForms(ctxOf(db)))[0].PdfUrl, '');
  assert.equal(res.pdfUrl, '', 'ต้องไม่ส่งลิงก์ไฟล์ที่ข้อมูลไม่ครบกลับไป');
});

/* ==================== สิ่งที่ต้องไม่รวม ==================== */

test('กรอกเครื่องเดิมซ้ำ ต้องถูกปฏิเสธพร้อมบอกเลขใบเดิม', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1));
  const docNo = (await getCleaningForms(ctxOf(db)))[0].DocNo;

  await assert.rejects(
    () => saveCleaningForm(ctxOf(db), oneUnit(1)),
    new RegExp(docNo),
    'ข้อความต้องบอกเลขใบที่มีอยู่แล้ว'
  );
  assert.equal((await getCleaningForms(ctxOf(db))).length, 1, 'ต้องไม่งอกใบใหม่');
});

test('คนละวัน = ไปคนละครั้ง ต้องแยกใบ', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1, { Date: '2026-09-15' }));
  await saveCleaningForm(ctxOf(db), oneUnit(2, { Date: '2026-09-16' }));

  assert.equal((await getCleaningForms(ctxOf(db))).length, 2);
});

test('คนละรอบ ต้องแยกใบ', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1, { PlanRound: 1 }));
  await saveCleaningForm(ctxOf(db), oneUnit(2, { PlanRound: 2 }));

  assert.equal((await getCleaningForms(ctxOf(db))).length, 2);
});

test('ใบที่ไม่ได้ผูกกับรอบไหน ต้องไม่ถูกรวมเข้าด้วยกัน', async () => {
  // ไม่มีปี/รอบ = ไม่มีอะไรบอกได้ว่าเป็นการไปล้างครั้งเดียวกัน
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1, { PlanYear: '', PlanRound: '' }));
  await saveCleaningForm(ctxOf(db), oneUnit(2, { PlanYear: '', PlanRound: '' }));

  assert.equal((await getCleaningForms(ctxOf(db))).length, 2);
});

/* ==================== ประวัติและงานในแผน ==================== */

test('ประวัติลงรายเครื่อง ไม่ซ้ำ และไม่หายตอนรวมใบ', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1));
  await saveCleaningForm(ctxOf(db), oneUnit(2));

  const hist = await getHistory(ctxOf(db));
  assert.equal(hist.length, 2, 'สองเครื่อง = สองใบประวัติ');
  assert.deepEqual(
    hist.map(h => h.AirCode).sort(),
    ['AYA-WNI-AIR-1', 'AYA-WNI-AIR-2']
  );
  assert.ok(hist.every(h => h.EventType === 'ล้างแอร์'));
});

test('กรอกเครื่องเดียว ประวัติต้องมีใบเดียว ไม่ลงให้เครื่องที่ยังไม่ได้ล้าง', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1));

  const hist = await getHistory(ctxOf(db));
  assert.equal(hist.length, 1);
  assert.equal(hist[0].AirCode, 'AYA-WNI-AIR-1');
});
