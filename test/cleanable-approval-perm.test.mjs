/**
 * จากการตรวจทุกบทบาท (14/10/2569)
 *
 * 1. ตำแหน่งที่ไม่มีเครื่อง (รื้อถอน/ปลดระวาง/Write off) ออกใบล้างไม่ได้ ทั้งกรอกในระบบและแนบไฟล์
 *    และรายการ Node ติดป้าย Retired ให้หน้าเว็บซ่อนจากฟอร์มใบล้าง
 *    เดิมกรอกได้ ได้ใบที่ไม่มีข้อมูลเครื่อง แต่ค่าล้างเข้างบ
 * 2. ตัวเลขเอกสารรออนุมัตินับตามสิทธิ์เอกสาร ไม่ผูกกับสิทธิ์งานซ่อม
 *    เดิมตั้งงานซ่อม "ไม่เห็น" แล้วตัวเลขเป็น 0 ทั้งที่ยังต้องอนุมัติใบล้าง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { getApprovalCount } from '../src/modules/approval.js';
import { getCleaningFormNodes, saveCleaningForm, uploadNodeDocuments } from '../src/modules/cleaningform.js';

function freshDb(staffPerms = '') {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  user.run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  user.run('staff', 'สตาฟ ภาคหนึ่ง', 'Staff', '1', staffPerms, 1, 'x');
  const a = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU, CleaningPricePerRound)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  a.run('ATG-ATG-AIR-1', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'ใช้งานปกติ', 'Daikin', 18000, 450);
  a.run('ATG-ATG-AIR-2', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'รื้อถอน/ปลดระวาง', '', '', 450);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };
const attachments = { save: (d, dt, files) => files.map(f => ({ name: f.name, bytes: 3 })), list: () => [], read: () => null, removeAll() {} };
const as = (db, u) => { const c = new Ctx({}, state, db, { attachments }); c.username = u; return c; };
const form = code => ({ NodeName: 'อ่างทอง', AirCode2: code, Date: '2026-10-14', TimeStart: '09:00', TimeEnd: '10:00', Price2: 450, Checklist: [] });

test('ตำแหน่งที่ไม่มีเครื่อง: กรอกใบล้างไม่ได้ · แนบไฟล์ไม่ได้ · ไม่มีอะไรถูกบันทึก', async () => {
  const db = freshDb();
  await assert.rejects(() => saveCleaningForm(as(db, 'staff'), form('ATG-ATG-AIR-2')), /ไม่มีเครื่องใช้งานอยู่/);
  await assert.rejects(() => uploadNodeDocuments(as(db, 'staff'), {
    nodeName: 'อ่างทอง', files: [{ name: 'a.jpg', mimeType: 'image/jpeg', data: 'QUJD' }],
    closeout: { year: 2026, round: 1, date: '2026-10-14', units: [{ airCode: 'ATG-ATG-AIR-2' }] }
  }), /ไม่มีเครื่องใช้งานอยู่/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cleaning_forms').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM history').get().n, 0, 'ต้องไม่มีค่าล้างงอกเข้างบ');

  await saveCleaningForm(as(db, 'staff'), { ...form(''), AirCode2: '', AirCode1: 'ATG-ATG-AIR-1', Price1: 450, Price2: '' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cleaning_forms').get().n, 1, 'เครื่องที่ใช้งานอยู่ยังกรอกได้ตามปกติ');
});

test('รายการ Node ติดป้าย Retired ให้ตำแหน่งที่ไม่มีเครื่อง', async () => {
  const db = freshDb();
  const [node] = await getCleaningFormNodes(as(db, 'staff'));
  const byCode = Object.fromEntries(node.units.map(u => [u.AirCode, u]));
  assert.equal(byCode['ATG-ATG-AIR-1'].Retired, false);
  assert.equal(byCode['ATG-ATG-AIR-2'].Retired, true);
});

test('ตัวเลขรออนุมัติ: งานซ่อม "ไม่เห็น" แต่เอกสารล้างแก้ไขได้ → ยังนับใบล้างที่รอบัญชีนี้', async () => {
  const db = freshDb('airlist:view,plan:edit,history:edit,repair:none,cleaningform:edit,repairform:edit,installform:edit,budget:none');
  // ใบล้างกรอกโดย Infrastructure รออนุมัติขั้น 2 (Staff)
  await saveCleaningForm(as(db, 'infra'), { ...form(''), AirCode2: '', AirCode1: 'ATG-ATG-AIR-1', Price1: 450, Price2: '' });
  const n = await getApprovalCount(as(db, 'staff'));
  assert.equal(n.cleaning, 1);
  assert.equal(n.total, 1);
});

test('ตัวเลขรออนุมัติ: ไม่มีสิทธิ์เอกสารสักแบบ → 0', async () => {
  const db = freshDb('airlist:view,plan:edit,history:edit,repair:edit,cleaningform:none,repairform:none,installform:none,budget:none');
  await saveCleaningForm(as(db, 'infra'), { ...form(''), AirCode2: '', AirCode1: 'ATG-ATG-AIR-1', Price1: 450, Price2: '' });
  assert.equal((await getApprovalCount(as(db, 'staff'))).total, 0);
});
