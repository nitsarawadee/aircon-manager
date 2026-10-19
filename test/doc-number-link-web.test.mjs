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

test('หน้าประวัติ: กดเลขอ้างอิงแล้วไปที่เลขนั้นในหน้าแบบฟอร์มเอกสาร ไม่ใช่เปิดหน้าเอกสาร (ผู้ใช้ขอ 19/10/2569)', () => {
  const src = sourceOf('openDocOfHistory');
  assert.ok(!src.includes('openLoadingTab()'), 'ต้องไม่เปิดแท็บเอกสารแล้ว');
  assert.match(src, /pendingDocOpen = \{ kind: f\.kind, term, row: f\._row \}/, 'ต้องจำชนิด/คำค้น/แถวของใบที่จะไป');
  assert.match(src, /querySelector\('\[data-tab="cleaningform"\]'\)\.click\(\)/, 'ต้องพาไปหน้าแบบฟอร์มเอกสาร');
  // หน้าแบบฟอร์มเอกสารไฮไลต์แถวของใบนั้น
  assert.match(html, /data-doc-row="\$\{esc\(r\.kind\)\}-\$\{Number\(f\._row\)\}"/);
  assert.match(html, /tr\[data-doc-row="\$\{goTo\.kind\}-\$\{Number\(goTo\.row\)\}"\]/);
});

test('ตัวเปิดเอกสารทั้งสามแบบรับแท็บที่เปิดไว้แล้วได้', () => {
  for (const name of ['openCleaningDoc', 'openRepairDoc', 'openInstallDoc']) {
    assert.match(sourceOf(name), new RegExp(`function ${name}\\(row, id, preWin\\)[\\s\\S]*openDocWindow\\('[A-Za-z]+', row, preWin\\)`), name);
  }
});

test('เลขอ้างอิงในหน้าอื่นเป็นลิงก์เปิดเอกสาร', () => {
  const formLinks = html.match(/\$\{formDocLink\('(repair|cleaning|install)'|\$\{formDocLink\(r\.kind, f, r\.docNo\)/g) || [];
  assert.equal(formLinks.length, 3, 'เอกสารรออนุมัติ 3 (ซ่อม ล้าง ติดตั้ง)');
  // หน้าแบบฟอร์มเอกสาร: เลขอ้างอิงไม่เป็นลิงก์แล้ว เปิดเอกสารที่ปุ่มคอลัมน์ PDF (ผู้ใช้ขอ 19/10/2569)
  assert.match(html, /\$\{esc\(r\.docNo \|\| '-'\)\}/);
  assert.equal((html.match(/\$\{historyDocLink\(h/g) || []).length, 2, 'ไทม์ไลน์หน้าเครื่อง + สรุปเคส');
  // เลขเคสในหน้างานซ่อม ใช้ตัวเดียวกับหน้าประวัติ (หาเอกสารของเคส ไม่มีค่อยสรุปเคส)
  assert.match(html, /caseId \? historyDocLink\(\{ CaseID: caseId, ID: caseId, AirCode: a\.AirCode \}\)/);
});
