/**
 * ทดสอบปฏิทินนัดหมายล้างแอร์
 *
 * ความผิดพลาดที่อันตรายที่สุดของปฏิทินคือ "นัดไปโผล่ผิดวัน"
 * เพราะคนจะไปตามงานผิดวันโดยไม่มีอะไรเตือน
 * และวันที่ 1 กับวันสุดท้ายของเดือนคือจุดที่พลาดบ่อยที่สุด
 * ระบบนี้เคยเจอบั๊กแบบนี้มาแล้วตอนคำนวณด้วยเวลา UTC
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { planCalendar } from '../src/modules/plan.js';

const row = (AirCode, over = {}) => ({
  AirCode, NodeName: 'อ่างทอง',
  R1_PlanDate: '', R1_ActualDate: '', R1_Status: 'รอดำเนินการ',
  R2_PlanDate: '', R2_ActualDate: '', R2_Status: 'รอดำเนินการ',
  R3_PlanDate: '', R3_ActualDate: '', R3_Status: 'รอดำเนินการ',
  ...over
});

/* ==================== การจัดลงวัน ==================== */

test('เดือนที่ไม่มีนัด ต้องคืนปฏิทินเปล่า ไม่ใช่พัง', () => {
  const c = planCalendar([], 2026, 9);
  assert.deepEqual(c.days, {});
  assert.equal(c.total, 0);
  assert.equal(c.month, 9);
});

test('จัดนัดลงวันที่ถูกต้อง', () => {
  const c = planCalendar([
    row('A-AIR-1', { R1_PlanDate: '2026-09-03' }),
    row('A-AIR-2', { R1_PlanDate: '2026-09-03' }),
    row('A-AIR-3', { R1_PlanDate: '2026-09-15' })
  ], 2026, 9);

  assert.equal(c.days[3].length, 2);
  assert.equal(c.days[15].length, 1);
  assert.equal(c.total, 3);
});

test('วันที่ 1 ของเดือน ต้องอยู่ในเดือนนั้น ไม่ตกไปเดือนก่อน', () => {
  // เคยพลาดมาแล้วในระบบนี้ตอนแปลงเป็น Date แล้วอ่านเดือนกลับออกมา
  const c = planCalendar([row('A-AIR-1', { R1_PlanDate: '2026-09-01' })], 2026, 9);
  assert.equal(c.days[1].length, 1);
  assert.equal(c.total, 1);
});

test('วันสุดท้ายของเดือน ต้องไม่ตกไปเดือนถัดไป', () => {
  const c = planCalendar([row('A-AIR-1', { R1_PlanDate: '2026-08-31' })], 2026, 8);
  assert.equal(c.days[31].length, 1);
});

test('นัดของเดือนอื่นต้องไม่ปนเข้ามา', () => {
  const c = planCalendar([
    row('A-AIR-1', { R1_PlanDate: '2026-08-31' }),
    row('A-AIR-2', { R1_PlanDate: '2026-09-15' }),
    row('A-AIR-3', { R1_PlanDate: '2026-10-01' })
  ], 2026, 9);

  assert.equal(c.total, 1);
  assert.equal(c.days[15][0].AirCode, 'A-AIR-2');
});

test('นัดของปีอื่นที่เดือนเดียวกัน ต้องไม่ปนเข้ามา', () => {
  const c = planCalendar([
    row('A-AIR-1', { R1_PlanDate: '2025-09-15' }),
    row('A-AIR-2', { R1_PlanDate: '2026-09-15' })
  ], 2026, 9);

  assert.equal(c.total, 1);
  assert.equal(c.days[15][0].AirCode, 'A-AIR-2');
});

/* ==================== หลายรอบในเครื่องเดียว ==================== */

test('เครื่องเดียวที่มีนัดหลายรอบในเดือนเดียว ต้องขึ้นครบทุกรอบ', () => {
  const c = planCalendar([
    row('A-AIR-1', { R1_PlanDate: '2026-09-03', R2_PlanDate: '2026-09-20' })
  ], 2026, 9);

  assert.equal(c.total, 2);
  assert.equal(c.days[3][0].round, 1);
  assert.equal(c.days[20][0].round, 2);
});

test('นัดวันเดียวกันคนละรอบ ต้องแยกกันได้', () => {
  const c = planCalendar([
    row('A-AIR-1', { R1_PlanDate: '2026-09-03', R2_PlanDate: '2026-09-03' })
  ], 2026, 9);

  assert.equal(c.days[3].length, 2);
  assert.deepEqual(c.days[3].map(x => x.round), [1, 2]);
});

/* ==================== สถานะของนัด ==================== */

test('บอกได้ว่านัดไหนล้างเสร็จแล้ว ยกเลิก หรือยังไม่ทำ', () => {
  const c = planCalendar([
    row('A-AIR-1', { R1_PlanDate: '2026-09-03', R1_Status: 'ล้างเสร็จสิ้น' }),
    row('A-AIR-2', { R1_PlanDate: '2026-09-03', R1_Status: 'ยกเลิก' }),
    row('A-AIR-3', { R1_PlanDate: '2026-09-03' })
  ], 2026, 9);

  const states = c.days[3].map(x => x.state);
  assert.deepEqual(states.sort(), ['cancelled', 'done', 'pending']);
});

test('นัดที่ยกเลิกยังต้องแสดงบนปฏิทิน', () => {
  // ถ้าซ่อนไป คนจะเห็นวันว่างแล้วจัดงานอื่นทับ ทั้งที่เคยมีนัดตรงนั้น
  const c = planCalendar([row('A-AIR-1', { R1_PlanDate: '2026-09-03', R1_Status: 'ยกเลิก' })], 2026, 9);
  assert.equal(c.days[3].length, 1);
});

/* ==================== ความทนทาน ==================== */

test('แถวที่ไม่มีวันนัด ต้องถูกข้ามเงียบๆ', () => {
  const c = planCalendar([row('A-AIR-1'), row('A-AIR-2', { R1_PlanDate: '2026-09-05' })], 2026, 9);
  assert.equal(c.total, 1);
});

test('วันที่รูปแบบผิด ต้องไม่ทำให้ปฏิทินพัง', () => {
  const c = planCalendar([
    row('A-AIR-1', { R1_PlanDate: 'ยังไม่กำหนด' }),
    row('A-AIR-2', { R1_PlanDate: '2026-09-05' })
  ], 2026, 9);
  assert.equal(c.total, 1);
});

test('เดือนที่ส่งมาเป็นข้อความ ต้องยังทำงานได้', () => {
  const c = planCalendar([row('A-AIR-1', { R1_PlanDate: '2026-09-05' })], '2026', '9');
  assert.equal(c.days[5].length, 1);
});

test('เรียงลำดับในแต่ละวันคงที่ ไม่สลับตำแหน่งเอง', () => {
  const c = planCalendar([
    row('C-AIR-1', { R1_PlanDate: '2026-09-03' }),
    row('A-AIR-1', { R1_PlanDate: '2026-09-03' }),
    row('B-AIR-1', { R1_PlanDate: '2026-09-03' })
  ], 2026, 9);

  assert.deepEqual(c.days[3].map(x => x.AirCode), ['A-AIR-1', 'B-AIR-1', 'C-AIR-1']);
});
