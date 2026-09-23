/**
 * ฟอร์มซ่อมเปล่าแบบ Excel ที่ระบบเติมข้อมูลเครื่องให้แล้ว
 *
 * ============================================================================
 * ทำไมต้องมีเทสต์ชุดนี้
 * ============================================================================
 * ไฟล์ที่ออกไปเป็นแบบฟอร์มควบคุม ถ้าเส้นกรอบหาย โลโก้หาย หรือชีตวางรูปหายไป
 * คนที่เจอคือช่างที่หน้างาน ตอนที่กลับมาแก้ไม่ได้แล้ว
 *
 * และความผิดพลาดแบบ "ข้อมูลลงผิดช่อง" มองไม่ออกจากโค้ด เพราะช่องปลายทาง
 * เป็นแค่รหัสอย่าง C3 กับ F6 ซึ่งดูยังไงก็ไม่รู้ว่าคือช่องไหนในฟอร์ม
 *
 * ============================================================================
 * สิ่งที่ล็อกไว้
 * ============================================================================
 * - แกะไฟล์ ZIP แล้วประกอบกลับ ต้องได้ของเดิมทุกไบต์
 * - ไฟล์แม่แบบต้องมีอยู่จริง พร้อมโลโก้และชีตวางรูป
 * - ข้อมูลลงถูกช่องตามฟอร์มจริง (เทียบกับป้ายชื่อที่พิมพ์มากับฟอร์ม)
 * - เติมแล้วโลโก้ สไตล์ และชีตรูป ต้องไม่ถูกแตะ
 * - วันที่เป็น วว/ดด/ปปปป เหมือนเอกสารอื่นทั้งระบบ
 * - อักขระพิเศษในชื่อ Node ต้องไม่ทำไฟล์พัง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { readZip, writeZip } from '../src/modules/zip.js';
import { setCells, fillXlsx } from '../src/modules/xlsx-template.js';
import { repairXlsxValues, repairXlsxFileName, REPAIR_XLSX_CELLS } from '../src/modules/repair-xlsx.js';

const TEMPLATE = join(process.cwd(), 'assets', 'forms', 'repair-form-template.xlsx');
const template = () => new Uint8Array(readFileSync(TEMPLATE));

const text = bytes => new TextDecoder().decode(bytes);
const bytesOf = s => new TextEncoder().encode(s);

/** ดึงชีตหนึ่งออกมาเป็นข้อความ */
async function sheetOf(file, path = 'xl/worksheets/sheet1.xml') {
  const entries = await readZip(file);
  const found = entries.find(e => e.name === path);
  return found ? text(found.data) : '';
}

/** ข้อความในเซลล์ที่เติมแบบ inlineStr */
function cellText(xml, ref) {
  const m = xml.match(new RegExp('<c r="' + ref + '"[^>]*><is><t[^>]*>([\\s\\S]*?)</t></is></c>'));
  return m ? m[1] : null;
}

/* ============================ ไฟล์แม่แบบต้องอยู่ครบ ============================ */

test('ไฟล์แม่แบบมีอยู่จริงในโปรเจกต์ ไม่ได้อยู่ใน data/ ที่ git ไม่เก็บ', () => {
  assert.ok(existsSync(TEMPLATE), 'ต้องมี assets/forms/repair-form-template.xlsx');
});

test('แม่แบบมีครบทั้งโลโก้ ชีตฟอร์ม และชีตวางรูป', async () => {
  const entries = await readZip(template());
  const names = entries.map(e => e.name);

  assert.ok(names.includes('xl/worksheets/sheet1.xml'), 'ต้องมีชีตฟอร์ม');
  assert.ok(names.includes('xl/worksheets/sheet2.xml'), 'ต้องมีชีตวางรูป');
  assert.ok(names.includes('xl/media/image1.png'), 'ต้องมีโลโก้');
  assert.ok(names.includes('xl/styles.xml'), 'ต้องมีไฟล์สไตล์ (เส้นกรอบอยู่ในนี้)');
});

