/**
 * แก้รูปของเอกสารที่บันทึกไปแล้ว
 *
 * ============================================================================
 * ที่มา
 * ============================================================================
 * เอกสาร 25 ใบในระบบ มีรูปแนบแค่ 4 ใบ และทั้ง 4 ใบแนบครบ 9/9
 * ไม่มีใบไหนอยู่ระหว่างกลาง แปลว่าไม่ใช่ "แนบไปครึ่งเดียวแล้วลืม"
 * แต่เป็น "แนบก็แนบครบ ไม่แนบก็ไม่แนบเลย" เจ้าของงานจึงให้บังคับครบทั้ง 9 ช่อง
 *
 * ด่านบังคับอยู่ฝั่งหน้าเว็บ (ดู photo-required-web.test.mjs) เพราะรูปเก็บด้วย
 * เลขที่เอกสารซึ่งเพิ่งมีตอนบันทึกเสร็จ ตอนที่เซิร์ฟเวอร์ตรวจได้จึงยังไม่มีรูปให้ตรวจ
 * ไฟล์นี้คุมฝั่งเซิร์ฟเวอร์ คือการอ่านรูปเดิมมาแก้
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - อ่านรูปของเอกสารมาแก้ได้ และต้องได้ตัวรูปจริง ไม่ใช่แค่รายชื่อช่อง
 * - แก้ได้แม้ปิดงานในแผนไปแล้ว และการแก้ต้องไม่ทำให้รอบที่ปิดไว้ขยับ
 * - ใบที่เป็นเอกสารแนบ (ถ่ายฟอร์มที่เขียนมือมา) แก้รูปแบบนี้ไม่ได้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm, getCleaningPhotos, saveCleaningPhoto } from '../src/modules/cleaningform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');

  for (const code of ['AYA-WNI-AIR-1', 'AYA-WNI-AIR-2']) {
    db.prepare(
      'INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status)' +
      ' VALUES (?,?,?,?,?,?,?)'
    ).run(code, 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'Container', 'ใช้งานปกติ');
  }
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };

/** ที่เก็บรูปปลอม เก็บไว้ในหน่วยความจำ ไม่แตะดิสก์ */
function fakePhotoStore() {
  const files = new Map();
  const key = (doc, slot, i) => doc + '|' + slot + '-' + i;
  return {
    // อาร์กิวเมนต์แรกคือชนิดเอกสาร บอกที่เก็บว่าไฟล์ไปอยู่โฟลเดอร์ไหน
    save(kind, doc, slot, i, dataUrl) { files.set(key(doc, slot, i), dataUrl); return { bytes: 10 }; },
    remove(kind, doc, slot, i) { files.delete(key(doc, slot, i)); },
    removeAll(kind, doc) { for (const k of [...files.keys()]) if (k.startsWith(doc + '|')) files.delete(k); },
    readAll(kind, doc) {
      const out = {};
      for (const [k, v] of files) if (k.startsWith(doc + '|')) out[k.split('|')[1]] = v;
      return out;
    }
  };
}

function ctxOf(db, services = {}) {
  const c = new Ctx({}, state, db, services);
  c.username = 'boss';
  return c;
}

const formPayload = (over = {}) => ({
  NodeName: 'วังน้อย', SiteCode: 'AYA-WNI', Region: '1', Province: 'อยุธยา',
  Date: '2026-09-15', AirCode1: 'AYA-WNI-AIR-1', Price1: 450, Unit1_Brand: 'Daikin',
  TechnicianName: 'ช่างสมชาย', EquipmentCondition: 'สภาพเครื่องสมบูรณ์',
  Checklist: [],
  ...over
});


/* ==================== อ่านรูปมาแก้ได้ ==================== */

test('อ่านรูปของเอกสารที่บันทึกไปแล้วได้ พร้อมตัวรูปจริง', async () => {
  // หน้าแก้รูปต้องเห็นรูปเดิมก่อน ถึงจะรู้ว่าใบไหนเบลอ ใบไหนถ่ายผิดเครื่อง
  const db = freshDb();
  const photos = fakePhotoStore();
  const ctx = () => ctxOf(db, { photos });

  const res = await saveCleaningForm(ctx(), formPayload());
  const row = res.forms[0]._row;

  const png = 'data:image/png;base64,iVBORw0KGgo=';
  await saveCleaningPhoto(ctx(), { row, unitSlot: 1, index: 3, dataUrl: png });

  const got = await getCleaningPhotos(ctx(), row);
  assert.equal(got.docNo, res.docNo);
  assert.deepEqual(got.photos, { '1-3': png }, 'ต้องได้ตัวรูปกลับมา ไม่ใช่แค่ชื่อช่อง');
});

test('ปิดงานในแผนไปแล้ว ก็ยังแก้รูปได้', async () => {
  // รูปไม่ได้เป็นฐานของการปิดงาน (วันที่ ราคา ช่าง สถานะ ประวัติ) จึงแก้ได้ไม่กระทบ
  const db = freshDb();
  db.prepare(
    'INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R2_PlanDate, R2_Status) VALUES (?,?,?,?,?,?)'
  ).run(2026, 'AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '2026-09-10', 'รอดำเนินการ');

  const photos = fakePhotoStore();
  const ctx = () => ctxOf(db, { photos });

  const res = await saveCleaningForm(ctx(), formPayload({ PlanYear: 2026, PlanRound: 2 }));
  assert.equal(res.planClosed, 1, 'ต้องปิดงานให้แล้ว');

  const row = res.forms[0]._row;
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  await saveCleaningPhoto(ctx(), { row, unitSlot: 1, index: 1, dataUrl: png });

  const got = await getCleaningPhotos(ctx(), row);
  assert.deepEqual(Object.keys(got.photos), ['1-1']);

  // สถานะในแผนต้องไม่ขยับเพราะการแก้รูป
  const s = db.prepare("SELECT R2_Status s FROM plans WHERE AirCode = ?").get('AYA-WNI-AIR-1').s;
  assert.equal(s, 'ล้างเสร็จสิ้น');
});

test('เอกสารที่แนบเข้ามา แก้รูปแบบนี้ไม่ได้', async () => {
  // ใบแนบคือรูปถ่ายฟอร์มที่เขียนด้วยมือ ไม่มีกรอบรูป 9 ช่องให้แก้
  const db = freshDb();
  const photos = fakePhotoStore();

  await saveCleaningForm(ctxOf(db, { photos }), formPayload());
  db.prepare("UPDATE cleaning_forms SET Source = 'attach'").run();

  const row = db.prepare('SELECT rowid r FROM cleaning_forms').get().r + 1;
  await assert.rejects(
    () => getCleaningPhotos(ctxOf(db, { photos }), row),
    /เอกสารที่แนบเข้ามา/
  );
});

test('ไม่มีที่เก็บรูป ต้องคืนค่าว่าง ไม่ใช่พัง', async () => {
  // ฝั่งที่ไม่มีดิสก์ (Cloudflare) ไม่มี ctx.photos
  const db = freshDb();
  await saveCleaningForm(ctxOf(db), formPayload());
  assert.deepEqual(await getCleaningPhotos(ctxOf(db), 2), {});
});
