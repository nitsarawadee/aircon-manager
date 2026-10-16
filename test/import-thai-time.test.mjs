/**
 * นำเข้าเครื่อง — UpdatedAt เป็นเวลาไทยเสมอ ไม่ขึ้นกับเขตเวลาของเครื่องเซิร์ฟเวอร์ (16/10/2569)
 *
 * เดิม applyImport ใช้เวลาของเครื่อง (getHours) ขณะที่ทุกจุดอื่นใช้ ymdhms (เวลาไทย)
 * ถ้าเซิร์ฟเวอร์ตั้งเป็น UTC เวลาที่นำเข้าจะช้าไป 7 ชั่วโมง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Repository } from '../src/db/repository.js';
import { planImport, applyImport } from '../src/import.js';
import { ymdhms } from '../src/values.js';

test('เครื่องเซิร์ฟเวอร์ตั้งเวลาเป็น UTC — เวลาที่นำเข้ายังเป็นเวลาไทย', async () => {
  const oldTz = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    const db = new DatabaseSync(':memory:');
    for (const sql of createTableStatements()) db.exec(sql);
    const ss = new Repository(db);
    await ss.load('AirList');

    const plan = planImport([], [{ __line: 2, Region: '1', Province: 'อ่างทอง', NodeName: 'ป่าโมก',
      SiteCode: 'ATG-PMK', LocationType: 'Shop House', AirNo: '1' }]);
    const before = ymdhms(new Date());
    await applyImport(ss, plan, { user: 'boss' });
    const after = ymdhms(new Date());

    const at = db.prepare("SELECT UpdatedAt FROM air_units WHERE AirCode = 'ATG-PMK-AIR-1'").get().UpdatedAt;
    assert.ok(at >= before && at <= after, 'ต้องเป็นเวลาไทย ' + before + ' – ' + after + ' แต่ได้ ' + at);
  } finally {
    if (oldTz === undefined) delete process.env.TZ; else process.env.TZ = oldTz;
  }
});