test('ชีตที่สองมีกรอบวางรูปครบ 6 ช่องตามที่ฟอร์มกำหนด', async () => {
  const entries = await readZip(template());
  const shared = text(entries.find(e => e.name === 'xl/sharedStrings.xml').data);

  for (const caption of [
    'รูปก่อนดำเนินซ่อม', 'รูปดำเนินการซ่อม', 'รูปหลังดำเนินการซ่อม',
    'รูปวัดแรงดันไฟฟ้า', 'รูปวัดค่ากระแสคอมเพรสเซอร์ขณะทำงาน', 'รูปวัดแรงดันน้ำยาด้านต่ำ (LOW)'
  ]) {
    assert.ok(shared.includes(caption), 'แม่แบบต้องมีกรอบ "' + caption + '"');
  }
});

/* ================================ ZIP ไปกลับ ================================ */

test('แกะ ZIP แล้วประกอบกลับ ได้เนื้อไฟล์ย่อยเท่าเดิมทุกไบต์', async () => {
  const before = await readZip(template());
  const after = await readZip(await writeZip(before));

  assert.equal(after.length, before.length, 'จำนวนไฟล์ย่อยต้องเท่าเดิม');
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].name, before[i].name, 'ลำดับไฟล์ย่อยต้องเหมือนเดิม');
    assert.deepEqual(after[i].data, before[i].data, 'เนื้อ ' + before[i].name + ' ต้องเหมือนเดิม');
  }
});

test('ZIP ที่เขียนออกมาขึ้นต้นด้วย PK และมีเครื่องหมายจบไฟล์', async () => {
  const out = await writeZip([{ name: 'a.txt', data: bytesOf('สวัสดี') }]);
  assert.equal(out[0], 0x50);
  assert.equal(out[1], 0x4b);

  const back = await readZip(out);
  assert.equal(back.length, 1);
  assert.equal(text(back[0].data), 'สวัสดี');
});

test('ไฟล์ที่ไม่ใช่ ZIP ต้องฟ้อง ไม่ใช่เงียบแล้วคืนของว่าง', async () => {
  await assert.rejects(() => readZip(bytesOf('ไม่ใช่ไฟล์ zip')), /ไม่ใช่ไฟล์ ZIP/);
});

/* =============================== การเติมเซลล์ =============================== */

test('เติมค่าลงเซลล์ที่ปิดในตัว โดยยังเก็บเลขสไตล์ไว้', () => {
  const { xml, filled } = setCells('<c r="C3" s="33"/>', { C3: 'ชุมแพ' });

  assert.deepEqual(filled, ['C3']);
  assert.ok(xml.includes('s="33"'), 'เลขสไตล์ = กรอบของช่องนั้น ห้ามหาย');
  assert.ok(xml.includes('t="inlineStr"'));
  assert.equal(cellText(xml, 'C3'), 'ชุมแพ');
});

