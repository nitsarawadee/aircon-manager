/**
 * เอกสารติดตั้งที่ปริ้นออกมา ต้องตรงกับแบบฟอร์มควบคุม ITEL-FM-NE-006
 *
 * ============================================================================
 * สิ่งที่ล็อกไว้
 * ============================================================================
 * - 6 ส่วนตามแบบฟอร์ม และหน้ารูปเครื่องละหนึ่งหน้า
 * - **สองเครื่องต่อใบ** แบบเดียวกับใบล้าง เครื่องอยู่คอลัมน์ตามตำแหน่งจริงเสมอ
 * - รายการตรวจสอบ 18 ข้อ (ใบล้างมี 21 ข้อ ใบซ่อมมี 5 ข้อ — คนละชุดกัน)
 * - ส่วนที่ 4 เป็นผลตรวจรับ ผ่าน/ไม่ผ่าน แยกรายเครื่อง
 * - ช่องลงนามซ้ายล่างต้องเขียนว่า "ผู้ตรวจรับ" ไม่ใช่ "ผู้ตรวจสอบ"
 * - รหัสแบบฟอร์มมุมขวาล่างต้องเป็น NE-006 ไม่ใช่ NE-004 หรือ NE-005
 * - ไม่มีการดึงอะไรจากอินเทอร์เน็ตเลย
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildInstallDocHtml } from '../src/modules/install-doc.js';
import { INSTALL_CHECKLIST_ITEMS } from '../src/schema.js';

const baseForm = (over = {}) => ({
  DocNo: 'CM2609-40', ID: 'IF123', Date: '2026-09-24',
  NodeName: 'ชุมแพ', SiteCode: 'KKN-CPE', Province: 'ขอนแก่น', LocationType: 'Shop House',
  AirCode1: 'KKN-CPE-AIR-1', AirCode2: 'KKN-CPE-AIR-2',
  TimeStart: '09:00', TimeEnd: '12:00', TotalTime: '3',
  Unit1_Brand: 'Carrier', Unit1_BTU: '18000',
  Unit1_IndoorSerial: 'IN-001', Unit1_IndoorAsset: 'AST-001',
  Unit1_OutdoorSerial: 'OUT-001', Unit1_OutdoorAsset: 'AST-002',
  Unit2_Brand: 'Daikin', Unit2_BTU: '24000',
  Unit2_IndoorSerial: 'IN-002', Unit2_IndoorAsset: 'AST-003',
  Unit2_OutdoorSerial: 'OUT-002', Unit2_OutdoorAsset: 'AST-004',
  AcceptResult1: 'ผ่าน', AcceptResult2: 'ไม่ผ่าน',
  AdditionalNote: 'รอเจ้าของพื้นที่เดินไฟเพิ่ม',
  CompanyName: 'หจก. ทดสอบ', TechnicianName: 'ช่างสมชาย', SupervisorName: 'หัวหน้าภาค',
  ChecklistJSON: JSON.stringify([
    { no: 10, val1: '225', val2: '228' },
    { no: 13, val1: '120', val2: '118', note: 'เติมน้ำยาเพิ่ม' }
  ]),
  ...over
});

/** ข้อความล้วนของเอกสาร ใช้ตรวจว่ามีอะไรปรากฏบ้าง */
const textOf = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/**
 * ข้อความในช่องของเครื่องแต่ละตัว เรียงซ้ายไปขวา
 *
 * ค่าที่กรอกไว้ถูกห่อด้วย <span class="v"> อีกชั้นจาก val() จึงต้องถอดแท็ก
 * ข้างในออกก่อน ไม่งั้นจะอ่านได้เป็นช่องว่างทั้งที่มีข้อมูลอยู่
 */
const unitCellsOf = rowHtml =>
  [...rowHtml.matchAll(/<td class="ctr">([\s\S]*?)<\/td>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, '').trim());

/* ============================== โครงเอกสาร ============================== */

test('มีครบทั้ง 6 ส่วนตามแบบฟอร์ม', () => {
  const text = textOf(buildInstallDocHtml(baseForm()));

  for (const section of [
    'ส่วนที่ 1 : ข้อมูล Node',
    'ส่วนที่ 2 : ข้อมูลเครื่อง',
    'ส่วนที่ 3 : รายการตรวจสอบการติดตั้ง',
    'ส่วนที่ 4 : สรุปผลการติดตั้ง',
    'ส่วนที่ 5 : บันทึกเพิ่มเติม',
    'ส่วนที่ 6 : การลงนาม'
  ]) {
    assert.ok(text.includes(section), 'ขาด ' + section);
  }
});

test('รหัสแบบฟอร์มต้องเป็น NE-006 ไม่ใช่ของใบล้างหรือใบซ่อม', () => {
  const html = buildInstallDocHtml(baseForm());

  assert.ok(html.includes('ITEL-FM-NE-006'));
  assert.ok(!html.includes('ITEL-FM-NE-004'), 'หลุดรหัสใบล้างมา');
  assert.ok(!html.includes('ITEL-FM-NE-005'), 'หลุดรหัสใบซ่อมมา');
});

