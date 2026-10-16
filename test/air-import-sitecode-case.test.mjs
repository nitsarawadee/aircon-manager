/**
 * นำเข้าเครื่อง — รหัสไซต์ที่พิมพ์ตัวเล็ก ต้องได้เครื่องเดิม ไม่ใช่เครื่องใหม่ซ้อน (16/10/2569)
 *
 * เดิมเทียบรหัสเครื่องแบบตรงตัว ไฟล์ใส่ "atg-pmk" AirNo 1 ได้ "atg-pmk-AIR-1" เป็นเครื่องใหม่
 * ทั้งที่มี ATG-PMK-AIR-1 อยู่แล้ว — ส่วนอื่นทั้งระบบเทียบรหัสแบบไม่สนตัวพิมพ์ (normalizeCode)
 * เครื่องซ้อนจึงไปโผล่ในแผน แดชบอร์ด และงบ เหมือนเป็นคนละเครื่อง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { planImport } from '../src/import.js';
import { makeAirCode } from '../src/import-spec.js';
import { planAirUnitImport, applyAirUnitImport } from '../src/modules/airlist.js';

const unit = (code, over = {}) => ({
  AirCode: code, Region: '1', Province: 'อ่างทอง', NodeName: 'ป่าโมก', SiteCode: 'ATG-PMK',
  LocationType: 'Shop House', Status: 'ใช้งานปกติ', ...over
});
const row = (site, no, over = {}) => ({
  Region: '1', Province: 'อ่างทอง', NodeName: 'ป่าโมก', SiteCode: site, LocationType: 'Shop House', AirNo: String(no), ...over
});

test('รหัสเครื่องที่ประกอบจากไฟล์เป็นตัวพิมพ์ใหญ่เสมอ', () => {
  assert.equal(makeAirCode(' atg-pmk ', 1), 'ATG-PMK-AIR-1');
});

test('ไฟล์พิมพ์รหัสไซต์ตัวเล็ก — ได้เครื่องเดิม ไม่เพิ่มใหม่ และไม่นับว่าเครื่องเดิมหายจากไฟล์', () => {
  const existing = [unit('ATG-PMK-AIR-1'), unit('ATG-PMK-AIR-2')];
  const plan = planImport(existing, [
    { ...row('atg-pmk', 1), __line: 2 },
    { ...row('Atg-Pmk', 2, { Brand: 'Daikin' }), __line: 3 }
  ]);

  assert.equal(plan.adds.length, 0);
  assert.deepEqual(plan.unchanged.map(u => u.airCode), ['ATG-PMK-AIR-1']);
  assert.deepEqual(plan.updates.map(u => u.airCode), ['ATG-PMK-AIR-2']);
  assert.deepEqual(plan.updates[0].changes.map(c => c.column), ['Brand'], 'รหัสไซต์ต้องไม่ขึ้นเป็นการเปลี่ยนแปลง');
  assert.equal(plan.missing.length, 0);
});

test('ไฟล์มีรหัสเดียวกันต่างแค่ตัวพิมพ์สองแถว — เป็นรหัสซ้ำในไฟล์', () => {
  const plan = planImport([], [{ ...row('ATG-PMK', 1), __line: 2 }, { ...row('atg-pmk', 1), __line: 3 }]);
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0].message, /ATG-PMK-AIR-1 ซ้ำกับบรรทัดที่ 2/);
});

test('ผ่านหน้าเว็บ — รหัสไซต์ตัวเล็กไม่สร้างเครื่องซ้อน เครื่องใหม่ได้รหัสตัวพิมพ์ใหญ่', async () => {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status) VALUES (?,?,?,?,?,?,?)`)
    .run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ');
  const ctx = () => { const c = new Ctx({}, { async acquireLock() { return true; }, async releaseLock() {} }, db, {}); c.username = 'boss'; return c; };

  const rows = [row('atg-pmk', 1, { Brand: 'Daikin' }), row('atg-pmk', 2)];
  const plan = await planAirUnitImport(ctx(), rows);
  assert.deepEqual(plan.counts, { adds: 1, updates: 1, unchanged: 0, errors: 0, warnings: 0, suspects: 0, missing: 0 });

  await applyAirUnitImport(ctx(), { rows, expect: { adds: 1, updates: 1 } });
  const codes = db.prepare('SELECT AirCode, SiteCode, Brand FROM air_units ORDER BY AirCode').all().map(r => ({ ...r }));
  assert.deepEqual(codes, [
    { AirCode: 'ATG-PMK-AIR-1', SiteCode: 'ATG-PMK', Brand: 'Daikin' },
    { AirCode: 'ATG-PMK-AIR-2', SiteCode: 'ATG-PMK', Brand: '' }
  ]);
});
