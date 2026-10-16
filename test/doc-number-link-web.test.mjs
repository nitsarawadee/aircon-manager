/**
 * เลขอ้างอิงทุกที่กดแล้วเปิดเอกสารเลย (เจ้าของงานขอ 17/10/2569)
 *
 * เดิมเลขในหน้าประวัติพาไปหน้าแบบฟอร์มเอกสารแล้วต้องกด "เปิดเอกสาร" อีกที
 * และเลขในหน้าอื่น (แบบฟอร์มเอกสาร · เอกสารรออนุมัติ · ไทม์ไลน์เครื่อง · สรุปเคส · งานซ่อม) กดไม่ได้เลย
 *
 * ⚠️ แท็บใหม่ต้องเปิดตอนกด ก่อนรอเซิร์ฟเวอร์ ไม่งั้นเบราว์เซอร์บล็อกป๊อปอัป
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');

function sourceOf(name) {
  const m = html.match(new RegExp(String.raw`\n( {2,4})(?:async )?function ${name}\([^)]*\) \{[\s\S]*?\n\1\}`));
  assert.ok(m, 'หาฟังก์ชัน ' + name + ' ในหน้าเว็บไม่เจอ');
  return m[0];
}

test('หน้าประวัติ: เปิดแท็บตอนกด (ก่อน await) แล้วใส่เอกสารลงแท็บนั้น ไม่ใช่พาไปหน้าแบบฟอร์มเอกสาร', () => {
  const src = sourceOf('openDocOfHistory');
  const opened = src.indexOf('openLoadingTab()');
  const firstAwait = src.indexOf('await Promise.all(');   // จุดที่รอเซิร์ฟเวอร์หาเอกสาร
  assert.ok(opened > 0 && opened < firstAwait, 'ต้องเปิดแท็บก่อนรอเซิร์ฟเวอร์');
  assert.match(src, /open\(f\._row, f\.ID, win\)/, 'ต้องเปิดเอกสารลงแท็บที่เปิดไว้');
  assert.match(src, /openAttachmentList\(f\._row, f\.kind\)/, 'ใบแนบไฟล์ต้องเปิดรายการไฟล์');
});

test('ตัวเปิดเอกสารทั้งสามแบบรับแท็บที่เปิดไว้แล้วได้', () => {
  for (const name of ['openCleaningDoc', 'openRepairDoc', 'openInstallDoc']) {
    assert.match(sourceOf(name), new RegExp(`function ${name}\\(row, id, preWin\\)[\\s\\S]*openDocWindow\\('[A-Za-z]+', row, preWin\\)`), name);
  }
});

test('เลขอ้างอิงในหน้าอื่นเป็นลิงก์เปิดเอกสาร', () => {
  const formLinks = html.match(/\$\{formDocLink\('(repair|cleaning|install)'|\$\{formDocLink\(r\.kind, f, r\.docNo\)/g) || [];
  assert.equal(formLinks.length, 4, 'แบบฟอร์มเอกสาร 1 + เอกสารรออนุมัติ 3 (ซ่อม ล้าง ติดตั้ง)');
  assert.equal((html.match(/\$\{historyDocLink\(h/g) || []).length, 2, 'ไทม์ไลน์หน้าเครื่อง + สรุปเคส');
  // เลขเคสในหน้างานซ่อม ใช้ตัวเดียวกับหน้าประวัติ (หาเอกสารของเคส ไม่มีค่อยสรุปเคส)
  assert.match(html, /caseId \? historyDocLink\(\{ CaseID: caseId, ID: caseId, AirCode: a\.AirCode \}\)/);
});
