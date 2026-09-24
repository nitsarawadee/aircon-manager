/**
 * ฟอร์มติดตั้งเปล่าแบบ Excel
 *
 * ============================================================================
 * จุดที่ต่างจากอีกสองฟอร์ม
 * ============================================================================
 * ไฟล์นี้มี "ช่องติ๊ก" ของ Excel จริงอยู่ 4 อัน (ผ่าน/ไม่ผ่าน ของสองเครื่อง)
 * ซึ่งเก็บอยู่คนละที่กับเซลล์ — อยู่ใน vmlDrawing กับ ctrlProps
 *
 * ของพวกนี้หายง่ายมากเวลาแกะไฟล์แล้วประกอบกลับ และถ้าหายจะไม่มีอะไรฟ้อง
 * จนกว่าจะมีคนเปิดไฟล์แล้วพบว่าติ๊กตรวจรับไม่ได้ ตอนอยู่หน้างาน
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { readZip } from '../src/modules/zip.js';
import {
  buildInstallXlsx, installXlsxValues, installXlsxFileName,
  INSTALL_XLSX_NODE_CELLS, INSTALL_XLSX_UNIT_ROWS
} from '../src/modules/install-xlsx.js';

const TEMPLATE = join(process.cwd(), 'assets', 'forms', 'install-form-template.xlsx');
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

async function fontColorOf(file, ref) {
  const entries = await readZip(file);
  const sheet = text(entries.find(e => e.name === MAIN).data);
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
  Unit1_Brand: 'Daikin', Unit1_BTU: '24000',
  Unit1_IndoorSerial: 'IN-001', Unit1_IndoorAsset: 'AST-001',
  Unit1_OutdoorSerial: 'OUT-001', Unit1_OutdoorAsset: 'AST-002',
  Unit2_IndoorSerial: 'IN-002', Unit2_IndoorAsset: 'AST-003',
  Unit2_OutdoorSerial: 'OUT-002', Unit2_OutdoorAsset: 'AST-004'
};

/* ============================== ไฟล์แม่แบบ ============================== */

test('ไฟล์แม่แบบมีอยู่จริงในโปรเจกต์', () => {
  assert.ok(existsSync(TEMPLATE), 'ต้องมี assets/forms/install-form-template.xlsx');
});

test('แม่แบบมีครบทั้งหน้าฟอร์ม หน้ารูปสองหน้า และช่องติ๊ก', async () => {
  const names = (await readZip(template())).map(e => e.name);

  assert.ok(names.includes(MAIN), 'ต้องมีหน้าฟอร์ม');
  assert.ok(names.includes(PHOTO1), 'ต้องมีหน้ารูปเครื่องที่ 1');
  assert.ok(names.includes(PHOTO2), 'ต้องมีหน้ารูปเครื่องที่ 2');
  assert.ok(names.includes('xl/media/image1.png'), 'ต้องมีโลโก้');
  assert.ok(names.includes('xl/drawings/vmlDrawing1.vml'), 'ต้องมีที่อยู่ของช่องติ๊ก');

  const ctrl = names.filter(n => n.includes('ctrlProps'));
  assert.equal(ctrl.length, 4, 'ช่องติ๊ก ผ่าน/ไม่ผ่าน ของสองเครื่อง รวม 4 อัน');
});

test('ทุกช่องที่ประกาศไว้ มีอยู่จริงในแม่แบบ', async () => {
  const xml = await sheetOf(template());
  const refs = [
    ...Object.keys(INSTALL_XLSX_NODE_CELLS),
    ...Object.keys(INSTALL_XLSX_UNIT_ROWS).flatMap(r => ['F' + r, 'G' + r])
  ];

  for (const ref of refs) {
    assert.ok(
      new RegExp('<c r="' + ref + '"').test(xml),
      'แม่แบบไม่มีช่อง ' + ref + ' — ถ้าฟอร์มเปลี่ยน Rev ต้องแก้แผนที่ช่องตาม'
    );
  }
});

