/**
 * คลังแอร์ — เครื่องเก่าที่ถอดออกจากตำแหน่ง (src/modules/warehouse.js)
 *
 * - เปลี่ยนเครื่อง: เครื่องเก่าเข้าคลังพร้อม Serial/Asset/อาการเสีย
 * - ย้ายเครื่องไปแทน: เครื่องเดิมของปลายทางเข้าคลัง
 * - ตำแหน่งว่าง ไม่มีเครื่องให้เก็บ
 * - ซ่อมไม่ได้ (ยังไม่เปลี่ยนเครื่อง) อยู่ในรายการ "ตำแหน่งที่เลิกใช้" ไม่ใช่ในคลัง
 * - Write off ในคลังได้ · เห็นเฉพาะภูมิภาคตัวเอง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { replaceAirUnit, moveAirUnit } from '../src/modules/airlist.js';
import { getWarehouse, writeOffStock } from '../src/modules/warehouse.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const u = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  u.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  u.run('r1', 'ภาค 1', 'RegionAdmin', '1', '', 1, 'x');
  u.run('r2', 'ภาค 2', 'RegionAdmin', '2', '', 1, 'x');
  const add = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, Brand, BTU, IndoorSN, IndoorAsset, Note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  add.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'รื้อถอน/ปลดระวาง', 'Carrier', 18000, 'OLD-SN-1', 'AST-1', 'คอมเพรสเซอร์เสีย');
  add.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'ใช้งานปกติ', 'Daikin', 24000, 'SN-2', 'AST-2', '');
  add.run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'ใช้งานปกติ', 'LG', 12000, 'SN-W1', 'AST-W1', '');
  add.run('CNX-CNX-AIR-1', 'เชียงใหม่', 'CNX-CNX', '2', 'รื้อถอน/ปลดระวาง', 'LG', 12000, 'SN-C1', '', '');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, u) => { const c = new Ctx({}, state, db, {}); c.username = u; return c; };
const rowOf = (db, code) => db.prepare('SELECT rowid AS r FROM air_units WHERE AirCode = ?').get(code).r + 1;

test('ซ่อมไม่ได้ (ยังไม่เปลี่ยน) อยู่ใน "ตำแหน่งที่เลิกใช้" · เปลี่ยนเครื่องแล้ว เครื่องเก่าเข้าคลังพร้อม Serial/Asset/อาการ', async () => {
  const db = freshDb();
  let w = await getWarehouse(as(db, 'boss'));
  assert.deepEqual(w.retired.map(u => u.AirCode), ['ATG-PMK-AIR-1', 'CNX-CNX-AIR-1']);
  assert.equal(w.stock.length, 0);

  await replaceAirUnit(as(db, 'boss'), rowOf(db, 'ATG-PMK-AIR-1'), { IndoorSN: 'NEW-SN-1', Brand: 'Daikin' }, 'ATG-PMK-AIR-1');
  w = await getWarehouse(as(db, 'boss'));
  assert.equal(w.stock.length, 1);
  const s = w.stock[0];
  assert.match(s.ID, /^WH\d{4}-01$/);
  assert.deepEqual([s.AirCode, s.Brand, s.IndoorSN, s.IndoorAsset, s.Note, s.Status, s.InReason],
    ['ATG-PMK-AIR-1', 'Carrier', 'OLD-SN-1', 'AST-1', 'คอมเพรสเซอร์เสีย', 'รื้อถอน/ปลดระวาง', 'เปลี่ยนเครื่อง']);
  assert.ok(!w.retired.some(u => u.AirCode === 'ATG-PMK-AIR-1'), 'ตำแหน่งได้เครื่องใหม่แล้ว ไม่เลิกใช้แล้ว');
});

test('ย้ายเครื่องไปแทน — เครื่องเดิมของปลายทางเข้าคลัง · ตำแหน่งว่างเปลี่ยนเครื่องแล้วไม่มีอะไรเข้าคลัง', async () => {
  const db = freshDb();
  await moveAirUnit(as(db, 'boss'), rowOf(db, 'ATG-PMK-AIR-2'), 'AYA-WNI-AIR-1', '', 'ATG-PMK-AIR-2');
  let w = await getWarehouse(as(db, 'boss'));
  assert.equal(w.stock.length, 1);
  assert.deepEqual([w.stock[0].AirCode, w.stock[0].IndoorSN], ['AYA-WNI-AIR-1', 'SN-W1']);
  assert.match(w.stock[0].InReason, /ย้ายเครื่อง ATG-PMK-AIR-2 มาแทน/);

  // ต้นทางว่างแล้ว — เปลี่ยนเครื่องใหม่ลงไป ไม่มีเครื่องเก่าให้เก็บ
  await replaceAirUnit(as(db, 'boss'), rowOf(db, 'ATG-PMK-AIR-2'), { IndoorSN: 'NEW-2' }, 'ATG-PMK-AIR-2');
  w = await getWarehouse(as(db, 'boss'));
  assert.equal(w.stock.length, 1);
});

test('Write off เครื่องในคลัง — ครั้งเดียว · เห็น/Write off ได้เฉพาะภูมิภาคตัวเอง', async () => {
  const db = freshDb();
  await replaceAirUnit(as(db, 'boss'), rowOf(db, 'ATG-PMK-AIR-1'), { IndoorSN: 'NEW' }, 'ATG-PMK-AIR-1');
  await replaceAirUnit(as(db, 'boss'), rowOf(db, 'CNX-CNX-AIR-1'), { IndoorSN: 'NEW' }, 'CNX-CNX-AIR-1');

  const mine = (await getWarehouse(as(db, 'r1'))).stock;
  assert.deepEqual(mine.map(s => s.AirCode), ['ATG-PMK-AIR-1']);
  const other = (await getWarehouse(as(db, 'boss'))).stock.find(s => s.AirCode === 'CNX-CNX-AIR-1');
  await assert.rejects(() => writeOffStock(as(db, 'r1'), other.ID), /ภูมิภาค/);

  const w = await writeOffStock(as(db, 'r1'), mine[0].ID);
  const s = w.stock.find(x => x.ID === mine[0].ID);
  assert.equal(s.Status, 'Write off');
  assert.ok(s.WriteOffDate);
  await assert.rejects(() => writeOffStock(as(db, 'r1'), mine[0].ID), /Write off ไปแล้ว/);
});
