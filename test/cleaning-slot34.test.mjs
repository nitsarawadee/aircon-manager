/**
 * ใบล้างของเครื่องที่ 3 ขึ้นไป — ใบแยก หน้าตาแบบฟอร์มเดิม (เหมือนใบติดตั้ง)
 *
 * ใบละคู่ตามเลขท้ายรหัส: AIR-1/2 ใบแรก · AIR-3/4 ใบคู่ 3–4 (ช่อง 1/2 ของใบนั้น) ...
 * เอกสารเขียนเลขเครื่องจริง · ข้ามคู่ในใบเดียวไม่ได้ · ใบเก่าเป็นเครื่องที่ 1–2 เหมือนเดิม
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm, unitSlotOf, unitBaseOf } from '../src/modules/cleaningform.js';
import { buildCleaningDocHtml } from '../src/modules/cleaning-doc.js';
import { cleaningXlsxValues } from '../src/modules/cleaning-xlsx.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const add = db.prepare('INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status) VALUES (?,?,?,?,?)');
  for (const n of [1, 2, 3, 4]) add.run('ATG-PMK-AIR-' + n, 'ป่าโมก', 'ATG-PMK', '1', 'ใช้งานปกติ');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const boss = db => { const c = new Ctx({}, state, db, {}); c.username = 'boss'; return c; };
const form = (over = {}) => ({
  NodeName: 'ป่าโมก', SiteCode: 'ATG-PMK', Date: '2026-09-30', PlanYear: 2026, PlanRound: 2,
  TechnicianName: 'ช่าง', Checklist: [], ...over
});
const rows = db => db.prepare('SELECT * FROM cleaning_forms ORDER BY rowid').all();

test('ช่องและคู่เครื่องจากเลขท้ายรหัส', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(n => [unitSlotOf('X-AIR-' + n), unitBaseOf('X-AIR-' + n)]),
    [[1, 0], [2, 0], [1, 2], [2, 2], [1, 4]]);
  assert.deepEqual([unitSlotOf('ไม่มีเลข'), unitBaseOf('ไม่มีเลข')], [1, 0]);
});

test('AIR-3 → ใบคู่ 3–4 ช่องที่ 1 · AIR-4 วันเดียวกันรวมเข้าใบเดียวกัน · AIR-1 วันเดียวกันเป็นอีกใบ', async () => {
  const db = freshDb();
  await saveCleaningForm(boss(db), form({ AirCode1: 'ATG-PMK-AIR-3' }));
  await saveCleaningForm(boss(db), form({ AirCode1: 'ATG-PMK-AIR-4' }));   // หน้าเว็บส่งช่องไหนมาก็ได้ เซิร์ฟเวอร์จัดให้
  await saveCleaningForm(boss(db), form({ AirCode1: 'ATG-PMK-AIR-1' }));

  const all = rows(db);
  assert.equal(all.length, 2, 'AIR-3/4 ใบเดียว + AIR-1 อีกใบ');
  assert.deepEqual([all[0].AirCode1, all[0].AirCode2, all[0].SlotBase], ['ATG-PMK-AIR-3', 'ATG-PMK-AIR-4', 2]);
  assert.deepEqual([all[1].AirCode1, all[1].SlotBase], ['ATG-PMK-AIR-1', 0]);
});

test('เลือก AIR-1 กับ AIR-3 ในใบเดียว — ไม่รับ', async () => {
  const db = freshDb();
  await assert.rejects(
    () => saveCleaningForm(boss(db), form({ AirCode1: 'ATG-PMK-AIR-1', AirCode2: 'ATG-PMK-AIR-3' })),
    /คนละใบ/);
});

test('เอกสาร / Excel ของใบคู่ 3–4 เขียนเลขเครื่องจริง · ใบเก่าเป็น 1–2 เหมือนเดิม', () => {
  const html = buildCleaningDocHtml({ AirCode1: 'ATG-PMK-AIR-3', SlotBase: 2, ChecklistJSON: '[]' });
  assert.ok(html.includes('เครื่องที่ 3 (AIR 3)'));
  assert.ok(!html.includes('เครื่องที่ 1 (AIR 1)'));
  assert.ok(buildCleaningDocHtml({ AirCode1: 'ATG-PMK-AIR-1', ChecklistJSON: '[]' }).includes('เครื่องที่ 1 (AIR 1)'));

  const x = cleaningXlsxValues({ SlotBase: 2 });
  assert.equal(x['xl/worksheets/sheet1.xml'].F8, 'เครื่องที่ 3 (Unit 3)');
  assert.equal(x['xl/worksheets/sheet1.xml'].D38, 'เครื่องที่ 4');
  assert.match(x['xl/worksheets/sheet3.xml'].A1, /เครื่องที่ 4 \(AIR 4\)/);
  assert.equal(cleaningXlsxValues({})['xl/worksheets/sheet1.xml'].F8, undefined, 'ใบแรกใช้ป้ายของแม่แบบ');
});
