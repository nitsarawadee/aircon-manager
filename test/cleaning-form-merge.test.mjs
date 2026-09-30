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

test('รวมแล้วผลประเมินของแต่ละเครื่องต้องอยู่คนละช่อง ไม่ทับกัน', async () => {
  // ไปล้างสองตัว เจอตัวหนึ่งไม่สมบูรณ์ — ต้องบันทึกได้ตามจริง
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1, { EquipmentCondition: 'สภาพเครื่องสมบูรณ์' }));
  await saveCleaningForm(ctxOf(db), oneUnit(2, { EquipmentCondition2: 'สภาพเครื่องควรปรับปรุง' }));

  const [form] = await getCleaningForms(ctxOf(db));
  assert.equal(form.EquipmentCondition, 'สภาพเครื่องสมบูรณ์');
  assert.equal(form.EquipmentCondition2, 'สภาพเครื่องควรปรับปรุง');
});

test('ผลประเมินต้องย้ายช่องตามเครื่อง เหมือนราคาและข้อมูลเครื่อง', async () => {
  // หน้าเว็บส่งเครื่องที่ 2 มาในช่องที่ 1 (ไซต์ที่เครื่องเรียงกลับด้าน)
  // ผลประเมินต้องตามไปช่องที่ 2 ด้วย ไม่ค้างอยู่ช่องเดิม
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), {
    ...oneUnit(1),
    AirCode1: 'AYA-WNI-AIR-2',
    EquipmentCondition: 'สภาพเครื่องควรปรับปรุง'
  });

  const [form] = await getCleaningForms(ctxOf(db));
  assert.equal(form.EquipmentCondition, '', 'ช่องของเครื่องที่ 1 ต้องว่าง');
  assert.equal(form.EquipmentCondition2, 'สภาพเครื่องควรปรับปรุง');
});

test('รวมแล้วไฟล์เดิมต้องถูกล้าง เพราะมีข้อมูลแค่เครื่องเดียว', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1));
  db.prepare("UPDATE cleaning_forms SET PdfUrl = 'https://example.com/old.pdf'").run();

  await saveCleaningForm(ctxOf(db), oneUnit(2));
  assert.equal((await getCleaningForms(ctxOf(db)))[0].PdfUrl, '');
});

/* ==================== เลขที่รายเครื่อง ==================== */

test('กรอกสองเครื่องพร้อมกัน ต้องได้เลขคนละเลข ไม่ใช่เลขเดียวกัน', async () => {
  // ตัวออกเลขนับจากแถวที่มีอยู่จริง ยังไม่เห็นเลขที่เพิ่งออกในรอบเดียวกัน
  // ถ้าไม่ส่งกลับเข้าไปเอง เครื่องทั้งสองตัวจะได้เลขเดียวกัน
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), {
    ...oneUnit(1),
    AirCode2: 'AYA-WNI-AIR-2', Price2: 500, Unit2_Brand: 'Carrier'
  });

  const [form] = await getCleaningForms(ctxOf(db));
  assert.ok(form.DocNo, 'เครื่องที่ 1 ต้องมีเลข');
  assert.ok(form.DocNo2, 'เครื่องที่ 2 ต้องมีเลข');
  assert.notEqual(form.DocNo, form.DocNo2, 'สองเครื่องต้องไม่ได้เลขเดียวกัน');
});

test('กรอกทีละเครื่องแล้วรวมใบ เครื่องที่เติมทีหลังก็ต้องได้เลขของตัวเอง', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1));

  const before = (await getCleaningForms(ctxOf(db)))[0];
  assert.ok(before.DocNo);
  assert.equal(before.DocNo2, '', 'ตอนมีเครื่องเดียว ยังไม่ต้องมีเลขที่สอง');

  await saveCleaningForm(ctxOf(db), oneUnit(2));

  const after = (await getCleaningForms(ctxOf(db)))[0];
  assert.equal(after.DocNo, before.DocNo, 'เลขของเครื่องแรกต้องไม่เปลี่ยน');
  assert.ok(after.DocNo2, 'เครื่องที่เติมทีหลังต้องได้เลข');
  assert.notEqual(after.DocNo2, after.DocNo);
});

test('เลขที่ออกให้เครื่อง ต้องไม่ไปชนกับเลขของใบประวัติ', async () => {
  // เอกสารกับประวัติใช้ชุดเลขเดียวกัน ถ้าตัวออกเลขไม่นับช่องที่สองด้วย
  // รายการถัดไปจะได้เลขซ้ำกับเลขของเครื่องที่ 2
  // (ประวัติของการล้างใช้เลขเดียวกับเอกสารของเครื่องนั้น — เลขเดียว = การล้างครั้งเดียว)
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), {
    ...oneUnit(1),
    AirCode2: 'AYA-WNI-AIR-2', Price2: 500, Unit2_Brand: 'Carrier'
  });
  // ใบถัดไป (คนละวัน = คนละใบ) ต้องได้เลขใหม่ ไม่ซ้ำกับเลขของเครื่องที่ 2 ในใบแรก
  await saveCleaningForm(ctxOf(db), oneUnit(1, { Date: '2026-09-20' }));

  const forms = await getCleaningForms(ctxOf(db));
  const hist = await getHistory(ctxOf(db));

  const docNos = forms.flatMap(f => [f.DocNo, f.DocNo2]).filter(Boolean);
  assert.equal(new Set(docNos).size, docNos.length, 'เลขเอกสารซ้ำกัน: ' + docNos.join(', '));
  const ids = hist.map(h => h.ID);
  assert.equal(new Set(ids).size, ids.length, 'เลขประวัติซ้ำกัน: ' + ids.join(', '));
  assert.deepEqual([...ids].sort(), [...docNos].sort(), 'ประวัติแต่ละแถวต้องถือเลขเอกสารของเครื่องนั้น');
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

