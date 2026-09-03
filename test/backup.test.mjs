/**
 * ทดสอบการสำรองข้อมูล
 *
 * สำรองข้อมูลเป็นอย่างเดียวที่ "ถ้าพังจะรู้ตอนที่สายไปแล้ว"
 * คือรู้ตอนที่ข้อมูลหายแล้วเปิดไฟล์สำรองไม่ได้ ซึ่งช่วยอะไรไม่ได้แล้ว
 * เทสต์ชุดนี้จึงกู้ข้อมูลจากไฟล์สำรองจริงๆ แล้วอ่านข้อมูลออกมาเทียบ
 * ไม่ใช่แค่เช็คว่าไฟล์ถูกสร้างขึ้นมา
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { backupDatabase, pruneBackups, listBackups } from '../platform/backup.js';

/** สร้างฐานข้อมูลชั่วคราวที่มีข้อมูลจริงอยู่ข้างใน */
function makeDb(dir) {
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('CREATE TABLE air_units (AirCode TEXT, NodeName TEXT)');
  db.exec("INSERT INTO air_units VALUES ('ATG-ATG-AIR-1', 'อ่างทอง'), ('KCB-KCB-AIR-1', 'กาญจนบุรี')");
  return db;
}

test('ไฟล์สำรองต้องเปิดได้และมีข้อมูลครบ ไม่ใช่แค่มีไฟล์', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aircon-'));
  try {
    const db = makeDb(dir);
    const { path } = backupDatabase(db, join(dir, 'backups'));
    db.close();

    // เปิดไฟล์สำรองขึ้นมาอ่านจริง — นี่คือหัวใจของเทสต์นี้
    const restored = new DatabaseSync(path, { readOnly: true });
    const rows = restored.prepare('SELECT * FROM air_units ORDER BY AirCode').all();
    restored.close();

    assert.equal(rows.length, 2);
    assert.equal(rows[0].NodeName, 'อ่างทอง', 'ภาษาไทยต้องไม่เพี้ยนในไฟล์สำรอง');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ไฟล์สำรองต้องเป็นสภาพ ณ ตอนสำรอง ไม่เปลี่ยนตามข้อมูลที่แก้ทีหลัง', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aircon-'));
  try {
    const db = makeDb(dir);
    const { path } = backupDatabase(db, join(dir, 'backups'));

    // แก้ข้อมูลต้นทางหลังสำรองไปแล้ว
    db.exec("DELETE FROM air_units WHERE AirCode = 'ATG-ATG-AIR-1'");
    db.close();

    const restored = new DatabaseSync(path, { readOnly: true });
    const n = restored.prepare('SELECT COUNT(*) c FROM air_units').get().c;
    restored.close();

    assert.equal(n, 2, 'ไฟล์สำรองต้องยังมี 2 แถวเหมือนตอนที่สำรอง');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ชื่อไฟล์ภาษาไทยต้องไม่เพี้ยน (สระและวรรณยุกต์ต้องอยู่ครบ)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aircon-'));
  try {
    const db = makeDb(dir);
    const { name } = backupDatabase(db, join(dir, 'backups'), 'ก่อนนำเข้า');
    db.close();
    assert.ok(name.includes('ก่อนนำเข้า'), 'ได้ชื่อไฟล์ว่า ' + name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ชื่อไฟล์ต้องกันการพาออกนอกโฟลเดอร์', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aircon-'));
  try {
    const db = makeDb(dir);
    const { name } = backupDatabase(db, join(dir, 'backups'), '../../หนีออกไป');
    db.close();
    assert.ok(!name.includes('..'), 'ได้ชื่อไฟล์ว่า ' + name);
    assert.ok(!name.includes('/') && !name.includes('\\'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ลบไฟล์เก่าที่เกินจำนวน แต่เก็บตัวใหม่ไว้', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aircon-'));
  const backups = join(dir, 'backups');
  try {
    const db = makeDb(dir);
    // สร้าง 5 ไฟล์ โดยแกล้งให้เวลาต่างกันเพื่อให้เรียงลำดับได้แน่นอน
    const names = [];
    for (let i = 0; i < 5; i++) {
      const { path, name } = backupDatabase(db, backups, 'ครั้งที่' + i);
      const t = new Date(Date.now() - (5 - i) * 60000);
      utimesSync(path, t, t);
      names.push(name);
    }
    db.close();

    const removed = pruneBackups(backups, 2);
    assert.equal(removed.length, 3);

    const left = listBackups(backups).map(b => b.name);
    assert.equal(left.length, 2);
    assert.ok(left.includes(names[4]), 'ไฟล์ใหม่สุดต้องอยู่');
    assert.ok(!left.includes(names[0]), 'ไฟล์เก่าสุดต้องถูกลบ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ห้ามลบไฟล์ที่ระบบไม่ได้สร้างเอง', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aircon-'));
  const backups = join(dir, 'backups');
  try {
    const db = makeDb(dir);
    for (let i = 0; i < 4; i++) backupDatabase(db, backups, 'ครั้งที่' + i);
    db.close();

    // ไฟล์ที่คนเอามาวางไว้เอง — การลบไฟล์ของคนอื่นเป็นเรื่องที่ให้อภัยไม่ได้
    writeFileSync(join(backups, 'ห้ามลบนะ.db'), 'ข้อมูลสำคัญของใครบางคน');
    writeFileSync(join(backups, 'notes.txt'), 'บันทึกส่วนตัว');

    pruneBackups(backups, 1);

    const left = readdirSync(backups);
    assert.ok(left.includes('ห้ามลบนะ.db'), 'ไฟล์ที่คนวางเองต้องไม่ถูกลบ');
    assert.ok(left.includes('notes.txt'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('โฟลเดอร์ที่ยังไม่มี ต้องไม่ทำให้พัง', () => {
  assert.deepEqual(pruneBackups(join(tmpdir(), 'ไม่มีโฟลเดอร์นี้-' + Date.now())), []);
  assert.deepEqual(listBackups(join(tmpdir(), 'ไม่มีโฟลเดอร์นี้-' + Date.now())), []);
});
