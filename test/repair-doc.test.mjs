/**
 * เอกสารซ่อมที่ปริ้นออกมา ต้องตรงกับแบบฟอร์มควบคุม ITEL-FM-NE-005
 *
 * ============================================================================
 * สิ่งที่ล็อกไว้
 * ============================================================================
 * - 6 ส่วนตามแบบฟอร์ม และ 2 หน้า (ใบแจ้งซ่อม + หน้ารูป)
 * - **เครื่องเดียวทั้งใบ** ไม่ใช่สองคอลัมน์เหมือนใบล้าง
 * - รายการบันทึกผล 5 ข้อ (ใบล้างมี 21 ข้อ — คนละชุดกัน)
 * - ตารางอะไหล่ต้องมี 4 แถวเสมอ แม้ใช้อะไหล่ชิ้นเดียวหรือไม่ใช้เลย
 * - รหัสแบบฟอร์มมุมขวาล่างต้องเป็น NE-005 ไม่ใช่ NE-004
 * - ไม่มีการดึงอะไรจากอินเทอร์เน็ตเลย
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { buildRepairDocHtml } from '../src/modules/repair-doc.js';
import { REPAIR_CHECKLIST_ITEMS, REPAIR_PART_ROWS } from '../src/schema.js';

const baseForm = (over = {}) => ({
  DocNo: 'CM2609-31', ID: 'RF123', Date: '2026-09-15',
  NodeName: 'ชุมแพ', SiteCode: 'KKN-CPE', Province: 'ขอนแก่น', LocationType: 'Shop House',
  AirCode: 'KKN-CPE-AIR-1', Brand: 'Carrier', BTU: '18000',
  IndoorSerial: 'IN-111', IndoorAsset: 'A-111',
  OutdoorSerial: 'OUT-111', OutdoorAsset: 'A-222',
  Symptom: 'แอร์ไม่เย็น มีน้ำหยด',
  Cause: 'ท่อน้ำทิ้งอุดตัน',
  Fix: 'ล้างท่อน้ำทิ้ง เติมน้ำยา',
  Suggestion: 'ควรล้างท่อน้ำทิ้งทุกรอบ',
  CompanyName: 'หจก. ทดสอบ', TechnicianName: 'ช่างสมชาย', SupervisorName: 'หัวหน้าภาค',
  ChecklistJSON: JSON.stringify([
    { no: 1, value: '225' },
    { no: 3, value: '118', note: 'เติมน้ำยาเพิ่ม' }
  ]),
  PartsJSON: JSON.stringify([{ name: 'ข้อต่อแป๊บ 1/4', qty: '2', note: 'ของใหม่' }]),
  ...over
});

/** ข้อความล้วนของเอกสาร ใช้ตรวจว่ามีอะไรปรากฏบ้าง */
const textOf = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/* ==================== โครงของเอกสาร ==================== */

test('ต้องมีครบ 6 ส่วนตามแบบฟอร์ม', () => {
  const t = textOf(buildRepairDocHtml(baseForm(), {}));

  for (const s of [
    'ส่วนที่ 1 : ข้อมูล Node และเครื่อง',
    'ส่วนที่ 2 : รายละเอียดสาเหตุและการแก้ไข',
    'ส่วนที่ 3 : รายการบันทึกผล',
    'ส่วนที่ 4 : อะไหล่ที่ใช้',
    'ส่วนที่ 5 : แนวทางป้องกันและข้อเสนอแนะ',
    'ส่วนที่ 6 : การลงนาม'
  ]) assert.ok(t.includes(s), 'ขาด ' + s);
});

test('ต้องมี 2 หน้า — ใบแจ้งซ่อม กับ หน้ารูป', () => {
  const html = buildRepairDocHtml(baseForm(), {});

  assert.equal((html.match(/class="sheet[ "]/g) || []).length, 2);
  assert.ok(html.includes('บันทึกผลการซ่อมเครื่องปรับอากาศ'));
  assert.ok(html.includes('รูปถ่ายประกอบการซ่อมเครื่องปรับอากาศ'));
});

