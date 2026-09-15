/**
 * เอกสารที่ปริ้นออกมา ต้องตรงกับแบบฟอร์มกระดาษและกับสิ่งที่ล้างจริง
 *
 * ============================================================================
 * สิ่งที่ล็อกไว้
 * ============================================================================
 * - ล้างสองเครื่อง = สองคอลัมน์ในใบเดียว (ตามแบบฟอร์ม Rev2026)
 * - ล้างเครื่องเดียว = คอลัมน์เดียว และหัวคอลัมน์บอกเลขเครื่องจริงเสมอ
 *   ล้างเฉพาะเครื่องที่ 2 ต้องขึ้นว่า "เครื่องที่ 2" ไม่ใช่เลื่อนมาเป็นคอลัมน์แรก
 * - ไม่มีการดึงอะไรจากอินเทอร์เน็ตเลย ทั้งฟอนต์ รูป และสคริปต์
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildCleaningDocHtml } from '../src/modules/cleaning-doc.js';
import { CLEANING_CHECKLIST_ITEMS } from '../src/schema.js';

const baseForm = (over = {}) => ({
  DocNo: 'PM2609-07', ID: 'CF123', Date: '2026-09-15',
  NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Province: 'อยุธยา', LocationType: 'Container',
  TimeStart: '09:00', TimeEnd: '12:00', TotalTime: '03:00',
  AirCode1: 'AYA-WNI-AIR-1', Unit1_Brand: 'Daikin', Unit1_BTU: '18000',
  Unit1_IndoorSerial: 'IN-111', Unit1_IndoorAsset: 'A-111',
  Unit1_OutdoorSerial: 'OUT-111', Unit1_OutdoorAsset: 'A-222',
  AirCode2: 'AYA-WNI-AIR-2', Unit2_Brand: 'Carrier', Unit2_BTU: '24000',
  Unit2_IndoorSerial: 'IN-222', Unit2_IndoorAsset: 'A-333',
  Unit2_OutdoorSerial: 'OUT-222', Unit2_OutdoorAsset: 'A-444',
  Price1: 450, Price2: 500,
  EquipmentCondition: 'สภาพเครื่องสมบูรณ์',
  CompanyName: 'หจก. ทดสอบ', TechnicianName: 'ช่างสมชาย', SupervisorName: 'หัวหน้าภาค',
  AdditionalNote: 'ไม่มีข้อสังเกตเพิ่มเติม',
  ChecklistJSON: JSON.stringify([
    { no: 1, val1: 'ปกติ', val2: 'ปกติ', note: '' },
    { no: 13, val1: '68', val2: '70', note: 'วัดตอนเที่ยง' }
  ]),
  ...over
});

/** ลบเครื่องที่ระบุออกจากใบ เพื่อจำลองว่าล้างแค่ตัวเดียว */
function withoutUnit(slot) {
  const f = baseForm();
  for (const k of Object.keys(f)) {
    if (k === 'AirCode' + slot || k.startsWith('Unit' + slot + '_') || k === 'Price' + slot) f[k] = '';
  }
  return f;
}

/* ==================== จำนวนคอลัมน์ ==================== */

test('ล้างสองเครื่อง ได้สองคอลัมน์ในใบเดียว', () => {
  const html = buildCleaningDocHtml(baseForm());
  assert.ok(html.includes('เครื่องที่ 1 (Unit 1)'));
  assert.ok(html.includes('เครื่องที่ 2 (Unit 2)'));
  assert.ok(html.includes('AYA-WNI-AIR-1') && html.includes('AYA-WNI-AIR-2'));
});

test('ล้างเฉพาะเครื่องที่ 2 หัวคอลัมน์ต้องบอกว่าเครื่องที่ 2', () => {
  // หัวใจของเรื่องนี้ — ห้ามเลื่อนมาเป็นคอลัมน์แรกแล้วขึ้นว่าเครื่องที่ 1
  const html = buildCleaningDocHtml(withoutUnit(1));
  assert.ok(html.includes('เครื่องที่ 2 (Unit 2)'), 'ต้องมีหัวคอลัมน์เครื่องที่ 2');
  assert.ok(!html.includes('เครื่องที่ 1 (Unit 1)'), 'ต้องไม่มีคอลัมน์เครื่องที่ 1');
  assert.ok(html.includes('AYA-WNI-AIR-2') && !html.includes('AYA-WNI-AIR-1'));
});

test('ล้างเฉพาะเครื่องที่ 1 ได้คอลัมน์เดียวเหมือนกัน', () => {
  const html = buildCleaningDocHtml(withoutUnit(2));
  assert.ok(html.includes('เครื่องที่ 1 (Unit 1)'));
  assert.ok(!html.includes('เครื่องที่ 2 (Unit 2)'));
});

