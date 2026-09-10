/**
 * ทดสอบว่าปุ่มลัดเปลี่ยนสถานะในหน้างานซ่อม กับฟอร์มแก้ไขเครื่อง เป็นทางเดียวกันจริง
 *
 * ============================================================================
 * ทำไมต้องมีเทสต์ชุดนี้
 * ============================================================================
 * สถานะของเครื่องเปลี่ยนได้จากสองหน้าโดยตั้งใจ — หน้ารายการเครื่อง (ฟอร์มเต็ม)
 * และหน้างานซ่อม (ปุ่มลัด) แต่ "สองทางเข้า" ต้องนำไปสู่ "การกระทำเดียวกัน"
 * ไม่ใช่สองการกระทำที่บังเอิญคล้ายกัน
 *
 * เคยมีฟังก์ชันแยกสำหรับเรื่องนี้ (startRepairWork) แล้วถอดออก เพราะมันมีตรรกะ
 * ของตัวเอง ซึ่งเป็นจุดที่สองหน้าจะค่อยๆ ทำงานไม่เหมือนกันโดยไม่มีใครสังเกต
 * เทสต์ชุดนี้เฝ้าไม่ให้เรื่องนั้นกลับมาอีก
 *
 * ตรวจที่ตัวโค้ดของหน้าเว็บโดยตรง เพราะสิ่งที่ต้องเฝ้าคือ "โครงสร้าง"
 * (เรียกฟังก์ชันไหน ใช้รายชื่อช่องชุดไหน) ไม่ใช่ผลลัพธ์ของการรันครั้งเดียว
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

/** โค้ดของฟังก์ชันชื่อที่ระบุ ตามที่เขียนไว้จริงในหน้าเว็บ (รองรับ async ด้วย) */
function sourceOf(name) {
  const re = new RegExp(String.raw`(?:async )?function ${name}\([^)]*\)[\s\S]*?\n    \}`);
  const src = js.match(re);
  assert.ok(src, `หาฟังก์ชัน ${name} ในหน้าเว็บไม่เจอ`);
  return src[0];
}

test('รายชื่อช่องข้อมูลเครื่องมีชุดเดียวในหน้าเว็บ', () => {
  const decls = js.match(/const AIR_FIELDS = \[/g) || [];
  assert.equal(decls.length, 1, 'AIR_FIELDS ต้องประกาศที่เดียว');

  const line = js.match(/const AIR_FIELDS = \[([^\]]*)\]/);
  assert.ok(line, 'อ่านรายชื่อช่องไม่ได้');
  assert.ok(line[1].includes("'Status'"), 'ต้องมีช่อง Status อยู่ในชุด ไม่งั้นเปลี่ยนสถานะไม่ได้');
  assert.ok(line[1].includes("'AirCode'"), 'ต้องมีช่อง AirCode อยู่ในชุด');
});

test('ทั้งฟอร์มแก้ไขและปุ่มลัด ประกอบข้อมูลจากรายชื่อช่องชุดเดียวกัน', () => {
  for (const fn of ['saveAir', 'changeAirStatus']) {
    const src = sourceOf(fn);
    assert.ok(
      src.includes('AIR_FIELDS'),
      fn + ' ต้องใช้ AIR_FIELDS — ห้ามเขียนรายชื่อช่องของตัวเองซ้ำ'
    );
    // รายชื่อช่องที่เขียนสดในฟังก์ชัน = เริ่มแยกทางกันแล้ว
    assert.ok(
      !/\[\s*'AirCode'\s*,/.test(src),
      fn + ' มีรายชื่อช่องเขียนสดอยู่ข้างใน ซึ่งจะแยกทางจากอีกฟังก์ชันในอนาคต'
    );
  }
});

test('ปุ่มลัดเรียกคำสั่งเดียวกับฟอร์มแก้ไข ไม่ใช่คำสั่งของตัวเอง', () => {
  const src = sourceOf('changeAirStatus');
  const calls = [...src.matchAll(/call\(\s*'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(calls, ['saveAirUnit'],
    'ปุ่มลัดต้องเรียก saveAirUnit ตัวเดียว เหมือนที่ฟอร์มแก้ไขเรียก');

  assert.deepEqual(
    [...sourceOf('saveAir').matchAll(/call\(\s*'([^']+)'/g)].map(m => m[1]),
    ['saveAirUnit'],
    'ฟอร์มแก้ไขต้องเรียก saveAirUnit เหมือนเดิม'
  );
});

test('ปุ่มลัดส่งเลขแถวขึ้นไปด้วย เพื่อให้เซิร์ฟเวอร์ตรวจได้ว่ายังเป็นเครื่องเดิม', () => {
  // ไม่ส่ง _row เซิร์ฟเวอร์จะเข้าใจว่าเป็นการเพิ่มเครื่องใหม่ แทนที่จะแก้ของเดิม
  assert.ok(sourceOf('changeAirStatus').includes('_row: unit._row'));
});

test('ปุ่มลัดไม่ทำงานถ้าสถานะเป็นค่านั้นอยู่แล้ว', () => {
  const src = sourceOf('changeAirStatus');
  assert.ok(src.includes('=== newStatus'), 'ต้องเทียบสถานะปัจจุบันก่อนส่ง');
});

test('หน้างานซ่อมไม่มีคำสั่งเปลี่ยนสถานะเป็นของตัวเอง', () => {
  // ทางลัดที่กลายเป็นทางที่สอง คือจุดที่สองหน้าเริ่มทำงานไม่เหมือนกัน
  assert.ok(!js.includes('startRepairWork('), 'startRepairWork ถูกถอดออกไปแล้ว ห้ามกลับมา');

  const view = js.match(/function renderRepairView\([\s\S]*?\n    \}/);
  assert.ok(view, 'หา renderRepairView ไม่เจอ');
  const apiCalls = [...view[0].matchAll(/call\(\s*'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(apiCalls, [], 'หน้างานซ่อมต้องไม่ยิงคำสั่งเองตอนวาดตาราง');
});

test('เซิร์ฟเวอร์ยังมีทางเปลี่ยนสถานะทางเดียว', () => {
  const api = readFileSync(join(ROOT, 'src', 'api.js'), 'utf8');
  // ถ้ามีใครเพิ่มคำสั่งเปลี่ยนสถานะแยกอีกตัว เทสต์นี้จะเตือน
  const suspicious = ['startRepairWork', 'setAirStatus', 'changeStatus', 'updateStatus'];
  for (const name of suspicious) {
    assert.ok(!api.includes(name), 'พบคำสั่งเปลี่ยนสถานะแยกอีกตัวใน api.js: ' + name);
  }
  assert.ok(api.includes('saveAirUnit'), 'saveAirUnit ต้องยังเปิดให้เรียกได้');
});