test('ประวัติของแต่ละเครื่อง ต้องได้ผลประเมินของตัวเอง', async () => {
  // ประวัติเป็นของรายเครื่อง ถ้าหยิบผลของใบมาใส่ทุกใบ
  // เครื่องที่ยังดีอยู่จะมีประวัติว่าควรปรับปรุง ทั้งที่ไม่ใช่
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1, { EquipmentCondition: 'สภาพเครื่องสมบูรณ์' }));
  await saveCleaningForm(ctxOf(db), oneUnit(2, { EquipmentCondition2: 'สภาพเครื่องควรปรับปรุง' }));

  const hist = await getHistory(ctxOf(db));
  const detailOf = code => hist.find(h => h.AirCode === code).Detail;

  assert.match(detailOf('AYA-WNI-AIR-1'), /ผลประเมิน: สภาพเครื่องสมบูรณ์/);
  assert.match(detailOf('AYA-WNI-AIR-2'), /ผลประเมิน: สภาพเครื่องควรปรับปรุง/);
});

test('กรอกสองเครื่องในครั้งเดียว ประวัติก็ต้องแยกผลประเมินของแต่ละเครื่อง', async () => {
  // กรอกจากแท็บฟอร์มโดยตรง ใบเดียวมีสองเครื่องตั้งแต่แรก ไม่ได้ผ่านการรวมใบ
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), {
    ...oneUnit(1, { EquipmentCondition: 'สภาพเครื่องสมบูรณ์' }),
    AirCode2: 'AYA-WNI-AIR-2', Price2: 500, Unit2_Brand: 'Carrier',
    EquipmentCondition2: 'สภาพเครื่องควรปรับปรุง'
  });

  const hist = await getHistory(ctxOf(db));
  const detailOf = code => hist.find(h => h.AirCode === code).Detail;

  assert.equal(hist.length, 2);
  assert.match(detailOf('AYA-WNI-AIR-1'), /ผลประเมิน: สภาพเครื่องสมบูรณ์/);
  assert.match(detailOf('AYA-WNI-AIR-2'), /ผลประเมิน: สภาพเครื่องควรปรับปรุง/);
});

/** ตั้งแผนปี 2026 รอบ 2 ให้ทั้งสองเครื่อง เพื่อดูว่าปิดงานถูกแถว */
function addPlans(db) {
  const add = db.prepare(
    'INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R2_PlanDate, R2_Status) VALUES (?,?,?,?,?,?)'
  );
  add.run(2026, 'AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '2026-09-10', 'รอดำเนินการ');
  add.run(2026, 'AYA-WNI-AIR-2', 'วังน้อย', 'AYA-WNI', '2026-09-10', 'รอดำเนินการ');
}

// node:sqlite คืนแถวเป็นอ็อบเจกต์ไร้ต้นแบบ ซึ่ง deepEqual ถือว่าไม่เท่ากับอ็อบเจกต์ธรรมดา
const planRound2 = db => db.prepare(
  'SELECT AirCode, R2_Status, R2_Price FROM plans WHERE Year = 2026 ORDER BY AirCode'
).all().map(r => ({ AirCode: r.AirCode, R2_Status: r.R2_Status, R2_Price: r.R2_Price }));

test('เอกสารรวมเป็นใบเดียว แต่งานในแผนต้องปิดแยกทีละเครื่อง', async () => {
  // เอกสารเป็นของ "การไปล้างครั้งนั้น" แต่แผนเป็นของ "เครื่อง"
  // กรอกเครื่องที่ 1 แล้วเครื่องที่ 2 ถูกปิดตามไปด้วย = แผนบอกว่าล้างแล้วทั้งที่ยังไม่ได้ล้าง
  const db = freshDb();
  addPlans(db);

  const first = await saveCleaningForm(ctxOf(db), oneUnit(1));
  assert.equal(first.planClosed, 1, 'ปิดได้ครั้งละหนึ่งเครื่อง');
  assert.deepEqual(planRound2(db), [
    { AirCode: 'AYA-WNI-AIR-1', R2_Status: 'ล้างเสร็จสิ้น', R2_Price: 450 },
    { AirCode: 'AYA-WNI-AIR-2', R2_Status: 'รอดำเนินการ', R2_Price: null }
  ]);

  const second = await saveCleaningForm(ctxOf(db), oneUnit(2));
  assert.equal(second.planClosed, 1);
  assert.deepEqual(planRound2(db), [
    { AirCode: 'AYA-WNI-AIR-1', R2_Status: 'ล้างเสร็จสิ้น', R2_Price: 450 },
    { AirCode: 'AYA-WNI-AIR-2', R2_Status: 'ล้างเสร็จสิ้น', R2_Price: 450 }
  ], 'ราคาต้องลงแถวของเครื่องตัวเอง ไม่ใช่ยอดรวมทั้งใบ');
});

test('กรอกเครื่องเดียว ประวัติต้องมีใบเดียว ไม่ลงให้เครื่องที่ยังไม่ได้ล้าง', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), oneUnit(1));

  const hist = await getHistory(ctxOf(db));
  assert.equal(hist.length, 1);
  assert.equal(hist[0].AirCode, 'AYA-WNI-AIR-1');
});
