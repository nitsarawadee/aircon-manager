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
 * - รูปต้องครบทั้ง 9 ช่อง ทุกเครื่องในฟอร์ม ไม่มีข้อยกเว้น
 *   (เคยเสนอให้ช่องวัดค่าขาดได้ถ้ามีเหตุผลกำกับ เจ้าของงานพิจารณาแล้วไม่เอา)
 * - ปุ่มเลือกหลายรูปพร้อมกัน ต้องลงให้แค่ช่อง 1-6 ไม่แตะช่องวัดค่า
 *   เพราะรูปวัดค่าดูจากลำดับชื่อไฟล์ไม่ออกว่าใบไหนวัดอะไร ถ้าไล่ลงให้เอง
 *   รูปวัดไฟอาจไปอยู่ช่องวัดน้ำยา แล้วเอกสารผิดโดยไม่มีอะไรฟ้อง
 *
 * สองข้อนี้ไม่ขัดกัน — บังคับให้ "มีครบ" กับ "ใส่ให้เองได้แค่ไหน" คนละเรื่อง
 * ช่อง 7-9 ยังต้องมีครบเหมือนเดิม แค่ต้องกดเลือกเอง
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

const slotsSrc = js.match(/const PHOTO_SLOTS = \d+;/);
const bulkSrc = js.match(/const PHOTO_BULK_SLOTS = \[[\d, ]+\];/);
assert.ok(slotsSrc && bulkSrc, 'หา PHOTO_SLOTS หรือ PHOTO_BULK_SLOTS ในหน้าเว็บไม่เจอ');

/**
 * ดึงตัวเช็คของจริงจากหน้าเว็บมาใช้ โดยป้อนรูปกับรายชื่อเครื่องเข้าไปเอง
 * (ของจริงอ่านจาก DOM ซึ่งไม่มีในเทสต์)
 */
function checker(photos, units) {
  return new Function('cfPhotos', 'cfPhotoUnits',
    slotsSrc[0] + '\n' + bulkSrc[0] + '\n' + sourceOf('cfMissingRequired') +
    '\nreturn { cfMissingRequired, PHOTO_SLOTS, PHOTO_BULK_SLOTS };'
  )(photos, () => units);
}

/** เครื่องหนึ่งตัว แนบรูปไว้ถึงช่องที่ระบุ */
const filled = (slot, upTo) => {
  const p = {};
  for (let i = 1; i <= upTo; i++) p[slot + '-' + i] = 'data:image/png;base64,x';
  return p;
};

const oneUnit = [{ slot: 1, airCode: 'AYA-WNI-AIR-1' }];
const twoUnits = [{ slot: 1, airCode: 'AYA-WNI-AIR-1' }, { slot: 2, airCode: 'AYA-WNI-AIR-2' }];

/* ==================== ต้องครบทั้ง 9 ช่อง ==================== */

test('ต้องแนบครบทั้ง 9 ช่อง', () => {
  assert.equal(checker({}, oneUnit).PHOTO_SLOTS, 9);
});

