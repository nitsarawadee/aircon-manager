/**
 * ที่เก็บไฟล์ PDF ของเอกสารบนเครื่องที่รันระบบ
 *
 * ============================================================================
 * สิ่งที่ล็อกไว้
 * ============================================================================
 * - แยกโฟลเดอร์ตามปี/เดือนของวันที่ในเอกสาร ไม่ใช่ตามวันที่กดปุ่ม
 * - ใบเดียวกันต้องมีไฟล์เดียวเสมอ แก้วันที่แล้วไฟล์ต้องย้าย ไม่ใช่งอกเพิ่ม
 * - ชื่อไฟล์มาจากเลขที่เอกสาร ซึ่งต้องไม่พาออกนอกโฟลเดอร์ที่เก็บ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { saveDocFile, readDocFile, removeDocFile, findDocFile, docsDiskUsage }
  from '../platform/docs.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'docs-'));
const PDF = Buffer.from('%PDF-1.4 ทดสอบ').toString('base64');

test('เก็บไฟล์แล้วอ่านกลับมาได้ครบเหมือนเดิม', () => {
  const root = fresh();
  saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', PDF);

  assert.equal(readDocFile(root, 'cleaning', 'PM2609-01'), PDF);
  rmSync(root, { recursive: true, force: true });
});

test('แยกโฟลเดอร์ตามปีและเดือนของวันที่ในเอกสาร', () => {
  const root = fresh();
  const saved = saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', PDF);

  assert.equal(saved.rel, 'docs/cleaning/2026/09/PM2609-01.pdf');
  assert.ok(existsSync(join(root, 'docs', 'cleaning', '2026', '09', 'PM2609-01.pdf')));
  rmSync(root, { recursive: true, force: true });
});

test('เอกสารคนละเดือน ต้องอยู่คนละโฟลเดอร์', () => {
  const root = fresh();
  saveDocFile(root, 'cleaning', 'PM2608-01', '2026-08-13', PDF);
  saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', PDF);

  assert.deepEqual(readdirSync(join(root, 'docs', 'cleaning', '2026')).sort(), ['08', '09']);
  rmSync(root, { recursive: true, force: true });
});

test('ใบเดียวกันเก็บซ้ำ ต้องทับของเดิม ไม่ใช่งอกไฟล์ใหม่', () => {
  const root = fresh();
  saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', PDF);

  const other = Buffer.from('%PDF-1.4 รอบสอง').toString('base64');
  saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', other);

  assert.equal(readdirSync(join(root, 'docs', 'cleaning', '2026', '09')).length, 1);
  assert.equal(readDocFile(root, 'cleaning', 'PM2609-01'), other);
  rmSync(root, { recursive: true, force: true });
});

test('วันที่ของเอกสารเปลี่ยนเดือน ไฟล์ต้องย้ายตาม ไม่ทิ้งของเก่าไว้', () => {
  // ไม่งั้นใบเดียวจะมีไฟล์สองที่ แล้วไม่มีใครรู้ว่าอันไหนใหม่กว่า
  const root = fresh();
  saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', PDF);
  saveDocFile(root, 'cleaning', 'PM2609-01', '2026-10-02', PDF);

  assert.ok(!existsSync(join(root, 'docs', 'cleaning', '2026', '09', 'PM2609-01.pdf')), 'ของเดือนเก่าต้องถูกลบ');
  assert.ok(existsSync(join(root, 'docs', 'cleaning', '2026', '10', 'PM2609-01.pdf')));
  assert.equal(findDocFile(root, 'cleaning', 'PM2609-01').rel, 'docs/cleaning/2026/10/PM2609-01.pdf');
  rmSync(root, { recursive: true, force: true });
});

test('ยังไม่มีไฟล์ ต้องตอบว่าไม่มี ไม่ใช่พัง', () => {
  const root = fresh();
  assert.equal(readDocFile(root, 'cleaning', 'PM2609-99'), null);
  assert.equal(findDocFile(root, 'cleaning', 'PM2609-99'), null);
  removeDocFile(root, 'cleaning', 'PM2609-99');   // ลบของที่ไม่มี ต้องไม่โยน error
  rmSync(root, { recursive: true, force: true });
});

test('ลบไฟล์ของเอกสารใบหนึ่ง ต้องไม่ไปโดนใบอื่น', () => {
  const root = fresh();
  saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', PDF);
  saveDocFile(root, 'cleaning', 'PM2609-02', '2026-09-15', PDF);

  removeDocFile(root, 'cleaning', 'PM2609-01');
  assert.equal(readDocFile(root, 'cleaning', 'PM2609-01'), null);
  assert.equal(readDocFile(root, 'cleaning', 'PM2609-02'), PDF);
  rmSync(root, { recursive: true, force: true });
});

test('เลขที่เอกสารที่พาออกนอกโฟลเดอร์ ต้องถูกปฏิเสธ', () => {
  // เลขที่เอกสารมาจากข้อมูลในระบบก็จริง แต่ที่เก็บไฟล์ต้องกันตัวเองได้
  const root = fresh();
  for (const bad of ['../หนี', 'a/b', '', '.', 'x'.repeat(65)]) {
    assert.throws(() => saveDocFile(root, 'cleaning', bad, '2026-09-15', PDF), /เลขที่เอกสารไม่ถูกรูปแบบ/);
  }
  rmSync(root, { recursive: true, force: true });
});

test('ไฟล์ว่างเปล่า ต้องไม่ถูกเก็บ', () => {
  // แปลงไฟล์ไม่สำเร็จแล้วได้ค่าว่างกลับมา ถ้าเก็บไว้จะกลายเป็นไฟล์เสียที่ดูเหมือนมีอยู่
  const root = fresh();
  assert.throws(() => saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', ''), /ว่างเปล่า/);
  assert.equal(findDocFile(root, 'cleaning', 'PM2609-01'), null);
  rmSync(root, { recursive: true, force: true });
});

test('นับพื้นที่ที่ใช้ไปได้ เพื่อดูว่าโตเร็วแค่ไหน', () => {
  const root = fresh();
  assert.deepEqual(docsDiskUsage(root), { files: 0, bytes: 0 });

  saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', PDF);
  saveDocFile(root, 'cleaning', 'PM2608-01', '2026-08-13', PDF);

  const used = docsDiskUsage(root);
  assert.equal(used.files, 2);
  assert.ok(used.bytes > 0);
  rmSync(root, { recursive: true, force: true });
});

/* ==================== แยกโฟลเดอร์ตามชนิดเอกสาร ==================== */

