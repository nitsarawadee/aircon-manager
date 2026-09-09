/**
 * ล็อกความหมายของ "เปลี่ยนเครื่อง"
 *
 * รหัสเครื่องคือชื่อของ "ตำแหน่ง" ไม่ใช่ชื่อของตัวเครื่อง
 * AYA-BPC-AIR-1 หมายถึงแอร์ตัวที่ 1 ของ Node บ้านภาชี เปลี่ยนตัวเครื่องไปกี่รอบ
 * ก็ยังเป็นตัวที่ 1 ของ Node นั้น
 *
 * เวอร์ชันแรกทำผิด — ปลดระวางรหัสเดิมแล้วสร้างแถวใหม่ ซึ่งบังคับให้ตั้งรหัสใหม่
 * เพราะรหัสห้ามซ้ำ ผลคือตำแหน่งเดิมหายไปจากรายการที่ใช้งานอยู่ ทั้งที่หน้างาน
 * ยังมีแอร์อยู่ เทสต์ชุดนี้กันไม่ให้กลับไปเป็นแบบนั้นอีก
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { getAirList, replaceAirUnit } from '../src/modules/airlist.js';
import { getHistory } from '../src/modules/history.js';

const OLD = {
  Brand: 'Eminent', BTU: 18500,
  IndoorSN: '18240800035', OutdoorSN: '18240800023',
  IndoorAsset: '730000349', OutdoorAsset: '730000352',
  InstallDate: '2011-09-13'
};

const NEW = {
  Brand: 'Daikin', BTU: '18000',
  IndoorSN: 'NEW-IN-001', OutdoorSN: 'NEW-OUT-001',
  IndoorAsset: 'AIR99001', OutdoorAsset: 'AIR99002',
  InstallDate: '2026-09-09', WarrantyExpire: '2029-09-09',
  ReplaceCost: '2900', Technician: 'ช่างสมชาย'
};

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('tester', 'ผู้ทดสอบ', 'Admin', '', '', 1, 'x');

  db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status,
       Brand, BTU, IndoorSN, OutdoorSN, IndoorAsset, OutdoorAsset, InstallDate)
      VALUES ('AYA-BPC-AIR-1','สถานีรถไฟบ้านภาชี','AYA-BPC','1','อยุธยา','Shop House','ชำรุด',?,?,?,?,?,?,?)`)
    .run(OLD.Brand, OLD.BTU, OLD.IndoorSN, OLD.OutdoorSN, OLD.IndoorAsset, OLD.OutdoorAsset, OLD.InstallDate);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => {
  const c = new Ctx({}, state, db);
  c.username = 'tester';
  return c;
};
const only = async db => {
  const list = await getAirList(ctxOf(db));
  assert.equal(list.length, 1, 'ต้องมีเครื่องแถวเดียวเสมอ ห้ามงอกแถวใหม่');
  return list[0];
};

test('เปลี่ยนเครื่องแล้วต้องไม่งอกแถวใหม่ และรหัสเดิมต้องยังใช้งานอยู่', async () => {
  const db = freshDb();
  const before = await only(db);

  await replaceAirUnit(ctxOf(db), before._row, NEW, 'AYA-BPC-AIR-1');

  const after = await only(db);
  assert.equal(after.AirCode, 'AYA-BPC-AIR-1', 'รหัสเป็นของตำแหน่ง ห้ามเปลี่ยน');
  assert.equal(after.Status, 'ใช้งานปกติ', 'เปลี่ยนเครื่องเสร็จคือใช้งานได้ ไม่ใช่ปลดระวาง');
});

test('ข้อมูลของตำแหน่งต้องไม่ถูกแตะแม้แต่ช่องเดียว', async () => {
  const db = freshDb();
  await replaceAirUnit(ctxOf(db), (await only(db))._row, NEW, 'AYA-BPC-AIR-1');

  const a = await only(db);
  assert.equal(a.NodeName, 'สถานีรถไฟบ้านภาชี');
  assert.equal(a.SiteCode, 'AYA-BPC');
  assert.equal(a.Region, '1');
  assert.equal(a.Province, 'อยุธยา');
  assert.equal(a.LocationType, 'Shop House');
});

test('ข้อมูลของตัวเครื่องต้องเปลี่ยนเป็นของเครื่องใหม่ทั้งหมด', async () => {
  const db = freshDb();
  await replaceAirUnit(ctxOf(db), (await only(db))._row, NEW, 'AYA-BPC-AIR-1');

  const a = await only(db);
  assert.equal(a.IndoorSN, NEW.IndoorSN);
  assert.equal(a.OutdoorSN, NEW.OutdoorSN);
  assert.equal(a.IndoorAsset, NEW.IndoorAsset);
  assert.equal(a.OutdoorAsset, NEW.OutdoorAsset);
  assert.equal(a.Brand, NEW.Brand);
  assert.equal(String(a.BTU), NEW.BTU);
});

test('ประวัติต้องมีใบเดียว และเก็บสเปกของเครื่องเก่ากับเครื่องใหม่ไว้ครบ', async () => {
  // ใบนี้เป็นที่เดียวที่บอกได้ว่าเครื่องตัวก่อนคือตัวไหน
  // และเป็นเส้นแบ่งที่หน้าเว็บใช้กำกับว่าประวัติเก่าเป็นของเครื่องตัวเก่า
  const db = freshDb();
  await replaceAirUnit(ctxOf(db), (await only(db))._row, NEW, 'AYA-BPC-AIR-1');

  const hist = await getHistory(ctxOf(db));
  assert.equal(hist.length, 1, 'ไม่ต้องมีใบ "ติดตั้ง" เพิ่ม เพราะไม่ได้เพิ่มเครื่องใหม่เข้าระบบ');

  const h = hist[0];
  assert.equal(h.EventType, 'เปลี่ยนเครื่อง');
  assert.equal(h.AirCode, 'AYA-BPC-AIR-1');
  assert.equal(Number(h.Cost), 2900);

  for (const v of [OLD.IndoorSN, OLD.OutdoorSN, OLD.IndoorAsset, OLD.OutdoorAsset, OLD.Brand]) {
    assert.ok(h.Detail.includes(String(v)), 'รายละเอียดต้องมีของเครื่องเก่า: ' + v);
  }
  for (const v of [NEW.IndoorSN, NEW.OutdoorSN, NEW.IndoorAsset, NEW.OutdoorAsset, NEW.Brand]) {
    assert.ok(h.Detail.includes(String(v)), 'รายละเอียดต้องมีของเครื่องใหม่: ' + v);
  }
});

test('ประวัติการล้าง/ซ่อมของเดิมต้องยังผูกกับตำแหน่งเดิม ไม่หายไปไหน', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO history (ID, AirCode, Date, EventType, Detail, Cost)
              VALUES ('PM2608-19','AYA-BPC-AIR-1','2026-08-25','ล้างแอร์','ล้างรอบที่ 1',450)`).run();

  await replaceAirUnit(ctxOf(db), (await only(db))._row, NEW, 'AYA-BPC-AIR-1');

  const hist = await getHistory(ctxOf(db));
  assert.equal(hist.length, 2);
  assert.ok(hist.some(h => h.ID === 'PM2608-19'), 'ประวัติการล้างของเครื่องเก่าต้องยังอยู่');
  assert.ok(hist.every(h => h.AirCode === 'AYA-BPC-AIR-1'), 'ทุกใบยังผูกกับตำแหน่งเดิม');
});

test('ไม่ระบุตัวระบุของเครื่องใหม่เลย ต้องไม่ยอมบันทึก', async () => {
  // ถ้าปล่อยผ่าน จะได้ใบประวัติที่บอกว่าเปลี่ยนเครื่องแล้ว
  // แต่ไม่มีอะไรบอกว่าเปลี่ยนเป็นเครื่องตัวไหน ซึ่งไร้ประโยชน์
  const db = freshDb();
  const row = (await only(db))._row;
  await assert.rejects(
    () => replaceAirUnit(ctxOf(db), row, { Brand: 'Daikin' }, 'AYA-BPC-AIR-1'),
    /S\/N หรือเลขทะเบียนทรัพย์สิน/
  );

  const a = await only(db);
  assert.equal(a.IndoorSN, OLD.IndoorSN, 'ต้องไม่เขียนอะไรลงไปเลยเมื่อถูกปฏิเสธ');
  assert.equal(a.Status, 'ชำรุด');
});

test('เปลี่ยนเครื่องด้วยลำดับแถวที่เลื่อนไปแล้ว ต้องถูกบล็อก', async () => {
  const db = freshDb();
  const row = (await only(db))._row;
  await assert.rejects(
    () => replaceAirUnit(ctxOf(db), row, NEW, 'คนละรหัส-AIR-9'),
    /ถูกเปลี่ยนไปแล้ว/
  );
});

test('หมายเหตุอาการเสียของเครื่องเก่า ต้องถูกล้าง แต่ไม่หายไปเฉยๆ', async () => {
  // อาการเสียจบไปพร้อมกับเครื่องที่ถูกยกออกไปแล้ว ถ้าค้างไว้หน้าเครื่องจะโชว์
  // อาการของเครื่องที่ไม่อยู่ที่นั่นอีก — อาการเดียวกับที่เคยแก้ตอนปิดงานซ่อม
  const db = freshDb();
  db.prepare("UPDATE air_units SET Note = 'คอมเพรสเซอร์ดัง ซ่อมไม่ได้' WHERE AirCode = 'AYA-BPC-AIR-1'").run();

  await replaceAirUnit(ctxOf(db), (await only(db))._row, NEW, 'AYA-BPC-AIR-1');

  assert.equal((await only(db)).Note, '', 'หมายเหตุต้องว่าง');

  const h = (await getHistory(ctxOf(db)))[0];
  assert.ok(h.Detail.includes('คอมเพรสเซอร์ดัง ซ่อมไม่ได้'), 'ข้อความเดิมต้องถูกเก็บลงประวัติ');
});

test('เครื่องที่ไม่มีหมายเหตุอยู่แล้ว ต้องไม่มีข้อความหมายเหตุงอกในประวัติ', async () => {
  const db = freshDb();
  await replaceAirUnit(ctxOf(db), (await only(db))._row, NEW, 'AYA-BPC-AIR-1');
  const h = (await getHistory(ctxOf(db)))[0];
  assert.ok(!h.Detail.includes('หมายเหตุเดิม'), 'ไม่มีหมายเหตุก็ไม่ต้องเขียนถึง');
});