test('ไม่มีรูปเลย ต้องฟ้องครบทั้ง 9 ช่อง', () => {
  const c = checker({}, oneUnit);
  assert.deepEqual(c.cfMissingRequired(),
    ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8', '1-9']);
});

test('แนบ 6 ช่องแรกแล้วแต่ช่องวัดค่ายังว่าง ต้องยังบันทึกไม่ได้', () => {
  // ข้อนี้คือการตัดสินใจของเจ้าของงานโดยตรง — ผมเสนอให้ผ่านได้ถ้ามีเหตุผลกำกับ
  // แต่เจ้าของงานให้บังคับครบทุกช่อง ใบงานต้องสมบูรณ์เท่านั้น
  const c = checker(filled(1, 6), oneUnit);
  assert.deepEqual(c.cfMissingRequired(), ['1-7', '1-8', '1-9']);
});

test('แนบครบทั้ง 9 ช่อง ถึงจะผ่าน', () => {
  assert.deepEqual(checker(filled(1, 9), oneUnit).cfMissingRequired(), []);
});

test('ขาดช่องเดียวก็ต้องฟ้อง', () => {
  const p = filled(1, 9);
  delete p['1-4'];
  assert.deepEqual(checker(p, oneUnit).cfMissingRequired(), ['1-4']);
});

test('ขาดเฉพาะช่องสุดท้ายก็ต้องฟ้อง', () => {
  const p = filled(1, 8);
  assert.deepEqual(checker(p, oneUnit).cfMissingRequired(), ['1-9']);
});

/* ==================== ต้องครบทุกเครื่อง ==================== */

test('ล้างสองเครื่อง ต้องครบทั้งสองเครื่อง', () => {
  // แนบให้เครื่องแรกครบแล้วกดบันทึก ต้องยังไม่ผ่าน เพราะเครื่องที่สองยังไม่มีรูปเลย
  const c = checker(filled(1, 9), twoUnits);
  assert.equal(c.cfMissingRequired().length, 9);
  assert.ok(c.cfMissingRequired().every(k => k.startsWith('2-')));
});

test('สองเครื่องครบทั้งคู่ ถึงจะผ่าน', () => {
  const c = checker({ ...filled(1, 9), ...filled(2, 9) }, twoUnits);
  assert.deepEqual(c.cfMissingRequired(), []);
});

test('สองเครื่อง ขาดคนละช่อง ต้องฟ้องทั้งคู่', () => {
  const p = { ...filled(1, 9), ...filled(2, 9) };
  delete p['1-2'];
  delete p['2-7'];
  assert.deepEqual(checker(p, twoUnits).cfMissingRequired(), ['1-2', '2-7']);
});

test('ยังไม่ได้เลือก Node (ไม่มีเครื่องเลย) ต้องไม่ฟ้องอะไร', () => {
  // ตอนเพิ่งเปิดหน้ายังไม่มีเครื่อง ถ้าฟ้องตรงนี้จะกลายเป็นขอบแดงเต็มหน้าตั้งแต่แรก
  assert.deepEqual(checker({}, []).cfMissingRequired(), []);
});

/* ==================== ปุ่มเลือกหลายรูป ต้องไม่แตะช่องวัดค่า ==================== */

test('ปุ่มเลือกหลายรูปพร้อมกัน ลงให้แค่ช่อง 2-5 (รูปดำเนินการ) — ช่อง 1 ก่อน / 6 หลัง เป็นคนละขั้นตอน', () => {
  // ผู้ใช้ขอ 19/10/2569: ถ้าให้ช่อง 1 กับ 6 เลือกพร้อมกัน ช่างจะใส่รูปก่อน/หลังสลับกัน
  assert.deepEqual(checker({}, oneUnit).PHOTO_BULK_SLOTS, [2, 3, 4, 5]);
});

test('ปุ่มเลือกหลายรูป ต้องวนหาช่องว่างเฉพาะ PHOTO_BULK_SLOTS', () => {
  // ถ้าเผลอเปลี่ยนเป็น PHOTO_SLOTS รูปวัดไฟจะไปอยู่ช่องวัดน้ำยาโดยไม่มีอะไรฟ้อง
  const src = sourceOf('cfPickManyPhotos');

  assert.ok(/for \(const i of PHOTO_BULK_SLOTS\) if \(!cfPhotos/.test(src),
    'ต้องวนเฉพาะช่องใน PHOTO_BULK_SLOTS');
  assert.ok(!/PHOTO_SLOTS/.test(src), 'ปุ่มนี้ต้องไม่อ้างถึงจำนวนช่องทั้งหมด');
});

test('ปุ่มเลือกหลายรูป ต้องเรียงไฟล์แบบรู้จักตัวเลข', () => {
  // ไม่งั้น IMG_10 จะมาก่อน IMG_9 แล้วรูปลงสลับช่องกัน
  assert.ok(/numeric: true/.test(sourceOf('cfPickManyPhotos')));
});

/* ==================== ต้องไม่เหลือร่องรอยของกติกาที่ถูกยกเลิก ==================== */

test('ต้องไม่เหลือช่องกรอกเหตุผลที่รูปไม่ครบ', () => {
  // เคยทำไว้ตอนที่กติกาคือ "ช่องวัดค่าขาดได้ถ้ามีเหตุผล" ซึ่งเจ้าของงานยกเลิกแล้ว
  // ถ้าเหลือค้างไว้ คนอ่านโค้ดจะเข้าใจว่ายังมีทางบันทึกโดยรูปไม่ครบ
  assert.ok(!/photoNote|MissingPhotoNote/i.test(html), 'ต้องไม่เหลือช่องเหตุผลในหน้าเว็บ');
});
