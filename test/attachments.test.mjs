/**
 * ที่เก็บไฟล์เอกสารที่ช่างเขียนมือแล้วถ่ายส่งกลับมา
 *
 * ============================================================================
 * สิ่งที่ล็อกไว้
 * ============================================================================
 * - ไฟล์ชื่อซ้ำกันในคราวเดียว ต้องอยู่ครบ ไม่ทับกัน (กล้องมือถือตั้งชื่อเหมือนกันหมด)
 * - ชื่อไฟล์มาจากเครื่องของผู้ใช้ ต้องพาไปเขียน/อ่านนอกโฟลเดอร์ไม่ได้
 * - แนบเพิ่มทีหลัง ต้องต่อท้าย ไม่ใช่ทับของเดิม
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  saveAttachments, listAttachments, readAttachment, removeAttachments,
  findAttachmentDir, attachmentsDiskUsage, safeFileName
} from '../platform/attachments.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'attach-'));
const b64 = text => Buffer.from(text).toString('base64');
const file = (name, text) => ({ name, data: b64(text) });

test('เก็บไฟล์แล้วอ่านกลับมาได้ครบเหมือนเดิม', () => {
  const root = fresh();
  saveAttachments(root, 'PM2609-03', '2026-09-15', [file('IMG_1234.jpg', 'รูปที่หนึ่ง')]);

  const got = readAttachment(root, 'PM2609-03', '1-IMG_1234.jpg');
  assert.equal(Buffer.from(got.base64, 'base64').toString(), 'รูปที่หนึ่ง');
  assert.equal(got.mime, 'image/jpeg');
  rmSync(root, { recursive: true, force: true });
});

test('แยกโฟลเดอร์ตามปี/เดือน แล้วผูกกับเลขที่เอกสาร', () => {
  const root = fresh();
  saveAttachments(root, 'PM2609-03', '2026-09-15', [file('a.pdf', 'x')]);

  assert.ok(existsSync(join(root, 'attachments', '2026', '09', 'PM2609-03', '1-a.pdf')));
  rmSync(root, { recursive: true, force: true });
});

test('ไฟล์ชื่อซ้ำกันในคราวเดียว ต้องอยู่ครบ ไม่ทับกัน', () => {
  // กล้องมือถือตั้งชื่อไฟล์เหมือนกันหมด ถ้าทับกันช่างจะเสียรูปไปเงียบๆ
  const root = fresh();
  saveAttachments(root, 'PM2609-03', '2026-09-15', [
    file('IMG_0001.jpg', 'หนึ่ง'),
    file('IMG_0001.jpg', 'สอง'),
    file('IMG_0001.jpg', 'สาม')
  ]);

  const files = listAttachments(root, 'PM2609-03');
  assert.equal(files.length, 3);
  assert.deepEqual(files.map(f => f.name), ['1-IMG_0001.jpg', '2-IMG_0001.jpg', '3-IMG_0001.jpg']);
  assert.equal(Buffer.from(readAttachment(root, 'PM2609-03', '2-IMG_0001.jpg').base64, 'base64').toString(), 'สอง');
  rmSync(root, { recursive: true, force: true });
});

test('แนบเพิ่มทีหลัง ต้องต่อท้ายของเดิม', () => {
  const root = fresh();
  saveAttachments(root, 'PM2609-03', '2026-09-15', [file('a.jpg', 'เก่า')]);
  saveAttachments(root, 'PM2609-03', '2026-09-15', [file('b.jpg', 'ใหม่')]);

  assert.deepEqual(listAttachments(root, 'PM2609-03').map(f => f.name), ['1-a.jpg', '2-b.jpg']);
  rmSync(root, { recursive: true, force: true });
});

test('รายชื่อไฟล์เรียงตามลำดับที่แนบ ไม่ใช่เรียงตามตัวอักษร', () => {
  const root = fresh();
  const many = Array.from({ length: 11 }, (_, i) => file('p' + i + '.jpg', 'x'));
  saveAttachments(root, 'PM2609-03', '2026-09-15', many);

  const names = listAttachments(root, 'PM2609-03').map(f => f.name);
  assert.equal(names[0], '1-p0.jpg');
  assert.equal(names[10], '11-p10.jpg', 'ไฟล์ที่ 11 ต้องอยู่ท้าย ไม่ใช่แทรกหลังไฟล์ที่ 1');
  rmSync(root, { recursive: true, force: true });
});

/* ==================== ชื่อไฟล์ที่ไม่น่าเชื่อถือ ==================== */

