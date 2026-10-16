/**
 * ปฏิทินนัด — เครื่องที่รื้อถอน/Write off หรือถูกลบออกจากทะเบียน นัดที่ยังไม่ล้างไม่ขึ้น (16/10/2569)
 *
 * เดิมปฏิทินโชว์นัดของเครื่องพวกนี้ แต่การ์ดนัด 30 วันบนแดชบอร์ดไม่โชว์ สองที่บอกไม่ตรงกัน
 * และพอถึงวันนัดจะมีคนถูกส่งไปล้างเครื่องที่ไม่มีอยู่แล้ว
 * รอบที่ล้างไปแล้วยังขึ้นตามเดิม เพราะเป็นงานที่ทำไปจริง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { planCalendar, upcomingFromPlan } from '../src/modules/plan.js';

const row = (code, over = {}) => ({
  AirCode: code, NodeName: 'ป่าโมก', PlanYear: '2026',
  R1_PlanDate: '2026-11-05', R1_Status: 'นัดหมายแล้ว', ...over
});
const codesOn = (cal, day) => (cal.days[day] || []).map(x => x.AirCode);

test('นัดที่ยังไม่ล้างของเครื่องรื้อถอน/ถูกลบ ไม่ขึ้นในปฏิทิน — เครื่องปกติขึ้นตามเดิม', () => {
  const cal = planCalendar([
    row('ATG-PMK-AIR-1'),
    row('ATG-PMK-AIR-2', { Retired: true }),
    row('ATG-PMK-AIR-3', { Removed: true })
  ], 2026, 11);
  assert.deepEqual(codesOn(cal, 5), ['ATG-PMK-AIR-1']);
  assert.equal(cal.total, 1);
});

test('รอบที่ล้างไปแล้วของเครื่องรื้อถอน ยังขึ้นในปฏิทิน (งานที่ทำไปจริง)', () => {
  const cal = planCalendar([
    row('ATG-PMK-AIR-2', { Retired: true, R1_Status: 'ล้างเสร็จสิ้น', R1_ActualDate: '2026-11-05' })
  ], 2026, 11);
  assert.deepEqual(codesOn(cal, 5), ['ATG-PMK-AIR-2']);
});

test('ปฏิทินกับการ์ดนัด 30 วัน เห็นนัดที่ยังไม่ล้างชุดเดียวกัน', () => {
  const rows = [row('ATG-PMK-AIR-1'), row('ATG-PMK-AIR-2', { Retired: true }), row('ATG-PMK-AIR-3', { Removed: true })];
  const today = new Date(Date.UTC(2026, 10, 1) - 7 * 3600000);   // 1 พ.ย. 2026 เที่ยงคืนเวลาไทย
  const card = upcomingFromPlan(rows, '2026', today).map(x => x.AirCode);
  const cal = codesOn(planCalendar(rows, 2026, 11), 5);
  assert.deepEqual(cal, card);
});
