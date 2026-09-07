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
// รวมโค้ดจาก <script> ทุกก้อนในหน้า ไม่ใช่เอาแค่ก้อนแรก
// เพราะหน้าเว็บมีสคริปต์เล็กๆ ใน head ด้วย (ตั้งค่าธีมก่อนหน้าจะวาด)
// ถ้าเอาแค่ก้อนแรกจะได้ก้อนนั้นแทนโค้ดหลัก แล้วหาฟังก์ชันไม่เจอ
const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

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

test('ต้องไม่มีช่องกรอกวันที่ของเบราว์เซอร์เหลืออยู่', () => {
  // <input type="date"> แสดงรูปแบบตามภาษาที่ผู้ใช้ตั้งไว้ในเครื่อง เว็บสั่งไม่ได้
  // เครื่องที่ตั้งเป็นอังกฤษจะเห็น mm/dd/yyyy ซึ่งอ่านสลับกับ dd/mm/yyyy ได้
  // และไม่มีอะไรบอกว่าอันไหนเป็นอันไหน จึงเปลี่ยนมาใช้ช่องที่ทำเองทั้งหมด
  // ช่องจริงต้องมี id เสมอ เพราะโค้ดอ่านค่าด้วย getElementById
  // เงื่อนไขนี้จึงแยกช่องจริงออกจากข้อความในคอมเมนต์ที่พูดถึงชื่อแท็กเฉยๆ ได้
  const real = html.match(/<input\s+type="date"\s+id=/g) || [];

  assert.deepEqual(real, [], 'ยังมีช่องกรอกวันที่ของเบราว์เซอร์เหลืออยู่ ' + real.length + ' จุด');
});

test('ช่องกรอกวันที่ทุกจุดต้องใช้ตัวเดียวกัน', () => {
  // ถ้ามีบางจุดหลุดไปใช้วิธีอื่น ผู้ใช้จะเจอสองรูปแบบในเว็บเดียวกัน
  const fields = html.match(/dateField\(/g) || [];
  assert.ok(fields.length >= 14, 'พบช่องกรอกวันที่ ' + fields.length + ' จุด คาดว่าอย่างน้อย 14');
});

/* ==================== ช่องกรอกวันที่แบบ วัน/เดือน/ปี ==================== */

const isoToThai = extract('isoToThai');
const thaiToIso = extract('thaiToIso');

test('แปลงค่าที่เก็บเป็นข้อความที่คนอ่าน', () => {
  assert.equal(isoToThai('2026-09-07'), '07/09/2026');
  assert.equal(isoToThai(''), '');
  assert.equal(isoToThai('ไม่ใช่วันที่'), '');
});

test('แปลงข้อความที่คนพิมพ์กลับเป็นค่าที่เก็บ', () => {
  assert.equal(thaiToIso('07/09/2026'), '2026-09-07');
  assert.equal(thaiToIso('7/9/2026'), '2026-09-07', 'ไม่ใส่เลขศูนย์นำหน้าก็ต้องได้');
});

test('รับตัวคั่นได้หลายแบบ เพราะคนพิมพ์ไม่เหมือนกัน', () => {
  for (const t of ['07/09/2026', '07-09-2026', '07.09.2026']) {
    assert.equal(thaiToIso(t), '2026-09-07', 'ตัวคั่นแบบ ' + t);
  }
});

test('พิมพ์ปีพุทธศักราชมา ต้องแปลงให้เป็นคริสต์ศักราช', () => {
  // คนไทยพิมพ์ 2569 ติดมือ ถ้าไม่ดักไว้ระบบจะบันทึกเป็นปี 2569 จริงๆ
  // คือเลยไปอีก 543 ปี แล้วรายงานทุกหน้าจะเพี้ยนโดยไม่มีใครรู้ว่าเพราะอะไร
  assert.equal(thaiToIso('07/09/2569'), '2026-09-07');
  assert.equal(thaiToIso('01/01/2568'), '2025-01-01');
});

test('วันที่ที่ไม่มีอยู่จริง ต้องไม่ผ่าน', () => {
  // ถ้าปล่อยผ่าน JavaScript จะเลื่อนวันให้เองเงียบๆ เช่น 31 ก.พ. กลายเป็น 3 มี.ค.
  assert.equal(thaiToIso('31/02/2026'), '', '31 กุมภาพันธ์ ไม่มีอยู่จริง');
  assert.equal(thaiToIso('31/04/2026'), '', 'เมษายนมี 30 วัน');
  assert.equal(thaiToIso('00/09/2026'), '');
  assert.equal(thaiToIso('07/13/2026'), '', 'ไม่มีเดือน 13');
});

test('29 กุมภาพันธ์ ต้องผ่านเฉพาะปีอธิกสุรทิน', () => {
  assert.equal(thaiToIso('29/02/2024'), '2024-02-29', '2024 เป็นปีอธิกสุรทิน');
  assert.equal(thaiToIso('29/02/2026'), '', '2026 ไม่ใช่ปีอธิกสุรทิน');
});

test('ข้อความที่ยังพิมพ์ไม่จบหรือใช้ไม่ได้ ต้องคืนค่าว่าง', () => {
  for (const t of ['', '07', '07/09', 'abc', '07/09/26', '2026-09-07']) {
    assert.equal(thaiToIso(t), '', 'ค่า "' + t + '" ไม่ควรผ่าน');
  }
});

test('แปลงไปกลับต้องได้ค่าเดิมเสมอ', () => {
  for (const iso of ['2026-01-01', '2026-12-31', '2024-02-29', '2020-03-15']) {
    assert.equal(thaiToIso(isoToThai(iso)), iso, 'ค่า ' + iso);
  }
});
