/**
 * นำเข้าผู้ใช้ — หัวคอลัมน์ "ผู้รับเหมา" ตามคำที่ใช้ทั้งเว็บ (16/10/2569)
 *
 * d82eca8 เปลี่ยนคำบนหน้าจอเป็น "ผู้รับเหมา" (ช่างรายคนก็สร้างบัญชีผู้รับเหมาได้) แต่ Template นำเข้าผู้ใช้
 * ยังใช้หัว "บริษัทผู้รับเหมา" — ตอนนี้ใช้หัวใหม่ และไฟล์เก่าที่ยังใช้หัวเดิมก็ยังอ่านได้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { USER_IMPORT_COLUMNS, planUserImport } from '../src/modules/user-import.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  return db;
}
const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => { const c = new Ctx({}, state, db, {}); c.username = 'boss'; return c; };
const sub = (over = {}) => ({ Username: 'c.one', 'บทบาท': 'Subcontract', 'รหัสผ่าน': 'secret1', ...over });

test('Template ใช้หัวคอลัมน์ "ผู้รับเหมา" ไม่มี "บริษัทผู้รับเหมา" แล้ว', () => {
  const names = USER_IMPORT_COLUMNS.map(c => c.name);
  assert.ok(names.includes('ผู้รับเหมา'));
  assert.ok(!names.includes('บริษัทผู้รับเหมา'));
});

test('อ่านได้ทั้งหัวใหม่และหัวเดิม · ไม่ใส่ = ข้อความใช้คำว่า "ผู้รับเหมา"', async () => {
  const plan = await planUserImport(ctxOf(freshDb()), [
    sub({ Username: 'c.new', 'ผู้รับเหมา': 'ช่างสมชาย' }),
    sub({ Username: 'c.old', 'บริษัทผู้รับเหมา': 'บริษัท เอ แอร์' }),
    sub({ Username: 'c.none' })
  ]);
  assert.deepEqual(plan.adds.map(a => [a.username, a.company]), [['c.new', 'ช่างสมชาย'], ['c.old', 'บริษัท เอ แอร์']]);
  assert.deepEqual(plan.errors.map(e => [e.username, e.message]), [['c.none', 'Subcontract ต้องระบุผู้รับเหมา']]);
});