test('ติดตั้งสองเครื่อง ได้หน้ารูปสองหน้า', () => {
  const text = textOf(buildInstallDocHtml(baseForm()));

  assert.ok(text.includes('เครื่องที่ 1 (AIR 1)'));
  assert.ok(text.includes('เครื่องที่ 2 (AIR 2)'));
  assert.equal((text.match(/ภาพถ่ายประกอบการติดตั้ง/g) || []).length, 2);
});

test('ติดตั้งเครื่องเดียว ได้หน้ารูปหน้าเดียว', () => {
  const text = textOf(buildInstallDocHtml(baseForm({ AirCode2: '' })));

  assert.equal((text.match(/ภาพถ่ายประกอบการติดตั้ง/g) || []).length, 1);
});

test('ไม่มีเครื่องเลย ต้องฟ้อง ไม่ใช่ออกเอกสารเปล่า', () => {
  assert.throws(
    () => buildInstallDocHtml(baseForm({ AirCode1: '', AirCode2: '' })),
    /ยังไม่มีข้อมูลเครื่องปรับอากาศ/
  );
});

/* ============================== รายการตรวจสอบ ============================== */

test('รายการตรวจสอบต้องครบ 18 ข้อ ตามแบบฟอร์มติดตั้ง', () => {
  assert.equal(INSTALL_CHECKLIST_ITEMS.length, 18);

  const text = textOf(buildInstallDocHtml(baseForm()));
  for (const item of INSTALL_CHECKLIST_ITEMS) {
    assert.ok(text.includes(item.label), 'ขาดข้อ ' + item.no + ' ' + item.label);
  }
});

test('ลำดับข้อในเอกสารต้องเรียงเหมือนกระดาษ ไม่สลับ', () => {
  const text = textOf(buildInstallDocHtml(baseForm()));
  let at = -1;

  for (const item of INSTALL_CHECKLIST_ITEMS) {
    const found = text.indexOf(item.label);
    assert.ok(found > at, 'ข้อ ' + item.no + ' มาก่อนข้อที่ควรอยู่ข้างหน้า');
    at = found;
  }
});

test('ค่าที่วัดมาลงช่องของเครื่องที่ถูกตัว', () => {
  const html = buildInstallDocHtml(baseForm());
  const row = html.match(/<tr>\s*<td class="ctr">10<\/td>[\s\S]*?<\/tr>/);

  assert.ok(row, 'ไม่พบแถวข้อ 10');
  const cells = unitCellsOf(row[0]);
  assert.equal(cells.at(-2), '225', 'ค่าเครื่องที่ 1 ผิดช่อง');
  assert.equal(cells.at(-1), '228', 'ค่าเครื่องที่ 2 ผิดช่อง');
});

test('หมายเหตุของข้อไหน ไปอยู่แถวนั้น', () => {
  const html = buildInstallDocHtml(baseForm());
  const row = html.match(/<tr>\s*<td class="ctr">13<\/td>[\s\S]*?<\/tr>/);

  assert.ok(row[0].includes('เติมน้ำยาเพิ่ม'));
});

test('ข้อที่ยังไม่ได้กรอก ต้องเป็นช่องว่าง ไม่ใช่คำว่า undefined', () => {
  const text = textOf(buildInstallDocHtml(baseForm({ ChecklistJSON: '[]' })));

  assert.ok(!text.includes('undefined'));
  assert.ok(!text.includes('null'));
});

test('ChecklistJSON เสีย ต้องไม่ทำเอกสารพัง', () => {
  assert.doesNotThrow(() => buildInstallDocHtml(baseForm({ ChecklistJSON: 'ไม่ใช่ json' })));
  assert.doesNotThrow(() => buildInstallDocHtml(baseForm({ ChecklistJSON: '{"a":1}' })));
});

/* ============================== ผลตรวจรับ ============================== */

test('ผลตรวจรับติ๊กแยกรายเครื่อง เครื่องหนึ่งผ่าน อีกเครื่องไม่ผ่านได้', () => {
  const html = buildInstallDocHtml(baseForm());
  const rows = [...html.matchAll(/<tr>\s*<th colspan="3" class="lbl">ผลการตรวจรับงานติดตั้ง[\s\S]*?<\/tr>/g)];

  assert.equal(rows.length, 2, 'ต้องมีแถวผลตรวจรับสองเครื่อง');

  // เครื่องที่ 1 ติ๊ก "ผ่าน" — กล่องแรกต้องถูกติ๊ก กล่องที่สองไม่ติ๊ก
  const boxes1 = [...rows[0][0].matchAll(/<span class="box">([☑☐])<\/span>/g)].map(m => m[1]);
  assert.deepEqual(boxes1, ['☑', '☐'], 'เครื่องที่ 1 ต้องติ๊กช่อง "ผ่าน"');

  const boxes2 = [...rows[1][0].matchAll(/<span class="box">([☑☐])<\/span>/g)].map(m => m[1]);
  assert.deepEqual(boxes2, ['☐', '☑'], 'เครื่องที่ 2 ต้องติ๊กช่อง "ไม่ผ่าน"');
});

