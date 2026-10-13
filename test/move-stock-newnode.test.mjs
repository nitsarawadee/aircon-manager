/**
 * ย้ายเครื่องเข้าคลัง / ย้ายไป Node ใหม่ที่ยังไม่มีแอร์ (เจ้าของงานกำหนด 14/10/2569)
 *
 * ต้นทางเหมือนย้ายไปแทนตำแหน่งที่มีอยู่ทุกอย่าง — ตำแหน่งว่าง "รื้อถอน/ปลดระวาง" รอเครื่องใหม่
 *   เข้าคลัง   ตัวเครื่องไปอยู่หน้าคลังพร้อม Serial/Asset
 *   Node ใหม่  ระบบสร้างตำแหน่งใหม่ ข้อมูลตัวเครื่องติดไปด้วย ใช้งานได้ทันที + งานรอเอกสารติดตั้ง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { INSTALL_PENDING_NOTE } from '../src/schema.js';
import { moveAirUnitToStock, moveAirUnitToNewNode } from '../src/modules/airlist.js';
import { saveInstallForm, getInstallForms, deleteInstallForm } from '../src/modules/installform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  user.run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  user.run('staff', 'สตาฟ ภาคหนึ่ง', 'Staff', '1', '', 1, 'x');
  const a = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU, IndoorSN, OutdoorSN, IndoorAsset)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  a.run('ATG-ATG-AIR-1', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'ใช้งานปกติ', 'Daikin', 18000, 'IN-001', 'OUT-001', 'AS-001');
  a.run('ATG-ATG-AIR-2', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'ชำรุด', 'Carrier', 24000, 'IN-002', '', '');
  a.run('KKN-MNG-AIR-1', 'เมืองขอนแก่น', 'KKN-MNG', '3', 'ขอนแก่น', 'ใช้งานปกติ', 'LG', 12000, 'IN-003', '', '');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };
const as = (db, u) => { const c = new Ctx({}, state, db, {}); c.username = u; return c; };
const unit = (db, code) => ({ ...db.prepare('SELECT * FROM air_units WHERE AirCode = ?').get(code) });
/** เลขแถวแบบที่หน้าเว็บส่งมา — แถว 1 คือหัวตาราง เครื่องตัวแรกอยู่แถว 2 */
const rowOf = (db, code) => db.prepare('SELECT AirCode FROM air_units ORDER BY row_id').all()
  .findIndex(x => x.AirCode === code) + 2;
const historyOf = (db, code) => db.prepare('SELECT EventType, Detail, Note FROM history WHERE AirCode = ? ORDER BY rowid').all(code);

const NEW_NODE = {
  AirCode: 'ATG-PMK-AIR-1', NodeName: 'โพธิ์ม่วงพันธ์', SiteCode: 'ATG-PMK', Region: '1', Province: 'อ่างทอง', LocationType: 'Shop House'
};

test('ย้ายเข้าคลัง: ตัวเครื่องอยู่ในคลังพร้อม Serial/Asset · ตำแหน่งเดิมว่าง รอเครื่องใหม่', async () => {
  const db = freshDb();
  const res = await moveAirUnitToStock(as(db, 'staff'), rowOf(db, 'ATG-ATG-AIR-1'), 'ไม่ใช้แล้ว', 'ATG-ATG-AIR-1');

  const stock = db.prepare('SELECT * FROM warehouse_units').all();
  assert.equal(stock.length, 1);
  assert.equal(stock[0].ID, res.stockId);
  assert.deepEqual([stock[0].AirCode, stock[0].Brand, stock[0].IndoorSN, stock[0].OutdoorSN, stock[0].IndoorAsset],
    ['ATG-ATG-AIR-1', 'Daikin', 'IN-001', 'OUT-001', 'AS-001']);

  const src = unit(db, 'ATG-ATG-AIR-1');
  assert.equal(src.Status, 'รื้อถอน/ปลดระวาง');
  assert.equal(src.Brand, '');
  assert.equal(src.IndoorSN, '');
  assert.match(src.Note, /เข้าคลัง.*รอเครื่องใหม่/);
  const [h] = historyOf(db, 'ATG-ATG-AIR-1');
  assert.equal(h.EventType, 'เปลี่ยนเครื่อง');
  assert.match(h.Detail, /เข้าคลัง.*IN-001.*ตำแหน่งว่าง รอเครื่องใหม่.*ไม่ใช้แล้ว/);
});