test('รหัสแบบฟอร์มต้องเป็น NE-005 ทุกหน้า ไม่ใช่ของใบล้าง', () => {
  const html = buildRepairDocHtml(baseForm(), {});

  assert.equal((html.match(/ITEL-FM-NE-005/g) || []).length, 2, 'ต้องมีทั้งสองหน้า');
  assert.ok(!html.includes('ITEL-FM-NE-004'), 'ต้องไม่ติดรหัสของใบล้างมา');
});

/* ==================== เครื่องเดียวทั้งใบ ==================== */

test('ใบซ่อมมีเครื่องเดียว ต้องไม่มีคอลัมน์ "เครื่องที่ 2" แบบใบล้าง', () => {
  // ใบล้างยึดสองคอลัมน์เสมอ แต่การซ่อมเกิดกับเครื่องที่เสียตัวใดตัวหนึ่ง
  const t = textOf(buildRepairDocHtml(baseForm(), {}));

  assert.ok(!t.includes('เครื่องที่ 2'));
  assert.ok(!t.includes('AIR 2'));
});

test('ไม่มีเครื่องในใบ ต้องฟ้อง ไม่ใช่ออกเอกสารเปล่า', () => {
  assert.throws(
    () => buildRepairDocHtml(baseForm({ AirCode: '' }), {}),
    /ยังไม่มีข้อมูลเครื่องปรับอากาศ/
  );
});

test('ข้อมูลเครื่องต้องขึ้นครบทุกช่องของส่วนที่ 1', () => {
  const t = textOf(buildRepairDocHtml(baseForm(), {}));

  for (const v of ['ชุมแพ', 'Shop House', 'ขอนแก่น', 'Carrier', '18000',
                   'IN-111', 'A-111', 'OUT-111', 'A-222']) {
    assert.ok(t.includes(v), 'ขาดค่า ' + v);
  }
});

/* ==================== ส่วนที่ 2 — สาเหตุและการแก้ไข ==================== */

test('อาการเสีย สาเหตุ และการแก้ไข ต้องขึ้นครบทั้งสามช่อง', () => {
  const t = textOf(buildRepairDocHtml(baseForm(), {}));

  assert.ok(t.includes('อาการเสีย :') && t.includes('แอร์ไม่เย็น มีน้ำหยด'));
  assert.ok(t.includes('สาเหตุ :') && t.includes('ท่อน้ำทิ้งอุดตัน'));
  assert.ok(t.includes('การแก้ไข :') && t.includes('ล้างท่อน้ำทิ้ง เติมน้ำยา'));
});

test('ไม่ได้กรอกสามช่องนี้ ป้ายต้องยังอยู่ให้เขียนมือได้', () => {
  const t = textOf(buildRepairDocHtml(baseForm({ Symptom: '', Cause: '', Fix: '' }), {}));

  assert.ok(t.includes('อาการเสีย :'));
  assert.ok(t.includes('สาเหตุ :'));
  assert.ok(t.includes('การแก้ไข :'));
});

/* ==================== ส่วนที่ 3 — รายการบันทึกผล 5 ข้อ ==================== */

test('รายการบันทึกผลต้องมี 5 ข้อ ตามแบบฟอร์ม NE-005', () => {
  const t = textOf(buildRepairDocHtml(baseForm(), {}));

  assert.equal(REPAIR_CHECKLIST_ITEMS.length, 5);
  for (const item of REPAIR_CHECKLIST_ITEMS) {
    assert.ok(t.includes(item.label), 'ขาดข้อ ' + item.no + ' ' + item.label);
  }
});

test('ต้องไม่มีรายการ 21 ข้อของใบล้างหลุดมา', () => {
  const t = textOf(buildRepairDocHtml(baseForm(), {}));
  assert.ok(!t.includes('ทำความสะอาดคอยล์ร้อน'));
  assert.ok(!t.includes('ตรวจเช็คสภาพทั่วไป'));
});