/* ==================== ช่องติ๊กต้องรอด (จุดเสี่ยงที่สุดของฟอร์มนี้) ==================== */

test('เติมข้อมูลแล้ว ช่องติ๊กทั้ง 4 อันต้องยังอยู่ครบและไม่ถูกแตะ', async () => {
  const before = await readZip(template());
  const after = await readZip(await buildInstallXlsx(template(), node));

  const risky = [
    'xl/drawings/vmlDrawing1.vml',
    'xl/ctrlProps/ctrlProp1.xml', 'xl/ctrlProps/ctrlProp2.xml',
    'xl/ctrlProps/ctrlProp3.xml', 'xl/ctrlProps/ctrlProp4.xml',
    'xl/drawings/drawing1.xml', 'xl/worksheets/_rels/sheet1.xml.rels'
  ];

  for (const name of risky) {
    const a = before.find(e => e.name === name);
    const b = after.find(e => e.name === name);
    assert.ok(b, 'ไฟล์ ' + name + ' หายไป — ช่องติ๊กจะใช้ไม่ได้');
    assert.deepEqual(b.data, a.data, name + ' ต้องเหมือนเดิมทุกไบต์');
  }
});

test('ชีตที่แก้ ต้องยังอ้างถึงช่องติ๊กอยู่', async () => {
  const xml = await sheetOf(await buildInstallXlsx(template(), node));

  assert.ok(/<legacyDrawing/.test(xml), 'ขาดที่อยู่ของช่องติ๊ก');
  assert.ok(/<controls>|mc:AlternateContent/.test(xml), 'ขาดบล็อก controls');
});

/* ============================== ข้อมูลลงถูกช่อง ============================== */

test('ข้อมูล Node ลงตรงกับป้ายชื่อที่พิมพ์มากับฟอร์ม', async () => {
  const xml = await sheetOf(await buildInstallXlsx(template(), node));

  assert.equal(cellText(xml, 'C3'), 'ชุมแพ', 'แถว 3 ซ้าย = Node');
  assert.equal(cellText(xml, 'G3'), 'Shop House', 'แถว 3 ขวา = ประเภท Node');
  assert.equal(cellText(xml, 'C4'), 'ขอนแก่น', 'แถว 4 ซ้าย = จังหวัด');
  assert.equal(cellText(xml, 'G4'), 'Daikin', 'แถว 4 ขวา = Brand');
  assert.equal(cellText(xml, 'C5'), '24/09/2026', 'แถว 5 ซ้าย = วันที่');
  assert.equal(cellText(xml, 'G5'), '24000', 'แถว 5 ขวา = BTU');
});

test('ข้อมูลเครื่องสองตัวอยู่คนละคอลัมน์ ไม่สลับกัน', async () => {
  const xml = await sheetOf(await buildInstallXlsx(template(), node));

  assert.equal(cellText(xml, 'F9'), 'IN-001');
  assert.equal(cellText(xml, 'F10'), 'AST-001');
  assert.equal(cellText(xml, 'F11'), 'OUT-001');
  assert.equal(cellText(xml, 'F12'), 'AST-002');

  assert.equal(cellText(xml, 'G9'), 'IN-002');
  assert.equal(cellText(xml, 'G10'), 'AST-003');
  assert.equal(cellText(xml, 'G11'), 'OUT-002');
  assert.equal(cellText(xml, 'G12'), 'AST-004');
});

test('ติดตั้งเครื่องเดียว คอลัมน์ของตัวที่ 2 ต้องว่างทั้งแถบ', async () => {
  const one = { ...node };
  for (const key of Object.keys(one)) if (key.startsWith('Unit2_')) one[key] = '';

  const xml = await sheetOf(await buildInstallXlsx(template(), one));

  assert.equal(cellText(xml, 'F9'), 'IN-001', 'ตัวที่ 1 ยังอยู่ครบ');
  for (const row of Object.keys(INSTALL_XLSX_UNIT_ROWS)) {
    assert.equal(cellText(xml, 'G' + row), null, 'ช่อง G' + row + ' ต้องว่าง');
  }
});

