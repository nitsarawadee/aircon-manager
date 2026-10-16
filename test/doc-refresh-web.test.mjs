/**
 * หน้าเว็บโหลดข้อมูลใหม่หลังเอกสารเปลี่ยน ด้วยตัวเดียวกันทุกทาง (refreshAfterFormSaved — 16/10/2569)
 *
 * เดิมแต่ละทางโหลดไม่เหมือนกัน: ใบล้างโหลดงบเฉพาะตอนปิดรอบ (ทั้งที่ลงค่าล้างในประวัติทุกครั้ง)
 * ใบติดตั้งไม่โหลดงบ แนบไฟล์โหลดแผนเฉพาะตอนเปิดหน้าแผน และอนุมัติใบติดตั้งขั้นสุดท้าย
 * (เครื่องเปลี่ยนเป็นใช้งานปกติ) ไม่โหลดอะไรเลย หน้าเครื่องค้าง "รอติดตั้ง" จนกว่าจะรีเฟรช
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');

/** เนื้อฟังก์ชันตามชื่อ (ฟังก์ชันระดับบนของสคริปต์ ปิดด้วยวงเล็บที่ย่อหน้า 2 หรือ 4 ช่อง) */
function sourceOf(name) {
  const m = html.match(new RegExp(String.raw`\n( {2,4})(?:async )?function ${name}\([^)]*\) \{[\s\S]*?\n\1\}`));
  assert.ok(m, 'หาฟังก์ชัน ' + name + ' ในหน้าเว็บไม่เจอ');
  return m[0];
}

test('ตัวโหลดใหม่โหลดครบทุกส่วนที่เอกสารแตะ — เครื่อง ประวัติ แผน สรุปแผน แดชบอร์ด งบ ตัวเลขบนเมนู', () => {
  const src = sourceOf('refreshAfterFormSaved');
  for (const want of ["callQuiet('getAirList')", "callQuiet('getHistory')", "callQuiet('getCleaningPlan'",
                      'renderPlanSummary(', 'loadDashboard()', 'loadBudget()', 'refreshApprovalBadge()']) {
    assert.ok(src.includes(want), 'refreshAfterFormSaved ต้องมี ' + want);
  }
});

test('บันทึก/แนบเอกสารทุกแบบ เรียกตัวโหลดใหม่ตัวเดียวกัน ไม่เขียนชุดโหลดเอง', () => {
  for (const name of ['submitCleaningForm', 'submitAttachDocs', 'submitRepairForm', 'submitInstallForm',
                      'submitRepairAttach', 'submitInstallAttach']) {
    const src = sourceOf(name);
    assert.ok(src.includes('refreshAfterFormSaved()'), name + ' ต้องเรียก refreshAfterFormSaved');
    assert.ok(!src.includes("callQuiet('getAirList')"), name + ' ไม่ควรโหลดรายการเครื่องเอง (ใช้ตัวกลาง)');
  }
});

test('ลบเอกสารใช้ตัวเดียวกัน · อนุมัติใบติดตั้งขั้นสุดท้ายโหลดใหม่ (เครื่องเปลี่ยนเป็นใช้งานปกติ)', () => {
  assert.ok(sourceOf('refreshAfterFormDeleted').includes('refreshAfterFormSaved()'));
  const approve = sourceOf('approveDocRow');
  assert.match(approve, /kind === 'install' && a\.next === 4\) refreshAfterFormSaved\(\)/);
});
