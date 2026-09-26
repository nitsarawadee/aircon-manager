/**
 * ย้ายเครื่องไปแทนตำแหน่งอื่น — เหมือน "เปลี่ยนเครื่อง" ทั้งสองฝั่ง
 *
 * ============================================================================
 * ปัญหาเดิม
 * ============================================================================
 * การย้ายเปลี่ยนแค่ Node กับ Site ของแถวเดิม ได้ BKK-LPA-AIR-1 ที่ไปตั้งอยู่ใน Node
 * ของ LKB — รหัสบอกที่หนึ่ง ข้อมูลบอกอีกที่
 *
 * ============================================================================
 * กติกาที่ล็อกไว้ (ตามที่เจ้าของงานเลือก)
 * ============================================================================
 * - ข้อมูลตัวเครื่อง (ยี่ห้อ BTU รุ่น S/N ทะเบียน วันติดตั้ง ประกัน ราคา สถานะ) ตามไปปลายทาง
 * - ตำแหน่ง (รหัส Node Site ภูมิภาค จังหวัด ที่อยู่ พิกัด) ของปลายทางคงเดิม
 * - ต้นทางยังอยู่ ข้อมูลตัวเครื่องว่าง สถานะรอเครื่องใหม่
 * - ประวัติ "เปลี่ยนเครื่อง" ทั้งสองฝั่ง เก็บสเปกเครื่องเก่าไว้ และบอกว่าย้ายไป/มาจากไหน
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { moveAirUnit, replaceAirUnit, getAirList } from '../src/modules/airlist.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('staff3', 'เจ้าหน้าที่ภาค 3', 'RegionAdmin', '3', '', 1, 'x');

  const unit = db.prepare(`INSERT INTO air_units (AirCode, Region, Province, NodeName, SiteCode, LocationType,
      BTU, Brand, ModelIndoor, ModelOutdoor, IndoorAsset, IndoorSN, OutdoorAsset, OutdoorSN,
      InstallDate, WarrantyExpire, CleaningPricePerRound, Status, Lat, Long, Address, Note)
      VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?)`);
  unit.run('BKK-LPA-AIR-1', '1', 'กรุงเทพฯ', 'ลาดพร้าว', 'BKK-LPA', 'Shop House',
    18000, 'Daikin', 'FTKM18', 'RKM18', 'AS-111', 'SN-111', 'AS-112', 'SN-112',
    '2024-05-01', '2027-05-01', 500, 'ใช้งานปกติ', '13.80', '100.57', 'ซอยลาดพร้าว 1', '');
  unit.run('BKK-LKB-AIR-1', '1', 'กรุงเทพฯ', 'ลาดกระบัง', 'BKK-LKB', 'Container',
    12000, 'Carrier', 'OLD-IN', 'OLD-OUT', 'AS-900', 'SN-900', 'AS-901', 'SN-901',
    '2015-01-01', '2016-01-01', 450, 'รื้อถอน/ปลดระวาง', '13.72', '100.75', 'ถนนฉลองกรุง', 'คอมเสีย ซ่อมไม่คุ้ม');
  unit.run('KKN-CPE-AIR-1', '3', 'ขอนแก่น', 'ชุมแพ', 'KKN-CPE', 'Shop House',
    18000, 'LG', '', '', '', 'SN-300', '', '', '', '', 500, 'ใช้งานปกติ', '', '', '', '');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, u) => { const c = new Ctx({}, state, db); c.username = u; return c; };
const unitOf = (db, code) => db.prepare('SELECT * FROM air_units WHERE AirCode = ?').get(code);
const rowOf = async (db, code) => (await getAirList(as(db, 'boss'))).find(a => a.AirCode === code)._row;

test('ย้าย LPA-1 ไปแทน LKB-1 — ข้อมูลเครื่องตามไป ตำแหน่งของ LKB คงเดิม', async () => {
  const db = freshDb();
  await moveAirUnit(as(db, 'boss'), await rowOf(db, 'BKK-LPA-AIR-1'), 'BKK-LKB-AIR-1', 'ย้ายไปใช้ที่ LKB', 'BKK-LPA-AIR-1');
  const lkb = unitOf(db, 'BKK-LKB-AIR-1');

  // ตัวเครื่องมาจาก LPA
  assert.equal(lkb.Brand, 'Daikin');
  assert.equal(lkb.BTU, 18000);
  assert.equal(lkb.ModelIndoor, 'FTKM18');
  assert.equal(lkb.IndoorSN, 'SN-111');
  assert.equal(lkb.OutdoorAsset, 'AS-112');
  assert.equal(lkb.InstallDate, '2024-05-01');
  assert.equal(lkb.WarrantyExpire, '2027-05-01');
  assert.equal(lkb.CleaningPricePerRound, 500);
  assert.equal(lkb.Status, 'ใช้งานปกติ');
  assert.equal(lkb.Note, '', 'อาการเสียของเครื่องเก่าต้องไม่ค้างอยู่กับเครื่องที่ย้ายมา');

  // ตำแหน่งยังเป็นของ LKB
  assert.equal(lkb.NodeName, 'ลาดกระบัง');
  assert.equal(lkb.SiteCode, 'BKK-LKB');
  assert.equal(lkb.LocationType, 'Container');
  assert.equal(lkb.Address, 'ถนนฉลองกรุง');
  assert.equal(String(lkb.Lat), '13.72');
});

test('ต้นทางยังอยู่ ข้อมูลตัวเครื่องว่าง สถานะรอเครื่องใหม่ ตำแหน่งคงเดิม', async () => {
  const db = freshDb();
  await moveAirUnit(as(db, 'boss'), await rowOf(db, 'BKK-LPA-AIR-1'), 'BKK-LKB-AIR-1', '', 'BKK-LPA-AIR-1');
  const lpa = unitOf(db, 'BKK-LPA-AIR-1');

  assert.ok(lpa, 'แถวต้นทางต้องไม่ถูกลบ');
  for (const f of ['Brand', 'ModelIndoor', 'IndoorSN', 'OutdoorSN', 'IndoorAsset', 'InstallDate']) {
    assert.equal(lpa[f] || '', '', f + ' ต้องว่าง เครื่องย้ายออกไปแล้ว');
  }
  assert.equal(lpa.Status, 'รื้อถอน/ปลดระวาง');
  assert.match(lpa.Note, /ย้ายเครื่องไปแทน BKK-LKB-AIR-1/);
  assert.equal(lpa.NodeName, 'ลาดพร้าว');
  assert.equal(lpa.Address, 'ซอยลาดพร้าว 1');
});

test('ประวัติเป็น "เปลี่ยนเครื่อง" ทั้งสองฝั่ง เก็บสเปกเครื่องเก่าและบอกทางไป-มา', async () => {
  const db = freshDb();
  await moveAirUnit(as(db, 'boss'), await rowOf(db, 'BKK-LPA-AIR-1'), 'BKK-LKB-AIR-1', 'ย้ายไปใช้ที่ LKB', 'BKK-LPA-AIR-1');
  const h = code => db.prepare('SELECT * FROM history WHERE AirCode = ?').get(code);

  const inDest = h('BKK-LKB-AIR-1');
  assert.equal(inDest.EventType, 'เปลี่ยนเครื่อง');
  assert.match(inDest.Detail, /ย้ายเครื่องมาจาก BKK-LPA-AIR-1/);
  assert.match(inDest.Detail, /เครื่องเดิม: Carrier 12,000 BTU.*S\/N SN-900/, 'สเปกเครื่องที่ถูกแทนต้องไม่หาย');
  assert.match(inDest.Detail, /เครื่องใหม่: Daikin 18,000 BTU.*S\/N SN-111/);
  assert.match(inDest.Detail, /หมายเหตุเดิมของเครื่องเก่า: คอมเสีย/);
  assert.match(inDest.Detail, /เหตุผล: ย้ายไปใช้ที่ LKB/);

  const inSrc = h('BKK-LPA-AIR-1');
  assert.equal(inSrc.EventType, 'เปลี่ยนเครื่อง');
  assert.match(inSrc.Detail, /ย้ายเครื่องออกไปแทน BKK-LKB-AIR-1/);
  assert.match(inSrc.Detail, /เครื่องเดิม: Daikin 18,000 BTU.*S\/N SN-111/);
});

test('ต้นทางที่รอเครื่องใหม่ — กดเปลี่ยนเครื่องทีหลังได้ตามปกติ แล้วกลับมาใช้งาน', async () => {
  const db = freshDb();
  await moveAirUnit(as(db, 'boss'), await rowOf(db, 'BKK-LPA-AIR-1'), 'BKK-LKB-AIR-1', '', 'BKK-LPA-AIR-1');

  await replaceAirUnit(as(db, 'boss'), await rowOf(db, 'BKK-LPA-AIR-1'),
    { Brand: 'Mitsubishi', BTU: 18000, IndoorSN: 'SN-NEW', InstallDate: '2026-09-27' }, 'BKK-LPA-AIR-1');

  const lpa = unitOf(db, 'BKK-LPA-AIR-1');
  assert.equal(lpa.Status, 'ใช้งานปกติ');
  assert.equal(lpa.IndoorSN, 'SN-NEW');
  assert.equal(lpa.Note, '', 'ข้อความ "รอเครื่องใหม่" ต้องหายไปพร้อมเครื่องใหม่');
});

test('ย้ายเครื่องที่ติดงานซ่อม หรือรื้อถอนแล้ว ไม่ได้', async () => {
  const db = freshDb();
  db.prepare("UPDATE air_units SET Status = 'รอซ่อม' WHERE AirCode = 'BKK-LPA-AIR-1'").run();
  await assert.rejects(
    async () => moveAirUnit(as(db, 'boss'), await rowOf(db, 'BKK-LPA-AIR-1'), 'BKK-LKB-AIR-1', '', 'BKK-LPA-AIR-1'), /ย้ายไม่ได้/);

  // ตำแหน่งที่รอเครื่องใหม่อยู่ ไม่มีเครื่องให้ย้าย
  await assert.rejects(
    async () => moveAirUnit(as(db, 'boss'), await rowOf(db, 'BKK-LKB-AIR-1'), 'KKN-CPE-AIR-1', '', 'BKK-LKB-AIR-1'), /ย้ายไม่ได้/);
  assert.equal(unitOf(db, 'KKN-CPE-AIR-1').IndoorSN, 'SN-300', 'ปลายทางต้องไม่ถูกแตะ');
});

test('ปลายทางต้องมีอยู่จริง และต้องไม่ใช่ตำแหน่งเดียวกัน', async () => {
  const db = freshDb();
  await assert.rejects(async () => moveAirUnit(as(db, 'boss'), await rowOf(db, 'BKK-LPA-AIR-1'), 'BKK-XXX-AIR-9', '', 'BKK-LPA-AIR-1'), /ไม่พบตำแหน่ง/);
  await assert.rejects(async () => moveAirUnit(as(db, 'boss'), await rowOf(db, 'BKK-LPA-AIR-1'), 'bkk-lpa-air-1', '', 'BKK-LPA-AIR-1'), /คนละตำแหน่ง/);
  await assert.rejects(async () => moveAirUnit(as(db, 'boss'), await rowOf(db, 'BKK-LPA-AIR-1'), '', '', 'BKK-LPA-AIR-1'), /เลือกตำแหน่งปลายทาง/);
});

test('ย้ายข้ามไปภาคที่ไม่ได้ดูแลไม่ได้ และไม่มีอะไรถูกแตะ', async () => {
  const db = freshDb();
  // staff3 ดูแลภาค 3 → ย้ายเครื่องภาค 3 ไปแทนตำแหน่งในภาค 1 ไม่ได้
  const before = JSON.stringify(db.prepare('SELECT * FROM air_units ORDER BY AirCode').all());
  await assert.rejects(async () => moveAirUnit(as(db, 'staff3'), await rowOf(db, 'KKN-CPE-AIR-1'), 'BKK-LKB-AIR-1', '', 'KKN-CPE-AIR-1'), /ภูมิภาค/);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM air_units ORDER BY AirCode').all()), before);
});
