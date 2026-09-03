/**
 * ทดสอบการแยกค่าใช้จ่ายรายเดือน
 *
 * เรื่องที่พลาดง่ายที่สุดของงานนี้คือ "ตัวเลขสองที่ไม่ตรงกัน"
 * คือยอดรวมทั้งปีบนการ์ด ไม่เท่ากับผลบวกของกราฟรายเดือน
 * แล้วไม่มีใครรู้ว่าอันไหนถูก เทสต์ชุดนี้จึงบังคับให้สองตัวนั้นตรงกันเสมอ
 *
 * อีกเรื่องคือวันที่ต้นเดือน ซึ่งเคยพลาดมาแล้วในระบบนี้ตอนคำนวณด้วยเวลา UTC
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { monthlyBreakdown, MONTH_LABELS } from '../src/modules/budget.js';

const h = (Date_, EventType, Cost) => ({ Date: Date_, EventType, Cost });

test('คืนครบ 12 เดือนเสมอ แม้ไม่มีข้อมูลเลย', () => {
  // เดือนที่ยังไม่ถึงกับเดือนที่ไม่ได้ใช้เงิน ต้องมีแกนอยู่บนกราฟทั้งคู่
  const m = monthlyBreakdown([], 2026);
  assert.equal(m.length, 12);
  assert.equal(m[0].label, 'ม.ค.');
  assert.equal(m[11].label, 'ธ.ค.');
  assert.ok(m.every(x => x.total === 0));
});

test('แยกล้างกับซ่อมลงเดือนที่ถูกต้อง', () => {
  const m = monthlyBreakdown([
    h('2026-03-15', 'ล้างแอร์', 450),
    h('2026-03-20', 'ซ่อม', 8500),
    h('2026-07-01', 'ล้างแอร์', 900)
  ], 2026);

  assert.equal(m[2].cleaning, 450);
  assert.equal(m[2].repair, 8500);
  assert.equal(m[2].total, 8950);
  assert.equal(m[6].cleaning, 900);
});

test('รายการวันที่ 1 ของเดือน ต้องไม่ตกไปอยู่เดือนก่อนหน้า', () => {
  // เคยพลาดมาแล้วตอนคำนวณด้วยเวลา UTC ทำให้ 1 ม.ค. ตกไปอยู่ ธ.ค. ปีก่อน
  const m = monthlyBreakdown([h('2026-01-01', 'ล้างแอร์', 100)], 2026);
  assert.equal(m[0].cleaning, 100, 'ต้องอยู่เดือนมกราคม');
  assert.equal(m[11].cleaning, 0, 'ต้องไม่ไปโผล่เดือนธันวาคม');
});

test('ข้ามรายการของปีอื่น', () => {
  const m = monthlyBreakdown([
    h('2025-03-15', 'ล้างแอร์', 999),
    h('2026-03-15', 'ล้างแอร์', 450),
    h('2027-03-15', 'ล้างแอร์', 111)
  ], 2026);
  assert.equal(m[2].cleaning, 450, 'ต้องนับเฉพาะปี 2026');
});

test('ผลบวก 12 เดือน ต้องเท่ากับยอดรวมทั้งปีเสมอ', () => {
  // ถ้าสองตัวนี้ไม่ตรงกัน คนใช้จะเห็นการ์ดกับกราฟบอกคนละเลข แล้วไม่เชื่อระบบทั้งหน้า
  const rows = [
    h('2026-01-05', 'ล้างแอร์', 450), h('2026-02-11', 'ซ่อม', 1200),
    h('2026-06-30', 'ล้างแอร์', 900), h('2026-12-31', 'เปลี่ยนอะไหล่', 3400)
  ];
  const m = monthlyBreakdown(rows, 2026);
  const sum = k => m.reduce((s, x) => s + x[k], 0);

  assert.equal(sum('cleaning'), 1350);
  assert.equal(sum('repair'), 4600);
  assert.equal(sum('total'), 5950);
  assert.equal(sum('cleaning') + sum('repair'), sum('total'));
});

test('เหตุการณ์ที่ไม่ใช่การล้าง ให้นับเป็นงานซ่อมทั้งหมด', () => {
  const m = monthlyBreakdown([
    h('2026-05-01', 'ซ่อม', 100),
    h('2026-05-02', 'เปลี่ยนอะไหล่', 200),
    h('2026-05-03', 'ย้าย', 300)
  ], 2026);
  assert.equal(m[4].repair, 600);
  assert.equal(m[4].cleaning, 0);
});

test('รายการที่ไม่มีค่าใช้จ่าย ต้องไม่ทำให้ตัวเลขเพี้ยน', () => {
  const m = monthlyBreakdown([
    h('2026-05-01', 'ล้างแอร์', ''),
    h('2026-05-02', 'ติดตั้ง', null),
    h('2026-05-03', 'ล้างแอร์', 450)
  ], 2026);
  assert.equal(m[4].cleaning, 450);
  assert.equal(m[4].total, 450);
});

test('วันที่ใช้ไม่ได้ ต้องถูกข้ามไปโดยไม่พัง', () => {
  const m = monthlyBreakdown([
    h('', 'ล้างแอร์', 100), h('ไม่ทราบ', 'ล้างแอร์', 200), h('2026-05-01', 'ล้างแอร์', 450)
  ], 2026);
  assert.equal(m.reduce((s, x) => s + x.total, 0), 450);
});

test('ป้ายเดือนเป็นภาษาไทยครบ 12 เดือน', () => {
  assert.equal(MONTH_LABELS.length, 12);
  assert.equal(MONTH_LABELS[5], 'มิ.ย.');
});
