/**
 * ใบล้างหาเครื่องไม่เจอ — ข้อความบอกสาเหตุให้ตรง แบบเดียวกับใบซ่อม/ใบติดตั้ง (16/10/2569)
 *
 * เดิมตอบ "ไม่พบเครื่องรหัส … ในทะเบียนเครื่อง หรือไม่มีสิทธิ์เข้าถึง" ทุกกรณี
 * คนที่เห็นเครื่องอยู่ในทะเบียนจะงงว่าทำไมระบบบอกว่าไม่พบ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm } from '../src/modules/cleaningform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  user.run('reg2', 'ภาค 2', 'RegionAdmin', '2', '', 1, 'x', '');
  user.run('ctA', 'ช่าง A', 'Contractor', '', '', 1, 'x', 'CT001');
  db.prepare("INSERT INTO contractors (ID, Name, Active) VALUES ('CT001', 'บริษัท เอ', 1)").run();
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status)
      VALUES ('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ')`).run();
  db.prepare("INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_Status) VALUES (2026, 'ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', 'นัดหมายแล้ว')").run();
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, u) => { const c = new Ctx({}, state, db, {}); c.username = u; return c; };
const form = code => ({ NodeName: 'ป่าโมก', SiteCode: 'ATG-PMK', Region: '1', Date: '2026-09-15',
  PlanYear: 2026, PlanRound: 1, AirCode1: code, Price1: 500, TechnicianName: 'ช่าง', Checklist: [] });

test('เครื่องไม่มีในทะเบียน — บอกว่าไม่พบในทะเบียน', async () => {
  await assert.rejects(() => saveCleaningForm(as(freshDb(), 'reg2'), form('XXX-AIR-1')),
    { message: 'ไม่พบเครื่องรหัส XXX-AIR-1 ในทะเบียนเครื่อง' });
});

test('เครื่องอยู่นอกภูมิภาคที่ดูแล — บอกภูมิภาค', async () => {
  await assert.rejects(() => saveCleaningForm(as(freshDb(), 'reg2'), form('ATG-PMK-AIR-1')),
    { message: 'คุณไม่มีสิทธิ์จัดการข้อมูลในภูมิภาค "1" (เครื่อง ATG-PMK-AIR-1)' });
});

test('ผู้รับเหมาไม่ได้รับมอบหมายเครื่องนี้ — บอกว่าไม่ได้มอบหมาย', async () => {
  await assert.rejects(() => saveCleaningForm(as(freshDb(), 'ctA'), form('ATG-PMK-AIR-1')),
    /เครื่อง "ATG-PMK-AIR-1" ไม่ได้มอบหมายงานล้างให้คุณ/);
});