test('ค่าที่บันทึกไว้ต้องขึ้นตรงข้อของมัน ข้อที่ไม่ได้กรอกต้องว่าง', () => {
  const html = buildRepairDocHtml(baseForm(), {});
  // ตัดเฉพาะส่วนที่ 3 มาดู เพราะตารางอะไหล่ในส่วนที่ 4 ก็ขึ้นต้นแถวด้วยเลขลำดับเหมือนกัน
  const sec = html.slice(html.indexOf('ส่วนที่ 3'), html.indexOf('ส่วนที่ 4'));
  const byNo = Object.fromEntries(
    [...sec.matchAll(/<tr><td class="ctr">(\d)<\/td>([\s\S]*?)<\/tr>/g)]
      .map(m => [m[1], m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()])
  );

  assert.ok(byNo['1'].includes('225'), 'ข้อ 1 ต้องมีค่า');
  assert.ok(byNo['3'].includes('118') && byNo['3'].includes('เติมน้ำยาเพิ่ม'));
  assert.ok(!byNo['2'].includes('225'), 'ค่าของข้ออื่นต้องไม่หลุดมาข้อที่ไม่ได้กรอก');
});

test('ChecklistJSON เสียหาย ต้องไม่ทำให้เอกสารพัง', () => {
  const t = textOf(buildRepairDocHtml(baseForm({ ChecklistJSON: '{ไม่ใช่ json' }), {}));
  assert.ok(t.includes('ค่าแรงดันไฟฟ้า (Voltage)'), 'ยังต้องเห็นรายการครบ');
});

/* ==================== ส่วนที่ 4 — อะไหล่ ==================== */

test('ตารางอะไหล่ต้องมี 4 แถวเสมอ แม้ใช้ชิ้นเดียว', () => {
  // แบบฟอร์มกระดาษมี 4 แถว ปริ้นไปเขียนมือต้องได้หน้าตาเดิม
  const html = buildRepairDocHtml(baseForm(), {});
  const parts = html.slice(html.indexOf('ส่วนที่ 4'), html.indexOf('ส่วนที่ 5'));

  assert.equal((parts.match(/<tr>/g) || []).length, REPAIR_PART_ROWS + 1, 'หัวตาราง + 4 แถว');
  assert.ok(parts.includes('ข้อต่อแป๊บ 1/4'));
});

test('ไม่ได้ใช้อะไหล่เลย ตารางต้องยังมี 4 แถวว่าง', () => {
  const html = buildRepairDocHtml(baseForm({ PartsJSON: '[]' }), {});
  const parts = html.slice(html.indexOf('ส่วนที่ 4'), html.indexOf('ส่วนที่ 5'));

  assert.equal((parts.match(/<tr>/g) || []).length, REPAIR_PART_ROWS + 1);
});

test('อะไหล่เกิน 4 รายการ ต้องไม่ทำให้ตารางยาวเกินกระดาษ', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: 'ของ ' + (i + 1), qty: '1' }));
  const html = buildRepairDocHtml(baseForm({ PartsJSON: JSON.stringify(many) }), {});
  const parts = html.slice(html.indexOf('ส่วนที่ 4'), html.indexOf('ส่วนที่ 5'));

  assert.equal((parts.match(/<tr>/g) || []).length, REPAIR_PART_ROWS + 1);
});

/* ==================== ส่วนที่ 6 — ลงนาม ==================== */

test('ช่องผู้ดำเนินการต้องเขียนว่า "ซ่อม" ไม่ใช่ "ล้างแอร์"', () => {
  const t = textOf(buildRepairDocHtml(baseForm(), {}));

  assert.ok(t.includes('ผู้ดำเนินการซ่อม (บ./หจก.)'));
  assert.ok(!t.includes('ผู้ดำเนินการล้างแอร์'));
});

test('ชื่อช่างกับวันที่ต้องถูกพิมพ์ลงช่องลงนามให้เลย', () => {
  const t = textOf(buildRepairDocHtml(baseForm(), {}));

  assert.ok(t.includes('ช่างสมชาย'));
  assert.ok(t.includes('หัวหน้าภาค'));
  assert.ok(t.includes('15/09/2026'), 'วันที่ต้องเป็น วัน/เดือน/ปี');
});

/* ==================== หน้ารูป ==================== */

