/**
 * ล็อกการกันแก้/ลบผิดแถว
 *
 * _row ที่หน้าเว็บส่งมาคือ "ลำดับที่เท่าไหร่ในตาราง" ไม่ใช่ id ถาวร
 * ถ้ามีคนลบแถวที่อยู่ก่อนหน้าไป ระหว่างที่อีกคนเปิดหน้าเดิมค้างไว้
 * ลำดับจะเลื่อนขึ้นทั้งหมด แล้วคำสั่งลบที่ส่งตามมาจะไปโดนเครื่องตัวถัดไปแทน
 *
 * อาการนี้ไม่มีอะไรฟ้องเลยสักอย่าง เครื่องหายไปหนึ่งตัวโดยไม่มีใครรู้ว่าใครลบ
 * และประวัติที่ระบบบันทึกไว้ให้จะเขียนรหัสเครื่องผิดตัวไปด้วย
 * เทสต์ชุดนี้จึงล็อกไว้ว่า "ตำแหน่งไม่ตรงกับที่หน้าเว็บเชื่อ = ต้องไม่ยอมเขียน"
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { getAirList, deleteAirUnit, saveAirUnit } from '../src/modules/airlist.js';
import { getHistory, deleteHistoryRecord } from '../src/modules/history.js';

/** ฐานข้อมูลในหน่วยความจำ ใส่ผู้ใช้ Admin หนึ่งคนกับเครื่องสามตัว */
function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('tester', 'ผู้ทดสอบ', 'Admin', '', '', 1, 'x');

  const ins = db.prepare(
    'INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status) VALUES (?,?,?,?,?)'
  );
  ins.run('A-AIR-1', 'โหนดหนึ่ง', 'A', '1', 'ใช้งานปกติ');
  ins.run('A-AIR-2', 'โหนดสอง', 'A', '1', 'ใช้งานปกติ');
  ins.run('A-AIR-3', 'โหนดสาม', 'A', '1', 'ใช้งานปกติ');

  return db;
}

/**
 * ล็อกแบบง่ายที่สุดที่ยังถูกต้อง — เทสต์นี้รันทีละคำสั่ง ไม่ต้องมีคิวจริง
 * สนใจแค่ว่า withLock เรียกได้และคืนล็อกทุกครั้ง
 */
const state = { async acquireLock() { return true; }, async releaseLock() {} };

/** Ctx ใหม่ต่อหนึ่งคำสั่ง เหมือนที่ handleApi สร้างใหม่ทุก request */
const ctxOf = db => {
  const c = new Ctx({}, state, db);
  c.username = 'tester';
  return c;
};

const codesOf = list => list.map(a => a.AirCode);

/** ลำดับแถวที่หน้าเว็บถืออยู่ตอนนั้น — อ่านจากรายการจริง ไม่เดาเอง */
const rowOf = (list, code) => list.find(a => a.AirCode === code)._row;

test('ลบเครื่องได้ตามปกติ เมื่อรหัสที่ส่งมาตรงกับแถวนั้น', async () => {
  const db = freshDb();
  const list = await getAirList(ctxOf(db));

  const after = await deleteAirUnit(ctxOf(db), rowOf(list, 'A-AIR-2'), 'A-AIR-2');
  assert.deepEqual(codesOf(after.air), ['A-AIR-1', 'A-AIR-3']);
});

