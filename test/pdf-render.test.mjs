/**
 * การแปลงเอกสารเป็นไฟล์ PDF
 *
 * ============================================================================
 * ทำไมต้องทนได้เมื่อไม่มีเบราว์เซอร์
 * ============================================================================
 * ระบบนี้จะถูกส่งต่อให้ IT เอาไปรันบนเครื่องที่เราไม่รู้ว่ามีอะไรติดตั้งอยู่
 * ถ้าไม่มีเบราว์เซอร์แล้วระบบพัง จะกลายเป็นว่าเปิดหน้าเอกสารก็ไม่ได้ทั้งที่ควรได้
 * จึงต้องล้มเฉพาะคำสั่งแปลงไฟล์ พร้อมบอกทางออกให้ผู้ใช้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { existsSync } from 'node:fs';

import { findBrowser, renderPdf } from '../platform/pdf-render.js';
import { buildCleaningDocHtml } from '../src/modules/cleaning-doc.js';

const sample = () => ({
  DocNo: 'PM2609-99', Date: '2026-09-15',
  NodeName: 'ทดสอบ', SiteCode: 'TST-TST', Province: 'อยุธยา',
  AirCode1: 'TST-TST-AIR-1', Unit1_Brand: 'Daikin', Unit1_IndoorSerial: 'IN-1',
  ChecklistJSON: '[]'
});

test('ระบุ BROWSER_PATH ที่ไม่มีอยู่จริง ต้องถือว่าไม่มีเบราว์เซอร์', () => {
  // ไม่ใช่ปล่อยให้ไปเรียกแล้วพังตอนรัน
  assert.equal(findBrowser({ BROWSER_PATH: 'C:\ไม่มีไฟล์นี้\nope.exe' }), null);
});

test('ไม่มีเบราว์เซอร์ ต้องบอกทางออกให้ผู้ใช้ ไม่ใช่แค่แจ้งว่าพัง', () => {
  assert.throws(
    () => renderPdf('<p>ทดสอบ</p>', { BROWSER_PATH: 'C:\ไม่มีไฟล์นี้\nope.exe' }),
    err => {
      assert.match(err.message, /เปิดเอกสาร/, 'ต้องบอกว่ากดเปิดเอกสารแล้วปริ้นเองได้');
      assert.match(err.message, /BROWSER_PATH/, 'ต้องบอกผู้ดูแลระบบว่าตั้งค่าตรงไหนได้');
      return true;
    }
  );
});

// เครื่องที่ไม่มีเบราว์เซอร์ก็ต้องรันเทสต์ชุดนี้ผ่าน จึงข้ามข้อที่ต้องใช้จริง
const browser = findBrowser({});

test('แปลงเอกสารจริงเป็นไฟล์ PDF ได้', { skip: browser ? false : 'เครื่องนี้ไม่มีเบราว์เซอร์' },
  async () => {
    const pdf = await renderPdf(buildCleaningDocHtml(sample()), {});

    assert.ok(pdf.length > 1000, 'ไฟล์ต้องไม่ว่าง ได้ ' + pdf.length + ' ไบต์');
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'ต้องเป็นไฟล์ PDF จริง');
  });

test('เอกสารสองใบที่ต่างกัน ต้องได้ไฟล์ที่ต่างกัน',
  { skip: browser ? false : 'เครื่องนี้ไม่มีเบราว์เซอร์' },
  async () => {
    // กันกรณีที่ไฟล์ชั่วคราวชนกันแล้วได้ไฟล์เดิมซ้ำ
    const a = await renderPdf(buildCleaningDocHtml(sample()), {});
    const b = await renderPdf(buildCleaningDocHtml({ ...sample(), NodeName: 'อีกโหนดหนึ่ง' }), {});
    assert.notEqual(a.length + ':' + a.subarray(0, 400).toString('latin1'),
                    b.length + ':' + b.subarray(0, 400).toString('latin1'));
  });
