/**
 * รหัสผ่านต้องถูกเก็บเป็นแฮช และต้องไม่มีใครใช้งานไม่ได้ระหว่างเปลี่ยนผ่าน
 *
 * ============================================================================
 * สองอย่างที่เทสต์ชุดนี้เฝ้าไว้
 * ============================================================================
 * 1. ฐานข้อมูลต้องไม่มีรหัสจริงอยู่อีก หลังตั้งหรือเปลี่ยนรหัสผ่าน
 *
 * 2. ต้องไม่มีใครล็อกอินไม่ได้ — บัญชีเก่าที่ยังเก็บรหัสเป็นข้อความธรรมดา
 *    ต้องยังเข้าได้ตามปกติ จนกว่าจะรันสคริปต์แปลง
 *
 * และข้อที่สำคัญที่สุดคือข้อ "แก้ชื่อผู้ใช้แล้วรหัสต้องยังใช้ได้"
 * เพราะโค้ดเดิมตอนแก้ไขผู้ใช้โดยไม่กรอกรหัสใหม่ จะอ่านรหัสเดิมมาเขียนกลับ
 * พอย้ายมาเก็บเป็นแฮช ช่องนั้นจะว่าง ผลคือแค่เข้าไปแก้ชื่อคนเดียว
 * รหัสผ่านจะหายทันทีโดยไม่มีอะไรฟ้อง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import {
  login, saveUser, changeOwnPassword, makePasswordHash, hashPassword
} from '../src/modules/users.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  return db;
}

const addUser = (db, cols) => {
  const keys = Object.keys(cols);
  db.prepare(
    'INSERT INTO users (' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')'
  ).run(...keys.map(k => cols[k]));
};

const sessions = new Map();
const state = {
  async acquireLock() { return true; },
  async releaseLock() {},
  async createSession(u) { const t = 'tok-' + u + '-' + sessions.size; sessions.set(t, u); return t; },
  async destroySessionsOf() {},
  async touchSession(t) { return sessions.get(t) || ''; }
};

const ctxOf = (db, username = '') => {
  const c = new Ctx({}, state, db);
  c.username = username;
  return c;
};

/** ค่าที่เก็บอยู่จริงในฐานข้อมูลของผู้ใช้คนนั้น */
const stored = (db, username) =>
  db.prepare('SELECT Password, PasswordHash, PasswordSalt FROM users WHERE Username = ?').get(username);

const ADMIN = {
  Username: 'boss', Name: 'ผู้ดูแลระบบ', Role: 'Admin',
  Regions: '', Permissions: '', Active: 1
};

/* ==================== บัญชีเก่ายังต้องเข้าได้ ==================== */

test('บัญชีที่ยังเก็บรหัสเป็นข้อความธรรมดา ต้องล็อกอินได้ตามปกติ', async () => {
  const db = freshDb();
  addUser(db, { ...ADMIN, Password: 'oldpass123' });

  const res = await login(ctxOf(db), 'boss', 'oldpass123');
  assert.ok(res.token, 'ต้องได้ token กลับมา');

  await assert.rejects(() => login(ctxOf(db), 'boss', 'ผิด'), /รหัสผ่านไม่ถูกต้อง/);
});

test('บัญชีแบบแฮช SHA-256 ยุค Apps Script ต้องยังล็อกอินได้', async () => {
  const db = freshDb();
  const salt = 'saltเก่า';
  addUser(db, { ...ADMIN, PasswordHash: await hashPassword('legacy123', salt), PasswordSalt: salt });

  assert.ok((await login(ctxOf(db), 'boss', 'legacy123')).token);
  await assert.rejects(() => login(ctxOf(db), 'boss', 'legacy124'), /รหัสผ่านไม่ถูกต้อง/);
});

/* ==================== รหัสใหม่ต้องเป็นแฮชเสมอ ==================== */

