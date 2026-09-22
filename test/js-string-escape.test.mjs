/**
 * ค่าที่ไปอยู่ในโค้ดของ onclick ต้องหนีอักขระสองชั้น
 *
 * ============================================================================
 * ปัญหาที่ชุดนี้แก้
 * ============================================================================
 * หน้าเว็บสร้างปุ่มด้วยการต่อสตริง แล้วยัดค่าจากฐานข้อมูลเข้าไปแบบนี้
 *
 *     onclick="deleteAir(5, '${esc(a.AirCode)}')"
 *
 * ตรงนั้นมีสองชั้นซ้อนกัน — ชั้นนอกเป็น attribute ของ HTML ชั้นในเป็นสตริงของ JS
 *
 * esc() เปลี่ยน ' เป็น &#39; ซึ่งพอสำหรับชั้นนอก แต่เบราว์เซอร์ถอดรหัสกลับเป็น '
 * ก่อนแล้วค่อยเอาไปอ่านเป็นโค้ด เครื่องหมายคำพูดจึงหลุดเข้าไปปิดสตริงของ JS
 * แล้วอะไรที่ตามมาก็กลายเป็นคำสั่งที่ทำงานจริง
 *
 * ทดสอบในเบราว์เซอร์จริงแล้ว ชื่อ Node ที่เป็น  '); alert(1); ('
 * ทำงานทั้งตอนใส่ดิบๆ และตอนครอบ esc() — ต่างกันแค่ตัวหลังดูเหมือนปลอดภัยแล้ว
 *
 * ของจริงที่เข้าถึงได้: ชื่อไฟล์ที่ช่างอัปโหลดมา — safeFileName ตัด <>:"|?* ออก
 * แต่ไม่ได้ตัด ' ชื่อไฟล์จึงเป็นทางที่ค่าจากคนนอกวิ่งเข้ามาถึง onclick ได้จริง
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - jsStr ต้องกันการปิดสตริงได้ และค่าที่ฝั่งรับต้องได้ของเดิมเป๊ะ
 * - ชื่อไทยที่มีเครื่องหมาย ' จริงๆ ต้องยังใช้งานได้ ไม่ใช่โดนตัดทิ้ง
 * - ทุกจุดใน onclick ที่ยัดค่าเข้าสตริง ต้องผ่าน jsStr ไม่ใช่ esc
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
  const re = new RegExp(String.raw`function ${name}\([^)]*\)[\s\S]*?\n    \}`);
  const src = js.match(re);
  assert.ok(src, `หาฟังก์ชัน ${name} ในหน้าเว็บไม่เจอ`);
  return src[0];
}

const { esc, jsStr } = new Function(
  sourceOf('esc') + '\n' + sourceOf('jsStr') + '\nreturn { esc, jsStr };'
)();

/**
 * จำลองสิ่งที่เบราว์เซอร์ทำกับ onclick — ถอดรหัส HTML ก่อน แล้วค่อยอ่านเป็นโค้ด
 * คืนค่าที่ฟังก์ชันได้รับ หรือโยน error ถ้าโค้ดที่ได้พัง
 */
function runOnclick(attr) {
  const decoded = attr
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  let got = null, extra = 0;
  const fn = new Function('recv', 'boom', decoded + '\n;return true;');
  fn(v => { got = v; }, () => { extra++; });
  return { got, extra };
}

/* ==================== esc() อย่างเดียวไม่พอ ==================== */

test('esc() อย่างเดียว ยังโดนแทรกคำสั่งได้อยู่', () => {
  // ข้อนี้คือเหตุผลทั้งหมดที่ jsStr ต้องมี — ถ้าวันหนึ่งข้อนี้กลายเป็นผ่าน
  // แปลว่ามีคนแก้ esc() ให้ครอบคลุมขึ้น แล้วค่อยพิจารณาว่ายังต้องมี jsStr มั้ย
  const evil = "'); boom(); ('";
  const { extra } = runOnclick(`recv('${esc(evil)}')`);

  assert.equal(extra, 1, 'esc() ต้องกันไม่อยู่ — ถ้ากันอยู่แล้ว ให้มาทบทวนเทสต์ชุดนี้');
});

/* ==================== jsStr กันได้ ==================== */

