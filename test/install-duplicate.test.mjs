/**
 * ใบติดตั้ง: เครื่องเดียวกันออกได้ทีละใบ · ลบเครื่องออกจากระบบเฉพาะ Infrastructure
 *
 * กติกาที่เจ้าของงานกำหนด (15/10/2569)
 * - เครื่องที่มีใบติดตั้งค้างอนุมัติอยู่ ออกใบใหม่ไม่ได้ — ต้องอนุมัติครบ หรือให้ Infrastructure ลบใบเดิม (ยกเลิกการติดตั้ง) ก่อน
 * - เครื่องอื่นของ Node เดียวกัน (เช่นตัวที่ 3-4) ออกใบแยกได้ตามปกติ
 * - ทางที่ออกใบติดตั้งทั้งสามทาง (กรอกในระบบ · แนบไฟล์ · ลิงก์) ใช้กติกาเดียวกัน
 * - ลบเครื่องออกจากระบบได้เฉพาะ Infrastructure
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { approveDoc } from '../src/modules/approval.js';
import { saveAirUnit, deleteAirUnit } from '../src/modules/airlist.js';
import { saveInstallForm, attachInstallDocument, deleteInstallForm, getInstallForms } from '../src/modules/installform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  user.run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  user.run('staff', 'สตาฟ', 'Staff', '1', 'airlist:edit,installform:edit', 1, 'x');
  user.run('sup', 'ซุป', 'Supervisor', '1', 'airlist:edit,installform:edit', 1, 'x');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };
const as = (db, u, extra = {}) => { const c = new Ctx({}, state, db, extra); c.username = u; return c; };

const addUnit = (db, n) => saveAirUnit(as(db, 'infra'), {
  AirCode: 'ATG-ATG-AIR-' + n, NodeName: 'อ่างทอง', SiteCode: 'ATG-ATG', Region: '1', Province: 'อ่างทอง', BTU: 18000
});
const form = (extra = {}) => ({ NodeName: 'อ่างทอง', Date: '2030-01-10', SlotBase: 0, Checklist: [], TechnicianName: 'ช่าง', CompanyName: 'x', ...extra });
const PENDING = /ยังอนุมัติไม่ครบ/;

test('เครื่องที่ใบติดตั้งยังค้างอนุมัติ ออกใบใหม่ไม่ได้ · เครื่องอื่นออกได้', async () => {
  const db = freshDb();
  for (const n of [1, 2, 3]) await addUnit(db, n);

  const first = await saveInstallForm(as(db, 'staff'), form({ AirCode1: 'ATG-ATG-AIR-1' }));
  await assert.rejects(() => saveInstallForm(as(db, 'staff'), form({ AirCode1: 'ATG-ATG-AIR-1' })), PENDING);
  // ใบที่สองมีเครื่องซ้ำแค่ตัวเดียวก็ไม่ได้ (เครื่อง 1 ซ้ำ แม้เครื่อง 2 ยังไม่มีใบ)
  await assert.rejects(() => saveInstallForm(as(db, 'staff'), form({ AirCode1: 'ATG-ATG-AIR-1', AirCode2: 'ATG-ATG-AIR-2' })), PENDING);
  assert.equal((await getInstallForms(as(db, 'infra'))).length, 1, 'ใบที่ถูกปฏิเสธต้องไม่ถูกเขียนลงตาราง');

  // เครื่องคนละตัว ออกใบแยกได้
  await saveInstallForm(as(db, 'staff'), form({ AirCode1: 'ATG-ATG-AIR-3' }));
  await saveInstallForm(as(db, 'staff'), form({ AirCode2: 'ATG-ATG-AIR-2' }));
  assert.equal((await getInstallForms(as(db, 'infra'))).length, 3);
  assert.ok(first.docNo);
});

test('แนบไฟล์ก็ใช้กติกาเดียวกัน', async () => {
  const db = freshDb();
  await addUnit(db, 1);
  const files = [{ name: 'a.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' }];
  const att = { save: () => [{ name: 'a.png' }], list: () => [], read: () => null, removeAll() {} };

  await saveInstallForm(as(db, 'staff'), form({ AirCode1: 'ATG-ATG-AIR-1' }));
  await assert.rejects(() => attachInstallDocument(as(db, 'staff', { attachments: att }),
    { record: form({ AirCode1: 'ATG-ATG-AIR-1' }), files }), PENDING);
});

test('อนุมัติครบแล้ว หรือถูกลบ (ยกเลิกการติดตั้ง) แล้ว ออกใบใหม่ของเครื่องเดิมได้', async () => {
  const db = freshDb();
  await addUnit(db, 1);
  await addUnit(db, 2);

  // ลบใบที่ค้าง → ออกใหม่ได้
  const a = await saveInstallForm(as(db, 'staff'), form({ AirCode1: 'ATG-ATG-AIR-1' }));
  const rowA = (await getInstallForms(as(db, 'infra'))).find(f => f.id === a.id || f.ID === a.id);
  await assert.rejects(() => deleteInstallForm(as(db, 'staff'), rowA._row, rowA.ID), /Infrastructure/);
  await deleteInstallForm(as(db, 'infra'), rowA._row, rowA.ID);
  await saveInstallForm(as(db, 'staff'), form({ AirCode1: 'ATG-ATG-AIR-1' }));

  // อนุมัติครบ 4 ขั้น → ออกใบใหม่ของเครื่องเดิมได้
  const b = await saveInstallForm(as(db, 'staff'), form({ AirCode2: 'ATG-ATG-AIR-2' }));
  await assert.rejects(() => saveInstallForm(as(db, 'staff'), form({ AirCode2: 'ATG-ATG-AIR-2' })), PENDING);
  await approveDoc(as(db, 'staff'), 'install', b.id);
  await approveDoc(as(db, 'sup'), 'install', b.id);
  await approveDoc(as(db, 'infra'), 'install', b.id);
  await saveInstallForm(as(db, 'staff'), form({ AirCode2: 'ATG-ATG-AIR-2' }));
});

test('ลบเครื่องออกจากระบบ: เฉพาะ Infrastructure', async () => {
  const db = freshDb();
  await addUnit(db, 1);
  await addUnit(db, 2);
  const row = code => db.prepare('SELECT rowid AS r FROM air_units WHERE AirCode = ?').get(code).r + 1;

  for (const who of ['staff', 'sup']) {
    await assert.rejects(() => deleteAirUnit(as(db, who), row('ATG-ATG-AIR-1'), 'ATG-ATG-AIR-1'), /Infrastructure/, who);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM air_units').get().n, 2, 'ถูกปฏิเสธต้องไม่ลบอะไร');

  await deleteAirUnit(as(db, 'infra'), row('ATG-ATG-AIR-1'), 'ATG-ATG-AIR-1');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM air_units').get().n, 1);
});
