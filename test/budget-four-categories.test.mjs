/**
 * งบ 4 หมวดตามไฟล์งบของพี่เลี้ยง (15/10/2569): ล้าง · ซ่อมบำรุง · จัดซื้อเครื่องใหม่ · ติดตั้ง
 *
 * - ประวัติ "เปลี่ยนเครื่อง" = จัดซื้อ · ค่าติดตั้งมาจากใบติดตั้ง · "เปลี่ยนอะไหล่" ยังเป็นซ่อม
 * - บันทึกงบ 4 ช่อง · หน้าเว็บรุ่นเก่าที่ส่งมา 2 ช่อง ต้องไม่ล้างงบจัดซื้อ/ติดตั้งที่ตั้งไว้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { monthlyBreakdown, costCategory, getBudgetSummary, saveBudgetRecord } from '../src/modules/budget.js';

const h = (Date, EventType, Cost) => ({ Date, EventType, Cost });

test('หมวดของประวัติ: เปลี่ยนเครื่อง = จัดซื้อ · ติดตั้ง = ติดตั้ง · เปลี่ยนอะไหล่ = ซ่อม', () => {
  assert.equal(costCategory('ล้างแอร์'), 'cleaning');
  assert.equal(costCategory('เปลี่ยนเครื่อง'), 'purchase');
  assert.equal(costCategory('ติดตั้ง'), 'install');
  assert.equal(costCategory('เปลี่ยนอะไหล่'), 'repair');
  assert.equal(costCategory('ซ่อมแล้ว'), 'repair');
});

test('รายเดือน 4 หมวด — ค่าติดตั้งนับจากใบติดตั้งตามวันที่ของใบ · ผลบวกเท่ากับยอดรวม', () => {
  const m = monthlyBreakdown([
    h('2027-03-05', 'ล้างแอร์', 550),
    h('2027-03-09', 'ซ่อมแล้ว', 1200),
    h('2027-04-01', 'เปลี่ยนเครื่อง', 14700),
    h('2026-04-01', 'เปลี่ยนเครื่อง', 99999)
  ], 2027, [{ Date: '2027-04-03', Cost: 4000 }, { Date: '2027-05-01', Cost: '' }, { Date: '2026-04-03', Cost: 1 }]);
  assert.equal(m[2].cleaning, 550);
  assert.equal(m[2].repair, 1200);
  assert.equal(m[3].purchase, 14700);
  assert.equal(m[3].install, 4000);
  const sum = k => m.reduce((s, x) => s + x[k], 0);
  assert.equal(sum('cleaning') + sum('repair') + sum('purchase') + sum('install'), sum('total'));
  assert.equal(sum('total'), 550 + 1200 + 14700 + 4000);
});

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  return db;
}
const state = { async acquireLock() { return true; }, async releaseLock() {} };
const infra = db => { const c = new Ctx({}, state, db, {}); c.username = 'infra'; return c; };

test('ตั้งงบ 4 หมวดแล้วสรุปถูก — ค่าใช้จ่ายจริงแยกหมวด คงเหลือรวมทั้ง 4 หมวด', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO history (ID, AirCode, Date, EventType, Cost) VALUES ('CM1','A-AIR-1','2027-04-01','เปลี่ยนเครื่อง',14700)").run();
  db.prepare("INSERT INTO history (ID, AirCode, Date, EventType, Cost) VALUES ('PM1','A-AIR-1','2027-03-05','ล้างแอร์',550)").run();
  db.prepare("INSERT INTO install_forms (ID, Date, Cost) VALUES ('IF1','2027-04-03',4000)").run();

  const s = await saveBudgetRecord(infra(db), 2027, 559500, 513541, 'ตามไฟล์พี่เลี้ยง', 1908100, 506000);
  assert.deepEqual([s.budgetCleaning, s.budgetRepair, s.budgetPurchase, s.budgetInstall], [559500, 513541, 1908100, 506000]);
  assert.equal(s.totalBudget, 3487141);
  assert.deepEqual([s.expenseCleaning, s.expenseRepair, s.expensePurchase, s.expenseInstall], [550, 0, 14700, 4000]);
  assert.equal(s.remainPurchase, 1908100 - 14700);
  assert.equal(s.remaining, 3487141 - 19250);
});

test('หน้าเว็บรุ่นเก่าส่งมาแค่งบล้าง/ซ่อม — งบจัดซื้อ/ติดตั้งที่ตั้งไว้ต้องไม่หาย · ติดลบไม่ได้', async () => {
  const db = freshDb();
  await saveBudgetRecord(infra(db), 2027, 1, 2, '', 3, 4);
  const s = await saveBudgetRecord(infra(db), 2027, 10, 20, '');
  assert.deepEqual([s.budgetCleaning, s.budgetRepair, s.budgetPurchase, s.budgetInstall], [10, 20, 3, 4]);
  await assert.rejects(() => saveBudgetRecord(infra(db), 2027, 1, 1, '', -5, 0), /งบจัดซื้อเครื่องใหม่ต้องเป็นตัวเลข/);
  await assert.rejects(() => saveBudgetRecord(infra(db), 2027, 1, 1, '', 0, -1), /งบติดตั้งต้องเป็นตัวเลข/);
  const again = await getBudgetSummary(infra(db), 2027);
  assert.equal(again.budgetPurchase, 3);
});
