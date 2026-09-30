/**
 * ทดสอบนิยามไฟล์นำเข้า
 *
 * เทสต์ชุดนี้ทำหน้าที่เป็น "สัญญา" กับคนที่กำลังกรอกข้อมูลจริงอยู่ตอนนี้
 * เขากรอกไปแล้วหลายร้อยแถวก่อนที่ตัวนำเข้าจริงจะเขียนเสร็จ
 * ถ้ามีใครไปแก้ชื่อคอลัมน์หรือรูปแบบรหัสเครื่องทีหลัง งานที่กรอกไว้จะเสียเปล่า
 * เทสต์พวกนี้จะพังทันทีเพื่อเตือนว่ากำลังจะทำแบบนั้น
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { COLUMNS, HEADERS, ALLOWED, makeAirCode, validateRow } from '../src/import-spec.js';

/** แถวที่ถูกต้องครบทุกช่อง ใช้เป็นฐานแล้วแก้ทีละช่องเพื่อทดสอบ */
const ok = () => ({
  Region: '1', Province: 'อ่างทอง', NodeName: 'อ่างทอง', SiteCode: 'ATG-ATG',
  LocationType: 'Shop House', AirNo: '1', Brand: 'Carrier', BTU: '18000',
  ModelIndoor: '42TSAA018', ModelOutdoor: '38TSAA018',
  IndoorAsset: 'AIR00929', IndoorSN: '22505915',
  OutdoorAsset: 'AIR00930', OutdoorSN: '22600647',
  InstallDate: '2020-03-15', WarrantyExpire: '2023-03-15',
  CleaningPricePerRound: '450', Status: 'ใช้งานปกติ', Note: ''
});

const errorsOf = row => validateRow(row).filter(p => p.level === 'error');
const warnsOf = row => validateRow(row).filter(p => p.level === 'warn');

/* ---------------- รูปแบบไฟล์ที่ห้ามเปลี่ยน ---------------- */

test('ลำดับและชื่อคอลัมน์ต้องไม่เปลี่ยน — ไฟล์ที่กรอกไว้แล้วจะใช้ไม่ได้', () => {
  assert.deepEqual(HEADERS, [
    'Region', 'Province', 'NodeName', 'SiteCode', 'LocationType', 'AirNo',
    'Brand', 'BTU', 'ModelIndoor', 'ModelOutdoor',
    'IndoorAsset', 'IndoorSN', 'OutdoorAsset', 'OutdoorSN',
    'InstallDate', 'WarrantyExpire', 'CleaningPricePerRound', 'Status', 'Note'
  ]);
});

test('รหัสเครื่องต้องสร้างตามรูปแบบเดิมที่ใช้อยู่จริงทั้ง 457 เครื่อง', () => {
  assert.equal(makeAirCode('ATG-ATG', 1), 'ATG-ATG-AIR-1');
  assert.equal(makeAirCode('ATG-ATG', '2'), 'ATG-ATG-AIR-2');
  assert.equal(makeAirCode(' ATG-ATG ', ' 3 '), 'ATG-ATG-AIR-3', 'ช่องว่างที่ติดมาต้องถูกตัด');
});

test('ช่องที่บังคับกรอกต้องเป็นชุดเดิม', () => {
  const required = COLUMNS.filter(c => c.required).map(c => c.name);
  assert.deepEqual(required, ['Region', 'Province', 'NodeName', 'SiteCode', 'LocationType', 'AirNo']);
});

test('ค่าที่ยอมรับได้ต้องตรงกับที่ระบบใช้อยู่จริง', () => {
  assert.deepEqual(ALLOWED.Region, ['1', '2', '3', '4', '5', '6']);
  assert.equal(ALLOWED.LocationType.length, 7);
  assert.ok(ALLOWED.Status.includes('ใช้งานปกติ'));
});

/* ---------------- แถวที่ถูกต้อง ---------------- */

test('แถวที่กรอกครบถูกต้อง ต้องไม่มีปัญหาเลย', () => {
  assert.deepEqual(validateRow(ok()), []);
});

test('ช่องที่ไม่บังคับเว้นว่างได้ ไม่ถือเป็นข้อผิดพลาด', () => {
  const row = ok();
  for (const c of COLUMNS) if (!c.required) row[c.name] = '';
  assert.deepEqual(errorsOf(row), []);
});

/* ---------------- จับความผิดพลาดจากคน ---------------- */

