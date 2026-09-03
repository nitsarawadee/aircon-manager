/**
 * ทดสอบสรุปการล้างแอร์รายปี
 *
 * ตัวเลขชุดนี้เอาไปรายงานหัวหน้าและใช้วางแผนงบปีถัดไป
 * ถ้าผิดจะไม่มีใครจับได้ทันที เพราะไม่มีอะไรให้เทียบนอกจากไปนับเองทั้ง 457 แถว
 * เทสต์จึงต้องคุมกฎการนับให้ชัดว่าอะไรนับเป็นเสร็จ อะไรไม่นับ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { summarizeCleaning } from '../src/modules/plan.js';

/** หนึ่งแถวของแผน โดยรอบที่ไม่ระบุจะเป็นรอดำเนินการ */
const row = (AirCode, over = {}) => ({
  AirCode, NodeName: 'ทดสอบ',
  R1_Status: 'รอดำเนินการ', R1_ActualDate: '', R1_Price: '',
  R2_Status: 'รอดำเนินการ', R2_ActualDate: '', R2_Price: '',
  R3_Status: 'รอดำเนินการ', R3_ActualDate: '', R3_Price: '',
  ...over
});

const units = [
  { AirCode: 'A-A-AIR-1', Region: '1' },
  { AirCode: 'A-A-AIR-2', Region: '1' },
  { AirCode: 'B-B-AIR-1', Region: '2' }
];

/* ==================== การนับพื้นฐาน ==================== */

test('แผนเปล่า ต้องไม่พังและได้ศูนย์ทั้งหมด', () => {
  const s = summarizeCleaning([], [], 2026);
  assert.equal(s.units, 0);
  assert.equal(s.done, 0);
  assert.equal(s.percent, 0, 'ไม่มีแผนต้องไม่หารด้วยศูนย์');
  assert.equal(s.rounds.length, 3, 'ต้องมีครบ 3 รอบเสมอ');
});

test('นับรอบที่เสร็จแล้วแยกตามรอบได้ถูก', () => {
  const s = summarizeCleaning([
    row('A-A-AIR-1', { R1_Status: 'ล้างเสร็จสิ้น', R1_Price: 450 }),
    row('A-A-AIR-2', { R1_Status: 'ล้างเสร็จสิ้น', R1_Price: 450, R2_Status: 'ล้างเสร็จสิ้น', R2_Price: 500 })
  ], units, 2026);

  assert.equal(s.rounds[0].done, 2);
  assert.equal(s.rounds[1].done, 1);
  assert.equal(s.rounds[2].done, 0);
  assert.equal(s.done, 3);
});

test('ค่าใช้จ่ายนับเฉพาะรอบที่ทำเสร็จแล้ว', () => {
  // ราคาที่กรอกไว้ล่วงหน้าในรอบที่ยังไม่ได้ทำ ไม่ใช่เงินที่จ่ายไปแล้ว
  const s = summarizeCleaning([
    row('A-A-AIR-1', { R1_Status: 'ล้างเสร็จสิ้น', R1_Price: 450, R2_Price: 9999 })
  ], units, 2026);

  assert.equal(s.cost, 450, 'ราคาของรอบที่ยังไม่ทำต้องไม่ถูกนับ');
});

/* ==================== กฎการนับที่พลาดง่าย ==================== */

test('รอบที่มีวันที่ทำจริง ต้องนับว่าเสร็จแม้สถานะยังไม่อัปเดต', () => {
  // ข้อมูลที่ย้ายมาจากชีตเดิมบางแถวเป็นแบบนี้
  // ถ้านับแต่สถานะ งานที่ทำไปแล้วจริงจะหายจากรายงาน
  const s = summarizeCleaning([
    row('A-A-AIR-1', { R1_Status: 'รอดำเนินการ', R1_ActualDate: '2026-07-23', R1_Price: 450 })
  ], units, 2026);

  assert.equal(s.done, 1);
  assert.equal(s.cost, 450);
});

test('รอบที่ยกเลิก ต้องไม่นับเป็นทั้งเสร็จและค้าง', () => {
  const s = summarizeCleaning([
    row('A-A-AIR-1', { R1_Status: 'ยกเลิก' })
  ], units, 2026);

  assert.equal(s.rounds[0].cancelled, 1);
  assert.equal(s.rounds[0].done, 0);
  assert.equal(s.rounds[0].pending, 0);
});