test('ชื่อไฟล์ต้องถูกตัดให้ปลอดภัย แต่ยังคงเค้าเดิมไว้', () => {
  assert.equal(safeFileName('IMG_1234.jpg'), 'IMG_1234.jpg');
  assert.equal(safeFileName('ใบงานล้างแอร์.pdf'), 'ใบงานล้างแอร์.pdf', 'ชื่อไทยต้องใช้ได้ คนตั้งกันจริง');
  assert.equal(safeFileName('../../หนี.jpg'), 'หนี.jpg');
  assert.equal(safeFileName('C:\\Windows\\evil.exe'), 'evil.exe');
  assert.equal(safeFileName('..'), 'file');
  assert.equal(safeFileName(''), 'file');
  assert.equal(safeFileName('a<b>c:d"e|f?g*h.jpg'), 'abcdefgh.jpg');
});

test('ชื่อไฟล์ที่พาออกนอกโฟลเดอร์ ต้องเขียนลงในโฟลเดอร์ของเอกสารเท่านั้น', () => {
  const root = fresh();
  saveAttachments(root, 'PM2609-03', '2026-09-15', [file('../../แอบออกไป.jpg', 'x')]);

  const dir = findAttachmentDir(root, 'PM2609-03');
  assert.deepEqual(readdirSync(dir), ['1-แอบออกไป.jpg']);
  assert.ok(!existsSync(join(root, 'แอบออกไป.jpg')), 'ต้องไม่มีไฟล์หลุดออกไปข้างนอก');
  rmSync(root, { recursive: true, force: true });
});

test('ขอไฟล์ด้วยชื่อที่พาออกนอกโฟลเดอร์ ต้องไม่ได้ไฟล์', () => {
  // ชื่อไฟล์ที่ขอมาจากหน้าเว็บ จึงถือว่าไม่น่าเชื่อถือเหมือนกัน
  const root = fresh();
  saveAttachments(root, 'PM2609-03', '2026-09-15', [file('a.jpg', 'x')]);
  writeFileSync(join(root, 'ความลับ.txt'), 'ห้ามหลุด');

  for (const bad of ['../../ความลับ.txt', '..\\..\\ความลับ.txt', 'a.jpg/../../../ความลับ.txt']) {
    assert.equal(readAttachment(root, 'PM2609-03', bad), null, 'ต้องไม่ได้ไฟล์จาก ' + bad);
  }
  rmSync(root, { recursive: true, force: true });
});

test('เลขที่เอกสารที่ไม่ถูกรูปแบบ ต้องถูกปฏิเสธ', () => {
  const root = fresh();
  for (const bad of ['../หนี', 'a/b', '', '.']) {
    assert.throws(() => saveAttachments(root, bad, '2026-09-15', [file('a.jpg', 'x')]),
                  /เลขที่เอกสารไม่ถูกรูปแบบ/);
  }
  rmSync(root, { recursive: true, force: true });
});

test('ไฟล์ว่างเปล่า ต้องไม่ถูกเก็บ', () => {
  const root = fresh();
  assert.throws(() => saveAttachments(root, 'PM2609-03', '2026-09-15', [{ name: 'a.jpg', data: '' }]),
                /ว่างเปล่า/);
  rmSync(root, { recursive: true, force: true });
});

/* ==================== ลบและนับพื้นที่ ==================== */

test('ลบไฟล์แนบของเอกสารใบหนึ่ง ต้องไม่ไปโดนใบอื่น', () => {
  const root = fresh();
  saveAttachments(root, 'PM2609-03', '2026-09-15', [file('a.jpg', 'x')]);
  saveAttachments(root, 'PM2609-04', '2026-09-15', [file('a.jpg', 'y')]);

  removeAttachments(root, 'PM2609-03');
  assert.deepEqual(listAttachments(root, 'PM2609-03'), []);
  assert.equal(listAttachments(root, 'PM2609-04').length, 1);
  rmSync(root, { recursive: true, force: true });
});

test('ยังไม่มีไฟล์ ต้องตอบว่าไม่มี ไม่ใช่พัง', () => {
  const root = fresh();
  assert.deepEqual(listAttachments(root, 'PM2609-99'), []);
  assert.equal(readAttachment(root, 'PM2609-99', 'a.jpg'), null);
  removeAttachments(root, 'PM2609-99');
  assert.deepEqual(attachmentsDiskUsage(root), { files: 0, bytes: 0 });
  rmSync(root, { recursive: true, force: true });
});