test('ยังไม่ได้เลือกผลตรวจรับ ต้องไม่ติ๊กช่องไหนเลย', () => {
  const html = buildInstallDocHtml(baseForm({ AcceptResult1: '', AcceptResult2: '' }));
  const rows = [...html.matchAll(/<tr>\s*<th colspan="3" class="lbl">ผลการตรวจรับงานติดตั้ง[\s\S]*?<\/tr>/g)];

  for (const row of rows) {
    assert.ok(!row[0].includes('☑'), 'ห้ามติ๊กให้เองเมื่อยังไม่ได้เลือก');
  }
});

test('ผลตรวจรับใช้คำว่า ผ่าน/ไม่ผ่าน ไม่ใช่คำของใบล้าง', () => {
  const text = textOf(buildInstallDocHtml(baseForm()));

  assert.ok(text.includes('ผลการตรวจรับงานติดตั้ง'));
  assert.ok(!text.includes('สภาพเครื่องสมบูรณ์'), 'หลุดคำของใบล้างมา');
});

/* ============================== ข้อมูลเครื่อง ============================== */

test('Serial และ Asset ของสองเครื่องไม่สลับกัน', () => {
  const html = buildInstallDocHtml(baseForm());

  const rowOf = label => {
    const m = html.match(new RegExp('<tr><th colspan="5" class="lbl">' + label + '<\\/th>([\\s\\S]*?)<\\/tr>'));
    return m ? unitCellsOf(m[1]) : [];
  };

  assert.deepEqual(rowOf('Indoor Serial No\\.').slice(0, 2), ['IN-001', 'IN-002']);
  assert.deepEqual(rowOf('Indoor Asset No\\.').slice(0, 2), ['AST-001', 'AST-003']);
  assert.deepEqual(rowOf('Outdoor Serial No\\.').slice(0, 2), ['OUT-001', 'OUT-002']);
  assert.deepEqual(rowOf('Outdoor Asset No\\.').slice(0, 2), ['AST-002', 'AST-004']);
});

test('ติดตั้งเฉพาะเครื่องที่ 2 ข้อมูลต้องอยู่คอลัมน์ขวา ไม่เลื่อนมาซ้าย', () => {
  const html = buildInstallDocHtml(baseForm({ AirCode1: '' }));
  const m = html.match(/<tr><th colspan="5" class="lbl">Indoor Serial No\.<\/th>([\s\S]*?)<\/tr>/);
  const cells = unitCellsOf(m[1]);

  assert.equal(cells[0], '', 'ช่องของเครื่องที่ 1 ต้องว่าง');
  assert.equal(cells[1], 'IN-002', 'ข้อมูลต้องอยู่ช่องของเครื่องที่ 2');
});

/* ============================== ลงนาม ============================== */

test('ช่องลงนามใช้คำของใบติดตั้ง ไม่ใช่ของใบล้าง', () => {
  const text = textOf(buildInstallDocHtml(baseForm()));

  assert.ok(text.includes('ผู้ติดตั้ง (บ./หจก.)'), 'ช่องซ้ายบนต้องเป็นผู้ติดตั้ง');
  assert.ok(text.includes('ผู้ตรวจรับ'), 'ช่องซ้ายล่างต้องเป็นผู้ตรวจรับ');
  assert.ok(!text.includes('ผู้ดำเนินการล้างแอร์'), 'หลุดคำของใบล้างมา');
});

test('ชื่อช่างกับหัวหน้างานถูกพิมพ์ลงไปให้ ไม่ต้องเขียนมือซ้ำ', () => {
  const text = textOf(buildInstallDocHtml(baseForm()));

  assert.ok(text.includes('ช่างสมชาย'));
  assert.ok(text.includes('หัวหน้าภาค'));
  assert.ok(text.includes('หจก. ทดสอบ'));
});

test('ช่องผู้ตรวจรับกับ Approve ยังเป็นเส้นประให้เซ็นจริง', () => {
  const html = buildInstallDocHtml(baseForm());
  const block = html.slice(html.indexOf('ผู้ตรวจรับ'));

  assert.ok(block.includes('………………………………'), 'ต้องเหลือเส้นประให้เซ็น');
});

/* ============================== วันที่และการพึ่งพา ============================== */

test('วันที่ทุกจุดเป็น วว/ดด/ปปปป', () => {
  const text = textOf(buildInstallDocHtml(baseForm()));

  assert.ok(text.includes('24/09/2026'));
  assert.ok(!text.includes('2026-09-24'), 'ห้ามเหลือรูปแบบ ปปปป-ดด-วว');
});

test('เอกสารไม่ดึงอะไรจากอินเทอร์เน็ต', () => {
  const html = buildInstallDocHtml(baseForm());

  assert.ok(!/https?:\/\//.test(html), 'พบที่อยู่ภายนอกในเอกสาร');
});

test('แถบปุ่มมีเฉพาะตอนเปิดดูบนจอ ไม่ติดไปในไฟล์ PDF', () => {
  assert.ok(buildInstallDocHtml(baseForm(), { toolbar: true }).includes('<button'));
  assert.ok(!buildInstallDocHtml(baseForm()).includes('<button'));
});