test('เวลาเริ่ม–สิ้นสุดกับรวมเวลา ต้องเว้นว่างไว้ให้กรอกหน้างาน', async () => {
  const xml = await sheetOf(await buildInstallXlsx(template(), node));

  assert.equal(cellText(xml, 'C6'), null);
  assert.equal(cellText(xml, 'G6'), null);
});

test('หน้ารูปทั้งสองหน้าได้ชื่อ Node กับวันที่มาให้', async () => {
  const out = await buildInstallXlsx(template(), node);

  for (const sheet of [PHOTO1, PHOTO2]) {
    const xml = await sheetOf(out, sheet);
    assert.equal(cellText(xml, 'C2'), 'ชุมแพ', sheet + ' ต้องมีชื่อ Node');
    assert.equal(cellText(xml, 'H2'), '24/09/2026', sheet + ' ต้องมีวันที่');
  }
});

test('วันที่เป็น วว/ดด/ปปปป และไม่มีวันที่ก็ไม่ขึ้นคำว่า undefined', () => {
  assert.equal(installXlsxValues(node)[MAIN].C5, '24/09/2026');
  assert.equal(installXlsxValues({ NodeName: 'ก' })[MAIN].C5, '');
});

test('ส่งของว่างเข้าไปก็ไม่ระเบิด', () => {
  assert.doesNotThrow(() => installXlsxValues(null));
  assert.doesNotThrow(() => installXlsxValues(undefined));
});

/* ============================== ฟอร์มต้องไม่เพี้ยน ============================== */

test('เติมข้อมูลแล้ว ไฟล์ย่อยอื่นต้องไม่ถูกแตะ', async () => {
  const before = await readZip(template());
  const after = await readZip(await buildInstallXlsx(template(), node));

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
  const after = await sheetOf(await buildInstallXlsx(template(), node));

  const merges = s => (s.match(/<mergeCell /g) || []).length;
  assert.equal(merges(after), merges(before));

  const styled = s => (s.match(/ s="\d+"/g) || []).length;
  assert.equal(styled(after), styled(before));
});

test('ข้อมูลที่ระบบเติมออกมาเป็นสีดำทุกช่อง', async () => {
  const out = await buildInstallXlsx(template(), node);
  const refs = [
    ...Object.keys(INSTALL_XLSX_NODE_CELLS),
    ...Object.keys(INSTALL_XLSX_UNIT_ROWS).flatMap(r => ['F' + r, 'G' + r])
  ];

  for (const ref of refs) {
    assert.equal(await fontColorOf(out, ref), 'FF000000', 'ช่อง ' + ref + ' ต้องเป็นสีดำ');
  }
});

/* ================================= ชื่อไฟล์ ================================= */

test('ชื่อไฟล์ใช้ชื่อ Node เพราะใบเดียวครอบคลุมได้สองเครื่อง', () => {
  assert.equal(installXlsxFileName(node), 'ฟอร์มติดตั้ง-ชุมแพ-20260924.xlsx');
});

test('ชื่อไฟล์ไม่มีอักขระที่ Windows ตั้งชื่อไฟล์ไม่ได้', () => {
  const name = installXlsxFileName({ NodeName: 'A/B:C*D?E"F<G>H|I', Date: '2026-09-24' });

  assert.ok(!/[\\/:*?"<>|]/.test(name.replace('.xlsx', '')), 'ได้ชื่อ: ' + name);
  assert.ok(name.endsWith('.xlsx'));
});

test('ไม่มีข้อมูลก็ยังได้ชื่อไฟล์ที่ใช้ได้', () => {
  assert.equal(installXlsxFileName({}), 'ฟอร์มติดตั้ง.xlsx');
  assert.equal(installXlsxFileName(null), 'ฟอร์มติดตั้ง.xlsx');
});
