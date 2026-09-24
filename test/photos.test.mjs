import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePhoto, removePhoto, removeDocPhotos, readDocPhotos, decodePhoto, photosDiskUsage }
  from '../platform/photos.js';

/** รูป PNG 1x1 จริง ใช้เป็นข้อมูลทดสอบ */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const fresh = () => mkdtempSync(join(tmpdir(), 'photos-'));

test('เก็บรูปแล้วอ่านกลับมาได้ พร้อมชนิดไฟล์ที่ถูกต้อง', () => {
  const root = fresh();
  savePhoto(root, 'cleaning', 'PM2609-01', 1, 3, PNG);

  const got = readDocPhotos(root, 'cleaning', 'PM2609-01');
  assert.ok(got['1-3'].startsWith('data:image/png;base64,'));
  assert.equal(Object.keys(got).length, 1);
  rmSync(root, { recursive: true, force: true });
});

test('แยกรูปตามเครื่องและตามช่อง ไม่ปนกัน', () => {
  const root = fresh();
  savePhoto(root, 'cleaning', 'PM2609-01', 1, 1, PNG);
  savePhoto(root, 'cleaning', 'PM2609-01', 2, 1, PNG);
  savePhoto(root, 'cleaning', 'PM2609-01', 2, 9, PNG);

  const got = readDocPhotos(root, 'cleaning', 'PM2609-01');
  assert.deepEqual(Object.keys(got).sort(), ['1-1', '2-1', '2-9']);
  rmSync(root, { recursive: true, force: true });
});

test('รูปของคนละเอกสารต้องไม่ปนกัน', () => {
  const root = fresh();
  savePhoto(root, 'cleaning', 'PM2609-01', 1, 1, PNG);
  savePhoto(root, 'cleaning', 'PM2609-02', 1, 1, PNG);

  assert.equal(Object.keys(readDocPhotos(root, 'cleaning', 'PM2609-01')).length, 1);
  assert.equal(Object.keys(readDocPhotos(root, 'cleaning', 'PM2609-02')).length, 1);
  rmSync(root, { recursive: true, force: true });
});

test('ใส่รูปช่องเดิมซ้ำ ต้องทับของเดิม ไม่ใช่มีสองไฟล์', () => {
  const root = fresh();
  savePhoto(root, 'cleaning', 'PM2609-01', 1, 1, PNG);
  savePhoto(root, 'cleaning', 'PM2609-01', 1, 1, JPG);   // คนละนามสกุลด้วย

  const got = readDocPhotos(root, 'cleaning', 'PM2609-01');
  assert.equal(Object.keys(got).length, 1, 'ต้องเหลือรูปเดียว');
  assert.ok(got['1-1'].startsWith('data:image/jpeg;base64,'), 'ต้องเป็นรูปใหม่');
  rmSync(root, { recursive: true, force: true });
});

test('ลบรูปทีละช่อง และลบทั้งเอกสารได้', () => {
  const root = fresh();
  savePhoto(root, 'cleaning', 'PM2609-01', 1, 1, PNG);
  savePhoto(root, 'cleaning', 'PM2609-01', 1, 2, PNG);

  removePhoto(root, 'cleaning', 'PM2609-01', 1, 1);
  assert.deepEqual(Object.keys(readDocPhotos(root, 'cleaning', 'PM2609-01')), ['1-2']);

  removeDocPhotos(root, 'cleaning', 'PM2609-01');
  assert.deepEqual(readDocPhotos(root, 'cleaning', 'PM2609-01'), {});
  rmSync(root, { recursive: true, force: true });
});

test('เอกสารที่ยังไม่มีรูป ต้องได้ผลว่าง ไม่ใช่พัง', () => {
  const root = fresh();
  assert.deepEqual(readDocPhotos(root, 'cleaning', 'PM2699-99'), {});
  assert.doesNotThrow(() => removeDocPhotos(root, 'cleaning', 'PM2699-99'));
  rmSync(root, { recursive: true, force: true });
});

/* ==================== กันข้อมูลที่ไม่ควรรับ ==================== */

test('เลขที่เอกสารที่พาออกนอกที่เก็บได้ ต้องถูกปฏิเสธ', () => {
  const root = fresh();
  for (const bad of ['../../etc', 'a/b', '..', 'PM 2609', '']) {
    assert.throws(() => savePhoto(root, 'cleaning', bad, 1, 1, PNG), /เลขที่เอกสารไม่ถูกรูปแบบ/,
      'ควรปฏิเสธ "' + bad + '"');
  }
  rmSync(root, { recursive: true, force: true });
});

test('เลขเครื่องและช่องนอกช่วงที่กำหนด ต้องถูกปฏิเสธ', () => {
  const root = fresh();
  assert.throws(() => savePhoto(root, 'cleaning', 'PM2609-01', 3, 1, PNG), /เลขเครื่อง/);
  assert.throws(() => savePhoto(root, 'cleaning', 'PM2609-01', 1, 0, PNG), /ช่องรูป/);
  assert.throws(() => savePhoto(root, 'cleaning', 'PM2609-01', 1, 10, PNG), /ช่องรูป/);
  rmSync(root, { recursive: true, force: true });
});

