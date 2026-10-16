/**
 * แผนเปลี่ยนเครื่อง — ตามชีต "งบเปลี่ยนเครื่อง 2027" ในไฟล์ Data_AIR
 * - อายุ ณ สิ้นปีงบ = ปีงบ − ปีที่ติดตั้ง · เกิน 8 ปี = ครบเกณฑ์ · ช่วงอายุ ปกติ/เฝ้าระวัง/ครบเกณฑ์
 * - ราคา = ค่าเครื่อง + ค่าติดตั้ง ตามช่วง BTU · ยอดรวมนับเฉพาะเครื่องที่ติ๊ก
 * - ติ๊ก/แก้ราคา/ส่งยอดไปงบ ทำได้เฉพาะ Infrastructure · งบล้าง/ซ่อมเดิมไม่ถูกแตะ
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { replacementKind, buildReplacementPlan, ageAtYearEnd, bandOf, getReplacementPlan, setReplacementPicks, saveReplacementPrices, applyReplacementToBudget } from '../src/modules/replacement.js';
import { saveBudgetRecord } from '../src/modules/budget.js';

const unit = (code, install, btu = 18000, extra = {}) => ({ AirCode: code, Region: '1', SiteCode: code.replace(/-AIR-\d+$/, ''), InstallDate: install, BTU: btu, Status: 'ใช้งานปกติ', ...extra });

test('อายุ ณ สิ้นปีงบ และช่วง BTU ตามไฟล์', () => {
  assert.equal(ageAtYearEnd('2013-05-15', 2027), 14);
  assert.equal(ageAtYearEnd('2018-12-31', 2027), 9);
  assert.equal(ageAtYearEnd('2019-01-01', 2027), 8);
  assert.equal(ageAtYearEnd('', 2027), null);
  assert.equal(bandOf(12000).band, 1);
  assert.equal(bandOf('18,000').band, 2);
  assert.equal(bandOf(30000).band, 3);
  assert.equal(bandOf(36000).band, 4);
});

test('ครบเกณฑ์ = อายุเกิน 8 ปี · ยอดนับเฉพาะที่ติ๊ก · เครื่องรื้อถอนไม่นับ', () => {
  const units = [
    unit('A-AIR-1', '2013-05-15'),            // 14 ปี ครบเกณฑ์ ติ๊ก
    unit('A-AIR-2', '2018-06-01', 36000),     // 9 ปี ครบเกณฑ์ ติ๊ก (ใหญ่)
    unit('B-AIR-1', '2017-01-01'),            // 10 ปี ครบเกณฑ์ ไม่ติ๊ก
    unit('C-AIR-1', '2020-01-01'),            // 7 ปี เฝ้าระวัง
    unit('D-AIR-1', '2025-01-01'),            // 2 ปี ปกติ
    unit('E-AIR-1', '2010-01-01', 18000, { Status: 'รื้อถอน/ปลดระวาง' })
  ];
  const picks = [{ AirCode: 'a-air-1', Selected: 1 }, { AirCode: 'A-AIR-2', Selected: 'true' }, { AirCode: 'C-AIR-1', Selected: 1 }];
  const p = buildReplacementPlan(units, picks, [], 2027);
  assert.deepEqual(p.ageGroups, { normal: 1, watch: 1, due: 3, unknown: 0 });
  assert.deepEqual(p.units.map(u => u.airCode), ['A-AIR-1', 'B-AIR-1', 'A-AIR-2'], 'อายุมากก่อน');
  assert.deepEqual([p.summary.due, p.summary.selected, p.summary.purchase, p.summary.install, p.summary.total], [3, 2, 14700 + 55000, 4000 + 8000, 14700 + 55000 + 4000 + 8000]);
  assert.deepEqual(p.staleSelected, [{ airCode: 'C-AIR-1', replacedOn: '' }], 'ติ๊กไว้แต่ยังไม่ครบเกณฑ์ ไม่นับในยอด');
  assert.equal(p.byRegion[0].selected, 2);
});

test('ราคาที่แก้รายปีใช้แทนราคาเริ่มต้น', () => {
  const p = buildReplacementPlan([unit('A-AIR-1', '2013-01-01')], [{ AirCode: 'A-AIR-1', Selected: 1 }], [{ Band: 2, UnitPrice: 16000, InstallPrice: 4500 }], 2027);
  assert.equal(p.summary.total, 20500);
});

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  user.run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  user.run('ra', 'ภาค', 'RegionAdmin', '1', 'budget:edit', 1, 'x');
  user.run('nob', 'ไม่มีสิทธิ์', 'RegionAdmin', '1', 'budget:none', 1, 'x');
  const air = db.prepare("INSERT INTO air_units (AirCode, Region, SiteCode, NodeName, BTU, InstallDate, Status) VALUES (?, '1', ?, 'n', 18000, ?, 'ใช้งานปกติ')");
  air.run('A-AIR-1', 'A', '2013-05-15');
  air.run('A-AIR-2', 'A', '2016-05-15');
  air.run('B-AIR-1', 'B', '2024-05-15');
  const state = { async acquireLock() { return true; }, async releaseLock() {} };
  const as = name => { const c = new Ctx({}, state, db, {}); c.username = name; return c; };
  return { db, as };
}

test('ติ๊ก · แก้ราคา · ส่งยอดไปงบ (งบล้าง/ซ่อมเดิมคงอยู่) · สิทธิ์', async () => {
  const { as } = setup();
  await saveBudgetRecord(as('infra'), 2027, 559500, 513541.1, 'จาก Data_AIR', 0, 0);

  let p = await setReplacementPicks(as('infra'), 2027, ['A-AIR-1', 'a-air-2'], true);
  assert.equal(p.summary.selected, 2);
  assert.equal(p.summary.total, 2 * 18700);
  p = await setReplacementPicks(as('infra'), 2027, ['A-AIR-2'], false);
  assert.equal(p.summary.selected, 1, 'เอาติ๊กออกแล้วแก้แถวเดิม ไม่เพิ่มแถวซ้ำ');
  await assert.rejects(setReplacementPicks(as('infra'), 2027, ['ZZZ-AIR-9'], true), /ไม่พบเครื่อง ZZZ-AIR-9/);

  p = await saveReplacementPrices(as('infra'), 2027, [{ band: 2, unitPrice: 15000, installPrice: 4000 }]);
  assert.equal(p.summary.total, 19000);
  await assert.rejects(saveReplacementPrices(as('infra'), 2027, [{ band: 2, unitPrice: -1, installPrice: 0 }]), /ราคาเครื่อง/);

  p = await applyReplacementToBudget(as('infra'), 2027);
  assert.deepEqual(p.budget, { purchase: 15000, install: 4000, exists: true });
  const { getBudgetSummary } = await import('../src/modules/budget.js');
  const b = await getBudgetSummary(as('infra'), 2027);
  assert.equal(b.budgetCleaning, 559500, 'งบล้างเดิมไม่ถูกแตะ');
  assert.equal(b.budgetRepair, 513541.1);
  assert.equal(b.note, 'จาก Data_AIR');

  // RegionAdmin ที่ดูงบได้ — ดูแผนได้ แต่แก้ไม่ได้
  const view = await getReplacementPlan(as('ra'), 2027);
  assert.equal(view.canEdit, false);
  assert.equal(view.summary.selected, 1);
  await assert.rejects(setReplacementPicks(as('ra'), 2027, ['A-AIR-1'], false), /Infrastructure/);
  await assert.rejects(applyReplacementToBudget(as('ra'), 2027), /Infrastructure/);
  await assert.rejects(getReplacementPlan(as('nob'), 2027), /ไม่มีสิทธิ์ดู/);
});

test('ช่วงที่สอง: ประเภทงานจากประวัติ', () => {
  assert.equal(replacementKind({ EventType: 'เปลี่ยนเครื่อง', Detail: 'เปลี่ยนตัวเครื่องใหม่ที่ตำแหน่งเดิม — …' }), 'replace');
  assert.equal(replacementKind({ EventType: 'เปลี่ยนเครื่อง', Detail: 'ย้ายเครื่องมาจาก X — …' }), 'movein');
  assert.equal(replacementKind({ EventType: 'เปลี่ยนเครื่อง', Detail: 'ย้ายเครื่องออกไปแทน Y — … → ตำแหน่งว่าง รอเครื่องใหม่' }), '');
  assert.equal(replacementKind({ EventType: 'ติดตั้ง', Detail: 'รื้อถอนและติดตั้งเครื่องใหม่แทนเครื่องเดิม (ระบบเดิม) — …' }), 'replace');
  assert.equal(replacementKind({ EventType: 'ติดตั้ง', Detail: 'ติดตั้งเครื่องใหม่ที่ Node "n" (S)' }), 'add');
  assert.equal(replacementKind({ EventType: 'ล้างแอร์', Detail: '' }), '');
});

test('ช่วงที่สอง: เปลี่ยนแล้วอยู่ในแผนต่อ · คงเหลือ · นอกแผน · ติดตั้งเพิ่ม · ติ๊กไว้แต่เปลี่ยนไปปีก่อน', () => {
  const units = [
    unit('A-AIR-1', '2027-03-10'),            // ติ๊ก · เปลี่ยนแล้ว 10/03/2027 (อายุใหม่ 0 ปี แต่ยังอยู่ในแผน)
    unit('A-AIR-2', '2014-01-01'),            // ติ๊ก · ยังไม่เปลี่ยน
    unit('B-AIR-1', '2027-05-01'),            // ไม่ติ๊ก · เปลี่ยนเพราะเสีย = นอกแผน
    unit('N-AIR-1', '2027-06-01'),            // ติดตั้งเพิ่ม
    unit('P-AIR-1', '2026-10-01')             // ติ๊ก แต่เปลี่ยนไปแล้วปี 2026 → ไม่อยู่ในแผน 2027
  ];
  const picks = ['A-AIR-1', 'A-AIR-2', 'P-AIR-1'].map(c => ({ AirCode: c, Selected: 1 }));
  const history = [
    { AirCode: 'A-AIR-1', Date: '2027-03-10', EventType: 'เปลี่ยนเครื่อง', Detail: 'เปลี่ยนตัวเครื่องใหม่ที่ตำแหน่งเดิม — …', Cost: 15000 },
    { AirCode: 'B-AIR-1', Date: '2027-05-01', EventType: 'เปลี่ยนเครื่อง', Detail: 'เปลี่ยนตัวเครื่องใหม่ที่ตำแหน่งเดิม — …', Cost: 14000 },
    { AirCode: 'N-AIR-1', Date: '2027-06-01', EventType: 'ติดตั้ง', Detail: 'ติดตั้งเครื่องใหม่ที่ Node "n" (N)', Cost: '' },
    { AirCode: 'P-AIR-1', Date: '2026-10-01', EventType: 'ติดตั้ง', Detail: 'รื้อถอนและติดตั้งเครื่องใหม่แทนเครื่องเดิม (ระบบเดิม) — …', Cost: 3000 },
    { AirCode: 'A-AIR-2', Date: '2027-02-01', EventType: 'ล้างแอร์', Detail: '', Cost: 500 }
  ];
  const forms = [{ Date: '2027-03-12', AirCode1: 'A-AIR-1', AirCode2: 'N-AIR-1', Cost: 8000 }, { Date: '2026-12-01', AirCode1: 'A-AIR-1', Cost: 999 }];
  const p = buildReplacementPlan(units, picks, [], 2027, history, forms);
  const a1 = p.units.find(u => u.airCode === 'A-AIR-1');
  assert.deepEqual([a1.status, a1.doneDate, a1.actualCost], ['done', '2027-03-10', 15000 + 4000], 'ใบติดตั้งสองเครื่องแบ่งครึ่ง · ใบปีอื่นไม่นับ');
  assert.equal(p.units.find(u => u.airCode === 'A-AIR-2').status, 'pending');
  assert.deepEqual([p.summary.selected, p.summary.done, p.summary.remaining, p.summary.doneActual, p.summary.remainingTotal], [2, 1, 1, 19000, 18700]);
  assert.equal(p.summary.total, 2 * 18700, 'ยอดตามแผนยังนับเครื่องที่เปลี่ยนแล้ว — ใช้ตั้งงบได้เหมือนเดิม');
  assert.deepEqual(p.unplanned.map(u => [u.airCode, u.actualCost]), [['B-AIR-1', 14000]]);
  assert.deepEqual(p.added.map(u => [u.airCode, u.actualCost]), [['N-AIR-1', 4000]]);
  assert.deepEqual(p.staleSelected, [{ airCode: 'P-AIR-1', replacedOn: '2026-10-01' }]);
  assert.equal(p.summary.due, 1, 'ครบเกณฑ์นับตามอายุตอนนี้ — เครื่องที่เปลี่ยนแล้วไม่นับ');
});