test('สร้างผู้ใช้ใหม่ ฐานข้อมูลต้องไม่มีรหัสจริงอยู่เลย', async () => {
  const db = freshDb();
  addUser(db, { ...ADMIN, Password: 'bootstrap1' });

  await saveUser(ctxOf(db, 'boss'), {
    Username: 'somchai', Name: 'ช่างสมชาย', Role: 'RegionAdmin',
    Regions: ['1'], Permissions: { cleaningform: 'edit' }, Password: 'ช่างรหัส123'
  });

  const row = stored(db, 'somchai');
  assert.equal(row.Password, '', 'ช่องรหัสข้อความธรรมดาต้องว่าง');
  assert.match(row.PasswordHash, /^pbkdf2\$\d+\$/, 'ต้องเป็นแฮชรูปแบบใหม่');
  assert.ok(!row.PasswordHash.includes('ช่างรหัส123'), 'ห้ามมีรหัสจริงปนอยู่ในแฮช');

  assert.ok((await login(ctxOf(db), 'somchai', 'ช่างรหัส123')).token);
  await assert.rejects(() => login(ctxOf(db), 'somchai', 'ช่างรหัส124'), /รหัสผ่านไม่ถูกต้อง/);
});

test('รีเซ็ตรหัสให้ผู้ใช้ รหัสเดิมต้องใช้ไม่ได้อีก', async () => {
  const db = freshDb();
  addUser(db, { ...ADMIN, Password: 'bootstrap1' });
  addUser(db, {
    Username: 'somchai', Name: 'ช่างสมชาย', Role: 'RegionAdmin',
    Regions: '1', Permissions: '', Active: 1, Password: 'เดิม123456'
  });

  const [, row] = db.prepare('SELECT row_id FROM users ORDER BY row_id').all();
  await saveUser(ctxOf(db, 'boss'), {
    _row: 3,   // แถวที่ 3 ในชีต = ข้อมูลแถวที่ 2 (แถวที่ 1 เป็นหัวตาราง)
    Username: 'somchai', Name: 'ช่างสมชาย', Role: 'RegionAdmin',
    Regions: ['1'], Permissions: {}, Password: 'ใหม่123456'
  });

  assert.ok(row, 'ต้องมีแถวผู้ใช้คนที่สอง');
  assert.ok((await login(ctxOf(db), 'somchai', 'ใหม่123456')).token, 'รหัสใหม่ต้องใช้ได้');
  await assert.rejects(() => login(ctxOf(db), 'somchai', 'เดิม123456'), /รหัสผ่านไม่ถูกต้อง/);
  assert.equal(stored(db, 'somchai').Password, '', 'รหัสเดิมต้องถูกล้างทิ้ง');
});

/* ==================== จุดที่เคยพัง ==================== */

test('แก้ไขผู้ใช้โดยไม่แตะรหัสผ่าน รหัสเดิมต้องยังใช้ได้', async () => {
  // นี่คือกรณีที่โค้ดเดิมจะทำรหัสหายโดยไม่มีอะไรฟ้อง
  const db = freshDb();
  addUser(db, { ...ADMIN, Password: 'bootstrap1' });

  await saveUser(ctxOf(db, 'boss'), {
    Username: 'somchai', Name: 'ช่างสมชาย', Role: 'RegionAdmin',
    Regions: ['1'], Permissions: {}, Password: 'รหัสช่าง123'
  });
  const before = stored(db, 'somchai').PasswordHash;

  // แก้แค่ชื่อ ไม่ส่งรหัสมาเลย
  await saveUser(ctxOf(db, 'boss'), {
    _row: 3, Username: 'somchai', Name: 'ช่างสมชาย (แก้ชื่อแล้ว)',
    Role: 'RegionAdmin', Regions: ['1'], Permissions: {}
  });

  const after = stored(db, 'somchai');
  assert.equal(after.PasswordHash, before, 'แฮชต้องไม่ถูกแตะเลย');
  assert.ok((await login(ctxOf(db), 'somchai', 'รหัสช่าง123')).token, 'ต้องยังล็อกอินได้');

  const name = db.prepare('SELECT Name FROM users WHERE Username = ?').get('somchai').Name;
  assert.equal(name, 'ช่างสมชาย (แก้ชื่อแล้ว)', 'ชื่อต้องถูกแก้จริง');
});

test('แก้ไขบัญชีเก่าที่ยังเป็นข้อความธรรมดา โดยไม่แตะรหัส ก็ต้องยังเข้าได้', async () => {
  const db = freshDb();
  addUser(db, { ...ADMIN, Password: 'bootstrap1' });
  addUser(db, {
    Username: 'tle', Name: 'ทีเล่', Role: 'RegionAdmin',
    Regions: '3', Permissions: '', Active: 1, Password: 'plainเก่า1'
  });

  await saveUser(ctxOf(db, 'boss'), {
    _row: 3, Username: 'tle', Name: 'ทีเล่ (แก้ชื่อ)',
    Role: 'RegionAdmin', Regions: ['3'], Permissions: {}
  });

  assert.ok((await login(ctxOf(db), 'tle', 'plainเก่า1')).token);
});

