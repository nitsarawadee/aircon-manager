/**
 * ทดสอบการเรียงลำดับรายการเครื่องปรับอากาศในหน้าเว็บ
 *
 * ดึงฟังก์ชันจริงออกมาจาก index.html แล้วเรียกใช้ ไม่ใช่คัดลอกโค้ดมาวางซ้ำ
 * (วิธีเดียวกับ web-format.test.mjs — ดูคำอธิบายเต็มที่หัวไฟล์นั้น)
 *
 * ============================================================================
 * เทสต์ที่สำคัญที่สุดในไฟล์นี้คือข้อสุดท้าย
 * ============================================================================
 * _row คือ "ลำดับที่เท่าไหร่ในผลลัพธ์ของเซิร์ฟเวอร์" ไม่ใช่ id ถาวร
 * การเรียงลำดับจึงทำได้ที่หน้าเว็บเท่านั้น ถ้าใครย้ายไปเรียงที่เซิร์ฟเวอร์
 * (เปลี่ยน ORDER BY row_id ใน repository.js) คำสั่งแก้ไขและลบจะไปโดนเครื่อง
 * ผิดตัวทันที โดยหน้าเว็บไม่มีอะไรฟ้องเลย เทสต์ข้อสุดท้ายเฝ้าจุดนั้นไว้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function extract(name) {
  const re = new RegExp(String.raw`function ${name}\([^)]*\)[\s\S]*?\n    \}`);
  const src = js.match(re);
  assert.ok(src, `หาฟังก์ชัน ${name} ในหน้าเว็บไม่เจอ`);
  return new Function('return ' + src[0])();
}

const sortAirRows = extract('sortAirRows');

const codes = list => sortAirRows(list).map(a => a.AirCode);

test('เครื่องในโหนดเดียวกันอยู่ติดกัน แม้เพิ่งเพิ่มเข้ามาทีหลัง', () => {
  // ลำดับที่ส่งมาคือลำดับที่เพิ่มเข้าระบบ AIR-2 ของวังน้อยเพิ่มทีหลังสุด
  const list = [
    { AirCode: 'AYA-WNI-AIR-1' },
    { AirCode: 'KCB-BKO-AIR-1' },
    { AirCode: 'KCB-BKO-AIR-2' },
    { AirCode: 'AYA-WNI-AIR-2' }
  ];
  assert.deepEqual(codes(list), [
    'AYA-WNI-AIR-1', 'AYA-WNI-AIR-2', 'KCB-BKO-AIR-1', 'KCB-BKO-AIR-2'
  ]);
});

test('เครื่องตัวที่ 3 ของโหนดเดิม ไปต่อท้ายพี่น้องตัวเอง ไม่ใช่ท้ายตาราง', () => {
  const list = [
    { AirCode: 'ATG-ATG-AIR-1' },
    { AirCode: 'ATG-ATG-AIR-2' },
    { AirCode: 'SRI-OFFICE-AIR-1' },
    { AirCode: 'ATG-ATG-AIR-3' }
  ];
  assert.deepEqual(codes(list), [
    'ATG-ATG-AIR-1', 'ATG-ATG-AIR-2', 'ATG-ATG-AIR-3', 'SRI-OFFICE-AIR-1'
  ]);
});

test('เลขสองหลักอยู่หลังเลขหลักเดียว ไม่ใช่แทรกหลังตัวที่ 1', () => {
  // เรียงแบบตัวอักษรล้วนจะได้ AIR-1, AIR-10, AIR-2 ซึ่งอ่านแล้วงง
  const list = [
    { AirCode: 'ATG-ATG-AIR-10' },
    { AirCode: 'ATG-ATG-AIR-2' },
    { AirCode: 'ATG-ATG-AIR-1' },
    { AirCode: 'ATG-ATG-AIR-9' }
  ];
  assert.deepEqual(codes(list), [
    'ATG-ATG-AIR-1', 'ATG-ATG-AIR-2', 'ATG-ATG-AIR-9', 'ATG-ATG-AIR-10'
  ]);
});

test('รหัสตัวพิมพ์เล็กพิมพ์ใหญ่ปนกัน ยังจัดกลุ่มอยู่ด้วยกัน', () => {
  const list = [
    { AirCode: 'atg-atg-air-2' },
    { AirCode: 'BKK-BKK-AIR-1' },
    { AirCode: 'ATG-ATG-AIR-1' }
  ];
  assert.deepEqual(codes(list), ['ATG-ATG-AIR-1', 'atg-atg-air-2', 'BKK-BKK-AIR-1']);
});

test('รายการว่างหรือไม่ได้ส่งมา ไม่ทำให้พัง', () => {
  assert.deepEqual(sortAirRows([]), []);
  assert.deepEqual(sortAirRows(null), []);
  assert.deepEqual(sortAirRows(undefined), []);
});

test('รหัสว่างไม่ทำให้พัง และไปรวมอยู่ต้นรายการ', () => {
  const list = [{ AirCode: 'ATG-ATG-AIR-1' }, { AirCode: '' }, {}];
  assert.equal(sortAirRows(list).length, 3);
  assert.equal(sortAirRows(list)[2].AirCode, 'ATG-ATG-AIR-1');
});

test('ไม่สลับลำดับของรายการต้นฉบับ', () => {
  // currentAirList ถูกใช้ร่วมกันหลายหน้า ถ้าเรียงทับของเดิมจะกระทบหน้าอื่นด้วย
  const list = [{ AirCode: 'B-AIR-1' }, { AirCode: 'A-AIR-1' }];
  const before = list.map(a => a.AirCode);
  sortAirRows(list);
  assert.deepEqual(list.map(a => a.AirCode), before);
});

test('_row ยังชี้ถูกเครื่องเดิมหลังเรียงลำดับใหม่', () => {
  // นี่คือเหตุผลที่การเรียงต้องอยู่ที่หน้าเว็บ ไม่ใช่ที่เซิร์ฟเวอร์
  const list = [
    { AirCode: 'ZZZ-AIR-1', _row: 2 },
    { AirCode: 'AAA-AIR-1', _row: 3 },
    { AirCode: 'MMM-AIR-1', _row: 4 }
  ];
  const sorted = sortAirRows(list);
  assert.deepEqual(sorted.map(a => a.AirCode), ['AAA-AIR-1', 'MMM-AIR-1', 'ZZZ-AIR-1']);
  // เลขแถวติดไปกับเครื่องแต่ละตัว ไม่ได้ผูกกับตำแหน่งในรายการ
  assert.deepEqual(sorted.map(a => a._row), [3, 4, 2]);
});

test('เซิร์ฟเวอร์ยังส่งข้อมูลตามลำดับแถวเดิม ไม่ได้เรียงใหม่', () => {
  // ด่านสุดท้าย: ถ้าใครย้ายการเรียงไปฝั่งเซิร์ฟเวอร์ _row จะเพี้ยนทั้งระบบ
  const repo = readFileSync(join(ROOT, 'src', 'db', 'repository.js'), 'utf8');
  const selects = [...repo.matchAll(/SELECT row_id[\s\S]{0,200}?FROM \$\{table\}[^`]*/g)].map(m => m[0]);
  assert.ok(selects.length > 0, 'หาคำสั่งอ่านตารางใน repository.js ไม่เจอ');
  for (const s of selects) {
    assert.ok(
      s.includes('ORDER BY row_id'),
      'repository.js ต้องอ่านข้อมูลตามลำดับ row_id เท่านั้น — การเรียงลำดับเพื่อแสดงผลทำที่หน้าเว็บ'
    );
  }
});
