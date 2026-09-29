/**
 * งานติดตั้ง ↔ เอกสารติดตั้ง
 *
 * เจ้าของงานกำหนด:
 * - เพิ่มเครื่องใหม่ / เปลี่ยนเครื่อง / ย้ายเครื่องมาแทน (ฝั่งปลายทาง) = งานติดตั้งที่รอเอกสาร
 *   ขึ้นในหน้างานซ่อมและติดตั้ง (ประวัติแถวนั้นติดป้าย INSTALL_PENDING_NOTE)
 * - กรอกเอกสารติดตั้งแล้ว ใส่เลขเอกสารลงประวัติแถวเดิม ไม่ลงประวัติ "ติดตั้ง" ซ้ำ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { INSTALL_PENDING_NOTE } from '../src/schema.js';
import { saveAirUnit, replaceAirUnit, moveAirUnit } from '../src/modules/airlist.js';
import { saveInstallForm } from '../src/modules/installform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const add = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU, IndoorSN)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  add.run('KKN-CPE-AIR-1', 'ชุมแพ', 'KKN-CPE', '3', 'ขอนแก่น', 'ใช้งานปกติ', 'Carrier', 18000, 'เก่า-IN-1');
  add.run('KKN-MNG-AIR-1', 'เมืองขอนแก่น', 'KKN-MNG', '3', 'ขอนแก่น', 'ใช้งานปกติ', 'Daikin', 24000, 'IN-M1');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const boss = db => { const c = new Ctx({}, state, db, {}); c.username = 'boss'; return c; };
const historyOf = (db, code) => db.prepare('SELECT * FROM history WHERE AirCode = ? ORDER BY rowid').all(code);
// เลขแถวแบบชีต = rowid + 1 (แถวที่ 1 คือหัวตาราง)
const rowOf = (db, code) => ({ r: db.prepare('SELECT rowid AS r FROM air_units WHERE AirCode = ?').get(code).r + 1 });

const installDoc = code => ({
  AirCode1: code, Date: '2026-09-30', AcceptResult1: 'ผ่าน', TechnicianName: 'ช่างติดตั้ง', Checklist: []
});

test('เพิ่มเครื่องใหม่ → รอเอกสาร · กรอกฟอร์มติดตั้งแล้ว เลขเอกสารลงแถวเดิม ประวัติติดตั้งเหลือแถวเดียว', async () => {
  const db = freshDb();
  await saveAirUnit(boss(db), {
    AirCode: 'KKN-CPE-AIR-2', NodeName: 'ชุมแพ', SiteCode: 'KKN-CPE', Region: '3', Status: 'ใช้งานปกติ'
  });
  let rows = historyOf(db, 'KKN-CPE-AIR-2');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].EventType, 'ติดตั้ง');
  assert.equal(rows[0].Note, INSTALL_PENDING_NOTE);

  const res = await saveInstallForm(boss(db), { ...installDoc('KKN-CPE-AIR-2'), AirCode1: '', AirCode2: 'KKN-CPE-AIR-2', AcceptResult2: 'ผ่าน' });
  rows = historyOf(db, 'KKN-CPE-AIR-2');
  assert.equal(rows.length, 1, 'ต้องไม่ลงประวัติติดตั้งซ้ำ');
  assert.equal(rows[0].Note, 'เอกสาร ' + res.docNo2);
  assert.match(rows[0].Detail, /ผลตรวจรับ: ผ่าน/);
  assert.equal(rows[0].Technician, 'ช่างติดตั้ง');
});

test('เปลี่ยนเครื่อง → รอเอกสาร · กรอกฟอร์มติดตั้งแล้วเลขเอกสารลงใบเปลี่ยนเครื่อง', async () => {
  const db = freshDb();
  await replaceAirUnit(boss(db), rowOf(db, 'KKN-CPE-AIR-1').r, { IndoorSN: 'ใหม่-IN-1' }, 'KKN-CPE-AIR-1');
  assert.equal(historyOf(db, 'KKN-CPE-AIR-1')[0].Note, INSTALL_PENDING_NOTE);

  const res = await saveInstallForm(boss(db), installDoc('KKN-CPE-AIR-1'));
  const rows = historyOf(db, 'KKN-CPE-AIR-1');
  assert.deepEqual(rows.map(h => h.EventType), ['เปลี่ยนเครื่อง']);
  assert.equal(rows[0].Note, 'เอกสาร ' + res.docNo1);
});

test('ย้ายเครื่อง → เฉพาะปลายทางรอเอกสารติดตั้ง ต้นทางไม่ต้อง', async () => {
  const db = freshDb();
  await moveAirUnit(boss(db), rowOf(db, 'KKN-MNG-AIR-1').r, 'KKN-CPE-AIR-1', '', 'KKN-MNG-AIR-1');
  assert.equal(historyOf(db, 'KKN-CPE-AIR-1').at(-1).Note, INSTALL_PENDING_NOTE, 'ปลายทาง');
  assert.notEqual(historyOf(db, 'KKN-MNG-AIR-1').at(-1).Note, INSTALL_PENDING_NOTE, 'ต้นทาง');
});

test('เครื่องที่ไม่มีงานรอเอกสาร — กรอกฟอร์มติดตั้งแล้วลงประวัติติดตั้งเหมือนเดิม', async () => {
  const db = freshDb();
  const res = await saveInstallForm(boss(db), installDoc('KKN-CPE-AIR-1'));
  const rows = historyOf(db, 'KKN-CPE-AIR-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].EventType, 'ติดตั้ง');
  assert.equal(rows[0].Note, 'เอกสาร ' + res.docNo1);
});

test('ป้าย "รอเอกสารติดตั้ง" ในหน้าเว็บ ตรงกับของเซิร์ฟเวอร์', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const web = html.match(/const INSTALL_PENDING_NOTE = '([^']*)';/)[1];
  assert.equal(web, INSTALL_PENDING_NOTE);
});
