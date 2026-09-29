/**
 * ตัวกันปุ่มแก้ไขตามสิทธิ์ (EDIT_ACTIONS ในหน้าเว็บ)
 *
 * ============================================================================
 * ทำไมต้องมีเทสต์ชุดนี้
 * ============================================================================
 * ตัวกันผูกสิทธิ์กับ "ชื่อคำสั่ง" ในปุ่ม ถ้าวันหนึ่งเปลี่ยนชื่อฟังก์ชันแล้วลืมแก้รายการ
 * ปุ่มนั้นจะหลุดจากการล็อกเงียบๆ — กลับไปเป็นปัญหาเดิมที่เจ้าของงานเจอ
 * ("ตั้งว่าแก้ไขไม่ได้ แต่ไปกดทางอื่นก็ยังได้อยู่ดี")
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'index.html'), 'utf8');
const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

const block = js.match(/const EDIT_ACTIONS = \{([\s\S]*?)\n    \};/);
const actions = {};
for (const m of block[1].matchAll(/(\w+): '(\w+)'/g)) actions[m[1]] = m[2];

test('รายการคำสั่งแก้ข้อมูลอ่านได้ และไม่ว่าง', () => {
  assert.ok(Object.keys(actions).length > 30);
});

test('ทุกชื่อในรายการมีอยู่จริงในหน้าเว็บ (ฟังก์ชัน หรือช่องเลือกไฟล์นำเข้า)', () => {
  const missing = Object.keys(actions).filter(name =>
    !new RegExp('function ' + name + '\\(').test(js) && !html.includes('id="' + name + '"'));
  assert.deepEqual(missing, [], 'ชื่อที่ไม่มีอยู่จริง = ปุ่มที่หลุดจากการล็อก');
});

test('สิทธิ์ในรายการเป็นชื่อสิทธิ์ที่มีอยู่จริงเท่านั้น', async () => {
  const { MODULES } = await import('../src/schema.js');
  const bad = Object.entries(actions).filter(([, mod]) => mod !== 'admin' && !MODULES.includes(mod));
  assert.deepEqual(bad, []);
});

test('ปุ่มแก้ไข/ลบ/ย้าย/เปลี่ยนเครื่อง และปุ่มในหน้าของเครื่อง อยู่ในรายการครบ', () => {
  // จุดที่รั่วจริง — หน้าของเครื่องมีปุ่มแก้ไข ลบประวัติ แจ้งซ่อม อยู่นอกหน้าที่ถูกล็อก
  for (const name of ['openAirModal', 'openMoveModal', 'openReplaceModal', 'deleteAir',
                      'deleteHistory', 'addHistoryForUnit', 'openReportRepairModal']) {
    assert.ok(actions[name], name + ' ต้องอยู่ในรายการ');
  }
});

test('ปุ่มที่แค่ดู ต้องไม่อยู่ในรายการ (คนที่ดูได้อย่างเดียวต้องกดได้)', () => {
  for (const name of ['viewAirHistory', 'openAirDetail', 'openRoundModal', 'exportAirListCSV',
                      'openCleaningDoc', 'openRepairDoc', 'openInstallDoc', 'goToPlan']) {
    assert.equal(actions[name], undefined, name + ' เป็นปุ่มดู ห้ามล็อก');
  }
});