test('ลำดับแถวเลื่อนแล้ว ต้องไม่ยอมลบ แทนที่จะลบเครื่องตัวถัดไปทิ้ง', async () => {
  const db = freshDb();

  // หน้าจอของคนที่สอง เปิดค้างไว้ตั้งแต่ตอนที่ยังมีเครื่องครบสามตัว
  const stale = await getAirList(ctxOf(db));

  // คนที่หนึ่งลบเครื่องตัวแรกไปก่อน ลำดับของที่เหลือเลื่อนขึ้นทั้งหมด
  await deleteAirUnit(ctxOf(db), rowOf(stale, 'A-AIR-1'), 'A-AIR-1');

  // คนที่สองกดลบ A-AIR-2 ด้วยลำดับเดิมในมือ ซึ่งตอนนี้เป็นที่อยู่ของ A-AIR-3 แล้ว
  await assert.rejects(
    () => deleteAirUnit(ctxOf(db), rowOf(stale, 'A-AIR-2'), 'A-AIR-2'),
    /ถูกเปลี่ยนไปแล้ว/,
    'ต้องหยุดและบอกให้รีเฟรช'
  );

  // ของสำคัญที่สุด: A-AIR-3 ที่ไม่เกี่ยวอะไรด้วยเลย ต้องยังอยู่
  assert.deepEqual(codesOf(await getAirList(ctxOf(db))), ['A-AIR-2', 'A-AIR-3']);
});

test('แก้ข้อมูลเครื่องที่ตำแหน่งเลื่อนไปแล้ว ต้องไม่เขียนทับเครื่องตัวอื่น', async () => {
  const db = freshDb();
  const stale = await getAirList(ctxOf(db));
  await deleteAirUnit(ctxOf(db), rowOf(stale, 'A-AIR-1'), 'A-AIR-1');

  await assert.rejects(
    () => saveAirUnit(ctxOf(db), {
      _row: rowOf(stale, 'A-AIR-2'), AirCode: 'A-AIR-2', Region: '1', Status: 'ชำรุด'
    }),
    /ถูกเปลี่ยนไปแล้ว/
  );

  // A-AIR-3 ที่ไปนั่งอยู่ตำแหน่งนั้นแทน ต้องไม่ถูกเปลี่ยนสถานะไปด้วย
  const list = await getAirList(ctxOf(db));
  assert.equal(list.find(a => a.AirCode === 'A-AIR-3').Status, 'ใช้งานปกติ');
});

test('ไม่ส่งรหัสมาเลย ต้องปฏิเสธ ไม่ใช่ปล่อยผ่าน', async () => {
  // หน้าเว็บรุ่นเก่าที่ยังไม่รู้จักการตรวจนี้ ต้องไม่ทำให้การกันหายไปเงียบๆ
  const db = freshDb();
  const list = await getAirList(ctxOf(db));

  await assert.rejects(() => deleteAirUnit(ctxOf(db), rowOf(list, 'A-AIR-2')), /รีเฟรช/);
  assert.equal((await getAirList(ctxOf(db))).length, 3);
});

test('ลบประวัติต้องตรวจเลขที่เอกสารด้วยเหตุผลเดียวกัน', async () => {
  const db = freshDb();

  // ประวัติของการลบเครื่องถูกบันทึกอัตโนมัติ ใช้เป็นข้อมูลตั้งต้นได้เลย
  const start = await getAirList(ctxOf(db));
  await deleteAirUnit(ctxOf(db), rowOf(start, 'A-AIR-1'), 'A-AIR-1');
  const afterFirst = await getAirList(ctxOf(db));
  await deleteAirUnit(ctxOf(db), rowOf(afterFirst, 'A-AIR-2'), 'A-AIR-2');

  const hist = await getHistory(ctxOf(db));
  assert.equal(hist.length, 2, 'ต้องมีประวัติการลบสองใบ');

  // ส่งเลขที่ของอีกใบมาคู่กับตำแหน่งของใบนี้ = ข้อมูลในมือไม่ตรงกับของจริง
  await assert.rejects(
    () => deleteHistoryRecord(ctxOf(db), hist[0]._row, hist[1].ID),
    /ถูกเปลี่ยนไปแล้ว/,
    'เลขที่ไม่ตรงกับแถวที่ระบุ ต้องไม่ลบ'
  );
  assert.equal((await getHistory(ctxOf(db))).length, 2);

  // ส่งให้ตรงกัน ต้องลบได้ตามปกติ
  const left = await deleteHistoryRecord(ctxOf(db), hist[0]._row, hist[0].ID);
  assert.equal(left.length, 1);
});
