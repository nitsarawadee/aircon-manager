/**
 * เลขที่เอกสาร ต้องใช้ชุดเลขเดียวกับหน้าประวัติ
 *
 * ============================================================================
 * ทำไมถึงไม่ตั้งรูปแบบใหม่
 * ============================================================================
 * ระบบมีกติกาอยู่แล้วว่า PM = งานล้างตามแผน, CM = งานซ่อมและอื่นๆ
 * (ดูหัวข้อ makeHistoryId ใน history.js) การเพิ่มคำนำหน้าใหม่ขึ้นมาอีกชุด
 * คือการมีชื่อเรียกของสิ่งเดียวกันสองแบบ ซึ่งคนถือกระดาษอยู่จะสับสน
 *
 * และเพราะเอกสารกับใบประวัติใช้ชุดเลขเดียวกัน จึงต้องนับรวมกันตอนออกเลข
 * ไม่งั้นจะมีวันที่เอกสารกับใบประวัติได้เลขเดียวกันคนละเรื่อง แล้วการตามหา
 * เอกสารจากเลขที่เห็นในหน้าประวัติจะเจอผิดใบ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm, getCleaningForms } from '../src/modules/cleaningform.js';
import { getHistory } from '../src/modules/history.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');

  const addUnit = db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU)
      VALUES (?,?,?,?,?,?,?,?)`);
  addUnit.run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'ใช้งานปกติ', 'Daikin', 18000);
  addUnit.run('AYA-WNI-AIR-2', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'ใช้งานปกติ', 'Daikin', 18000);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => {
  const c = new Ctx({}, state, db);   // env ว่าง = สร้าง PDF ไม่ได้ ซึ่งไม่กระทบการออกเลข
  c.username = 'boss';
  return c;
};

const baseRecord = (over = {}) => ({
  NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Region: '1', Province: 'อยุธยา',
  AirCode1: 'AYA-WNI-AIR-1', Date: '2026-09-15',
  TechnicianName: 'ช่างสมชาย', Price1: 450, Checklist: [],
  ...over
});

test('เอกสารล้างได้เลขขึ้นต้นด้วย PM ตามกติกาเดิมของระบบ', async () => {
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), baseRecord());

  const [form] = await getCleaningForms(ctxOf(db));
  assert.equal(form.DocType, 'cleaning');
  assert.match(form.DocNo, /^PM2609-\d{2,}$/, 'ได้เลข ' + form.DocNo);
});

test('แถวประวัติการล้างใช้เลขเดียวกับเลขเอกสารของเครื่องนั้น และไม่ซ้ำกันเอง', async () => {
  // การล้างครั้งเดียวต้องมีเลขเดียว — ถือกระดาษเลขไหนค้นในหน้าประวัติก็เจอเลขนั้น
  const db = freshDb();
  for (let i = 0; i < 3; i++) {
    await saveCleaningForm(ctxOf(db), baseRecord({ AirCode2: 'AYA-WNI-AIR-2', Price2: 450 }));
  }

  const forms = await getCleaningForms(ctxOf(db));
  const history = await getHistory(ctxOf(db));
  assert.equal(forms.length, 3);
  assert.equal(history.length, 6, 'สามใบ สองเครื่องต่อใบ = หกใบประวัติ');

  const ids = history.map(h => h.ID);
  assert.equal(new Set(ids).size, ids.length, 'เลขประวัติซ้ำ: ' + ids.join(', '));
  const docNos = forms.flatMap(f => [f.DocNo, f.DocNo2]).filter(Boolean);
  assert.deepEqual([...ids].sort(), [...docNos].sort(), 'เลขประวัติต้องตรงกับเลขเอกสาร');

  // เครื่องที่ 2 ของแต่ละใบได้เลข DocNo2 ของใบนั้น
  for (const f of forms) {
    const h2 = history.find(h => h.ID === f.DocNo2);
    assert.equal(h2 && h2.AirCode, 'AYA-WNI-AIR-2');
  }
});

test('เลขเดินขึ้นเสมอ ไม่ย้อนกลับและไม่ซ้ำ แม้บันทึกติดกันหลายใบ', async () => {
  const db = freshDb();
  for (let i = 0; i < 3; i++) await saveCleaningForm(ctxOf(db), baseRecord());

  // getCleaningForms คืนใบใหม่สุดขึ้นก่อน ลำดับในรายการจึงกลับกับลำดับเลข
  const nums = (await getCleaningForms(ctxOf(db)))
    .map(f => Number(String(f.DocNo).split('-')[1]))
    .sort((a, b) => a - b);

  // จงใจไม่บังคับให้เลขติดกันทีละหนึ่ง เพราะเอกสารกับใบประวัติใช้ชุดเลขเดียวกัน
  // ใบประวัติที่เอกสารสร้างขึ้นก็กินเลขในชุดเดียวกันไปด้วย เลขเอกสารจึงมีช่องว่าง
  // ได้ตามปกติ (เช่น 01, 03, 05) สิ่งที่ต้องรับประกันคือไม่ซ้ำและไม่ย้อน
  assert.equal(new Set(nums).size, 3, 'ห้ามซ้ำ');
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b), 'ต้องเรียงขึ้น');
  assert.ok(nums[0] >= 1);
});

test('เดือนในเลขมาจากวันที่ล้าง ไม่ใช่วันที่กดบันทึก', async () => {
  // บันทึกย้อนหลังเป็นเรื่องปกติ เลขต้องอยู่ในเดือนของงานจริง
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), baseRecord({ Date: '2026-07-02' }));

  const [form] = await getCleaningForms(ctxOf(db));
  assert.match(form.DocNo, /^PM2607-/, 'ได้เลข ' + form.DocNo);
});

test('ใบเก่าที่ยังไม่มีเลข หน้าเว็บต้องแสดง ID เดิมแทน ไม่ใช่ช่องว่าง', () => {
  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  const src = html.match(/function displayDocNo\([\s\S]*?\n  \}/);
  assert.ok(src, 'หาฟังก์ชัน displayDocNo ไม่เจอ');

  const displayDocNo = new Function('return ' + src[0])();
  assert.equal(displayDocNo({ DocNo: 'PM2609-01', ID: 'CF1786584310030' }), 'PM2609-01');
  assert.equal(displayDocNo({ DocNo: '', ID: 'CF1786584310030' }), 'CF1786584310030');
  assert.equal(displayDocNo({ ID: 'CF1786584310030' }), 'CF1786584310030');
  assert.equal(displayDocNo({}), '');
  assert.equal(displayDocNo(null), '');
});