test('jsStr ต้องกันการแทรกคำสั่งได้', () => {
  const evil = "'); boom(); ('";
  const { got, extra } = runOnclick(`recv('${jsStr(evil)}')`);

  assert.equal(extra, 0, 'ต้องไม่มีคำสั่งแปลกปลอมทำงาน');
  assert.equal(got, evil, 'ค่าที่รับได้ต้องเป็นของเดิมทั้งก้อน');
});

test('ชื่อไทยที่มีเครื่องหมาย \' จริงๆ ต้องยังใช้งานได้', () => {
  // ไม่ใช่ทุก ' จะเป็นการโจมตี ชื่อร้านชื่อโรงแรมมีกันจริง
  const name = "โรงแรมเดอะ'ซิตี้ ลำพูน";
  const { got, extra } = runOnclick(`recv('${jsStr(name)}')`);

  assert.equal(extra, 0);
  assert.equal(got, name, 'ต้องได้ชื่อเดิมครบ ไม่ใช่โดนตัดทิ้ง');
});

test('backslash ต้องถูกหนีก่อน ไม่งั้นตัวที่เติมทีหลังจะถูกกลืน', () => {
  // ถ้าหนี ' ก่อนแล้วค่อยหนี \\ ตัว \\ ที่เพิ่งเติมเข้าไปจะโดนหนีซ้ำ แล้วค่าเพี้ยน
  const p = "C:\\ทดสอบ\\ไฟล์";
  const { got, extra } = runOnclick(`recv('${jsStr(p)}')`);

  assert.equal(extra, 0);
  assert.equal(got, p);
});

test('ชื่อไฟล์ที่ช่างตั้งมาเอง ต้องกันได้', () => {
  // safeFileName ตัด <>:"|?* ออก แต่ไม่ได้ตัด ' และ \\
  // ชื่อไฟล์จึงเป็นทางที่ค่าจากคนนอกวิ่งเข้ามาถึง onclick ได้จริง
  const file = "รูป'); boom(); ('งาน.jpg";
  const { got, extra } = runOnclick(`recv('${jsStr(file)}')`);

  assert.equal(extra, 0);
  assert.equal(got, file);
});

test('เครื่องหมายคำพูดคู่ ต้องไม่ทำให้ attribute ขาดกลางคัน', () => {
  const v = 'ไซต์ "กลาง" เชียงใหม่';
  assert.ok(!jsStr(v).includes('"'), 'ต้องไม่เหลือ \" ดิบๆ ที่จะไปปิด attribute');
  assert.equal(runOnclick(`recv('${jsStr(v)}')`).got, v);
});

test('ค่าว่างหรือไม่มีค่า ต้องได้สตริงว่าง ไม่ใช่คำว่า null', () => {
  assert.equal(jsStr(null), '');
  assert.equal(jsStr(undefined), '');
  assert.equal(jsStr(0), '0');
});

/* ==================== ทุกจุดในหน้าเว็บต้องใช้ตัวที่ถูก ==================== */

test('ทุกจุดที่ยัดค่าเข้าสตริงใน onclick ต้องผ่าน jsStr', () => {
  // ถ้าเทสต์นี้แดง แปลว่ามีคนเขียนปุ่มใหม่แล้วใช้ esc() ตามนิสัยเดิม
  const bad = [];
  for (const m of html.matchAll(/onclick="[^"]*"/g)) {
    for (const hit of m[0].matchAll(/'\$\{([^}]+)\}'/g)) {
      if (!hit[1].includes('jsStr')) bad.push(m[0].slice(0, 80));
    }
  }
  assert.deepEqual(bad, [], 'จุดพวกนี้ยังไม่ได้ใช้ jsStr');
});

test('ต้องไม่เหลือการหนีอักขระด้วยมือที่ไม่ได้ผล', () => {
  // ของเดิมมีจุดที่เขียน esc(x).replace(/'/g,'&#39;') ซึ่งไม่ได้ช่วยอะไรเลย
  // เพราะ esc() เปลี่ยน ' ไปแล้วตั้งแต่แรก แต่ทำให้คนอ่านเข้าใจว่ากันแล้ว
  assert.ok(!/esc\([^)]*\)\.replace\(\/'\/g/.test(html));
});
