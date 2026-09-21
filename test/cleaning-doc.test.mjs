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
  assert.ok(html.includes('เครื่องที่ 1 (AIR 1)'));
  assert.ok(html.includes('เครื่องที่ 2 (AIR 2)'));
  // เอกสารควบคุมไม่มีช่องรหัสเครื่อง ระบุตัวเครื่องด้วย Serial/Asset แทน
  assert.ok(html.includes('IN-111') && html.includes('IN-222'), 'ต้องมี Serial ของทั้งสองเครื่อง');
});

test('ล้างเฉพาะเครื่องที่ 2 หัวคอลัมน์ต้องบอกว่าเครื่องที่ 2', () => {
  // หัวใจของเรื่องนี้ — ห้ามเลื่อนมาเป็นคอลัมน์แรกแล้วขึ้นว่าเครื่องที่ 1
  const html = buildCleaningDocHtml(withoutUnit(1));
  assert.ok(html.includes('เครื่องที่ 2 (AIR 2)'), 'ต้องมีหัวคอลัมน์เครื่องที่ 2');
  assert.ok(!html.includes('เครื่องที่ 1 (AIR 1)'), 'ต้องไม่มีคอลัมน์เครื่องที่ 1');
  assert.ok(html.includes('IN-222'), 'ต้องมี Serial ของเครื่องที่ 2');
  assert.ok(!html.includes('IN-111'), 'ต้องไม่มีข้อมูลของเครื่องที่ 1 หลุดมา');
});

