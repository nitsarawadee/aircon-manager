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

/* ==================== สรุปราย Node ภายในภูมิภาค ====================
   ยอดรวมของภูมิภาคบอกได้แค่ว่าคืบหน้าเท่าไหร่ ไม่ได้บอกว่า "ที่ไหน" ยังไม่ได้ล้าง
   ซึ่งเป็นคำถามที่ต้องใช้ตอนตามงานจริง ภูมิภาคหนึ่งมี Node ได้ถึง 51 แห่ง
   ============================================================================ */

/** แถวที่ระบุ Node ได้ ต่างจาก row() ที่ตรึงชื่อ Node ไว้ตัวเดียว */
const nodeRow = (AirCode, NodeName, SiteCode, over = {}) => ({
  ...row(AirCode, over), NodeName, SiteCode
});

test('แยกย่อยราย Node ในแต่ละภูมิภาคได้', () => {
  const s = summarizeCleaning([
    nodeRow('A-A-AIR-1', 'วังน้อย', 'AYA-WNI', { R1_Status: 'ล้างเสร็จสิ้น', R1_Price: 850 }),
    nodeRow('A-A-AIR-2', 'วังน้อย', 'AYA-WNI'),
    nodeRow('B-B-AIR-1', 'ชลบุรี', 'CBI-CBI')
  ], units, 2026);

  const r1 = s.byRegion.find(r => r.region === '1');
  assert.equal(r1.nodes.length, 1, 'ภูมิภาค 1 มี Node เดียว แม้จะมี 2 เครื่อง');
  assert.equal(r1.nodes[0].node, 'วังน้อย');
  assert.equal(r1.nodes[0].siteCode, 'AYA-WNI');
  assert.equal(r1.nodes[0].units, 2);
  assert.equal(r1.nodes[0].done, 1);
  assert.equal(r1.nodes[0].cost, 850);

  const r2 = s.byRegion.find(r => r.region === '2');
  assert.equal(r2.nodes.length, 1);
  assert.equal(r2.nodes[0].node, 'ชลบุรี');
});

test('Node ที่ค้างมากที่สุดต้องอยู่บนสุด', () => {
  // รายการนี้มีไว้ใช้ตามงาน ที่ที่ยังไม่ได้ล้างเลยต้องไม่ไปจมอยู่ท้ายรายการ
  const s = summarizeCleaning([
    nodeRow('A-A-AIR-1', 'เสร็จหมดแล้ว', 'S1', {
      R1_Status: 'ล้างเสร็จสิ้น', R2_Status: 'ล้างเสร็จสิ้น', R3_Status: 'ล้างเสร็จสิ้น'
    }),
    nodeRow('A-A-AIR-2', 'ยังไม่ได้ล้างเลย', 'S2')
  ], [{ AirCode: 'A-A-AIR-1', Region: '1' }, { AirCode: 'A-A-AIR-2', Region: '1' }], 2026);

  assert.deepEqual(
    s.byRegion[0].nodes.map(n => n.node),
    ['ยังไม่ได้ล้างเลย', 'เสร็จหมดแล้ว']
  );
});

test('Node ที่ยกเลิกทุกรอบ ต้องไม่ลอยขึ้นมาปนกับงานที่ยังค้าง', () => {
  // ยกเลิกแล้วคือไม่มีงานเหลือ ไม่ใช่งานที่ต้องไปตาม
  const s = summarizeCleaning([
    nodeRow('A-A-AIR-1', 'ยกเลิกหมด', 'S1', {
      R1_Status: 'ยกเลิก', R2_Status: 'ยกเลิก', R3_Status: 'ยกเลิก'
    }),
    nodeRow('A-A-AIR-2', 'ยังค้างอยู่', 'S2')
  ], [{ AirCode: 'A-A-AIR-1', Region: '1' }, { AirCode: 'A-A-AIR-2', Region: '1' }], 2026);

  assert.equal(s.byRegion[0].nodes[0].node, 'ยังค้างอยู่');
});

