/**
 * ทดสอบฟังก์ชันจัดรูปแบบของหน้าเว็บ
 *
 * JavaScript ของหน้าเว็บอยู่ในไฟล์ index.html ก้อนเดียว ยังไม่ได้แยกเป็นโมดูล
 * เทสต์ชุดนี้จึงดึงฟังก์ชันออกมาจากไฟล์ตรงๆ แล้วเรียกใช้จริง
 * ไม่ใช่การคัดลอกโค้ดมาวางซ้ำ — ถ้าของจริงเปลี่ยน เทสต์จะเห็นทันที
 *
 * (เมื่อแยกไฟล์ JavaScript ของหน้าเว็บออกมาแล้ว ให้เปลี่ยนมา import ตรงๆ แทน)
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/** ดึงฟังก์ชันชื่อที่ระบุออกมาจากโค้ดหน้าเว็บ แล้วทำให้เรียกใช้ได้ */
function extract(name) {
  const re = new RegExp(String.raw`function ${name}\([^)]*\)[\s\S]*?\n    \}`);
  const src = js.match(re);
  assert.ok(src, `หาฟังก์ชัน ${name} ในหน้าเว็บไม่เจอ`);
  return new Function('return ' + src[0])();
}

const fmtDate = extract('fmtDate');
const searchText = extract('searchText');

test('แสดงวันที่เป็น วัน/เดือน/ปี ค.ศ.', () => {
  assert.equal(fmtDate('2026-09-01'), '01/09/2026');
  assert.equal(fmtDate('2026-01-05'), '05/01/2026');
  assert.equal(fmtDate('2026-12-31'), '31/12/2026');
});

test('ค่าที่มีเวลาต่อท้าย ให้ตัดเวลาทิ้ง เหลือแต่วันที่', () => {
  // คอลัมน์ UpdatedAt / CreatedAt เก็บเป็น yyyy-mm-dd HH:mm:ss
  assert.equal(fmtDate('2026-09-01 14:30:00'), '01/09/2026');
});

test('ค่าที่ไม่ใช่วันที่ ต้องคืนกลับตามเดิม ไม่ถูกแปลงมั่ว', () => {
  assert.equal(fmtDate(''), '');
  assert.equal(fmtDate(null), '');
  assert.equal(fmtDate(undefined), '');
  assert.equal(fmtDate('-'), '-');                    // ช่องที่ยังไม่มีข้อมูลในตารางแผน
  assert.equal(fmtDate('รอดำเนินการ'), 'รอดำเนินการ'); // สถานะ ไม่ใช่วันที่
});

test('ค้นหาได้ทั้งรูปแบบที่เก็บและรูปแบบที่เห็นบนหน้าจอ', () => {
  // ผู้ใช้เห็น 01/09/2026 บนจอ แต่ข้อมูลจริงเก็บเป็น 2026-09-01
  // ถ้าค้นได้แบบเดียวจะงงมาก — เห็นอยู่ตรงหน้าแต่พิมพ์ค้นแล้วไม่เจอ
  const row = { AirCode: 'KCB-KCB-AIR-1', Date: '2026-09-01', EventType: 'ล้างแอร์' };
  const hay = searchText(row);

  assert.ok(hay.includes('2026-09-01'), 'ค้นด้วยรูปแบบที่เก็บไม่เจอ');
  assert.ok(hay.includes('01/09/2026'), 'ค้นด้วยรูปแบบที่เห็นบนจอไม่เจอ');
  assert.ok(hay.includes('kcb-kcb-air-1'), 'ค้นด้วยรหัสเครื่องไม่เจอ');
  assert.ok(hay.includes('ล้างแอร์'), 'ค้นด้วยเหตุการณ์ไม่เจอ');
});

test('ช่องกรอกวันที่ต้องไม่ถูกแปลงรูปแบบ', () => {
  // <input type="date"> ต้องได้ค่า yyyy-mm-dd เท่านั้น เป็นข้อกำหนดของ HTML
  // ถ้าเผลอเอา fmtDate ไปครอบ ปฏิทินจะว่างเปล่าและบันทึกวันที่ไม่ได้
  assert.equal((html.match(/type="date"/g) || []).length, 14, 'จำนวนช่องกรอกวันที่เปลี่ยนไป');
  assert.ok(
    !/type="date"[^>]*value="\$\{esc\(fmtDate/.test(html),
    'มีช่องกรอกวันที่ถูกครอบด้วย fmtDate — ปฏิทินจะใช้งานไม่ได้'
  );
});