test('ย้ายเข้าคลัง: เครื่องมีงานซ่อมค้าง / นอกภาค / ไม่มีข้อมูลตัวเครื่อง — ไม่ได้ และไม่มีอะไรค้าง', async () => {
  const db = freshDb();
  await assert.rejects(() => moveAirUnitToStock(as(db, 'staff'), rowOf(db, 'ATG-ATG-AIR-2'), '', 'ATG-ATG-AIR-2'), /ย้ายไม่ได้/);
  await assert.rejects(() => moveAirUnitToStock(as(db, 'staff'), rowOf(db, 'KKN-MNG-AIR-1'), '', 'KKN-MNG-AIR-1'), /ภูมิภาค "3"/);

  db.exec("UPDATE air_units SET Brand = '', IndoorSN = '', OutdoorSN = '', IndoorAsset = '' WHERE AirCode = 'ATG-ATG-AIR-1'");
  await assert.rejects(() => moveAirUnitToStock(as(db, 'staff'), rowOf(db, 'ATG-ATG-AIR-1'), '', 'ATG-ATG-AIR-1'), /ไม่มีข้อมูลตัวเครื่อง/);

  assert.equal(db.prepare('SELECT COUNT(*) n FROM warehouse_units').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM history').get().n, 0);
  assert.equal(unit(db, 'ATG-ATG-AIR-1').Status, 'ใช้งานปกติ');
});

test('ย้ายไป Node ใหม่: สร้างตำแหน่งใหม่ ข้อมูลเครื่องติดไป ใช้งานได้ทันที + รอเอกสารติดตั้ง · ต้นทางรอเครื่องใหม่', async () => {
  const db = freshDb();
  const res = await moveAirUnitToNewNode(as(db, 'staff'), rowOf(db, 'ATG-ATG-AIR-1'), NEW_NODE, 'ย้ายตามงานขยาย', 'ATG-ATG-AIR-1');
  assert.equal(res.destCode, 'ATG-PMK-AIR-1');

  const dest = unit(db, 'ATG-PMK-AIR-1');
  assert.deepEqual([dest.NodeName, dest.SiteCode, dest.Region, dest.Province, dest.LocationType],
    ['โพธิ์ม่วงพันธ์', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House']);
  assert.deepEqual([dest.Brand, dest.BTU, dest.IndoorSN, dest.OutdoorSN, dest.IndoorAsset],
    ['Daikin', 18000, 'IN-001', 'OUT-001', 'AS-001']);
  assert.equal(dest.Status, 'ใช้งานปกติ');
  const [dh] = historyOf(db, 'ATG-PMK-AIR-1');
  assert.equal(dh.EventType, 'ติดตั้ง');
  assert.equal(dh.Note, INSTALL_PENDING_NOTE);
  assert.match(dh.Detail, /ย้ายเครื่องมาจาก ATG-ATG-AIR-1/);

  const src = unit(db, 'ATG-ATG-AIR-1');
  assert.equal(src.Status, 'รื้อถอน/ปลดระวาง');
  assert.equal(src.IndoorSN, '');
  assert.match(historyOf(db, 'ATG-ATG-AIR-1')[0].Detail, /ไปติดตั้งที่ ATG-PMK-AIR-1/);
});

test('ย้ายไป Node ใหม่: Node มีแอร์อยู่แล้ว / รหัสซ้ำ / ไม่กรอกช่องที่ต้องมี / ภาคที่ไม่ได้ดูแล — ไม่ได้', async () => {
  const db = freshDb();
  const go = place => moveAirUnitToNewNode(as(db, 'staff'), rowOf(db, 'ATG-ATG-AIR-1'), place, '', 'ATG-ATG-AIR-1');
  await assert.rejects(() => go({ ...NEW_NODE, NodeName: 'เมืองขอนแก่น' }), /มีแอร์อยู่แล้ว/);
  await assert.rejects(() => go({ ...NEW_NODE, SiteCode: 'KKN-MNG' }), /มีแอร์อยู่แล้ว/);
  await assert.rejects(() => go({ ...NEW_NODE, AirCode: 'KKN-MNG-AIR-1' }), /มีรหัสเครื่อง KKN-MNG-AIR-1 อยู่แล้ว/);
  await assert.rejects(() => go({ ...NEW_NODE, NodeName: '' }), /ชื่อ Node/);
  await assert.rejects(() => go({ ...NEW_NODE, Region: '3' }), /ภูมิภาค "3"/);

  assert.equal(db.prepare('SELECT COUNT(*) n FROM air_units').get().n, 3, 'ต้องไม่มีตำแหน่งงอกออกมา');
  assert.equal(unit(db, 'ATG-ATG-AIR-1').Status, 'ใช้งานปกติ');
});

test('ย้ายไป Node ใหม่ แล้วกรอกใบติดตั้ง · ลบใบติดตั้ง — งานกลับไปรอเอกสาร ประวัติย้ายมาไม่หาย', async () => {
  const db = freshDb();
  await moveAirUnitToNewNode(as(db, 'infra'), rowOf(db, 'ATG-ATG-AIR-1'), NEW_NODE, '', 'ATG-ATG-AIR-1');
  await saveInstallForm(as(db, 'infra'), { AirCode1: 'ATG-PMK-AIR-1', Date: '2026-10-14', TechnicianName: 'ช่าง', Checklist: [] });
  assert.notEqual(historyOf(db, 'ATG-PMK-AIR-1')[0].Note, INSTALL_PENDING_NOTE);

  const [form] = await getInstallForms(as(db, 'infra'));
  await deleteInstallForm(as(db, 'infra'), form._row, form.ID);

  const h = historyOf(db, 'ATG-PMK-AIR-1');
  assert.equal(h.length, 1, 'แถวย้ายมาต้องยังอยู่ ไม่ถูกลบเหมือนแถวที่ใบติดตั้งลงเอง');
  assert.equal(h[0].Note, INSTALL_PENDING_NOTE);
  assert.equal(unit(db, 'ATG-PMK-AIR-1').Status, 'ใช้งานปกติ', 'เครื่องย้ายมาไม่ใช่เครื่องเพิ่มใหม่ ไม่กลับเป็นรอติดตั้ง');
});