test('เติมทับเซลล์ที่เคยชี้ไปยังข้อความกลาง ต้องทิ้ง t เดิมไม่ให้ซ้อนกัน', () => {
  const { xml } = setCells('<c r="C3" s="33" t="s"><v>7</v></c>', { C3: 'ขอนแก่น' });

  assert.equal((xml.match(/t="/g) || []).length, 1, 'ต้องเหลือ t เดียว');
  assert.ok(xml.includes('t="inlineStr"'));
  assert.ok(!xml.includes('<v>7</v>'), 'ค่าเดิมต้องหายไป');
  assert.equal(cellText(xml, 'C3'), 'ขอนแก่น');
});

test('ไม่มีค่าก็ปล่อยช่องว่างไว้ ไม่เขียนทับกรอบเปล่า', () => {
  const src = '<c r="C3" s="33"/>';
  for (const empty of ['', null, undefined]) {
    const { xml, filled } = setCells(src, { C3: empty });
    assert.equal(xml, src);
    assert.deepEqual(filled, []);
  }
});

test('ไม่มีเซลล์ปลายทางก็ไม่สร้างใหม่ แต่ต้องรายงานว่าขาด', () => {
  const { xml, filled, missing } = setCells('<c r="A1" s="1"/>', { ZZ99: 'ค่า' });

  assert.equal(xml, '<c r="A1" s="1"/>', 'ห้ามสร้างเซลล์ใหม่ เพราะจะไม่มีกรอบ');
  assert.deepEqual(filled, []);
  assert.deepEqual(missing, ['ZZ99']);
});

test('อักขระพิเศษถูกแปลงก่อนลง XML ไม่งั้นไฟล์พังเปิดไม่ได้', () => {
  const { xml } = setCells('<c r="C3" s="33"/>', { C3: 'A & B <test> "x"' });

  assert.ok(xml.includes('&amp;'));
  assert.ok(xml.includes('&lt;test&gt;'));
  assert.ok(!/<test>/.test(xml), 'ห้ามมีแท็กปลอมหลุดเข้าไป');
});

test('เติมเซลล์หนึ่งไม่ไปโดนเซลล์ข้างเคียงที่ชื่อขึ้นต้นเหมือนกัน', () => {
  const { xml } = setCells('<c r="C3" s="1"/><c r="C33" s="2"/>', { C3: 'x' });

  assert.equal(cellText(xml, 'C3'), 'x');
  assert.ok(xml.includes('<c r="C33" s="2"/>'), 'C33 ต้องไม่ถูกแตะ');
});

/* ============================== ข้อมูลลงถูกช่อง ============================== */

const unit = {
  Date: '2026-09-23',
  NodeName: 'ชุมแพ', Province: 'ขอนแก่น', LocationType: 'Shop House',
  AirCode: 'KKN-CPE-AIR-1', Brand: 'Carrier', BTU: '18000',
  IndoorSerial: 'IN-111', IndoorAsset: 'AST-111',
  OutdoorSerial: 'OUT-222', OutdoorAsset: 'AST-222',
  Symptom: 'แอร์ไม่เย็น มีน้ำหยด'
};

test('ทุกช่องที่ประกาศไว้ มีอยู่จริงในไฟล์แม่แบบ', async () => {
  const xml = await sheetOf(template());

  for (const ref of Object.keys(REPAIR_XLSX_CELLS)) {
    assert.ok(
      new RegExp('<c r="' + ref + '"').test(xml),
      'แม่แบบไม่มีช่อง ' + ref + ' — ถ้าฟอร์มเปลี่ยน Rev ต้องแก้ REPAIR_XLSX_CELLS ตาม'
    );
  }
});

test('วันที่ออกมาเป็น วว/ดด/ปปปป เหมือนเอกสารอื่นทั้งระบบ', () => {
  assert.equal(repairXlsxValues(unit).C5, '23/09/2026');
});

test('ข้อมูลที่ระบบไม่รู้ กลายเป็นช่องว่าง ไม่ใช่คำว่า undefined', () => {
  const values = repairXlsxValues({ NodeName: 'ชุมแพ' });

  assert.equal(values.C3, 'ชุมแพ');
  assert.equal(values.F4, '');
  assert.equal(values.C6, '');
});

test('ส่งของว่างเข้าไปก็ไม่ระเบิด', () => {
  assert.doesNotThrow(() => repairXlsxValues(null));
  assert.doesNotThrow(() => repairXlsxValues(undefined));
});

test('ข้อมูลลงตรงกับป้ายชื่อที่พิมพ์มากับฟอร์มจริง', async () => {
  const out = await fillXlsx(template(), { 'xl/worksheets/sheet1.xml': repairXlsxValues(unit) });
  const xml = await sheetOf(out);

  // คอลัมน์ C คู่กับป้ายฝั่งซ้าย คอลัมน์ F คู่กับป้ายฝั่งขวา
  assert.equal(cellText(xml, 'C3'), 'ชุมแพ', 'แถว 3 ซ้าย = Node Nane');
  assert.equal(cellText(xml, 'F3'), 'Shop House', 'แถว 3 ขวา = ประเภท Node');
  assert.equal(cellText(xml, 'C4'), 'ขอนแก่น', 'แถว 4 ซ้าย = จังหวัด');
  assert.equal(cellText(xml, 'F4'), 'Carrier', 'แถว 4 ขวา = Brand');
  assert.equal(cellText(xml, 'C5'), '23/09/2026', 'แถว 5 ซ้าย = วันที่');
  assert.equal(cellText(xml, 'F5'), '18000', 'แถว 5 ขวา = BTU');
  assert.equal(cellText(xml, 'C6'), 'IN-111', 'แถว 6 ซ้าย = Indoor Serial');
  assert.equal(cellText(xml, 'F6'), 'OUT-222', 'แถว 6 ขวา = Outdoor Serial');
  assert.equal(cellText(xml, 'C7'), 'AST-111', 'แถว 7 ซ้าย = Indoor Asset');
  assert.equal(cellText(xml, 'F7'), 'AST-222', 'แถว 7 ขวา = Outdoor Asset');
  assert.equal(cellText(xml, 'A10'), 'แอร์ไม่เย็น มีน้ำหยด', 'แถว 10 = ใต้ "อาการเสีย :"');
});

test('Serial กับ Asset ของ Indoor และ Outdoor ต้องไม่สลับกัน', async () => {
  const out = await fillXlsx(template(), {
    'xl/worksheets/sheet1.xml': repairXlsxValues({
      IndoorSerial: 'ในSN', IndoorAsset: 'ในAST',
      OutdoorSerial: 'นอกSN', OutdoorAsset: 'นอกAST'
    })
  });
  const xml = await sheetOf(out);

  assert.equal(cellText(xml, 'C6'), 'ในSN');
  assert.equal(cellText(xml, 'C7'), 'ในAST');
  assert.equal(cellText(xml, 'F6'), 'นอกSN');
  assert.equal(cellText(xml, 'F7'), 'นอกAST');
});

/* ========================== เติมแล้วฟอร์มต้องไม่เพี้ยน ========================== */

test('เติมข้อมูลแล้ว โลโก้ สไตล์ และชีตวางรูป ต้องไม่ถูกแตะเลย', async () => {
  const src = template();
  const out = await fillXlsx(src, { 'xl/worksheets/sheet1.xml': repairXlsxValues(unit) });

  const before = await readZip(src);
  const after = await readZip(out);

  assert.equal(after.length, before.length, 'จำนวนไฟล์ย่อยต้องเท่าเดิม');

  for (const entry of before) {
    const now = after.find(e => e.name === entry.name);
    assert.ok(now, 'ไฟล์ย่อย ' + entry.name + ' หายไป');

    if (entry.name === 'xl/worksheets/sheet1.xml') continue;   // ชีตเดียวที่ตั้งใจแก้
    assert.deepEqual(now.data, entry.data, entry.name + ' ต้องเหมือนเดิมทุกไบต์');
  }
});

test('ป้ายชื่อและเส้นกรอบในชีตที่แก้ ยังอยู่ครบ', async () => {
  const before = await sheetOf(template());
  const after = await sheetOf(await fillXlsx(template(), {
    'xl/worksheets/sheet1.xml': repairXlsxValues(unit)
  }));

  const merges = s => (s.match(/<mergeCell /g) || []).length;
  assert.equal(merges(after), merges(before), 'ช่องที่ผสานไว้ต้องเท่าเดิม');

  const styles = s => (s.match(/ s="\d+"/g) || []).length;
  assert.equal(styles(after), styles(before), 'จำนวนเซลล์ที่มีสไตล์ต้องเท่าเดิม');

  assert.ok(after.includes('<mergeCell ref="A3:B3"/>'), 'ป้าย Node ยังผสานอยู่');
});

test('ชื่อ Node ที่มีอักขระพิเศษ ไม่ทำให้ไฟล์เสีย', async () => {
  const out = await fillXlsx(template(), {
    'xl/worksheets/sheet1.xml': repairXlsxValues({ ...unit, NodeName: 'ชุมแพ & <สาขา 2>' })
  });

  const entries = await readZip(out);
  assert.equal(entries.length, 20, 'ไฟล์ยังครบ');
  assert.equal(cellText(await sheetOf(out), 'C3'), 'ชุมแพ &amp; &lt;สาขา 2&gt;');
});

/* ================================= ชื่อไฟล์ ================================= */

test('ชื่อไฟล์มีรหัสเครื่องกับวันที่ เพื่อไม่ให้ซ้ำกันตอนโหลดหลายใบ', () => {
  assert.equal(repairXlsxFileName(unit), 'ฟอร์มซ่อม-KKN-CPE-AIR-1-20260923.xlsx');
});

test('ชื่อไฟล์ไม่มีอักขระที่ Windows ตั้งชื่อไฟล์ไม่ได้', () => {
  const name = repairXlsxFileName({ AirCode: 'A/B:C*D?E"F<G>H|I', Date: '2026-09-23' });

  assert.ok(!/[\\/:*?"<>|]/.test(name.replace('.xlsx', '')), 'ได้ชื่อ: ' + name);
  assert.ok(name.endsWith('.xlsx'));
});

test('ไม่มีข้อมูลเครื่องก็ยังได้ชื่อไฟล์ที่ใช้ได้', () => {
  assert.equal(repairXlsxFileName({}), 'ฟอร์มซ่อม.xlsx');
  assert.equal(repairXlsxFileName(null), 'ฟอร์มซ่อม.xlsx');
});
