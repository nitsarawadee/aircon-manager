/**
 * ทดสอบตัวแปลงค่าวันที่และตัวเลข
 *
 * วิธีรัน:  npm test
 *
 * ทำไมต้องมีเทสต์เฉพาะส่วนนี้: การแปลงค่าระหว่าง Google Sheets กับ JavaScript
 * เป็นจุดที่เคยพลาดมาแล้ว 2 ครั้ง และเป็นความผิดพลาดแบบ "เงียบ" คือไม่มี error
 * แต่ข้อมูลผิด กว่าจะรู้ตัวก็ตอนที่รายงานงบประมาณออกมาเพี้ยนแล้ว
 *
 *   ครั้งที่ 1 — Worker รันด้วยเวลา UTC ต่างจาก Apps Script ที่ใช้เวลาไทย
 *              รายการของวันที่ 1 ของเดือน/ปี ตกไปอยู่เดือนหรือปีก่อนหน้า
 *   ครั้งที่ 2 — Sheets ส่งวันที่กลับมาเป็นตัวเลขล้วน แยกไม่ออกจากตัวเลขปกติ
 *              ค่าอย่าง BTU 36000 หรือค่าล้าง 30000 กลายเป็นวันที่มั่วๆ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  formatDate, safeParseDate, dateToSerial, partsOf, cleanFormValue
} from '../src/values.js';
import { CLEANFORM_HEADERS, cleanFormColKind } from '../src/schema.js';
import { TABLES } from '../src/db/schema.js';

test('อ่านรหัสวันที่ของ Sheets ได้ตรงกับค่าอ้างอิงที่รู้แน่', () => {
  // 45292 คือ 1 ม.ค. 2024 เป็นค่ามาตรฐานที่ใช้อ้างอิงกันทั่วไป
  assert.equal(formatDate(45292), '2024-01-01');
  assert.equal(formatDate(45293), '2024-01-02');
  assert.equal(formatDate(46000), '2025-12-09');
});

test('แปลงวันที่ไป-กลับแล้วต้องได้ค่าเดิมเสมอ', () => {
  for (const iso of ['2024-01-01', '2025-12-09', '2026-08-25', '2026-01-01', '2026-12-31']) {
    assert.equal(formatDate(dateToSerial(safeParseDate(iso))), iso, 'ไป-กลับ ' + iso);
  }
});

test('วันที่ 1 ของเดือนและปี ต้องไม่ตกไปอยู่เดือนก่อนหน้า', () => {
  // จุดที่พลาดง่ายที่สุดของเรื่องเขตเวลา เพราะเที่ยงคืนของไทย
  // คือ 17:00 น. ของเมื่อวานตามเวลา UTC ที่ server ใช้
  for (const iso of ['2026-01-01', '2026-09-01', '2026-03-01']) {
    const p = partsOf(safeParseDate(iso));
    const got = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    assert.equal(got, iso);
  }
});

test('วันที่รูปแบบไทย dd/mm/yyyy ต้องไม่ถูกอ่านสลับเป็น mm/dd', () => {
  assert.equal(formatDate(dateToSerial(safeParseDate('25/08/2026'))), '2026-08-25');
  assert.equal(formatDate(dateToSerial(safeParseDate('01/12/2026'))), '2026-12-01');
});

test('ตัวเลขทั่วไปต้องไม่ถูกแปลงเป็นวันที่ แม้จะตกในช่วงรหัสวันที่พอดี', () => {
  // ช่วงรหัสวันที่ราว 25,000 ถึง 73,000 ทับกับค่าที่ใช้จริงในระบบพอดี
  assert.equal(cleanFormValue(36000, cleanFormColKind('Unit1_BTU')), 36000);
  assert.equal(cleanFormValue(30000, cleanFormColKind('Price')), 30000);
  assert.equal(cleanFormValue(500, cleanFormColKind('Price1')), 500);
});

test('คอลัมน์เวลาแปลงเศษของวันกลับเป็น HH:mm ได้', () => {
  assert.equal(cleanFormValue(0.5, cleanFormColKind('TimeStart')), '12:00');
  assert.equal(cleanFormValue(0.364583, cleanFormColKind('TimeEnd')), '08:45');
});

test('คอลัมน์ถูกจัดชนิดตรงตามความหมาย', () => {
  assert.equal(cleanFormColKind('Date'), 'date');
  assert.equal(cleanFormColKind('CreatedAt'), 'date');
  assert.equal(cleanFormColKind('TotalTime'), 'time');
  assert.equal(cleanFormColKind('Price2'), 'plain');
  assert.equal(cleanFormColKind('Source'), 'plain');
});

test('คอลัมน์ที่เพิ่มใหม่ต้องอยู่ท้ายสุดเสมอ', () => {
  // ระบบเติมคอลัมน์ที่ขาดด้วยการต่อท้าย ถ้าในโค้ดวางไว้กลาง
  // ตำแหน่งในโค้ดจะไม่ตรงกับในชีต แล้วข้อมูลจะถูกเขียนลงผิดช่องทั้งแถว
  //
  // ตรึงท้ายรายการไว้เป็นสัญญาณเตือน: เพิ่มคอลัมน์ใหม่แล้วเทสต์นี้จะแดง
  // เป็นการบังคับให้คนที่เพิ่มต้องยืนยันว่าวางไว้ท้ายสุดจริง ไม่ใช่แทรกกลาง
  assert.deepEqual(CLEANFORM_HEADERS.slice(-3), ['Source', 'DocType', 'DocNo']);
});

test('ลำดับคอลัมน์ในโค้ดกับในฐานข้อมูลต้องเรียงตรงกัน', () => {
  // อันนี้คือกฎจริงที่เทสต์ข้างบนเป็นแค่สัญญาณเตือน
  // repository.load() อ่านข้อมูลตามลำดับคอลัมน์ของโค้ด ถ้าสองที่เรียงไม่ตรงกัน
  // ค่าจะถูกอ่านสลับช่องกันทั้งตาราง โดยไม่มีอะไรฟ้องเลยสักอย่าง
  //
  // ฐานข้อมูลมีคอลัมน์ได้มากกว่า (เช่น PhotoUrl ที่ยังไม่ได้ใช้ในฟอร์ม)
  // แต่คอลัมน์ที่มีทั้งสองที่ ต้องเรียงลำดับเหมือนกันเสมอ
  const dbCols = Object.keys(TABLES.cleaning_forms.columns);
  const shared = dbCols.filter(c => CLEANFORM_HEADERS.includes(c));
  assert.deepEqual(CLEANFORM_HEADERS, shared);
});
