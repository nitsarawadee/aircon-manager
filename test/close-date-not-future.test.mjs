/**
 * วันที่ปิดงาน (ล้าง/ซ่อมเสร็จ/ติดตั้ง) ห้ามเป็นวันล่วงหน้า (ผู้ใช้ขอ 20/10/2569)
 *
 * ตรวจทั้งด่านเซิร์ฟเวอร์ (assertNotFuture) และว่าทุกเส้นทางปิดงานเรียกใช้จริง
 * รวมถึงช่องวันที่ปิดงานบนหน้าเว็บที่ต้องเปิดโหมดห้ามวันล่วงหน้า
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import { assertNotFuture, ymd } from '../src/values.js';

const DAY = 86400000;
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('วันนี้และวันที่ผ่านมาแล้วผ่าน · พรุ่งนี้ไม่ผ่าน', () => {
  const now = Date.now();
  assert.doesNotThrow(() => assertNotFuture('วันที่ซ่อมเสร็จ', ymd(new Date(now))));
  assert.doesNotThrow(() => assertNotFuture('วันที่ซ่อมเสร็จ', ymd(new Date(now - DAY))));
  assert.throws(() => assertNotFuture('วันที่ซ่อมเสร็จ', ymd(new Date(now + DAY))), /วันที่ซ่อมเสร็จเป็นวันล่วงหน้าไม่ได้/);
});

test('รูปแบบ วว/ดด/ปปปป ก็ตรวจ · ค่าว่างปล่อยให้ด่านกรอกวันที่ของฟอร์มตัดสิน', () => {
  const [y, m, d] = ymd(new Date(Date.now() + 2 * DAY)).split('-');
  assert.throws(() => assertNotFuture('วันที่ติดตั้ง', `${d}/${m}/${y}`), /ล่วงหน้าไม่ได้/);
  assert.doesNotThrow(() => assertNotFuture('วันที่ติดตั้ง', ''));
});

test('ทุกเส้นทางปิดงานเรียก assertNotFuture', () => {
  const count = p => (read(p).match(/assertNotFuture\(/g) || []).length;
  assert.equal(count('src/modules/cleaningform.js'), 2, 'กรอกฟอร์มล้าง + แนบไฟล์ปิดงานล้าง');
  assert.equal(count('src/modules/repairform.js'), 2, 'กรอกใบซ่อม + แนบไฟล์ใบซ่อม');
  assert.equal(count('src/modules/installform.js'), 1, 'prepareInstall ใช้ทั้งกรอก แนบไฟล์ และลิงก์ติดตั้ง');
  assert.equal(count('src/modules/repairlink.js'), 1, 'ลิงก์ซ่อม (ลิงก์ติดตั้งผ่าน prepareInstall)');
  assert.match(read('src/modules/repairlink.js'), /submitInstallLink[\s\S]*?prepareInstall\(/);
});

test('ช่องวันที่ปิดงานบนหน้าเว็บห้ามวันล่วงหน้า ส่วนวันนัดยังเลือกล่วงหน้าได้', () => {
  const html = read('web/index.html');
  for (const id of ['cf_date', 'rf_date', 'if_date', 'fa_date', 'ad_date']) {
    const m = html.match(new RegExp(String.raw`dateField\('${id}',[^\n]*?, true\)`));
    assert.ok(m, id + ' ต้องส่ง noFuture = true');
  }
  for (const id of ['as_date', 'rl_appt', 'rp_plan']) {
    const m = html.match(new RegExp(String.raw`dateField\('${id}',[^\n]*?, true\)`));
    assert.ok(!m, id + ' เป็นวันนัด ต้องเลือกล่วงหน้าได้');
  }
});