test('รอบที่ยกเลิก ต้องไม่ถูกนับเป็นงานที่ต้องทำ', () => {
  // ถ้านับรวม เปอร์เซ็นต์ความคืบหน้าจะไม่มีวันถึง 100 ทั้งที่ทำครบแล้ว
  const s = summarizeCleaning([
    row('A-A-AIR-1', { R1_Status: 'ล้างเสร็จสิ้น', R2_Status: 'ยกเลิก', R3_Status: 'ยกเลิก' })
  ], units, 2026);

  assert.equal(s.planned, 1, 'มีงานที่ต้องทำแค่รอบเดียว');
  assert.equal(s.done, 1);
  assert.equal(s.percent, 100, 'ทำครบแล้วต้องเป็น 100%');
});

test('ยกเลิกทุกรอบ ต้องไม่หารด้วยศูนย์', () => {
  const s = summarizeCleaning([
    row('A-A-AIR-1', { R1_Status: 'ยกเลิก', R2_Status: 'ยกเลิก', R3_Status: 'ยกเลิก' })
  ], units, 2026);
  assert.equal(s.percent, 0);
});

/* ==================== เครื่องที่ยังไม่ได้ล้างเลย ==================== */

test('นับเครื่องที่ยังไม่ได้ล้างเลยสักรอบ', () => {
  // ตัวเลขนี้ต่างจาก "เหลืออีกกี่รอบ" เพราะบอกว่าต้องไปตามเครื่องไหนจริงๆ
  const s = summarizeCleaning([
    row('A-A-AIR-1', { R1_Status: 'ล้างเสร็จสิ้น' }),
    row('A-A-AIR-2'),
    row('B-B-AIR-1')
  ], units, 2026);

  assert.equal(s.neverCleaned, 2);
});

test('เครื่องที่ล้างแล้วแม้รอบเดียว ต้องไม่ถูกนับว่ายังไม่ได้ล้าง', () => {
  const s = summarizeCleaning([
    row('A-A-AIR-1', { R3_Status: 'ล้างเสร็จสิ้น' })
  ], units, 2026);
  assert.equal(s.neverCleaned, 0);
});

/* ==================== แยกตามภูมิภาค ==================== */

test('แยกตามภูมิภาคได้ถูก และผลรวมต้องเท่ากับยอดรวม', () => {
  const s = summarizeCleaning([
    row('A-A-AIR-1', { R1_Status: 'ล้างเสร็จสิ้น', R1_Price: 450 }),
    row('A-A-AIR-2', { R1_Status: 'ล้างเสร็จสิ้น', R1_Price: 450 }),
    row('B-B-AIR-1', { R1_Status: 'ล้างเสร็จสิ้น', R1_Price: 550 })
  ], units, 2026);

  const r1 = s.byRegion.find(r => r.region === '1');
  const r2 = s.byRegion.find(r => r.region === '2');

  assert.equal(r1.units, 2);
  assert.equal(r1.done, 2);
  assert.equal(r1.cost, 900);
  assert.equal(r2.cost, 550);

  assert.equal(s.byRegion.reduce((t, r) => t + r.done, 0), s.done, 'ผลรวมรายภาคต้องเท่ากับยอดรวม');
  assert.equal(s.byRegion.reduce((t, r) => t + r.cost, 0), s.cost);
});

test('เครื่องที่หาภูมิภาคไม่เจอ ต้องไม่หายไปจากสรุป', () => {
  // ถ้าเงียบๆ ทิ้งไป ผลรวมรายภาคจะไม่เท่ากับยอดรวมโดยไม่มีใครรู้
  const s = summarizeCleaning([row('ไม่รู้จัก-AIR-1', { R1_Status: 'ล้างเสร็จสิ้น' })], units, 2026);

  assert.equal(s.byRegion.length, 1);
  assert.equal(s.byRegion[0].region, 'ไม่ระบุ');
  assert.equal(s.byRegion[0].done, 1);
});

test('รหัสเครื่องที่ตัวพิมพ์หรือช่องว่างต่างกัน ต้องจับคู่ภูมิภาคได้', () => {
  const s = summarizeCleaning([row(' a-a-air-1 ')], units, 2026);
  assert.equal(s.byRegion[0].region, '1');
});

/* ==================== ความสอดคล้องของตัวเลข ==================== */

test('เสร็จ + ค้าง + ยกเลิก ต้องเท่ากับจำนวนเครื่อง x 3 รอบเสมอ', () => {
  const rows = [
    row('A-A-AIR-1', { R1_Status: 'ล้างเสร็จสิ้น', R2_Status: 'ยกเลิก' }),
    row('A-A-AIR-2', { R1_ActualDate: '2026-01-05' }),
    row('B-B-AIR-1')
  ];
  const s = summarizeCleaning(rows, units, 2026);

  assert.equal(s.done + s.pending + s.cancelled, rows.length * 3);
});
