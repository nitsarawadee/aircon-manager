/**
 * ด่านกันลืมแนบรูป ฝั่งหน้าเว็บ
 *
 * ============================================================================
 * ทำไมด่านนี้อยู่ฝั่งหน้าเว็บ ไม่ใช่ฝั่งเซิร์ฟเวอร์
 * ============================================================================
 * รูปเก็บด้วยเลขที่เอกสาร ซึ่งเพิ่งมีตอนบันทึกเสร็จ ตอนที่เซิร์ฟเวอร์ตรวจได้จึงยัง
 * ไม่มีรูปให้ตรวจ นี่เป็นด่านกันลืม ไม่ใช่ด่านกันคนตั้งใจเลี่ยง
 * (ของแบบนั้นต้องอยู่ฝั่งเซิร์ฟเวอร์เสมอ ดูกฎในเอกสารโครงการ)
 *
 * ตัวที่ตัดสินว่ากดบันทึกได้หรือไม่คือฟังก์ชันพวกนี้ จึงต้องมีเทสต์คุมไว้
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - ช่อง 1-6 บังคับทุกเครื่องในฟอร์ม
 * - ช่อง 7-9 (รูปวัดค่า) ขาดได้ แต่ต้องมีเหตุผล
 * - ปุ่มเลือกหลายรูปพร้อมกัน ต้องลงให้แค่ช่อง 1-6 ไม่แตะช่องวัดค่า
 *   เพราะรูปวัดค่าดูจากลำดับชื่อไฟล์ไม่ออกว่าใบไหนวัดอะไร
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function sourceOf(name) {
  const re = new RegExp(String.raw`function ${name}\([^)]*\)[\s\S]*?\n  \}`);
  const src = js.match(re);
  assert.ok(src, `หาฟังก์ชัน ${name} ในหน้าเว็บไม่เจอ`);
  return src[0];
}

const requiredSrc = js.match(/const PHOTO_REQUIRED = \d+;/);
assert.ok(requiredSrc, 'หา PHOTO_REQUIRED ในหน้าเว็บไม่เจอ');

const missingSrc = js.match(/const cfMissingRequired = [^\n]+\n/);
const measureSrc = js.match(/const cfMissingMeasure = [^\n]+\n/);
assert.ok(missingSrc && measureSrc, 'หาตัวเช็คช่องที่ขาดในหน้าเว็บไม่เจอ');

/**
 * ดึงตัวเช็คของจริงจากหน้าเว็บมาใช้ โดยป้อนรูปกับรายชื่อเครื่องเข้าไปเอง
 * (ของจริงอ่านจาก DOM ซึ่งไม่มีในเทสต์)
 */
function checker(photos, units) {
  return new Function('cfPhotos', 'cfPhotoUnits',
    requiredSrc[0] + '\n' + sourceOf('cfMissingIn') + '\n' + missingSrc[0] + measureSrc[0] +
    '\nreturn { cfMissingRequired, cfMissingMeasure, PHOTO_REQUIRED };'
  )(photos, () => units);
}

/** เครื่องเดียว รูปครบตามจำนวนที่ระบุ */
const filled = (slot, upTo) => {
  const p = {};
  for (let i = 1; i <= upTo; i++) p[slot + '-' + i] = 'data:image/png;base64,x';
  return p;
};

const oneUnit = [{ slot: 1, airCode: 'AYA-WNI-AIR-1' }];
const twoUnits = [{ slot: 1, airCode: 'AYA-WNI-AIR-1' }, { slot: 2, airCode: 'AYA-WNI-AIR-2' }];

/* ==================== ช่อง 1-6 บังคับ ==================== */

test('ช่องที่บังคับคือ 6 ช่องแรก', () => {
  assert.equal(checker({}, oneUnit).PHOTO_REQUIRED, 6);
});

