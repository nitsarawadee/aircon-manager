/**
 * ทดสอบตัวอ่าน/เขียน CSV
 *
 * CSV ดูเหมือนง่ายจนหลายคนใช้ split(',') แล้วจบ — แต่พังทันทีเมื่อเจอ
 * ลูกน้ำในข้อความ เครื่องหมายคำพูด หรือการขึ้นบรรทัดในเซลล์
 * และพังแบบ "เงียบ" คือข้อมูลเลื่อนคอลัมน์ไปทั้งแถวโดยไม่มี error
 * เทสต์ชุดนี้จึงเน้นกรณีพวกนั้นเป็นหลัก
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { parseCsv, parseCsvObjects, toCsv } from '../src/csv.js';

test('อ่านไฟล์ธรรมดาได้', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('ลูกน้ำในข้อความที่มีคำพูดครอบ ต้องไม่ถูกตัดเป็นคนละคอลัมน์', () => {
  const rows = parseCsv('Node,Province\n"เชียงใหม่, ลำพูน",เชียงใหม่');
  assert.deepEqual(rows[1], ['เชียงใหม่, ลำพูน', 'เชียงใหม่']);
});

test('เครื่องหมายคำพูดซ้อน (พิมพ์สองครั้ง) ต้องอ่านเป็นคำพูดตัวเดียว', () => {
  const rows = parseCsv('Note\n"เขาบอกว่า ""ใช้ได้"""');
  assert.deepEqual(rows[1], ['เขาบอกว่า "ใช้ได้"']);
});

test('การขึ้นบรรทัดใหม่ในเซลล์ที่มีคำพูดครอบ ต้องไม่ถูกนับเป็นแถวใหม่', () => {
  const rows = parseCsv('Note\n"บรรทัดหนึ่ง\nบรรทัดสอง"');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'บรรทัดหนึ่ง\nบรรทัดสอง');
});

test('บรรทัดว่างต้องถูกข้าม (Excel มักใส่มาต่อท้ายไฟล์)', () => {
  assert.equal(parseCsv('a,b\n1,2\n\n\n').length, 2);
});

test('ไฟล์ที่ลงท้ายบรรทัดแบบ Windows อ่านได้เหมือนกัน', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('ตัด BOM ของ Excel ออกจากชื่อคอลัมน์แรก', () => {
  // ถ้าไม่ตัด ชื่อคอลัมน์แรกจะมีอักขระล่องหนติดอยู่ แล้วจับคู่คอลัมน์ไม่ตรง
  const { headers } = parseCsvObjects('﻿Region,Province\n1,อยุธยา');
  assert.equal(headers[0], 'Region');
});

test('แปลงเป็น object พร้อมเลขบรรทัดในไฟล์จริง', () => {
  const { rows } = parseCsvObjects('Region,Province\n1,อยุธยา\n2,ลพบุรี');
  assert.equal(rows[0].Region, '1');
  assert.equal(rows[0].__line, 2, 'แถวข้อมูลแรกอยู่บรรทัดที่ 2 ของไฟล์');
  assert.equal(rows[1].__line, 3);
});

test('เขียนไฟล์ต้องมี BOM เสมอ ไม่งั้น Excel เปิดมาภาษาไทยเป็นขยะ', () => {
  const out = toCsv(['ชื่อ'], [{ 'ชื่อ': 'อ่างทอง' }]);
  assert.ok(out.startsWith('﻿'), 'ไฟล์ที่เขียนออกไม่มี BOM');
});

test('เขียนค่าที่มีลูกน้ำหรือคำพูด ต้องครอบและ escape ให้ถูก', () => {
  const out = toCsv(['a'], [{ a: 'x,y' }], false);
  assert.ok(out.includes('"x,y"'));

  const out2 = toCsv(['a'], [{ a: 'เขาว่า "ดี"' }], false);
  assert.ok(out2.includes('"เขาว่า ""ดี"""'));
});

test('เขียนแล้วอ่านกลับ ต้องได้ค่าเดิมทุกตัว', () => {
  const headers = ['AirCode', 'Note'];
  const rows = [
    { AirCode: 'ATG-ATG-AIR-1', Note: 'มีลูกน้ำ, และ "คำพูด"' },
    { AirCode: 'ATG-ATG-AIR-2', Note: 'สองบรรทัด\nที่นี่' }
  ];
  const back = parseCsvObjects(toCsv(headers, rows)).rows;
  assert.equal(back[0].Note, rows[0].Note);
  assert.equal(back[1].Note, rows[1].Note);
});