test('ไฟล์ที่ไม่ใช่ภาพ ต้องถูกปฏิเสธ', () => {
  assert.throws(() => decodePhoto('data:application/pdf;base64,AAAA'), /รับเฉพาะไฟล์ภาพ/);
  assert.throws(() => decodePhoto('ไม่ใช่ data url'), /ไม่ถูกรูปแบบ/);
  assert.throws(() => decodePhoto(''), /ไม่ถูกรูปแบบ/);
});

test('ไฟล์ที่ใหญ่เกินกำหนด ต้องถูกปฏิเสธ', () => {
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(4 * 1024 * 1024);
  assert.throws(() => decodePhoto(big), /ใหญ่เกิน/);
});

test('นับพื้นที่ที่รูปใช้ไปได้', () => {
  const root = fresh();
  assert.deepEqual(photosDiskUsage(root), { files: 0, bytes: 0 });

  savePhoto(root, 'cleaning', 'PM2609-01', 1, 1, PNG);
  savePhoto(root, 'cleaning', 'PM2609-02', 1, 1, PNG);
  const usage = photosDiskUsage(root);
  assert.equal(usage.files, 2);
  assert.ok(usage.bytes > 0);
  rmSync(root, { recursive: true, force: true });
});

/* ==================== แยกโฟลเดอร์ตามชนิดเอกสาร ==================== */

test('รูปของใบล้างกับใบซ่อม ต้องอยู่คนละโฟลเดอร์', () => {
  const root = fresh();
  savePhoto(root, 'cleaning', 'PM2609-01', 1, 1, PNG);
  savePhoto(root, 'repair', 'CM2609-31', 1, 1, PNG);

  assert.deepEqual(readdirSync(join(root, 'photos')).sort(), ['cleaning', 'repair']);
  assert.ok(existsSync(join(root, 'photos', 'cleaning', 'PM2609-01')));
  assert.ok(existsSync(join(root, 'photos', 'repair', 'CM2609-31')));
  rmSync(root, { recursive: true, force: true });
});

test('อ่านรูปข้ามชนิดกันไม่ได้', () => {
  const root = fresh();
  savePhoto(root, 'repair', 'CM2609-31', 1, 1, PNG);

  assert.equal(Object.keys(readDocPhotos(root, 'repair', 'CM2609-31')).length, 1);
  assert.equal(Object.keys(readDocPhotos(root, 'cleaning', 'CM2609-31')).length, 0);
  rmSync(root, { recursive: true, force: true });
});

test('ลบรูปของใบซ่อม ต้องไม่ไปโดนใบล้าง', () => {
  const root = fresh();
  savePhoto(root, 'cleaning', 'PM2609-01', 1, 1, PNG);
  savePhoto(root, 'repair', 'CM2609-31', 1, 1, PNG);

  removeDocPhotos(root, 'repair', 'CM2609-31');

  assert.equal(Object.keys(readDocPhotos(root, 'repair', 'CM2609-31')).length, 0);
  assert.equal(Object.keys(readDocPhotos(root, 'cleaning', 'PM2609-01')).length, 1);
  rmSync(root, { recursive: true, force: true });
});

test('ชนิดเอกสารที่ไม่รู้จัก ต้องถูกปฏิเสธ', () => {
  const root = fresh();
  // เคยใช้ 'install' เป็นตัวอย่างชนิดที่ไม่รู้จัก แต่ตอนนี้เอกสารติดตั้งมีจริงแล้ว
  // จึงต้องใช้ชื่อที่ยังไม่มีในระบบแทน ไม่งั้นเทสต์จะกลายเป็นตรวจของที่ถูกต้อง
  assert.throws(() => savePhoto(root, 'moving', 'XX-01', 1, 1, PNG), /ชนิดเอกสารไม่ถูกต้อง/);
  assert.throws(() => savePhoto(root, '..', 'XX-01', 1, 1, PNG), /ชนิดเอกสารไม่ถูกต้อง/);
  rmSync(root, { recursive: true, force: true });
});

test('รูปที่เก็บไว้ก่อนแยกชนิด ต้องยังอ่านได้', () => {
  // ตอนเพิ่มการแยกชนิด มีรูปเก่าอยู่ที่ photos/<เลขที่เอกสาร>/ แล้ว 7 โฟลเดอร์
  const root = fresh();
  mkdirSync(join(root, 'photos', 'PM2609-05'), { recursive: true });
  writeFileSync(join(root, 'photos', 'PM2609-05', 'u1-3.png'), Buffer.from(PNG.split(',')[1], 'base64'));

  const got = readDocPhotos(root, 'cleaning', 'PM2609-05');
  assert.deepEqual(Object.keys(got), ['1-3']);
  rmSync(root, { recursive: true, force: true });
});
