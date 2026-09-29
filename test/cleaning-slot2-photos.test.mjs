/**
 * ใบล้างที่มีแค่เครื่องที่ 2 — รูปต้องขึ้น และไม่หายตอนรวมใบ
 *
 * ============================================================================
 * บั๊กที่เจอจริง (29/09/2026)
 * ============================================================================
 * กรอกใบล้างจากหน้าแผนให้เครื่องที่ 2 ของ Node (PM2609-37, PM2609-39) แล้วขึ้นว่า
 * "บันทึกเอกสารสำเร็จแล้ว แต่รูปยังส่งไม่ขึ้น 9 ใบ"
 *
 * ใบแบบนี้ไม่มีเลขช่องที่ 1 (DocNo ว่าง มีแต่ DocNo2) เซิร์ฟเวอร์ส่ง docNo ว่างกลับไป
 * หน้าเว็บหาแถวที่เพิ่งบันทึกด้วยเลขนั้นไม่เจอ เลยไม่ส่งรูปเลยสักใบ
 *
 * บั๊กที่สองที่ซ่อนอยู่: รูปของใบแบบนี้เก็บด้วย ID ของแถว พอกรอกเครื่องที่ 1 ของการไป
 * ล้างครั้งเดียวกันตามมา ระบบรวมใบและออกเลขช่องที่ 1 ให้ ใบนี้จึงไปหารูปด้วยเลขใหม่
 * รูปของเครื่องที่ 2 หายไปจากเอกสาร
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm, saveCleaningPhoto, getCleaningPhotos } from '../src/modules/cleaningform.js';
import { settleDocPdfQueue } from '../src/modules/doc-pdf-queue.js';

/** ฟังก์ชันหาแถวที่เพิ่งบันทึก ดึงจากหน้าเว็บจริง */
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'index.html'), 'utf8');
const src = html.match(/function rowOfSavedDoc\(res\) \{[\s\S]*?\n  \}/);
const rowOfSavedDoc = new Function('return ' + src[0])();

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const u = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, Brand, BTU)
    VALUES (?,?,?,?,?,?,?,?)`);
  u.run('LRI-STA-AIR-1', 'นิคมสร้างตนเอง', 'LRI-STA', '1', 'ลพบุรี', 'ใช้งานปกติ', 'Daikin', 18000);
  u.run('LRI-STA-AIR-2', 'นิคมสร้างตนเอง', 'LRI-STA', '1', 'ลพบุรี', 'ใช้งานปกติ', 'Carrier', 24000);
  return db;
}

/** ที่เก็บรูปในหน่วยความจำ แทนดิสก์ */
function memPhotos() {
  const store = {};
  return {
    store,
    save(kind, docNo, slot, index, dataUrl) { (store[docNo] ||= {})[slot + '-' + index] = dataUrl; return { bytes: 1 }; },
    readAll(kind, docNo) { return { ...(store[docNo] || {}) }; },
    remove(kind, docNo, slot, index) { if (store[docNo]) delete store[docNo][slot + '-' + index]; },
    removeAll(kind, docNo) { delete store[docNo]; }
  };
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, photos) => { const c = new Ctx({}, state, db, { photos }); c.username = 'boss'; return c; };

/** ใบของเครื่องหนึ่งตัว แบบที่หน้าแผนส่งมา */
const oneUnit = slot => ({
  NodeName: 'นิคมสร้างตนเอง', SiteCode: 'LRI-STA', Region: '1', Province: 'ลพบุรี',
  Date: '2026-09-29', PlanYear: 2026, PlanRound: 1,
  ['AirCode' + slot]: 'LRI-STA-AIR-' + slot, ['Price' + slot]: 500, Checklist: []
});

test('ใบที่มีแค่เครื่องที่ 2 — หน้าเว็บหาแถวเจอ และแนบรูปได้ครบ 9 ช่อง', async () => {
  const db = freshDb();
  const photos = memPhotos();
  const res = await saveCleaningForm(as(db, photos), oneUnit(2));

  assert.match(res.docNo, /^PM/, 'เลขที่ที่โชว์ต้องเป็นเลขของเครื่องที่ 2 ไม่ใช่ค่าว่าง');
  const row = rowOfSavedDoc(res);
  assert.ok(row, 'หน้าเว็บต้องหาแถวของใบที่เพิ่งบันทึกเจอ (เดิมหาไม่เจอ รูปจึงไม่ถูกส่ง)');

  for (let i = 1; i <= 9; i++) {
    await saveCleaningPhoto(as(db, photos), { row, unitSlot: 2, index: i, dataUrl: 'data:image/jpeg;base64,AA' + i });
  }
  await settleDocPdfQueue();
  const got = await getCleaningPhotos(as(db, photos), row);
  assert.equal(Object.keys(got.photos || got).filter(k => k.startsWith('2-')).length, 9);
});

test('กรอกเครื่องที่ 2 ก่อน แล้วเครื่องที่ 1 ตามมา — รวมใบแล้วรูปเครื่องที่ 2 ต้องยังอยู่', async () => {
  const db = freshDb();
  const photos = memPhotos();

  const first = await saveCleaningForm(as(db, photos), oneUnit(2));
  const row = rowOfSavedDoc(first);
  await saveCleaningPhoto(as(db, photos), { row, unitSlot: 2, index: 1, dataUrl: 'data:image/jpeg;base64,AAAA' });
  await settleDocPdfQueue();

  const second = await saveCleaningForm(as(db, photos), oneUnit(1));
  assert.ok(second.mergedInto, 'ต้องรวมเป็นใบเดียว');
  assert.equal(rowOfSavedDoc(second), row, 'ต้องเป็นแถวเดิม');

  const form = db.prepare('SELECT * FROM cleaning_forms').get();
  assert.ok(form.DocNo, 'ใบนี้ได้เลขช่องที่ 1 แล้ว');
  assert.equal(photos.readAll('cleaning', form.DocNo)['2-1'], 'data:image/jpeg;base64,AAAA',
    'รูปเครื่องที่ 2 ต้องย้ายไปอยู่ใต้ชื่อใหม่ของใบ');
  assert.deepEqual(photos.readAll('cleaning', form.ID), {}, 'ที่เดิมต้องว่าง ไม่มีรูปค้างซ้ำสองที่');

  const got = await getCleaningPhotos(as(db, photos), row);
  assert.ok((got.photos || got)['2-1'], 'หน้าแก้รูปต้องเห็นรูปเดิม');
});

test('รวมใบที่ชื่อที่เก็บรูปไม่เปลี่ยน (กรอกเครื่องที่ 1 ก่อน) — ไม่แตะรูปเลย', async () => {
  const db = freshDb();
  const photos = memPhotos();
  const first = await saveCleaningForm(as(db, photos), oneUnit(1));
  const row = rowOfSavedDoc(first);
  await saveCleaningPhoto(as(db, photos), { row, unitSlot: 1, index: 1, dataUrl: 'data:image/jpeg;base64,BBBB' });
  await settleDocPdfQueue();
  const key = db.prepare('SELECT DocNo FROM cleaning_forms').get().DocNo;

  await saveCleaningForm(as(db, photos), oneUnit(2));
  assert.equal(photos.readAll('cleaning', key)['1-1'], 'data:image/jpeg;base64,BBBB');
});
