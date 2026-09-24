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
import { setCells, fillXlsx, recolorStyles } from '../src/modules/xlsx-template.js';
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

/* ============================ สีตัวอักษรของช่องที่เติม ============================ */

/**
 * ไฟล์ฟอร์มต้นฉบับทำสี "ช่องที่ต้องกรอก" ไม่ครบ — ในส่วนข้อมูล Node
 * คอลัมน์ซ้าย (C) เป็นสีดำ คอลัมน์ขวา (F) เป็นสีน้ำเงิน ทั้งที่เป็นข้อมูล
 * ชนิดเดียวกัน ตอนช่องว่างมองไม่เห็น พอระบบเติมข้อมูลลงไปเอกสารเลยออกมา
 * สีปนกันครึ่งดำครึ่งน้ำเงิน
 *
 * เจ้าของงานสั่งว่า "เปลี่ยนตรงที่เราบอกเป็นสีดำ ที่เหลือเอาเหมือนเดิม"
 * = แก้เฉพาะช่องที่ระบบเติม ช่องว่างที่เหลือให้คนกรอกเองห้ามแตะ
 */

/** สีตัวอักษรที่เซลล์หนึ่งใช้จริง ไล่จาก s= ไป cellXfs ไป fonts */
async function fontColorOf(file, ref, sheetPath = 'xl/worksheets/sheet1.xml') {
  const entries = await readZip(file);
  const sheet = text(entries.find(e => e.name === sheetPath).data);
  const styles = text(entries.find(e => e.name === 'xl/styles.xml').data);

  // ดึงแท็กของเซลล์ออกมาก่อน แล้วค่อยอ่าน s= จากแท็กนั้น
  // ปลอดภัยกว่าเขียน regex ยาวๆ ที่ต้องไล่ข้ามแอตทริบิวต์อื่นให้ถูก
  const tag = (sheet.match(new RegExp('<c r="' + ref + '"[^>]*>')) || [])[0];
  const s = tag ? (tag.match(/ s="(\d+)"/) || [])[1] : undefined;
  if (s === undefined) return null;

  const cellXfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1];
  const xfs = cellXfs.match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) || [];
  const fontId = (xfs[Number(s)].match(/fontId="(\d+)"/) || [])[1];

  const fontsBlock = styles.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)[1];
  const fonts = fontsBlock.match(/<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/g) || [];
  return (fonts[Number(fontId)].match(/<color rgb="([^"]+)"\/>/) || [])[1] || null;
}

test('ไฟล์ต้นฉบับมีปัญหาสีจริง — ช่องซ้ายดำ ช่องขวาน้ำเงิน', async () => {
  assert.equal(await fontColorOf(template(), 'C3'), 'FF000000', 'ช่องซ้ายเป็นสีดำอยู่แล้ว');
  assert.equal(await fontColorOf(template(), 'F3'), 'FF0000FF', 'ช่องขวาเป็นสีน้ำเงิน');
});

test('ข้อมูลที่ระบบเติมออกมาเป็นสีดำทุกช่อง', async () => {
  const out = await (await import('../src/modules/repair-xlsx.js')).buildRepairXlsx(template(), unit);

  for (const ref of Object.keys(REPAIR_XLSX_CELLS)) {
    assert.equal(await fontColorOf(out, ref), 'FF000000', 'ช่อง ' + ref + ' ต้องเป็นสีดำ');
  }
});

test('ช่องว่างที่เหลือไว้ให้คนกรอกเอง ยังเป็นสีเดิมทุกช่อง', async () => {
  const out = await (await import('../src/modules/repair-xlsx.js')).buildRepairXlsx(template(), unit);

  // ช่องกรอกผลตรวจวัดกับช่องข้อเสนอแนะ ระบบไม่ได้เติม จึงต้องไม่ถูกแตะ
  for (const ref of ['F17', 'F18', 'D24', 'E25', 'A29', 'F32']) {
    assert.equal(
      await fontColorOf(out, ref), 'FF0000FF',
      'ช่อง ' + ref + ' ระบบไม่ได้เติม ห้ามเปลี่ยนสี'
    );
  }
});

