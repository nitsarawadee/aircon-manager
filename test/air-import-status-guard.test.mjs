/**
 * นำเข้าเครื่องใช้กติกาเดียวกับการแก้เครื่องทีละตัวและปุ่มลบ (เจ้าของงานกำหนด 16/10/2569)
 *
 * เดิมไฟล์นำเข้าเป็นทางลัดข้ามด่าน: Regional ที่แก้รายการเครื่องได้ ตั้ง "รอซ่อม" ได้ (ปกติเฉพาะ Infrastructure)
 * เปลี่ยน "รอซ่อม" เป็น "ใช้งานปกติ" ได้ = ปิดงานซ่อมโดยไม่มีใบซ่อม และติ๊กลบเครื่องได้ทั้งที่ปุ่มลบเป็นของ Infrastructure
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { planAirUnitImport, applyAirUnitImport } from '../src/modules/airlist.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  user.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  user.run('reg1', 'ภาค 1', 'RegionAdmin', '1', 'airlist:edit', 1, 'x');
  const unit = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status)
      VALUES (?,?,?,?,?,?,?)`);
  unit.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ');
  unit.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'รอซ่อม');
  unit.run('ATG-PMK-AIR-3', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, username) => { const c = new Ctx({}, state, db, {}); c.username = username; return c; };
const row = (no, over = {}) => ({ Region: '1', Province: 'อ่างทอง', NodeName: 'ป่าโมก', SiteCode: 'ATG-PMK', LocationType: 'Shop House', AirNo: String(no), ...over });
const statusOf = (db, code) => db.prepare('SELECT Status FROM air_units WHERE AirCode = ?').get(code).Status;
const all3 = (over = {}) => [row(1, over[1]), row(2, over[2]), row(3, over[3])];

test('Regional ตั้ง "รอซ่อม" ผ่านไฟล์ไม่ได้ — ข้อผิดพลาดบอกบรรทัดและเหตุผล ไม่เขียนอะไร', async () => {
  const db = freshDb();
  const rows = all3({ 1: { Status: 'รอซ่อม' } });
  const plan = await planAirUnitImport(as(db, 'reg1'), rows);

  assert.equal(plan.counts.errors, 1);
  assert.deepEqual(plan.errors[0], {
    line: 2, column: 'Status',
    message: 'เครื่อง ATG-PMK-AIR-1: ตั้งสถานะ "รอซ่อม" ได้เฉพาะ Infrastructure (เป็นการอนุมัติค่าซ่อม)'
  });
  await assert.rejects(() => applyAirUnitImport(as(db, 'reg1'), { rows, expect: { adds: 0, updates: 0 } }), /ข้อผิดพลาด 1 จุด/);
  assert.equal(statusOf(db, 'ATG-PMK-AIR-1'), 'ใช้งานปกติ');
});

test('Regional เพิ่มเครื่องใหม่สถานะ "รอซ่อม" ก็ไม่ได้ · Infrastructure ตั้ง "รอซ่อม" ได้', async () => {
  const db = freshDb();
  const plan = await planAirUnitImport(as(db, 'reg1'), [...all3(), row(4, { Status: 'รอซ่อม' })]);
  assert.match(plan.errors[0].message, /ATG-PMK-AIR-4: ตั้งสถานะ "รอซ่อม" ได้เฉพาะ Infrastructure/);

  const rows = all3({ 1: { Status: 'รอซ่อม' } });
  const ok = await planAirUnitImport(as(db, 'boss'), rows);
  assert.equal(ok.counts.errors, 0);
  await applyAirUnitImport(as(db, 'boss'), { rows, expect: { adds: 0, updates: 1 } });
  assert.equal(statusOf(db, 'ATG-PMK-AIR-1'), 'รอซ่อม');
});

test('"รอซ่อม" → "ใช้งานปกติ" ผ่านไฟล์ไม่ได้ทุกบทบาท แม้เป็น Infrastructure', async () => {
  const db = freshDb();
  for (const who of ['reg1', 'boss']) {
    const plan = await planAirUnitImport(as(db, who), all3({ 2: { Status: 'ใช้งานปกติ' } }));
    assert.equal(plan.counts.errors, 1, who);
    assert.equal(plan.errors[0].line, 3);
    assert.match(plan.errors[0].message, /ATG-PMK-AIR-2 อยู่ระหว่าง "รอซ่อม" — เปลี่ยนเป็น "ใช้งานปกติ" ผ่านไฟล์ไม่ได้ ต้องปิดงานซ่อมด้วยใบซ่อม/);
  }
  assert.equal(statusOf(db, 'ATG-PMK-AIR-2'), 'รอซ่อม');
});

test('ไฟล์ไม่ได้เปลี่ยนสถานะ (ช่องว่าง หรือค่าเดิม) — นำเข้าได้ตามปกติ', async () => {
  const db = freshDb();
  const rows = all3({ 1: { Brand: 'Daikin' }, 2: { Status: 'รอซ่อม', Brand: 'LG' } });
  const plan = await planAirUnitImport(as(db, 'reg1'), rows);
  assert.equal(plan.counts.errors, 0);
  await applyAirUnitImport(as(db, 'reg1'), { rows, expect: { adds: 0, updates: 2 } });
  assert.equal(statusOf(db, 'ATG-PMK-AIR-2'), 'รอซ่อม');
});

test('ติ๊กลบเครื่องที่ไม่มีในไฟล์ได้เฉพาะ Infrastructure', async () => {
  const db = freshDb();
  const rows = [row(1), row(2)];   // AIR-3 ไม่มีในไฟล์
  await assert.rejects(
    () => applyAirUnitImport(as(db, 'reg1'), { rows, removeMissing: true, expect: { adds: 0, updates: 0, removes: 1 } }),
    /ลบเครื่องที่ไม่มีในไฟล์ได้เฉพาะ Infrastructure/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM air_units').get().n, 3);

  await applyAirUnitImport(as(db, 'boss'), { rows, removeMissing: true, expect: { adds: 0, updates: 0, removes: 1 } });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM air_units').get().n, 2);
});
