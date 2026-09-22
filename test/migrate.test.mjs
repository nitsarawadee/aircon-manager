/**
 * ล็อกตัวเติมคอลัมน์อัตโนมัติ
 *
 * ตัวอ่านข้อมูลสร้าง SQL จากรายชื่อคอลัมน์ "ในโค้ด" ไม่ใช่จากฐานข้อมูล
 * เพิ่มคอลัมน์ใน schema.js เมื่อไหร่ ทุกคำสั่ง SELECT จะอ้างถึงทันที
 * ถ้าฐานข้อมูลยังไม่มี ทุกหน้าที่อ่านตารางนั้นจะพังตั้งแต่วินาทีแรก
 *
 * เทสต์ชุดนี้คุมสองอย่าง — เติมของที่ขาดได้จริง และไม่แตะข้อมูลที่มีอยู่
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements, TABLES } from '../src/db/schema.js';
import { addMissingTables, addMissingColumns } from '../src/db/migrate.js';

/** ฐานข้อมูลที่โครงสร้างครบตามโค้ดปัจจุบัน */
function fullDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  return db;
}

const colsOf = (db, t) => db.prepare('PRAGMA table_info(' + t + ')').all().map(c => c.name);

test('ฐานข้อมูลที่ครบอยู่แล้ว ต้องไม่ถูกแตะเลย', () => {
  const db = fullDb();
  assert.deepEqual(addMissingColumns(db), [], 'ไม่ควรมีอะไรให้เติม');
});

test('คอลัมน์ที่ขาดต้องถูกเติมกลับมา', () => {
  // จำลองฐานข้อมูลรุ่นเก่าที่ยังไม่มีคอลัมน์ Note ในตารางประวัติ
  const db = new DatabaseSync(':memory:');
  const cols = Object.keys(TABLES.history.columns).filter(c => c !== 'Note');
  db.exec('CREATE TABLE history (row_id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
          cols.map(c => '"' + c + '" TEXT').join(', ') + ')');

  assert.ok(!colsOf(db, 'history').includes('Note'), 'ตั้งต้นต้องยังไม่มี Note');

  const added = addMissingColumns(db);
  assert.ok(added.includes('history.Note'), 'ต้องรายงานว่าเติมอะไรไป');
  assert.ok(colsOf(db, 'history').includes('Note'), 'ต้องมี Note แล้ว');
});

test('ข้อมูลเดิมต้องอยู่ครบหลังเติมคอลัมน์ และแถวเก่าได้ค่าว่าง', () => {
  // ข้อที่สำคัญที่สุด — การอัปเดตโครงสร้างต้องไม่ทำข้อมูลหาย
  const db = new DatabaseSync(':memory:');
  const cols = Object.keys(TABLES.history.columns).filter(c => c !== 'Note');
  db.exec('CREATE TABLE history (row_id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
          cols.map(c => '"' + c + '" TEXT').join(', ') + ')');
  db.prepare('INSERT INTO history (ID, AirCode, EventType) VALUES (?,?,?)')
    .run('CM2609-01', 'A-AIR-1', 'ล้างแอร์');

  addMissingColumns(db);

  const row = db.prepare('SELECT ID, AirCode, EventType, Note FROM history').get();
  assert.equal(row.ID, 'CM2609-01');
  assert.equal(row.AirCode, 'A-AIR-1');
  assert.equal(row.EventType, 'ล้างแอร์');
  assert.equal(row.Note, null, 'แถวเก่าได้ค่าว่างในคอลัมน์ใหม่');
});

test('รันซ้ำต้องไม่เติมซ้ำ', () => {
  const db = new DatabaseSync(':memory:');
  const cols = Object.keys(TABLES.history.columns).filter(c => c !== 'Note');
  db.exec('CREATE TABLE history (row_id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
          cols.map(c => '"' + c + '" TEXT').join(', ') + ')');

  assert.equal(addMissingColumns(db).length, 1);
  assert.deepEqual(addMissingColumns(db), [], 'รอบสองต้องไม่มีอะไรให้ทำ');
});

test('คอลัมน์ที่มีในฐานข้อมูลแต่ไม่มีในโค้ด ต้องไม่ถูกลบ', () => {
  // ลบคอลัมน์อัตโนมัติทำให้ข้อมูลหาย จึงต้องเป็นสคริปต์ที่คนสั่งเองเท่านั้น
  const db = fullDb();
  db.exec('ALTER TABLE history ADD COLUMN "ของเก่าที่เลิกใช้" TEXT');

  addMissingColumns(db);

  assert.ok(colsOf(db, 'history').includes('ของเก่าที่เลิกใช้'), 'ต้องยังอยู่');
});

/* ==================== ตารางที่เพิ่มใหม่ ==================== */

test('ฐานข้อมูลเก่าที่ยังไม่มีตารางใหม่ ต้องถูกสร้างให้ตอนเปิดเซิร์ฟเวอร์', () => {
  // เกิดจริงตอนเพิ่ม repair_forms — คำสั่งสร้างตารางเคยรันแค่ตอนติดตั้งครั้งแรก
  // ฐานข้อมูลที่ใช้งานอยู่แล้วจึงไม่มีตารางนั้น แล้ว getSystemStatus พังตั้งแต่เปิด
  // ทำให้หน้าเว็บเปิดไม่ขึ้นเลยสักหน้า
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.exec('DROP TABLE repair_forms');

  const added = addMissingTables(db);

  assert.deepEqual(added, ['repair_forms']);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM repair_forms').get().c, 0);
});

test('เติมคอลัมน์อย่างเดียวแก้ปัญหานี้ไม่ได้ — ต้องสร้างตารางก่อน', () => {
  // ตัวเติมคอลัมน์ข้ามตารางที่ยังไม่มีไปเลย (ตั้งใจให้ข้าม) ลำดับจึงสำคัญ
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.exec('DROP TABLE repair_forms');

  assert.deepEqual(addMissingColumns(db), [], 'ตัวเติมคอลัมน์ต้องไม่ยุ่งกับตารางที่ยังไม่มี');
  assert.throws(() => db.prepare('SELECT 1 FROM repair_forms').get(), /no such table/);
});

test('รันซ้ำต้องไม่มีอะไรเปลี่ยน และข้อมูลเดิมต้องอยู่ครบ', () => {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO air_units (AirCode, NodeName) VALUES (?,?)').run('A-1', 'ทดสอบ');

  assert.deepEqual(addMissingTables(db), [], 'ครบอยู่แล้วต้องไม่สร้างอะไรเพิ่ม');
  assert.deepEqual(addMissingTables(db), []);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM air_units').get().c, 1, 'ข้อมูลเดิมต้องไม่หาย');
});

test('ตารางที่หายไปหลายตัว ต้องถูกสร้างครบทุกตัว', () => {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.exec('DROP TABLE repair_forms');
  db.exec('DROP TABLE budgets');

  assert.deepEqual(addMissingTables(db).sort(), ['budgets', 'repair_forms']);
});

test('ดัชนีของตารางที่เพิ่งสร้าง ต้องมาด้วย', () => {
  // ถ้าสร้างแต่ตารางไม่สร้างดัชนี ตารางใหม่จะช้าลงเรื่อยๆ โดยไม่มีใครสังเกต
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.exec('DROP TABLE repair_forms');
  addMissingTables(db);

  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'repair_forms'"
  ).all().map(r => r.name);

  assert.ok(idx.some(n => n.includes('AirCode')), 'ต้องมีดัชนีของ AirCode · ได้ ' + idx.join(', '));
});