test('วันที่ล้างล่าสุดของ Node ต้องเป็นวันที่ใหม่สุด ไม่ใช่วันที่เจอเป็นอันสุดท้าย', () => {
  const s = summarizeCleaning([
    nodeRow('A-A-AIR-1', 'วังน้อย', 'S1', { R1_Status: 'ล้างเสร็จสิ้น', R1_ActualDate: '2026-05-20' }),
    nodeRow('A-A-AIR-2', 'วังน้อย', 'S1', { R1_Status: 'ล้างเสร็จสิ้น', R1_ActualDate: '2026-03-10' })
  ], [{ AirCode: 'A-A-AIR-1', Region: '1' }, { AirCode: 'A-A-AIR-2', Region: '1' }], 2026);

  assert.equal(s.byRegion[0].nodes[0].lastDone, '2026-05-20');
});

test('Node ที่ยังไม่เคยล้าง ต้องไม่มีวันที่ล้างล่าสุด', () => {
  const s = summarizeCleaning([nodeRow('A-A-AIR-1', 'วังน้อย', 'S1')],
    [{ AirCode: 'A-A-AIR-1', Region: '1' }], 2026);
  assert.equal(s.byRegion[0].nodes[0].lastDone, '');
});

test('ยอดรวมราย Node ต้องบวกกันได้เท่ายอดของภูมิภาค', () => {
  // ถ้าสองตัวเลขนี้ไม่ตรงกัน คนอ่านจะไม่รู้ว่าอันไหนถูก
  const s = summarizeCleaning([
    nodeRow('A-A-AIR-1', 'วังน้อย', 'S1', { R1_Status: 'ล้างเสร็จสิ้น', R1_Price: 850 }),
    nodeRow('A-A-AIR-2', 'บางปะอิน', 'S2', { R2_ActualDate: '2026-04-01', R2_Price: 700 }),
    nodeRow('B-B-AIR-1', 'ชลบุรี', 'S3', { R3_Status: 'ยกเลิก' })
  ], units, 2026);

  for (const reg of s.byRegion) {
    const sum = k => reg.nodes.reduce((t, n) => t + n[k], 0);
    assert.equal(sum('units'), reg.units, 'จำนวนเครื่องของ Region ' + reg.region);
    assert.equal(sum('done'), reg.done, 'ล้างแล้วของ Region ' + reg.region);
    assert.equal(sum('pending'), reg.pending, 'ค้างของ Region ' + reg.region);
    assert.equal(sum('cancelled'), reg.cancelled, 'ยกเลิกของ Region ' + reg.region);
    assert.equal(sum('cost'), reg.cost, 'ค่าใช้จ่ายของ Region ' + reg.region);
  }
});

/* ==================== เครื่องที่รื้อถอน/Write off ไปแล้ว ====================
   แถวแผนของเครื่องพวกนี้ลบทิ้งไม่ได้ เพราะรอบที่ล้างไปแล้วเป็นเงินที่จ่ายจริง
   แต่จะไม่มีใครไปล้างมันอีก การนับจึงต้องแยกสองเรื่องนี้ออกจากกันให้ได้
   ================================================================================ */

/** รายการเครื่องชุดเดียวกับข้างบน แต่ B-B-AIR-1 ถูกรื้อถอนไปแล้ว */
const unitsWithRetired = [
  { AirCode: 'A-A-AIR-1', Region: '1' },
  { AirCode: 'A-A-AIR-2', Region: '1' },
  { AirCode: 'B-B-AIR-1', Region: '2', Status: 'รื้อถอน/ปลดระวาง' }
];

test('รอบที่ยังไม่ได้ล้างของเครื่องที่รื้อถอนแล้ว ต้องไม่นับเป็นงานค้าง', () => {
  const s = summarizeCleaning([row('A-A-AIR-1'), row('B-B-AIR-1')], unitsWithRetired, 2026);

  assert.equal(s.pending, 3, 'เหลือแค่ 3 รอบของเครื่องที่ยังใช้งานอยู่');
  assert.equal(s.cancelled, 3, 'อีก 3 รอบของเครื่องที่รื้อถอนแล้ว ถือว่ายกเลิก');
  assert.equal(s.planned, 3, 'ตัวหารต้องไม่รวมงานที่ไม่มีวันได้ทำ');
});

