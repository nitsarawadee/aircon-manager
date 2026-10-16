/**
 * ช่องทะเบียนจากไฟล์ Data_AIR ของพี่เลี้ยง (15/10/2569): Area · ProvinceCode · LocationCode
 * - นำเข้าแล้วค่าเข้าทะเบียน · ช่องว่างไม่ลบค่าเดิม
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { validateRow, HEADERS } from '../src/import-spec.js';
import { planAirUnitImport, applyAirUnitImport, getAirList } from '../src/modules/airlist.js';

const row = extra => ({ Region: '1', Province: 'กาญจนบุรี', NodeName: 'ท่าม่วง', SiteCode: 'KCB-TAM', LocationType: 'Shop House', AirNo: '1', ...extra });

test('Template มีช่องใหม่ครบ', () => {
  for (const h of ['Area', 'ProvinceCode', 'LocationCode']) assert.ok(HEADERS.includes(h), h);
});

test('นำเข้าแล้วค่าเข้าทะเบียน · นำเข้าซ้ำด้วยช่องว่างไม่ลบค่าเดิม', async () => {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  db.prepare("INSERT INTO air_units (AirCode, Region, Province, NodeName, SiteCode, LocationType, Status) VALUES ('KCB-TAM-AIR-1','1','กาญจนบุรี','ท่าม่วง','KCB-TAM','Shop House','ใช้งานปกติ')").run();
  const state = { async acquireLock() { return true; }, async releaseLock() {} };
  const ctx = () => { const c = new Ctx({}, state, db, {}); c.username = 'infra'; return c; };

  const rows = [row({ Area: 'นครปฐม', ProvinceCode: 'KCB', LocationCode: 'KCB-01-TAM' })];
  const plan = await planAirUnitImport(ctx(), rows);
  assert.equal(plan.counts.errors, 0);
  await applyAirUnitImport(ctx(), { rows, expect: { adds: plan.counts.adds, updates: plan.counts.updates, removes: 0 } });
  let u = (await getAirList(ctx())).find(x => x.AirCode === 'KCB-TAM-AIR-1');
  assert.deepEqual([u.Area, u.ProvinceCode, u.LocationCode], ['นครปฐม', 'KCB', 'KCB-01-TAM']);

  const again = [row({ Brand: 'Carrier' })];
  const p2 = await planAirUnitImport(ctx(), again);
  await applyAirUnitImport(ctx(), { rows: again, expect: { adds: p2.counts.adds, updates: p2.counts.updates, removes: 0 } });
  u = (await getAirList(ctx())).find(x => x.AirCode === 'KCB-TAM-AIR-1');
  assert.equal(u.LocationCode, 'KCB-01-TAM', 'ช่องว่างในไฟล์ไม่ลบค่าเดิม');
  assert.equal(u.Brand, 'Carrier');
});