test('หน้ารูปต้องมี 9 กรอบ และคำบรรยายต้องเป็นของงานซ่อม', () => {
  const html = buildRepairDocHtml(baseForm(), {});

  assert.equal((html.match(/วางรูปในกรอบด้านล่าง/g) || []).length, 9);
  assert.ok(html.includes('รูปก่อนดำเนินซ่อม'));
  assert.ok(html.includes('รูปหลังดำเนินการซ่อม'));
  assert.ok(!html.includes('ดำเนินการล้าง'), 'ต้องไม่ติดคำของใบล้างมา');
});

test('รูปที่แนบไว้ต้องถูกฝังลงหน้ารูป ใช้คีย์ของเครื่องตัวที่ 1', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const html = buildRepairDocHtml(baseForm(), { photos: { '1-1': png, '1-9': png } });

  assert.equal((html.match(/<img src="data:image/g) || []).length, 2);
  assert.equal((html.match(/วางรูปในกรอบด้านล่าง/g) || []).length, 7, 'ที่เหลือยังเป็นกรอบเปล่า');
});

/* ==================== ความปลอดภัยและการพึ่งพา ==================== */

test('ต้องไม่ดึงอะไรจากอินเทอร์เน็ต', () => {
  const html = buildRepairDocHtml(baseForm(), { logoHref: '/assets/logo.png' });
  assert.ok(!/https?:\/\//.test(html.replace(/xmlns="[^"]*"/g, '')));
});

test('ข้อความที่มีอักขระพิเศษ ต้องไม่หลุดเป็น HTML', () => {
  const html = buildRepairDocHtml(baseForm({ Symptom: '<script>alert(1)</script>' }), {});

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('แถบปุ่มต้องมีเฉพาะตอนเปิดดูบนจอ ไม่ติดไปในไฟล์ PDF', () => {
  assert.ok(!buildRepairDocHtml(baseForm(), {}).includes('docDownloadBtn'));
  assert.ok(buildRepairDocHtml(baseForm(), { toolbar: true }).includes('docDownloadBtn'));
});

/* ==================== ฝั่งหน้าเว็บต้องตรงกับฝั่งเซิร์ฟเวอร์ ==================== */

test('รายการบันทึกผล 5 ข้อ ในหน้าเว็บต้องตรงกับของเซิร์ฟเวอร์เป๊ะ', async () => {
  // มีก็อปปี้สองที่ (หน้าเว็บใช้วาดฟอร์ม เซิร์ฟเวอร์ใช้วาดเอกสาร)
  // ถ้าหลุดกันเมื่อไหร่ ช่องที่กรอกจะไปโผล่ผิดข้อบนเอกสารโดยไม่มีอะไรฟ้อง
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

  const src = js.match(/const REPAIR_CHECKLIST_ITEMS = \[[\s\S]*?\n  \];/);
  assert.ok(src, 'หารายการในหน้าเว็บไม่เจอ');

  const web = new Function('return ' + src[0].replace('const REPAIR_CHECKLIST_ITEMS = ', '').replace(/;$/, ''))();
  assert.deepEqual(web, REPAIR_CHECKLIST_ITEMS);
});

test('จำนวนแถวอะไหล่ในหน้าเว็บต้องตรงกับของเซิร์ฟเวอร์', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  const m = html.match(/const REPAIR_PART_ROWS = (\d+);/);

  assert.ok(m, 'หาจำนวนแถวอะไหล่ในหน้าเว็บไม่เจอ');
  assert.equal(Number(m[1]), REPAIR_PART_ROWS);
});

test('คำบรรยายรูปในหน้าเว็บต้องตรงกับที่พิมพ์บนเอกสาร', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  const src = html.match(/const REPAIR_PHOTO_CAPTIONS = \[[\s\S]*?\n  \];/);
  assert.ok(src, 'หาคำบรรยายในหน้าเว็บไม่เจอ');

  const web = new Function('return ' + src[0].replace('const REPAIR_PHOTO_CAPTIONS = ', '').replace(/;$/, ''))();
  const doc = buildRepairDocHtml(baseForm(), {});
  for (const cap of web) assert.ok(doc.includes(cap), 'เอกสารไม่มีคำบรรยาย "' + cap + '"');
});
