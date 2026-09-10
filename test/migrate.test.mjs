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
import { addMissingColumns } from '../src/db/migrate.js';

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