/* ==================== เปลี่ยนรหัสตัวเอง ==================== */

test('เปลี่ยนรหัสตัวเอง เก็บเป็นแฮชและล้างรหัสเดิมทิ้ง', async () => {
  const db = freshDb();
  addUser(db, { ...ADMIN, Password: 'เดิม123456' });

  await changeOwnPassword(ctxOf(db, 'boss'), 'เดิม123456', 'ใหม่123456');

  const row = stored(db, 'boss');
  assert.equal(row.Password, '');
  assert.match(row.PasswordHash, /^pbkdf2\$/);
  assert.ok((await login(ctxOf(db), 'boss', 'ใหม่123456')).token);
  await assert.rejects(() => login(ctxOf(db), 'boss', 'เดิม123456'), /รหัสผ่านไม่ถูกต้อง/);
});

test('เปลี่ยนรหัสตัวเองต้องรู้รหัสเดิมก่อน', async () => {
  const db = freshDb();
  addUser(db, { ...ADMIN, Password: 'เดิม123456' });

  await assert.rejects(
    () => changeOwnPassword(ctxOf(db, 'boss'), 'เดาเอา', 'ใหม่123456'),
    /รหัสผ่านเดิมไม่ถูกต้อง/
  );
  assert.equal(stored(db, 'boss').Password, 'เดิม123456', 'ต้องไม่มีอะไรเปลี่ยน');
});

/* ==================== ตัวแฮชเอง ==================== */

test('รหัสเดียวกันแฮชสองครั้ง ต้องได้ค่าไม่เหมือนกัน', async () => {
  // salt สุ่มใหม่ทุกครั้ง คนที่ได้ไฟล์ฐานข้อมูลไปจึงบอกไม่ได้ว่าใครใช้รหัสซ้ำกัน
  const a = await makePasswordHash('รหัสเดียวกัน');
  const b = await makePasswordHash('รหัสเดียวกัน');
  assert.notEqual(a, b);
});

test('แฮชบอกวิธีและจำนวนรอบไว้ในตัวเอง เพื่อให้เพิ่มรอบทีหลังได้', async () => {
  const h = await makePasswordHash('ทดสอบ123456');
  const [algo, rounds, salt, digest] = h.split('$');
  assert.equal(algo, 'pbkdf2');
  assert.ok(Number(rounds) >= 600000, 'รอบต้องไม่น้อยกว่าที่ตั้งไว้ ได้ ' + rounds);
  assert.ok(salt.length > 10 && digest.length > 10);
});

test('แฮชที่เสียหายต้องตรวจไม่ผ่าน ไม่ใช่ทำให้ระบบล้ม', async () => {
  const db = freshDb();
  for (const broken of ['pbkdf2$', 'pbkdf2$600000$!!!$!!!', 'pbkdf2$abc$x$y', 'pbkdf2$1$a$b']) {
    const d = freshDb();
    addUser(d, { ...ADMIN, PasswordHash: broken });
    await assert.rejects(() => login(ctxOf(d), 'boss', 'อะไรก็ได้'), /รหัสผ่านไม่ถูกต้อง/,
      'แฮชเสีย "' + broken + '" ต้องตรวจไม่ผ่าน');
  }
  assert.ok(db);
});

test('มีแฮชแล้ว รหัสข้อความธรรมดาที่ค้างอยู่ต้องใช้เข้าระบบไม่ได้', async () => {
  // กันกรณีแปลงข้อมูลไม่ครบ แล้วรหัสเก่ายังเปิดประตูได้อยู่
  const db = freshDb();
  addUser(db, {
    ...ADMIN,
    Password: 'รหัสเก่าค้าง',
    PasswordHash: await makePasswordHash('รหัสใหม่จริง')
  });

  assert.ok((await login(ctxOf(db), 'boss', 'รหัสใหม่จริง')).token);
  await assert.rejects(() => login(ctxOf(db), 'boss', 'รหัสเก่าค้าง'), /รหัสผ่านไม่ถูกต้อง/);
});