test('เปลี่ยนสีแล้วเส้นกรอบกับการจัดวางต้องเหมือนเดิม', async () => {
  const out = await (await import('../src/modules/repair-xlsx.js')).buildRepairXlsx(template(), unit);

  const styles = text((await readZip(template())).find(e => e.name === 'xl/styles.xml').data);
  const after = text((await readZip(out)).find(e => e.name === 'xl/styles.xml').data);

  const xfsOf = s => (s.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1]
    .match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) || []);

  const before = xfsOf(styles);
  const now = xfsOf(after);

  // ของเดิมต้องอยู่ครบและไม่ถูกแก้ ตัวใหม่ต่อท้ายเท่านั้น
  assert.ok(now.length >= before.length, 'รายการสไตล์ต้องไม่หดลง');
  for (let i = 0; i < before.length; i++) {
    assert.equal(now[i], before[i], 'สไตล์เบอร์ ' + i + ' ห้ามถูกแก้ เพราะเซลล์อื่นใช้ร่วมกันอยู่');
  }

  // สไตล์ที่เพิ่มมาต้องยังมี borderId เดิมของช่องนั้น
  const newOnes = now.slice(before.length);
  for (const xf of newOnes) {
    assert.ok(/borderId="\d+"/.test(xf), 'สไตล์ใหม่ต้องยังมีเส้นกรอบ');
  }
});

test('count ของ fonts กับ cellXfs ต้องตรงกับจำนวนจริง ไม่งั้น Excel ฟ้องไฟล์เสีย', async () => {
  const out = await (await import('../src/modules/repair-xlsx.js')).buildRepairXlsx(template(), unit);
  const styles = text((await readZip(out)).find(e => e.name === 'xl/styles.xml').data);

  const fontsBlock = styles.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)[1];
  const fonts = (fontsBlock.match(/<font\b[^>]*\/>|<font\b[^>]*>[\s\S]*?<\/font>/g) || []).length;
  assert.equal(Number(styles.match(/<fonts count="(\d+)"/)[1]), fonts);

  const cellXfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1];
  const xfs = (cellXfs.match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) || []).length;
  assert.equal(Number(styles.match(/<cellXfs count="(\d+)"/)[1]), xfs);
});

test('ฟอนต์ที่หน้าตาซ้ำกับของเดิมต้องใช้ซ้ำ ไม่เพิ่มตัวใหม่ให้ไฟล์บวม', () => {
  // ฟอนต์น้ำเงิน (4) กับฟอนต์ดำ (5) ในไฟล์นี้ต่างกันแค่สี พอเปลี่ยนสีน้ำเงินเป็นดำ
  // ต้องได้ฟอนต์ 5 ที่มีอยู่แล้ว ไม่ใช่สร้างตัวที่ 13 ขึ้นมาซ้ำ
  const styles =
    '<styleSheet><fonts count="2">' +
    '<font><sz val="12"/><color rgb="FF0000FF"/><name val="Angsana New"/></font>' +
    '<font><sz val="12"/><color rgb="FF000000"/><name val="Angsana New"/></font>' +
    '</fonts><cellXfs count="1"><xf fontId="0" borderId="3" applyFont="1"/></cellXfs></styleSheet>';

  const { xml, map } = recolorStyles(styles, [0], 'FF000000');

  assert.equal(Number(xml.match(/<fonts count="(\d+)"/)[1]), 2, 'ห้ามเพิ่มฟอนต์ซ้ำ');
  assert.equal(Number(xml.match(/<cellXfs count="(\d+)"/)[1]), 2, 'เพิ่ม xf ใหม่ 1 ตัว');
  assert.ok(xml.includes('fontId="1" borderId="3"'), 'ตัวใหม่ต้องชี้ไปฟอนต์ดำที่มีอยู่แล้ว');
  assert.equal(map.get(0), 1);
});

test('ช่องที่สีถูกอยู่แล้ว ไม่ต้องสร้างสไตล์ใหม่', () => {
  const styles =
    '<styleSheet><fonts count="1">' +
    '<font><sz val="12"/><color rgb="FF000000"/></font>' +
    '</fonts><cellXfs count="1"><xf fontId="0" borderId="3"/></cellXfs></styleSheet>';

  const { xml, map } = recolorStyles(styles, [0], 'FF000000');

  assert.equal(Number(xml.match(/<cellXfs count="(\d+)"/)[1]), 1, 'ไม่ต้องเพิ่มอะไร');
  assert.equal(map.get(0), 0, 'ชี้ไปที่เดิม');
});

test('ไฟล์ที่เปลี่ยนสีแล้ว ตัวอ่านอื่นยังเปิดได้และค่าครบ', async () => {
  const out = await (await import('../src/modules/repair-xlsx.js')).buildRepairXlsx(template(), unit);
  const entries = await readZip(out);

  assert.equal(entries.length, 20, 'ไฟล์ย่อยยังครบ');
  assert.equal(cellText(await sheetOf(out), 'F3'), 'Shop House', 'ค่ายังอยู่');
  assert.equal(cellText(await sheetOf(out), 'C3'), 'ชุมแพ');
});