test('ล้างเฉพาะเครื่องที่ 1 ได้คอลัมน์เดียวเหมือนกัน', () => {
  const html = buildCleaningDocHtml(withoutUnit(2));
  assert.ok(html.includes('เครื่องที่ 1 (AIR 1)'));
  assert.ok(!html.includes('เครื่องที่ 2 (AIR 2)'));
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

/* ==================== ผลประเมินรายเครื่อง ==================== */

/** ช่องที่ถูกติ๊กในแถวสรุปผลของเครื่องที่ระบุ */
function tickedFor(html, slot) {
  const row = html.split('<tr>')
    .find(r => r.includes('ผลการล้างและตรวจสอบ') && r.includes('เครื่องที่ ' + slot));
  assert.ok(row, 'ไม่พบแถวสรุปผลของเครื่องที่ ' + slot);

  const out = [];
  for (const part of row.split('<span class="box">')) {
    if (part[0] !== '☑') continue;
    out.push(part.split('</span>')[1].split('<')[0].trim());
  }
  return out;
}

test('สองเครื่องผลประเมินต่างกัน ต้องติ๊กคนละช่อง', () => {
  // หัวใจของเรื่องนี้ — ไปล้างสองตัว เจอตัวหนึ่งไม่สมบูรณ์ เป็นเรื่องที่เกิดได้จริง
  // เอกสารนี้เอาไปเซ็นกัน เอาผลของเครื่องหนึ่งไปติ๊กแทนอีกเครื่องไม่ได้
  const html = buildCleaningDocHtml(baseForm({
    EquipmentCondition: 'สภาพเครื่องสมบูรณ์',
    EquipmentCondition2: 'สภาพเครื่องควรปรับปรุง'
  }));

  assert.deepEqual(tickedFor(html, 1), ['สภาพเครื่องสมบูรณ์']);
  assert.deepEqual(tickedFor(html, 2), ['สภาพเครื่องควรปรับปรุง']);
});

test('ผลประเมินของเครื่องที่ 2 ที่ยังไม่ได้กรอก ต้องเว้นว่าง ไม่ยืมของเครื่องแรกมาติ๊ก', () => {
  const html = buildCleaningDocHtml(baseForm({
    EquipmentCondition: 'สภาพเครื่องสมบูรณ์',
    EquipmentCondition2: ''
  }));

  assert.deepEqual(tickedFor(html, 1), ['สภาพเครื่องสมบูรณ์']);
  assert.deepEqual(tickedFor(html, 2), [], 'ยังไม่ได้กรอก ต้องไม่มีช่องไหนถูกติ๊ก');
});

test('ล้างเฉพาะเครื่องที่ 2 ผลประเมินต้องอ่านจากช่องของเครื่องที่ 2', () => {
  const f = withoutUnit(1);
  f.EquipmentCondition = '';
  f.EquipmentCondition2 = 'สภาพเครื่องควรปรับปรุง';

  const html = buildCleaningDocHtml(f);
  assert.deepEqual(tickedFor(html, 2), ['สภาพเครื่องควรปรับปรุง']);
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

/* ==================== หน้าตาต้องตรงกับแบบฟอร์มจริง ==================== */

test('ใช้สีเดียวกับเอกสารควบคุมตัวจริง', () => {
  // สีพวกนี้อ่านมาจาก styles.xml ของไฟล์ฟอร์มจริง ไม่ได้เลือกเอง
  const html = buildCleaningDocHtml(baseForm());
  assert.ok(html.includes('#ECECEC'), 'แถบหัวข้อส่วนและป้ายต้องเป็นเทา #ECECEC');
  assert.ok(html.includes('#7F7F7F'), 'ตัวอักษรคอลัมน์หน่วย/เกณฑ์ต้องเป็นเทา #7F7F7F');
});

test('ตัวหนังสือในเอกสารเป็นสีดำทั้งหมด', () => {
  // ไฟล์ Excel ตั้งค่าที่กรอกไว้เป็นสีน้ำเงิน แต่ผู้ใช้เลือกใช้สีดำ
  // เหลือสีเทาได้เฉพาะคอลัมน์หน่วย/เกณฑ์ ซึ่งเป็นข้อความของฟอร์มเอง ไม่ใช่ค่าที่กรอก
  const html = buildCleaningDocHtml(baseForm());
  assert.ok(!html.includes('#0000FF'), 'ต้องไม่มีตัวหนังสือสีน้ำเงินเหลืออยู่');
  assert.ok(/\.v\s*\{\s*color:\s*#000/.test(html), 'ค่าที่กรอกต้องเป็นสีดำ');
});

test('ค่าที่กรอกยังถูกทำเครื่องหมายแยกจากข้อความที่พิมพ์มากับฟอร์ม', () => {
  // ถึงจะเป็นสีดำเหมือนกันแล้ว ก็ยังต้องแยกออกในโครงสร้าง
  // เพื่อให้เปลี่ยนสีกลับหรือปรับรูปแบบทีหลังได้ที่เดียว
  const html = buildCleaningDocHtml(baseForm());
  assert.ok(html.includes('<span class="v">ช่างสมชาย</span>') ||
            html.includes('<span class="v">หจก. ทดสอบ</span>'),
    'ค่าที่กรอกต้องอยู่ใน span ของตัวเอง');
  assert.ok(html.includes('>Indoor Serial No.<'), 'ข้อความของฟอร์มต้องไม่ถูกทำเป็นค่าที่กรอก');
});

test('ช่องที่ยังไม่ได้กรอก ต้องว่างจริง ไม่ใช่ขีด', () => {
  // ฟอร์มเปล่าที่ปริ้นไปเขียนมือ ต้องมีที่ให้เขียน ไม่ใช่มีขีดขวางอยู่
  const html = buildCleaningDocHtml(baseForm({ AdditionalNote: '', CompanyName: '' }));
  assert.ok(!html.includes('<span class="v">–</span>'));
});

test('มีโลโก้เมื่อระบุที่อยู่รูปมาให้ และไม่ดึงจากอินเทอร์เน็ต', () => {
  const html = buildCleaningDocHtml(baseForm(), { logoHref: '/assets/form-logo.png' });
  assert.ok(html.includes('src="/assets/form-logo.png"'));
  assert.ok(html.includes('class="logo"'));

  // ไม่ระบุก็ต้องยังสร้างเอกสารได้ ไม่ใช่พัง
  assert.ok(!buildCleaningDocHtml(baseForm()).includes('<img'));
});

test('ความกว้างคอลัมน์ตรงตามสัดส่วนในไฟล์ Excel', () => {
  // A 4.6 / B 16.6 / C 17.6 / D 10 / E 11 / F 16.6 / G 16.6 / H 28.1
  const html = buildCleaningDocHtml(baseForm());
  const widths = [...html.matchAll(/<col style="width:([\d.]+)%">/g)].map(m => Number(m[1]));
  assert.equal(widths.length, 8, 'ต้องมี 8 คอลัมน์เท่าแบบฟอร์ม');
  assert.ok(Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 0.5, 'รวมกันต้องได้ 100%');
  assert.ok(widths[0] < widths[1], 'คอลัมน์เลขข้อต้องแคบที่สุด');
  assert.ok(widths[7] > widths[6], 'คอลัมน์หมายเหตุต้องกว้างที่สุด');
});

/* ==================== หน้ารูปภาพ ==================== */

test('มีหน้ารูปภาพหนึ่งหน้าต่อหนึ่งเครื่อง', () => {
  const two = buildCleaningDocHtml(baseForm());
  assert.equal((two.match(/ภาพถ่ายประกอบการล้าง/g) || []).length, 2, 'ล้างสองเครื่อง = สองหน้ารูป');

  const one = buildCleaningDocHtml(withoutUnit(1));
  assert.equal((one.match(/ภาพถ่ายประกอบการล้าง/g) || []).length, 1, 'ล้างเครื่องเดียว = หน้ารูปเดียว');
  assert.ok(one.includes('ภาพถ่ายประกอบการล้างเครื่องปรับอากาศ — เครื่องที่ 2 (AIR 2)'),
    'หัวหน้ารูปต้องบอกเลขเครื่องจริง');
});

test('หน้ารูปมี 9 ช่อง พร้อมคำบรรยายตามแบบฟอร์ม', () => {
  const html = buildCleaningDocHtml(withoutUnit(2));
  for (const cap of ['รูปก่อนดำเนินล้าง', 'รูปหลังดำเนินการล้าง',
                     'รูปวัดค่ากระแสคอมเพรสเซอร์ขณะทำงาน', 'รูปวัดแรงดันไฟฟ้า',
                     'รูปวัดแรงดันน้ำยาด้านต่ำ (LOW)']) {
    assert.ok(html.includes(cap), 'ขาดคำบรรยาย ' + cap);
  }
  assert.equal((html.match(/class="pic"/g) || []).length, 9);
});

test('ช่องที่ยังไม่มีรูป พิมพ์ออกมาเป็นกรอบเปล่าให้ติดรูปเอง', () => {
  const html = buildCleaningDocHtml(withoutUnit(2));
  assert.equal((html.match(/class="ph"/g) || []).length, 9);
  assert.ok(!html.includes('<img src="data:'));
});

test('รูปที่แนบไว้ถูกฝังลงในเอกสาร ไม่ใช่ลิงก์ไปที่ไฟล์', () => {
  // ฝังลงไปเลย จึงไม่มีที่อยู่ให้ใครเปิดดูรูปโดยไม่ผ่านการตรวจสิทธิ์
  const photos = { '1-1': 'data:image/jpeg;base64,AAAA', '1-9': 'data:image/png;base64,BBBB' };
  const html = buildCleaningDocHtml(withoutUnit(2), { photos });

  assert.ok(html.includes('src="data:image/jpeg;base64,AAAA"'));
  assert.ok(html.includes('src="data:image/png;base64,BBBB"'));
  assert.equal((html.match(/class="ph"/g) || []).length, 7, 'อีก 7 ช่องยังเป็นกรอบเปล่า');
});

test('รูปของเครื่องหนึ่ง ต้องไม่ไปโผล่ในหน้าของอีกเครื่อง', () => {
  const photos = { '1-1': 'data:image/jpeg;base64,ONE', '2-1': 'data:image/jpeg;base64,TWO' };
  const html = buildCleaningDocHtml(baseForm(), { photos });

  const pages = html.split('ภาพถ่ายประกอบการล้าง');
  assert.ok(pages[1].includes('ONE') && !pages[1].includes('TWO'), 'หน้าเครื่องที่ 1 ต้องมีแต่รูปของตัวเอง');
  assert.ok(pages[2].includes('TWO') && !pages[2].includes('ONE'), 'หน้าเครื่องที่ 2 ต้องมีแต่รูปของตัวเอง');
});

test('หน้ารูปขึ้นหน้าใหม่เสมอ ไม่ต่อท้ายหน้าแรก', () => {
  assert.ok(buildCleaningDocHtml(baseForm()).includes('page-break-after: always'));
});
