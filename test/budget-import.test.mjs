/**
 * ส่งออก / นำเข้างบที่ตั้งไว้รายปี (หน้างบประมาณ)
 * - ไฟล์ที่ส่งออกนำเข้ากลับได้ทันที · ช่องว่าง = ไม่แก้ค่าเดิม · ผิดแถวเดียวไม่รับทั้งไฟล์
 * - ดูผลก่อน (ไม่บันทึก) แล้วค่อยนำเข้าจริง · ต้องมีสิทธิ์แก้งบ
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveBudgetRecord, getBudgetRows, previewBudgetImport, applyBudgetImport, getBudgetSummary, parseBudgetImport } from '../src/modules/budget.js';

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  user.run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  user.run('view', 'ดูอย่างเดียว', 'RegionAdmin', '1', 'budget:view', 1, 'x');
  const state = { async acquireLock() { return true; }, async releaseLock() {} };
  const as = name => { const c = new Ctx({}, state, db, {}); c.username = name; return c; };
  return { as };
}

test('ส่งออกแล้วนำเข้ากลับได้ · ดูผลก่อนไม่บันทึก · ช่องว่างไม่แก้ · เพิ่มปีใหม่ได้', async () => {
  const { as } = setup();
  await saveBudgetRecord(as('infra'), 2027, 559500, 513541.1, 'จาก Data_AIR', 1908100, 506000);

  const rows = await getBudgetRows(as('view'));
  assert.deepEqual(rows, [{ Year: 2027, CleaningBudget: 559500, RepairBudget: 513541.1, PurchaseBudget: 1908100, InstallBudget: 506000, Note: 'จาก Data_AIR' }]);

  // ไฟล์ที่แก้: 2027 แก้งบจัดซื้อ (มีจุลภาค) เว้นงบติดตั้งว่าง · เพิ่มปี 2028
  const file = [
    { Year: '2027', CleaningBudget: '559,500', RepairBudget: '513541.1', PurchaseBudget: '2,000,000', InstallBudget: '', Note: '' },
    { Year: '2028', CleaningBudget: '600000', RepairBudget: '', PurchaseBudget: '', InstallBudget: '', Note: 'ปีหน้า' }
  ];
  const pv = await previewBudgetImport(as('infra'), file);
  assert.deepEqual(pv.changes.map(c => [c.year, c.isNew, c.fields.map(f => [f.column, f.from, f.to])]), [
    [2027, false, [['PurchaseBudget', 1908100, 2000000]]],
    [2028, true, [['CleaningBudget', 0, 600000], ['Note', '', 'ปีหน้า']]]
  ]);
  assert.equal((await getBudgetSummary(as('infra'), 2027)).budgetPurchase, 1908100, 'ดูผลก่อนยังไม่บันทึก');

  const res = await applyBudgetImport(as('infra'), file);
  assert.deepEqual(res.changedYears, [2027, 2028]);
  const b27 = await getBudgetSummary(as('infra'), 2027);
  assert.deepEqual([b27.budgetPurchase, b27.budgetInstall, b27.note], [2000000, 506000, 'จาก Data_AIR'], 'ช่องว่างไม่แก้ค่าเดิม');
  const b28 = await getBudgetSummary(as('infra'), 2028);
  assert.deepEqual([b28.budgetCleaning, b28.budgetRepair, b28.budgetPurchase, b28.note], [600000, 0, 0, 'ปีหน้า']);

  // นำเข้าไฟล์เดิมซ้ำ — ไม่มีอะไรเปลี่ยน
  assert.equal((await previewBudgetImport(as('infra'), file)).changes.length, 0);
});

test('ผิดแถวเดียวไม่รับทั้งไฟล์ · ปีซ้ำ · ไม่มีคอลัมน์ Year · สิทธิ์', async () => {
  const { as } = setup();
  assert.throws(() => parseBudgetImport([{ Year: '2027', CleaningBudget: '-5' }, { Year: '2028', CleaningBudget: '1' }]), /แถว 2 \(ปี 2027\): งบล้างแอร์/);
  assert.throws(() => parseBudgetImport([{ Year: '2027' }, { Year: '2027' }]), /ปี 2027 ซ้ำในไฟล์/);
  assert.throws(() => parseBudgetImport([{ Year: 'abc' }]), /ปี "abc" ไม่ถูกต้อง/);
  assert.throws(() => parseBudgetImport([{ ปี: 2027 }]), /ต้องมีคอลัมน์ Year/);
  assert.equal(parseBudgetImport([{ Year: '2027' }, { Year: '', CleaningBudget: '' }]).length, 1, 'แถวว่างทั้งแถวข้ามไป');

  await assert.rejects(applyBudgetImport(as('infra'), [{ Year: '2027', CleaningBudget: '1' }, { Year: '2028', CleaningBudget: 'x' }]), /ยังไม่ได้บันทึก/);
  assert.equal((await getBudgetRows(as('infra'))).length, 0, 'แถวที่ถูกต้องก็ไม่ถูกบันทึก');
  await assert.rejects(previewBudgetImport(as('view'), [{ Year: '2027', CleaningBudget: '1' }]), /ไม่มีสิทธิ์แก้ไข/);
  await assert.rejects(applyBudgetImport(as('view'), [{ Year: '2027', CleaningBudget: '1' }]), /ไม่มีสิทธิ์แก้ไข/);
});