test('ใบล้างกับใบซ่อม ต้องอยู่คนละโฟลเดอร์', () => {
  // เจ้าของงานให้แยก เพราะเป็นคนละแบบฟอร์มควบคุม และคนที่ไปหยิบไฟล์ไปเก็บ
  // มักหยิบทีละประเภท ไม่ได้หยิบทั้งกอง
  const root = fresh();
  const a = saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', PDF);
  const b = saveDocFile(root, 'repair', 'CM2609-31', '2026-09-15', PDF);

  assert.equal(a.rel, 'docs/cleaning/2026/09/PM2609-01.pdf');
  assert.equal(b.rel, 'docs/repair/2026/09/CM2609-31.pdf');
  assert.deepEqual(readdirSync(join(root, 'docs')).sort(), ['cleaning', 'repair']);
  rmSync(root, { recursive: true, force: true });
});

test('หาไฟล์ข้ามชนิดกันไม่ได้', () => {
  const root = fresh();
  saveDocFile(root, 'repair', 'CM2609-31', '2026-09-15', PDF);

  assert.ok(findDocFile(root, 'repair', 'CM2609-31'), 'ชนิดถูกต้องต้องเจอ');
  assert.equal(findDocFile(root, 'cleaning', 'CM2609-31'), null, 'คนละชนิดต้องไม่เจอ');
  rmSync(root, { recursive: true, force: true });
});

test('ลบใบซ่อม ต้องไม่ไปโดนใบล้างที่เลขใกล้กัน', () => {
  const root = fresh();
  saveDocFile(root, 'cleaning', 'PM2609-01', '2026-09-15', PDF);
  saveDocFile(root, 'repair', 'CM2609-31', '2026-09-15', PDF);

  removeDocFile(root, 'repair', 'CM2609-31');

  assert.equal(readDocFile(root, 'repair', 'CM2609-31'), null);
  assert.equal(readDocFile(root, 'cleaning', 'PM2609-01'), PDF, 'ใบล้างต้องยังอยู่');
  rmSync(root, { recursive: true, force: true });
});

test('ชนิดเอกสารที่ไม่รู้จัก ต้องถูกปฏิเสธ', () => {
  const root = fresh();
  // เคยใช้ 'install' เป็นตัวอย่างชนิดที่ไม่รู้จัก แต่ตอนนี้เอกสารติดตั้งมีจริงแล้ว
  // จึงต้องใช้ชื่อที่ยังไม่มีในระบบแทน ไม่งั้นเทสต์จะกลายเป็นตรวจของที่ถูกต้อง
  assert.throws(() => saveDocFile(root, 'moving', 'XX-01', '2026-09-15', PDF), /ชนิดเอกสารไม่ถูกต้อง/);
  assert.throws(() => saveDocFile(root, '../etc', 'XX-01', '2026-09-15', PDF), /ชนิดเอกสารไม่ถูกต้อง/);
  rmSync(root, { recursive: true, force: true });
});

test('ไฟล์ที่เก็บไว้ก่อนแยกชนิด ต้องยังอ่านได้', () => {
  // ตอนเพิ่มการแยกชนิด มีไฟล์เก่าอยู่ที่ docs/<ปี>/<เดือน>/ แล้ว 10 ไฟล์
  // ถ้าตัวอ่านไม่มองที่เดิมให้ด้วย ไฟล์พวกนั้นจะหายไปเฉยๆ โดยไม่มีอะไรฟ้อง
  const root = fresh();
  mkdirSync(join(root, 'docs', '2026', '09'), { recursive: true });
  writeFileSync(join(root, 'docs', '2026', '09', 'PM2609-05.pdf'), Buffer.from(PDF, 'base64'));

  assert.equal(readDocFile(root, 'cleaning', 'PM2609-05'), PDF);
  assert.equal(findDocFile(root, 'cleaning', 'PM2609-05').rel, 'docs/2026/09/PM2609-05.pdf');
  rmSync(root, { recursive: true, force: true });
});

test('นับพื้นที่ต้องรวมทั้งของใหม่และของเดิมที่อยู่คนละชั้น', () => {
  const root = fresh();
  mkdirSync(join(root, 'docs', '2026', '09'), { recursive: true });
  writeFileSync(join(root, 'docs', '2026', '09', 'PM2609-05.pdf'), Buffer.from(PDF, 'base64'));
  saveDocFile(root, 'repair', 'CM2609-31', '2026-09-15', PDF);

  assert.equal(docsDiskUsage(root).files, 2);
  rmSync(root, { recursive: true, force: true });
});