test('ไม่มีรูปเลย ต้องฟ้องครบทั้ง 6 ช่อง', () => {
  const c = checker({}, oneUnit);
  assert.deepEqual(c.cfMissingRequired(), ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6']);
});

test('แนบครบ 6 ช่องแรกแล้ว ต้องผ่าน แม้ช่องวัดค่ายังว่าง', () => {
  const c = checker(filled(1, 6), oneUnit);
  assert.deepEqual(c.cfMissingRequired(), [], 'ช่องบังคับครบแล้วต้องไม่ฟ้อง');
  assert.deepEqual(c.cfMissingMeasure(), ['1-7', '1-8', '1-9'], 'แต่ต้องรู้ว่าช่องวัดค่ายังขาด');
});

test('แนบครบทั้ง 9 ช่อง ต้องไม่ต้องกรอกเหตุผล', () => {
  const c = checker(filled(1, 9), oneUnit);
  assert.deepEqual(c.cfMissingRequired(), []);
  assert.deepEqual(c.cfMissingMeasure(), []);
});

test('ขาดช่องเดียวในช่วงบังคับ ก็ต้องฟ้อง', () => {
  const p = filled(1, 6);
  delete p['1-4'];
  assert.deepEqual(checker(p, oneUnit).cfMissingRequired(), ['1-4']);
});

/* ==================== ต้องครบทุกเครื่อง ==================== */

test('ล้างสองเครื่อง ต้องบังคับทั้งสองเครื่อง', () => {
  // แนบให้เครื่องแรกครบแล้วกดบันทึก ต้องยังไม่ผ่าน เพราะเครื่องที่สองยังไม่มีรูปเลย
  const c = checker(filled(1, 9), twoUnits);
  assert.deepEqual(c.cfMissingRequired(), ['2-1', '2-2', '2-3', '2-4', '2-5', '2-6']);
});

test('สองเครื่องครบทั้งคู่ ต้องผ่าน', () => {
  const c = checker({ ...filled(1, 6), ...filled(2, 6) }, twoUnits);
  assert.deepEqual(c.cfMissingRequired(), []);
});

test('ช่องวัดค่าที่ขาด ต้องนับรวมทุกเครื่อง', () => {
  const c = checker({ ...filled(1, 9), ...filled(2, 6) }, twoUnits);
  assert.deepEqual(c.cfMissingMeasure(), ['2-7', '2-8', '2-9']);
});

test('ยังไม่ได้เลือก Node (ไม่มีเครื่องเลย) ต้องไม่ฟ้องอะไร', () => {
  // ตอนเพิ่งเปิดหน้ายังไม่มีเครื่อง ถ้าฟ้องตรงนี้จะกลายเป็นขอบแดงเต็มหน้าตั้งแต่แรก
  const c = checker({}, []);
  assert.deepEqual(c.cfMissingRequired(), []);
  assert.deepEqual(c.cfMissingMeasure(), []);
});

/* ==================== ปุ่มเลือกหลายรูป ต้องไม่แตะช่องวัดค่า ==================== */

test('ปุ่มเลือกหลายรูปพร้อมกัน ต้องไล่ลงแค่ช่อง 1-6', () => {
  // ช่อง 7-9 เป็นรูปเฉพาะเจาะจงว่าวัดอะไร เรียงตามชื่อไฟล์แล้วดูไม่ออก
  // ถ้าไล่ลงให้เอง รูปวัดไฟอาจไปอยู่ช่องวัดน้ำยา แล้วเอกสารผิดโดยไม่มีอะไรฟ้อง
  const src = sourceOf('cfPickManyPhotos');

  assert.ok(/for \(let i = 1; i <= PHOTO_REQUIRED; i\+\+\) if \(!cfPhotos/.test(src),
    'ต้องวนหาช่องว่างแค่ถึง PHOTO_REQUIRED ไม่ใช่ถึง 9');
  assert.ok(!/i <= 9/.test(src), 'ต้องไม่มีการวนถึงช่อง 9 ในปุ่มนี้');
});

test('ปุ่มเลือกหลายรูป ต้องเรียงไฟล์แบบรู้จักตัวเลข', () => {
  // ไม่งั้น IMG_10 จะมาก่อน IMG_9 แล้วรูปลงสลับช่องกัน
  assert.ok(/numeric: true/.test(sourceOf('cfPickManyPhotos')));
});
