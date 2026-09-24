/**
 * ฟอร์มล้างเปล่าแบบ Excel ที่ระบบเติมข้อมูล Node กับเครื่องให้แล้ว
 *
 * ============================================================================
 * จุดที่พลาดง่ายกว่าใบซ่อม
 * ============================================================================
 * ใบล้างมีเครื่อง 2 ตัวในใบเดียว แยกเป็นคนละคอลัมน์ (F = ตัวที่ 1, G = ตัวที่ 2)
 * ความผิดพลาดที่อันตรายที่สุดคือข้อมูลของเครื่องหนึ่งไปโผล่ในคอลัมน์ของอีกเครื่อง
 * ซึ่งอ่านจากโค้ดไม่มีทางรู้ เพราะปลายทางเป็นแค่รหัสอย่าง F9 กับ G11
 *
 * และถ้า Node มีเครื่องเดียว คอลัมน์ของตัวที่ 2 ต้องว่างทั้งแถบ
 * ห้ามให้ข้อมูลเลื่อนไปลงช่องของอีกตัว
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { readZip } from '../src/modules/zip.js';
import {
  buildCleaningXlsx, cleaningXlsxValues, cleaningXlsxFileName,
  CLEANING_XLSX_NODE_CELLS, CLEANING_XLSX_UNIT_ROWS
} from '../src/modules/cleaning-xlsx.js';

const TEMPLATE = join(process.cwd(), 'assets', 'forms', 'cleaning-form-template.xlsx');
const template = () => new Uint8Array(readFileSync(TEMPLATE));
const text = bytes => new TextDecoder().decode(bytes);

const MAIN = 'xl/worksheets/sheet1.xml';
const PHOTO1 = 'xl/worksheets/sheet2.xml';
const PHOTO2 = 'xl/worksheets/sheet3.xml';

async function sheetOf(file, path = MAIN) {
  const found = (await readZip(file)).find(e => e.name === path);
  return found ? text(found.data) : '';
}

function cellText(xml, ref) {
  const m = xml.match(new RegExp('<c r="' + ref + '"[^>]*><is><t[^>]*>([\\s\\S]*?)</t></is></c>'));
  return m ? m[1] : null;
}

/** สีตัวอักษรที่เซลล์หนึ่งใช้จริง */
async function fontColorOf(file, ref, sheetPath = MAIN) {
  const entries = await readZip(file);
  const sheet = text(entries.find(e => e.name === sheetPath).data);
  const styles = text(entries.find(e => e.name === 'xl/styles.xml').data);

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

const node = {
  NodeName: 'ชุมแพ', Province: 'ขอนแก่น', LocationType: 'Shop House',
  Date: '2026-09-24',
  AirCode1: 'KKN-CPE-AIR-1', AirCode2: 'KKN-CPE-AIR-2',
  Unit1_Brand: 'Carrier', Unit1_BTU: '18000',
  Unit1_IndoorSerial: 'IN-001', Unit1_IndoorAsset: 'AST-001',
  Unit1_OutdoorSerial: 'OUT-001', Unit1_OutdoorAsset: 'AST-002',
  Unit2_Brand: 'Daikin', Unit2_BTU: '24000',
  Unit2_IndoorSerial: 'IN-002', Unit2_IndoorAsset: 'AST-003',
  Unit2_OutdoorSerial: 'OUT-002', Unit2_OutdoorAsset: 'AST-004'
};

/* ============================== ไฟล์แม่แบบ ============================== */

test('ไฟล์แม่แบบมีอยู่จริงในโปรเจกต์', () => {
  assert.ok(existsSync(TEMPLATE), 'ต้องมี assets/forms/cleaning-form-template.xlsx');
});

test('แม่แบบมีครบทั้งหน้าฟอร์มและหน้ารูปของเครื่องทั้งสองตัว', async () => {
  const names = (await readZip(template())).map(e => e.name);

  assert.ok(names.includes(MAIN), 'ต้องมีหน้าฟอร์ม');
  assert.ok(names.includes(PHOTO1), 'ต้องมีหน้ารูปเครื่องที่ 1');
  assert.ok(names.includes(PHOTO2), 'ต้องมีหน้ารูปเครื่องที่ 2');
  assert.ok(names.includes('xl/media/image1.png'), 'ต้องมีโลโก้');
});

test('หน้ารูปทั้งสองหน้าเป็นของคนละเครื่อง ไม่ใช่หน้าซ้ำ', async () => {
  const shared = text((await readZip(template()))
    .find(e => e.name === 'xl/sharedStrings.xml').data);

  assert.ok(shared.includes('เครื่องที่ 1 (AIR 1)'), 'ต้องมีหน้ารูปของเครื่องที่ 1');
  assert.ok(shared.includes('เครื่องที่ 2 (AIR 2)'), 'ต้องมีหน้ารูปของเครื่องที่ 2');
});

test('ทุกช่องที่ประกาศไว้ มีอยู่จริงในแม่แบบ', async () => {
  const xml = await sheetOf(template());
  const refs = [
    ...Object.keys(CLEANING_XLSX_NODE_CELLS),
    ...Object.keys(CLEANING_XLSX_UNIT_ROWS).flatMap(r => ['F' + r, 'G' + r])
  ];

  for (const ref of refs) {
    assert.ok(
      new RegExp('<c r="' + ref + '"').test(xml),
      'แม่แบบไม่มีช่อง ' + ref + ' — ถ้าฟอร์มเปลี่ยน Rev ต้องแก้แผนที่ช่องตาม'
    );
  }
});

/* ============================== ข้อมูลลงถูกช่อง ============================== */

test('ข้อมูล Node ลงตรงกับป้ายชื่อที่พิมพ์มากับฟอร์ม', async () => {
  const xml = await sheetOf(await buildCleaningXlsx(template(), node));

  assert.equal(cellText(xml, 'C3'), 'ชุมแพ', 'แถว 3 ซ้าย = Node / รหัส Node');
  assert.equal(cellText(xml, 'G3'), 'Shop House', 'แถว 3 ขวา = ประเภท Node');
  assert.equal(cellText(xml, 'C4'), 'ขอนแก่น', 'แถว 4 ซ้าย = จังหวัด');
  assert.equal(cellText(xml, 'G4'), 'Carrier', 'แถว 4 ขวา = Brand');
  assert.equal(cellText(xml, 'C5'), '24/09/2026', 'แถว 5 ซ้าย = วันที่');
  assert.equal(cellText(xml, 'G5'), '18000', 'แถว 5 ขวา = BTU');
});

test('ข้อมูลเครื่องสองตัวอยู่คนละคอลัมน์ ไม่สลับกัน', async () => {
  const xml = await sheetOf(await buildCleaningXlsx(template(), node));

  assert.equal(cellText(xml, 'F9'), 'IN-001', 'ตัวที่ 1 Indoor Serial');
  assert.equal(cellText(xml, 'F10'), 'AST-001', 'ตัวที่ 1 Indoor Asset');
  assert.equal(cellText(xml, 'F11'), 'OUT-001', 'ตัวที่ 1 Outdoor Serial');
  assert.equal(cellText(xml, 'F12'), 'AST-002', 'ตัวที่ 1 Outdoor Asset');

  assert.equal(cellText(xml, 'G9'), 'IN-002', 'ตัวที่ 2 Indoor Serial');
  assert.equal(cellText(xml, 'G10'), 'AST-003', 'ตัวที่ 2 Indoor Asset');
  assert.equal(cellText(xml, 'G11'), 'OUT-002', 'ตัวที่ 2 Outdoor Serial');
  assert.equal(cellText(xml, 'G12'), 'AST-004', 'ตัวที่ 2 Outdoor Asset');
});

test('Node ที่มีเครื่องเดียว คอลัมน์ของตัวที่ 2 ต้องว่างทั้งแถบ', async () => {
  const one = { ...node };
  for (const key of Object.keys(one)) if (key.startsWith('Unit2_')) one[key] = '';

  const xml = await sheetOf(await buildCleaningXlsx(template(), one));

  assert.equal(cellText(xml, 'F9'), 'IN-001', 'ตัวที่ 1 ยังอยู่ครบ');
  for (const row of Object.keys(CLEANING_XLSX_UNIT_ROWS)) {
    assert.equal(cellText(xml, 'G' + row), null, 'ช่อง G' + row + ' ต้องว่าง ห้ามมีข้อมูลเลื่อนมาลง');
  }
});

test('เลือกเฉพาะเครื่องตัวที่ 2 ข้อมูลต้องลงคอลัมน์ขวา ไม่เลื่อนมาซ้าย', async () => {
  const second = { NodeName: 'ชุมแพ', Unit2_IndoorSerial: 'IN-002', Unit2_IndoorAsset: 'AST-003' };
  const xml = await sheetOf(await buildCleaningXlsx(template(), second));

  assert.equal(cellText(xml, 'F9'), null, 'ช่องของตัวที่ 1 ต้องว่าง');
  assert.equal(cellText(xml, 'G9'), 'IN-002', 'ข้อมูลต้องอยู่คอลัมน์ของตัวที่ 2');
  assert.equal(cellText(xml, 'G10'), 'AST-003');
});

test('ยี่ห้อกับ BTU ใช้ของเครื่องตัวที่ 1 เหมือนหน้าเอกสารแบบปริ้น', () => {
  const values = cleaningXlsxValues(node)[MAIN];

  assert.equal(values.G4, 'Carrier', 'ฟอร์มมีช่องยี่ห้อช่องเดียวต่อทั้ง Node');
  assert.equal(values.G5, '18000');
});

test('เวลาเริ่ม–สิ้นสุดกับรวมเวลา ต้องเว้นว่างไว้ให้กรอกหน้างาน', async () => {
  const xml = await sheetOf(await buildCleaningXlsx(template(), node));

  assert.equal(cellText(xml, 'C6'), null, 'เวลาเริ่ม–สิ้นสุดต้องว่าง');
  assert.equal(cellText(xml, 'G6'), null, 'รวมเวลาต้องว่าง');
});

test('วันที่เป็น วว/ดด/ปปปป และไม่มีวันที่ก็ไม่ขึ้นคำว่า undefined', () => {
  assert.equal(cleaningXlsxValues(node)[MAIN].C5, '24/09/2026');
  assert.equal(cleaningXlsxValues({ NodeName: 'ก' })[MAIN].C5, '');
});

test('ส่งของว่างเข้าไปก็ไม่ระเบิด', () => {
  assert.doesNotThrow(() => cleaningXlsxValues(null));
  assert.doesNotThrow(() => cleaningXlsxValues(undefined));
});

/* ============================== หัวหน้ารูป ============================== */

test('หน้ารูปทั้งสองหน้าได้ชื่อ Node กับวันที่มาให้ ไม่ต้องพิมพ์ซ้ำ', async () => {
  const out = await buildCleaningXlsx(template(), node);

  for (const sheet of [PHOTO1, PHOTO2]) {
    const xml = await sheetOf(out, sheet);
    assert.equal(cellText(xml, 'C2'), 'ชุมแพ', sheet + ' ต้องมีชื่อ Node');
    assert.equal(cellText(xml, 'H2'), '24/09/2026', sheet + ' ต้องมีวันที่');
  }
});

/* ============================== ฟอร์มต้องไม่เพี้ยน ============================== */

test('เติมข้อมูลแล้ว โลโก้กับไฟล์ย่อยอื่นต้องไม่ถูกแตะ', async () => {
  const before = await readZip(template());
  const after = await readZip(await buildCleaningXlsx(template(), node));

  assert.equal(after.length, before.length, 'จำนวนไฟล์ย่อยต้องเท่าเดิม');

  const touched = [MAIN, PHOTO1, PHOTO2, 'xl/styles.xml'];
  for (const entry of before) {
    if (touched.includes(entry.name)) continue;
    const now = after.find(e => e.name === entry.name);
    assert.deepEqual(now.data, entry.data, entry.name + ' ต้องเหมือนเดิมทุกไบต์');
  }
});

test('ช่องที่ผสานไว้ยังเท่าเดิม เส้นกรอบไม่หาย', async () => {
  const before = await sheetOf(template());
  const after = await sheetOf(await buildCleaningXlsx(template(), node));

  const merges = s => (s.match(/<mergeCell /g) || []).length;
  assert.equal(merges(after), merges(before));

  const styled = s => (s.match(/ s="\d+"/g) || []).length;
  assert.equal(styled(after), styled(before));
});

test('ข้อมูลที่ระบบเติมออกมาเป็นสีดำทุกช่อง', async () => {
  const out = await buildCleaningXlsx(template(), node);
  const refs = [
    ...Object.keys(CLEANING_XLSX_NODE_CELLS),
    ...Object.keys(CLEANING_XLSX_UNIT_ROWS).flatMap(r => ['F' + r, 'G' + r])
  ];

  for (const ref of refs) {
    assert.equal(await fontColorOf(out, ref), 'FF000000', 'ช่อง ' + ref + ' ต้องเป็นสีดำ');
  }
});

test('อักขระพิเศษในชื่อ Node ไม่ทำให้ไฟล์เสีย', async () => {
  const out = await buildCleaningXlsx(template(), { ...node, NodeName: 'ชุมแพ & <สาขา 2>' });

  assert.equal((await readZip(out)).length, 25, 'ไฟล์ย่อยยังครบ');
  assert.equal(cellText(await sheetOf(out), 'C3'), 'ชุมแพ &amp; &lt;สาขา 2&gt;');
});

/* ================================= ชื่อไฟล์ ================================= */

test('ชื่อไฟล์ใช้ชื่อ Node เพราะใบล้างหนึ่งใบครอบคลุมทั้ง Node', () => {
  assert.equal(cleaningXlsxFileName(node), 'ฟอร์มล้าง-ชุมแพ-20260924.xlsx');
});

test('ชื่อไฟล์ไม่มีอักขระที่ Windows ตั้งชื่อไฟล์ไม่ได้', () => {
  const name = cleaningXlsxFileName({ NodeName: 'A/B:C*D?E"F<G>H|I', Date: '2026-09-24' });

  assert.ok(!/[\\/:*?"<>|]/.test(name.replace('.xlsx', '')), 'ได้ชื่อ: ' + name);
  assert.ok(name.endsWith('.xlsx'));
});

test('ไม่มีข้อมูลก็ยังได้ชื่อไฟล์ที่ใช้ได้', () => {
  assert.equal(cleaningXlsxFileName({}), 'ฟอร์มล้าง.xlsx');
  assert.equal(cleaningXlsxFileName(null), 'ฟอร์มล้าง.xlsx');
});