test('ใบที่ไม่มีเครื่องเลย ต้องบอกให้รู้ ไม่ใช่ออกใบเปล่า', () => {
  assert.throws(
    () => buildCleaningDocHtml(baseForm({ AirCode1: '', AirCode2: '' })),
    /ยังไม่มีข้อมูลเครื่อง/
  );
});

/* ==================== เนื้อหาตามแบบฟอร์ม ==================== */

test('มีครบทั้ง 6 ส่วนตามแบบฟอร์ม', () => {
  const html = buildCleaningDocHtml(baseForm());
  for (const s of ['ส่วนที่ 1 : ข้อมูล Node', 'ส่วนที่ 2 : ข้อมูลเครื่อง',
                   'ส่วนที่ 3 : รายการบำรุงรักษาและตรวจสอบ', 'ส่วนที่ 4 : สรุปผล',
                   'ส่วนที่ 5 : บันทึกเพิ่มเติม', 'ส่วนที่ 6 : การลงนาม']) {
    assert.ok(html.includes(s), 'ขาด ' + s);
  }
});

test('รายการตรวจสอบต้องครบทุกข้อ ไม่ตกหล่น', () => {
  const html = buildCleaningDocHtml(baseForm());
  assert.equal(CLEANING_CHECKLIST_ITEMS.length, 21, 'แบบฟอร์มมี 21 ข้อ');
  for (const item of CLEANING_CHECKLIST_ITEMS) {
    assert.ok(html.includes(item.label), 'ขาดข้อ ' + item.no + ': ' + item.label);
  }
});

test('ค่าที่วัดได้ต้องลงคอลัมน์ของเครื่องที่ถูกต้อง', () => {
  const html = buildCleaningDocHtml(baseForm());
  // ข้อ 13 บันทึกไว้ 68 (เครื่อง 1) และ 70 (เครื่อง 2)
  assert.ok(html.includes('>68<') && html.includes('>70<'));
  assert.ok(html.includes('วัดตอนเที่ยง'), 'หมายเหตุของข้อนั้นต้องติดมาด้วย');
});

test('ช่องลงนามครบ 4 ช่องตาม Rev2026', () => {
  const html = buildCleaningDocHtml(baseForm());
  for (const s of ['ผู้ดำเนินการล้างแอร์', 'ผู้ควบคุมงาน (Interlink)',
                   'ผู้ตรวจสอบ', 'Approve (Infra)']) {
    assert.ok(html.includes(s), 'ขาดช่องลงนาม ' + s);
  }
});

test('เลขที่เอกสารขึ้นบนหัวกระดาษ และใช้ ID เดิมถ้ายังไม่มีเลขใหม่', () => {
  assert.ok(buildCleaningDocHtml(baseForm()).includes('PM2609-07'));
  assert.ok(buildCleaningDocHtml(baseForm({ DocNo: '' })).includes('CF123'));
});

/* ==================== ความปลอดภัยและการทำงานแบบไม่มีเน็ต ==================== */

test('ข้อความที่คนพิมพ์เอง ต้องถูกแปลงก่อนวางลงหน้าเอกสาร', () => {
  const html = buildCleaningDocHtml(baseForm({
    NodeName: '<script>alert(1)</script>',
    AdditionalNote: 'ท่อ "เก่า" & ผุ'
  }));
  assert.ok(!html.includes('<script>alert(1)</script>'), 'ต้องไม่หลุดเป็นแท็กจริง');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&quot;เก่า&quot;') && html.includes('&amp;'));
});

test('เอกสารต้องไม่ดึงอะไรจากอินเทอร์เน็ตเลย', () => {
  // ทั้งใบต้องเปิดได้ในวงแลนที่ไม่มีเน็ต ฟอนต์ก็เสิร์ฟจากเครื่องเราเอง
  const html = buildCleaningDocHtml(baseForm(), { fontHref: '/vendor/fonts.css' });
  assert.ok(!/https?:\/\//.test(html.replace(/R410A|R22|R32/g, '')), 'พบที่อยู่ภายนอกในเอกสาร');
  assert.ok(html.includes('/vendor/fonts.css'));
});

test('ไม่ระบุฟอนต์ ต้องยังสร้างเอกสารได้ (ใช้ฟอนต์ของเครื่อง)', () => {
  const html = buildCleaningDocHtml(baseForm());
  assert.ok(!html.includes('<link rel="stylesheet"'));
  assert.ok(html.includes('Sarabun'), 'ยังต้องขอฟอนต์ไทยก่อนเป็นอันดับแรก');
});

test('สั่งพิมพ์เป็นกระดาษ A4 แนวตั้ง', () => {
  assert.ok(buildCleaningDocHtml(baseForm()).includes('size: A4 portrait'));
});