test('ช่องบังคับที่เว้นว่างต้องถูกจับ', () => {
  const row = ok(); row.Province = '   ';
  assert.equal(errorsOf(row).length, 1);
  assert.equal(errorsOf(row)[0].column, 'Province');
});

test('ค่าที่ไม่อยู่ในรายการต้องถูกจับ พร้อมบอกว่าใช้อะไรได้บ้าง', () => {
  const row = ok(); row.LocationType = 'ShopHouse';   // ลืมเว้นวรรค
  const e = errorsOf(row);
  assert.equal(e.length, 1);
  assert.ok(e[0].message.includes('Shop House'), 'ต้องบอกค่าที่ใช้ได้ ไม่ใช่แค่บอกว่าผิด');
});

/* ---------------- จับความเสียหายที่ Excel ทำเงียบๆ ---------------- */

test('เลขที่มีลูกน้ำคั่นหลักต้องถูกจับ พร้อมบอกค่าที่ควรเป็น', () => {
  const row = ok(); row.BTU = '18,000';
  const e = errorsOf(row);
  assert.equal(e.length, 1);
  assert.ok(e[0].message.includes('18000'), 'ต้องบอกค่าที่แก้แล้วให้เลย');
});

test('วันที่ใส่วันก่อนเดือน (15/3/2020) ต้องถูกจับ พร้อมบอกว่าต้องเป็น เดือน/วัน/ปี', () => {
  // Template ใช้ เดือน/วัน/ปี ค.ศ. (4/26/2018) ตามที่เจ้าของงานกำหนด
  const row = ok(); row.InstallDate = '15/3/2020';
  const e = errorsOf(row);
  assert.equal(e.length, 1);
  assert.ok(e[0].message.includes('วันก่อนเดือน'), 'ต้องบอกสาเหตุ ไม่ใช่แค่บอกว่ารูปแบบผิด');
});

test('วันที่ เดือน/วัน/ปี (4/26/2018) รับได้ และเก็บเป็นรูปแบบของระบบ · ปี-เดือน-วัน เดิมก็ยังรับ', async () => {
  const { toIsoDate, canonicalize } = await import('../src/import-spec.js');
  const row = ok(); row.InstallDate = '4/26/2018';
  assert.equal(errorsOf(row).length, 0);
  assert.equal(canonicalize('InstallDate', '4/26/2018'), '2018-04-26');
  assert.equal(toIsoDate('2018-04-26'), '2018-04-26');
  assert.equal(toIsoDate('2/30/2020'), null, 'วันที่ไม่มีจริง');
});

test('ปี พ.ศ. ต้องถูกจับ — อายุเครื่องจะเพี้ยนไป 543 ปี', () => {
  const row = ok(); row.InstallDate = '4/26/2561';
  const e = errorsOf(row);
  assert.equal(e.length, 1);
  assert.ok(e[0].message.includes('ค.ศ.'));
});

test('วันที่ผิดรูปแบบแบบอื่น ต้องถูกจับแต่ไม่โทษ Excel มั่ว', () => {
  const row = ok(); row.InstallDate = 'ไม่ทราบ';
  const e = errorsOf(row);
  assert.equal(e.length, 1);
  assert.ok(!e[0].message.includes('Excel'), 'อย่าเดาสาเหตุเมื่อไม่ได้เข้าข่าย');
});

test('Serial ที่เป็นตัวเลขสั้นๆ ต้องเตือน แต่ไม่ห้ามนำเข้า', () => {
  // ห้ามไม่ได้ เพราะค่าจริงอาจไม่มีศูนย์นำหน้ามาตั้งแต่แรก — ต้องให้คนตัดสิน
  const row = ok(); row.IndoorSN = '12345';
  assert.equal(errorsOf(row).length, 0, 'ห้ามกลายเป็น error');
  assert.equal(warnsOf(row).length, 1);
});

test('Serial ยาวปกติต้องไม่เตือนพร่ำเพรื่อ', () => {
  const row = ok(); row.IndoorSN = '22505915';
  assert.equal(warnsOf(row).length, 0, 'เตือนบ่อยเกินไปจนคนเลิกอ่านคือเตือนเสียเปล่า');
});

test('เลขเครื่องต้องเป็นจำนวนเต็ม', () => {
  const row = ok(); row.AirNo = '1.5';
  assert.equal(errorsOf(row).length, 1);
});

test('ค่าล้างเป็นทศนิยมได้ ไม่ใช่ข้อผิดพลาด', () => {
  const row = ok(); row.CleaningPricePerRound = '450.50';
  assert.equal(errorsOf(row).length, 0);
});
