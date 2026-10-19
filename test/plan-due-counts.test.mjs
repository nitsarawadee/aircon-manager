/**
 * ทดสอบตัวนับประกาศบนปฏิทิน — รอบที่เลยกำหนด / ใกล้ถึงเวลาล้างภายใน 30 วัน (ผู้ใช้ขอ 19/10/2569)
 *
 * กติกาต้องตรงกับนัด 30 วันในแดชบอร์ด (upcomingFromPlan) ไม่งั้นสองที่บอกจำนวนไม่ตรงกัน
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { planDueCounts } from '../src/modules/plan.js';
import { safeParseDate } from '../src/values.js';

const row = (AirCode, over = {}) => ({
  AirCode, NodeName: 'อ่างทอง',
  R1_PlanDate: '', R1_ActualDate: '', R1_Status: 'รอดำเนินการ',
  R2_PlanDate: '', R2_ActualDate: '', R2_Status: 'รอดำเนินการ',
  R3_PlanDate: '', R3_ActualDate: '', R3_Status: 'รอดำเนินการ',
  ...over
});

// วันนี้ = 19/10/2026 ตามเวลาไทย (คิดแบบเดียวกับ todayStart)
const today = safeParseDate('2026-10-19');

test('เลยวันนัดแล้ว = late · อีกไม่เกิน 30 วัน = soon · ไกลกว่านั้นไม่นับ', () => {
  const c = planDueCounts([
    row('A-AIR-1', { R1_PlanDate: '2026-10-18' }),   // เมื่อวาน — เลยกำหนด
    row('A-AIR-2', { R1_PlanDate: '2026-10-19' }),   // วันนี้ — ใกล้ถึง
    row('A-AIR-3', { R1_PlanDate: '2026-11-18' }),   // อีก 30 วัน — ใกล้ถึง
    row('A-AIR-4', { R1_PlanDate: '2026-11-19' })    // อีก 31 วัน — ไม่นับ
  ], today);
  assert.deepEqual(c, { late: 1, soon: 2 });
});

test('รอบที่ล้างแล้ว ยกเลิก หรือยังไม่ลงวันนัด ไม่นับ', () => {
  const c = planDueCounts([
    row('A-AIR-1', { R1_PlanDate: '2026-10-01', R1_Status: 'ล้างเสร็จสิ้น' }),
    row('A-AIR-2', { R1_PlanDate: '2026-10-01', R1_Status: 'ยกเลิก' }),
    row('A-AIR-3', { R1_PlanDate: '' })
  ], today);
  assert.deepEqual(c, { late: 0, soon: 0 });
});

test('นัดหมายแล้วแต่เลยวัน ยังนับเป็นเลยกำหนด', () => {
  const c = planDueCounts([row('A-AIR-1', { R1_PlanDate: '2026-10-01', R1_Status: 'นัดหมายแล้ว' })], today);
  assert.deepEqual(c, { late: 1, soon: 0 });
});

test('เครื่องที่เลิกใช้ และรอบของผู้รับเหมาเจ้าอื่น ไม่นับ', () => {
  const c = planDueCounts([
    row('A-AIR-1', { R1_PlanDate: '2026-10-01', Retired: true }),
    row('A-AIR-2', { R1_PlanDate: '2026-10-01', Removed: true }),
    row('A-AIR-3', { R1_PlanDate: '2026-10-01', R1_Mine: false }),
    row('A-AIR-4', { R1_PlanDate: '2026-10-01', R1_Mine: true })
  ], today);
  assert.deepEqual(c, { late: 1, soon: 0 });
});

test('นับทุกรอบของเครื่องเดียวกันแยกกัน', () => {
  const c = planDueCounts([row('A-AIR-1', { R1_PlanDate: '2026-03-01', R2_PlanDate: '2026-10-25', R3_PlanDate: '2027-01-10' })], today);
  assert.deepEqual(c, { late: 1, soon: 1 });
});
