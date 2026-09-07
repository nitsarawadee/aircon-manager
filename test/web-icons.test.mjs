/**
 * ตรวจว่าไอคอนทุกตัวที่หน้าเว็บเรียกใช้ มีอยู่จริงในชุดไอคอนที่เก็บไว้ในเครื่อง
 *
 * ทำไมต้องมีเทสต์นี้:
 * ถ้าเรียกใช้ชื่อไอคอนที่ไม่มีอยู่ เบราว์เซอร์จะวาดเป็นกล่องทึบเปล่าๆ
 * โดยไม่มี error ในคอนโซล ไม่มีอะไรฟ้องเลยสักอย่าง
 * ต้องมีคนสังเกตเห็นด้วยตาเองเท่านั้น ซึ่งกว่าจะเห็นก็ผ่านไปนาน
 *
 * เคยเกิดจริงกับ ph-air-conditioner ที่ไม่มีในชุดเวอร์ชันที่ใช้อยู่
 * การ์ด "เครื่องทั้งหมด" บนแดชบอร์ดจึงเป็นกล่องสีทึบมาตลอดโดยไม่มีใครรู้
 *
 * เทสต์นี้ยังกันกรณีที่อัปเดตชุดไอคอนแล้วบางตัวถูกเปลี่ยนชื่อหรือถูกถอดออกด้วย
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');

const cssFiles = ['phosphor.css', 'phosphor-fill.css']
  .map(f => join(ROOT, 'web', 'vendor', f))
  .filter(existsSync);

/** คำที่ขึ้นต้นด้วย ph- แต่เป็นชื่อรูปแบบ ไม่ใช่ชื่อไอคอน */
const STYLES = new Set(['fill', 'bold', 'thin', 'light', 'duotone']);

/** ชื่อไอคอนทั้งหมดที่หน้าเว็บเรียกใช้ */
function iconsUsed() {
  const out = new Set();
  for (const m of html.matchAll(/\bph-([a-z0-9][a-z0-9-]*)\b/g)) {
    if (!STYLES.has(m[1])) out.add(m[1]);
  }
  return out;
}

/** ชื่อไอคอนทั้งหมดที่มีอยู่จริงในไฟล์ที่เก็บไว้ */
function iconsAvailable() {
  const out = new Set();
  for (const f of cssFiles) {
    const css = readFileSync(f, 'utf8');
    for (const m of css.matchAll(/\.ph[a-z-]*\.ph-([a-z0-9-]+):before/g)) out.add(m[1]);
  }
  return out;
}

test('ไฟล์ชุดไอคอนต้องอยู่ในเครื่อง ไม่ใช่ดึงจากอินเทอร์เน็ต', () => {
  assert.ok(cssFiles.length >= 1, 'ไม่พบไฟล์ไอคอนใน web/vendor/ — สั่ง node scripts/vendor-assets.mjs ก่อน');
});

test('ไอคอนทุกตัวที่หน้าเว็บใช้ ต้องมีอยู่จริงในชุดที่เก็บไว้', () => {
  const used = iconsUsed();
  const have = iconsAvailable();
  const missing = [...used].filter(n => !have.has(n)).sort();

  assert.deepEqual(missing, [],
    'ไอคอนเหล่านี้ไม่มีในชุดที่ใช้อยู่ จะขึ้นเป็นกล่องทึบบนหน้าเว็บ: ' + missing.join(', '));
});

test('หน้าเว็บต้องไม่ดึงไอคอนจากอินเทอร์เน็ต', () => {
  // ถ้าเผลอใส่ลิงก์ CDN กลับเข้ามา ระบบจะใช้งานไม่ได้ตอนเน็ตหลุด
  assert.equal(/https?:\/\/[^"')]*phosphor/i.test(html), false,
    'พบการเรียกไอคอนจากอินเทอร์เน็ตในหน้าเว็บ');
});