test('ความคืบหน้าต้องขึ้นถึง 100% ได้ ถึงแม้จะมีเครื่องที่รื้อถอนค้างอยู่ในแผน', () => {
  // เดิมเป็นบัค: 3 รอบของเครื่องที่ถูกรื้อจะค้างเป็น "รอดำเนินการ" ตลอดไป
  // ทำให้เปอร์เซ็นต์ตันอยู่ที่ 50% ทั้งที่งานที่ทำได้ ทำครบหมดแล้ว
  const s = summarizeCleaning([
    row('A-A-AIR-1', { R1_Status: 'ล้างเสร็จสิ้น', R2_Status: 'ล้างเสร็จสิ้น', R3_Status: 'ล้างเสร็จสิ้น' }),
    row('B-B-AIR-1')
  ], unitsWithRetired, 2026);

  assert.equal(s.percent, 100);
});

test('รอบที่ล้างไปแล้วของเครื่องที่รื้อถอน ยังนับเป็นเสร็จและยังนับค่าใช้จ่าย', () => {
  // เงินจ่ายไปจริงก่อนจะรื้อ ถ้าตัดทิ้งด้วย ยอดที่เคยรายงานไปแล้วจะหายไปเฉยๆ
  const s = summarizeCleaning([
    row('B-B-AIR-1', { R1_Status: 'ล้างเสร็จสิ้น', R1_Price: 900 })
  ], unitsWithRetired, 2026);

  assert.equal(s.done, 1);
  assert.equal(s.cost, 900);
  assert.equal(s.pending, 0, 'อีกสองรอบที่เหลือไม่ต้องตามแล้ว');
});

test('จำนวนเครื่องต้องนับเฉพาะที่ยังใช้งานอยู่ ให้ตรงกับการ์ดบนแดชบอร์ด', () => {
  const s = summarizeCleaning([row('A-A-AIR-1'), row('A-A-AIR-2'), row('B-B-AIR-1')], unitsWithRetired, 2026);
  assert.equal(s.units, 2);
});

test('เครื่องที่รื้อถอนแล้ว ต้องไม่ถูกนับว่า "ยังไม่ได้ล้างเลย"', () => {
  // รายการนี้มีไว้ตามงาน เครื่องที่ไม่มีอยู่แล้วตามไม่ได้
  const s = summarizeCleaning([row('A-A-AIR-1'), row('B-B-AIR-1')], unitsWithRetired, 2026);
  assert.equal(s.neverCleaned, 1);
});

test('Write off ก็ต้องได้ผลเหมือนรื้อถอน/ปลดระวาง', () => {
  const s = summarizeCleaning([row('B-B-AIR-1')],
    [{ AirCode: 'B-B-AIR-1', Region: '2', Status: 'Write off' }], 2026);
  assert.equal(s.pending, 0);
  assert.equal(s.units, 0);
});

test('เครื่องที่ถูกลบออกจากทะเบียนไปแล้ว ต้องไม่ค้างเป็นงานที่ต้องทำ', () => {
  // ลบเครื่องแล้วแถวในตารางแผนไม่ได้ถูกลบตามไปด้วย
  // ถ้ายังนับ ตัวเลข "เหลืออีกกี่รอบ" จะสูงเกินจริงตลอดไปโดยไม่มีใครไปล้างได้
  const s = summarizeCleaning([row('A-A-AIR-1'), row('ถูกลบไปแล้ว-AIR-9')], units, 2026);

  assert.equal(s.units, 1, 'นับเฉพาะเครื่องที่ยังอยู่ในทะเบียน');
  assert.equal(s.pending, 3);
  assert.equal(s.planned, 3);
  assert.equal(s.neverCleaned, 1);
});

test('รอบที่ล้างไปแล้วของเครื่องที่ถูกลบ ยังต้องอยู่ในสรุปค่าใช้จ่าย', () => {
  const s = summarizeCleaning([row('ถูกลบไปแล้ว-AIR-9', { R1_Status: 'ล้างเสร็จสิ้น', R1_Price: 600 })], units, 2026);
  assert.equal(s.done, 1);
  assert.equal(s.cost, 600);
  assert.equal(s.pending, 0);
});
