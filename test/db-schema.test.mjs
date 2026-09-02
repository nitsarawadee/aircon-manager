/**
 * ล็อกโครงสร้างฐานข้อมูลที่โค้ดพึ่งพาอยู่แบบเงียบๆ
 *
 * เทสต์ชุดนี้ไม่ได้ทดสอบ "ว่าโค้ดทำงานถูกไหม" แต่ทดสอบว่า
 * "ข้อสมมติที่โค้ดตั้งไว้ยังจริงอยู่ไหม" — ถ้าใครแก้ src/db/schema.js
 * แล้วเผลอสลับลำดับคอลัมน์ เทสต์ชุดนี้จะแดงทันที
 *
 * ทำไมต้องล็อก: plan.js เขียนผลล้างด้วย setValues(ชีต, แถว, คอลัมน์เริ่ม, [[6 ค่า]])
 * ซึ่งหมายถึง "เขียน 6 คอลัมน์ที่ติดกัน" ไม่ได้ระบุชื่อคอลัมน์เลย
 * ถ้าลำดับเปลี่ยน ข้อมูลจะไปลงผิดช่องทั้งแถวโดยไม่มี error ใดๆ ฟ้อง
 * — วันที่ล้างจริงอาจไปโผล่ในช่องราคา ชื่อช่างไปอยู่ในช่องสถานะ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import { TABLES, createTableStatements } from '../src/db/schema.js';
import {
  AIRLIST_HEADERS, HISTORY_HEADERS, PLAN_HEADERS,
  BUDGET_HEADERS, USERS_HEADERS, CLEANFORM_HEADERS
} from '../src/schema.js';

/** ลำดับคอลัมน์ของตารางนั้น ตามที่ repository ใช้จริง */
const colsOf = table => Object.keys(TABLES[table].columns);

test('คอลัมน์ของแต่ละรอบในแผนต้องติดกัน 6 ช่องและเรียงตามลำดับเดิม', () => {
  const cols = colsOf('plans');

  for (const round of [1, 2, 3]) {
    const start = cols.indexOf(`R${round}_PlanDate`);
    assert.notEqual(start, -1, `ไม่พบคอลัมน์ R${round}_PlanDate`);

    // plan.js เขียนบล็อกนี้ทีเดียว 6 ช่อง ห้ามสลับ ห้ามแทรกอะไรคั่น
    assert.deepEqual(
      cols.slice(start, start + 6),
      [
        `R${round}_PlanDate`,
        `R${round}_ActualDate`,
        `R${round}_Price`,
        `R${round}_Technician`,
        `R${round}_Status`,
        `R${round}_Note`
      ],
      `ลำดับคอลัมน์ของรอบที่ ${round} เปลี่ยนไป — plan.js จะเขียนข้อมูลลงผิดช่อง`
    );
  }
});

test('คอลัมน์ Year ของแผนต้องอยู่หน้าสุด ไม่ปนกับคอลัมน์ที่โมดูลเห็น', () => {
  // repository ตัด Year ออกก่อนส่งให้โมดูล เพราะชีตเดิมไม่มีคอลัมน์นี้
  // ถ้า Year ไปแทรกกลาง การตัดออกจะทำให้ตำแหน่งคอลัมน์อื่นเลื่อนตาม
  assert.equal(colsOf('plans')[0], 'Year');
});

test('ทุกคอลัมน์ที่โค้ดต้องการ มีอยู่จริงในฐานข้อมูล', () => {
  const pairs = [
    ['air_units', AIRLIST_HEADERS],
    ['history', HISTORY_HEADERS],
    ['plans', PLAN_HEADERS],
    ['budgets', BUDGET_HEADERS],
    ['users', USERS_HEADERS],
    ['cleaning_forms', CLEANFORM_HEADERS]
  ];

  for (const [table, headers] of pairs) {
    const cols = colsOf(table);
    const missing = headers.filter(h => !cols.includes(h));
    assert.deepEqual(missing, [], `ตาราง ${table} ขาดคอลัมน์ที่โค้ดต้องการ`);
  }
});

test('ชื่อคอลัมน์ต้องไม่ชนกับ row_id ที่เป็นคีย์หลัก', () => {
  // SQLite ไม่แยกตัวพิมพ์เล็ก-ใหญ่ของชื่อคอลัมน์
  // เคยพลาดมาแล้วตอนตั้งชื่อคีย์หลักว่า id แล้วชนกับคอลัมน์ ID ของชีต History
  for (const table of Object.keys(TABLES)) {
    const clash = colsOf(table).filter(c => c.toLowerCase() === 'row_id');
    assert.deepEqual(clash, [], `ตาราง ${table} มีคอลัมน์ชื่อชนกับ row_id`);
  }
});

test('สร้างคำสั่ง SQL ได้ครบทุกตารางและมีคีย์หลัก', () => {
  const sql = createTableStatements();
  for (const table of Object.keys(TABLES)) {
    const create = sql.find(s => s.includes(`CREATE TABLE IF NOT EXISTS ${table} (`));
    assert.ok(create, `ไม่มีคำสั่งสร้างตาราง ${table}`);
    assert.match(create, /row_id INTEGER PRIMARY KEY AUTOINCREMENT/);
  }
});

test('ตารางที่ห้ามมีข้อมูลซ้ำ ต้องมี unique index กำกับ', () => {
  const sql = createTableStatements().join('\n');
  // รหัสเครื่องซ้ำ = ข้อมูลพัง / แผนปีเดียวกันเครื่องเดียวกันซ้ำ = ปิดงานผิดแถว
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_air_units ON air_units \("AirCode"\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_plans ON plans \("Year", "AirCode"\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_users ON users \("Username"\)/);
});
