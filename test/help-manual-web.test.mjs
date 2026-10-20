/**
 * ปุ่มคู่มือ (?) — เปิดคู่มือ PDF ตรงหน้าที่อธิบายหน้าที่ใช้อยู่ (เจ้าของงานขอ 20/10/2569)
 *
 * คู่มือคือ คู่มือการใช้งานเว็บแอร์.pptx ที่แปลงเป็น web/help/manual.pdf (เลขหน้า = ลำดับสไลด์)
 * เทสต์นี้กันสองอย่าง: เพิ่มหน้าใหม่ในเว็บแล้วลืมผูกหน้าคู่มือ · ไฟล์ PDF หายจากเว็บ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');

test('ทุกหน้าในเว็บมีหน้าคู่มือผูกไว้', () => {
  const views = [...html.matchAll(/<section id="view-([a-z]+)" class="view/g)].map(m => m[1]);
  const map = /const HELP_PAGE = \{([\s\S]*?)\};/.exec(html);
  assert.ok(map, 'หา HELP_PAGE ไม่เจอ');
  const keys = [...map[1].matchAll(/([a-z]+):\s*\d+/g)].map(m => m[1]);
  assert.ok(views.length >= 12);
  for (const v of views) assert.ok(keys.includes(v), 'หน้า ' + v + ' ยังไม่ได้ผูกหน้าคู่มือ');
});

test('มีปุ่มคู่มือ และไฟล์คู่มือ PDF อยู่ในเว็บ', () => {
  assert.match(html, /id="helpBtn" onclick="openHelp\(\)"/);
  const pdf = statSync(join(ROOT, 'web', 'help', 'manual.pdf'));
  assert.ok(pdf.size > 100000, 'ไฟล์คู่มือเล็กผิดปกติ');
  assert.equal(readFileSync(join(ROOT, 'web', 'help', 'manual.pdf')).subarray(0, 4).toString(), '%PDF');
});
