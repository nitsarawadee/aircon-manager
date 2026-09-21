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
import { getCleaningForms, deleteCleaningForm } from '../src/modules/cleaningform.js';
import { saveUser, deleteUser } from '../src/modules/users.js';

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
const state = {
  async acquireLock() { return true; },
  async releaseLock() {},
  // การลบ/แก้ผู้ใช้เตะ session ที่ค้างอยู่ออกด้วย เทสต์นี้ไม่สนใจส่วนนั้น
  async destroySessionsOf() {}
};

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

/* ==================== เอกสารและผู้ใช้ ====================
   สองส่วนนี้ใช้ฐานข้อมูลคนละชุดกับเครื่อง จึงแยกตัวช่วยไว้ต่างหาก
   ==================================================================== */

/** ฐานข้อมูลที่มีเอกสารสามใบและผู้ใช้สามคน */
function docsDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  const addUser = db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  );
  addUser.run('tester', 'ผู้ทดสอบ', 'Admin', '', '', 1, 'x');
  addUser.run('somchai', 'ช่างสมชาย', 'RegionAdmin', '1', 'airlist:edit', 1, 'x');
  addUser.run('somsri', 'ช่างสมศรี', 'RegionAdmin', '1', 'airlist:edit', 1, 'x');

  const addForm = db.prepare(
    'INSERT INTO cleaning_forms (ID, DocNo, NodeName, Region, Date) VALUES (?,?,?,?,?)'
  );
  addForm.run('CF1', 'PM2609-01', 'อ่างทอง', '1', '2026-09-01');
  addForm.run('CF2', 'PM2609-02', 'วังน้อย', '1', '2026-09-02');
  addForm.run('CF3', 'PM2609-03', 'บ้านภาชี', '1', '2026-09-03');
  return db;
}

const formIds = db =>
  db.prepare('SELECT ID FROM cleaning_forms ORDER BY row_id').all().map(r => r.ID);

const usernames = db =>
  db.prepare('SELECT Username FROM users ORDER BY row_id').all().map(r => r.Username);

test('ลบเอกสารได้ตามปกติ เมื่อเลขที่ที่ส่งมาตรงกับแถวนั้น', async () => {
  const db = docsDb();
  const [form] = (await getCleaningForms(ctxOf(db))).filter(f => f.ID === 'CF2');

  await deleteCleaningForm(ctxOf(db), form._row, 'CF2');
  assert.deepEqual(formIds(db), ['CF1', 'CF3']);
});

test('ลำดับแถวของเอกสารเลื่อนแล้ว ต้องไม่ยอมลบ แทนที่จะลบใบถัดไปทิ้ง', async () => {
  // สถานการณ์จริง: สองคนเปิดหน้าเอกสารพร้อมกัน คนแรกลบ CF1 ไปก่อน
  // ลำดับของ CF2 กับ CF3 เลื่อนขึ้นทั้งคู่ คนที่สองยังเห็นภาพเก่าอยู่
  const db = docsDb();
  const before = (await getCleaningForms(ctxOf(db)));
  const rowOfCF2 = before.find(f => f.ID === 'CF2')._row;

  await deleteCleaningForm(ctxOf(db), before.find(f => f.ID === 'CF1')._row, 'CF1');

  await assert.rejects(
    () => deleteCleaningForm(ctxOf(db), rowOfCF2, 'CF2'),
    /ข้อมูลในระบบถูกเปลี่ยนไปแล้ว/
  );
  assert.deepEqual(formIds(db), ['CF2', 'CF3'], 'ต้องไม่มีใบไหนหายเพิ่ม');
});

test('ลบเอกสารโดยไม่ส่งเลขที่มา ต้องปฏิเสธ ไม่ใช่ปล่อยผ่าน', async () => {
  const db = docsDb();
  await assert.rejects(() => deleteCleaningForm(ctxOf(db), 2), /คำสั่งไม่สมบูรณ์/);
  assert.equal(formIds(db).length, 3);
});

test('ลบผู้ใช้ที่ตำแหน่งเลื่อนไปแล้ว ต้องไม่ลบคนอื่นแทน', async () => {
  const db = docsDb();
  const rowOfSomsri = 4;   // แถวที่ 1 เป็นหัวตาราง ผู้ใช้คนที่สามจึงอยู่แถวที่ 4

  await deleteUser(ctxOf(db), 3, 'somchai');
  assert.deepEqual(usernames(db), ['tester', 'somsri']);

  await assert.rejects(
    () => deleteUser(ctxOf(db), rowOfSomsri, 'somsri'),
    /ข้อมูลในระบบถูกเปลี่ยนไปแล้ว/
  );
  assert.deepEqual(usernames(db), ['tester', 'somsri'], 'ต้องไม่มีใครหายเพิ่ม');
});

test('แก้ผู้ใช้ที่ตำแหน่งเลื่อนไปแล้ว ต้องไม่เขียนทับคนอื่น', async () => {
  const db = docsDb();
  await deleteUser(ctxOf(db), 3, 'somchai');

  await assert.rejects(
    () => saveUser(ctxOf(db), {
      _row: 4, _expectUsername: 'somsri',
      Username: 'somsri', Name: 'แก้ชื่อ', Role: 'RegionAdmin',
      Regions: ['1'], Permissions: {}
    }),
    /ข้อมูลในระบบถูกเปลี่ยนไปแล้ว/
  );

  const left = db.prepare('SELECT Name FROM users WHERE Username = ?').get('somsri');
  assert.equal(left.Name, 'ช่างสมศรี', 'ชื่อเดิมต้องไม่ถูกแตะ');
});

test('เปลี่ยนชื่อผู้ใช้ได้ตามปกติ ตราบใดที่แถวนั้นยังเป็นคนเดิม', async () => {
  // ตัวตรวจต้องเทียบกับชื่อ "ตอนเปิดหน้ามา" ไม่ใช่ชื่อใหม่ในฟอร์ม
  // ไม่งั้นการเปลี่ยนชื่อผู้ใช้จะทำไม่ได้เลยสักครั้ง
  const db = docsDb();

  await saveUser(ctxOf(db), {
    _row: 3, _expectUsername: 'somchai',
    Username: 'somchai2', Name: 'ช่างสมชาย', Role: 'RegionAdmin',
    Regions: ['1'], Permissions: {}
  });

  assert.deepEqual(usernames(db), ['tester', 'somchai2', 'somsri']);
});
