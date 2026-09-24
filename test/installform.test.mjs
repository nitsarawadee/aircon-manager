/**
 * บันทึกและจัดการเอกสารติดตั้ง
 *
 * ============================================================================
 * สิ่งที่ล็อกไว้ — เน้นจุดที่ต่างจากอีกสองเอกสาร
 * ============================================================================
 * - **เขียนข้อมูลเครื่องตัวใหม่กลับเข้าทะเบียน** จุดนี้ใบล้างกับใบซ่อมไม่ทำ
 *   ถ้าพลาด ทะเบียนจะค้างเป็นเครื่องเก่า แล้วเอกสารที่ออกทีหลังผิดตามทั้งหมด
 * - ช่องที่ช่างเว้นว่าง ต้องไม่ไปลบข้อมูลเดิมในทะเบียนทิ้ง
 * - สองเครื่องต่อใบ ได้เลขที่คนละเลข และต้องไม่ซ้ำกัน
 * - ลงประวัติ "ติดตั้ง" ให้ทุกเครื่องในใบ
 * - ตรวจรับไม่ผ่าน ต้องไม่ตั้งสถานะเครื่องเป็นใช้งานปกติ
 * - ไฟล์และรูปเก็บแยกโฟลเดอร์จากงานล้างและงานซ่อม
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { getHistory } from '../src/modules/history.js';
import { getAirList } from '../src/modules/airlist.js';
import {
  getInstallForms, saveInstallForm, deleteInstallForm,
  saveInstallPhoto, getInstallDocHtml, settleDocPdfQueue
} from '../src/modules/installform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');

  const add = db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status,
       Brand, BTU, IndoorSN, IndoorAsset, OutdoorSN, OutdoorAsset)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  add.run('KKN-CPE-AIR-1', 'ชุมแพ', 'KKN-CPE', '3', 'ขอนแก่น', 'Shop House', 'ใช้งานปกติ',
          'Carrier', 18000, 'เก่า-IN-1', 'เก่า-A-1', 'เก่า-OUT-1', 'เก่า-A-2');
  add.run('KKN-CPE-AIR-2', 'ชุมแพ', 'KKN-CPE', '3', 'ขอนแก่น', 'Shop House', 'ชำรุด',
          'Carrier', 18000, 'เก่า-IN-2', 'เก่า-A-3', 'เก่า-OUT-2', 'เก่า-A-4');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };

const ctxOf = (db, services = {}) => {
  const c = new Ctx({}, state, db, services);
  c.username = 'boss';
  return c;
};

const payload = (over = {}) => ({
  AirCode1: 'KKN-CPE-AIR-1',
  Date: '2026-09-24',
  TimeStart: '09:00', TimeEnd: '12:00', TotalTime: '3',
  Unit1_Brand: 'Daikin', Unit1_BTU: '24000',
  Unit1_IndoorSerial: 'ใหม่-IN-1', Unit1_IndoorAsset: 'ใหม่-A-1',
  Unit1_OutdoorSerial: 'ใหม่-OUT-1', Unit1_OutdoorAsset: 'ใหม่-A-2',
  AcceptResult1: 'ผ่าน',
  TechnicianName: 'ช่างสมชาย',
  CompanyName: 'หจก. ทดสอบ',
  Checklist: [{ no: 10, val1: '225' }],
  ...over
});

/** ที่เก็บรูปปลอม เก็บในหน่วยความจำ พร้อมจำว่าไฟล์ลงโฟลเดอร์ชนิดไหน */
function fakePhotos() {
  const files = new Map();
  return {
    kinds: new Set(),
    save(kind, doc, slot, i, dataUrl) {
      this.kinds.add(kind);
      files.set(kind + '|' + doc + '|' + slot + '-' + i, dataUrl);
      return { bytes: 10 };
    },
    remove(kind, doc, slot, i) { files.delete(kind + '|' + doc + '|' + slot + '-' + i); },
    removeAll(kind, doc) {
      for (const k of [...files.keys()]) if (k.startsWith(kind + '|' + doc + '|')) files.delete(k);
    },
    readAll(kind, doc) {
      const out = {};
      for (const [k, v] of files) {
        const p = k.split('|');
        if (p[0] === kind && p[1] === doc) out[p[2]] = v;
      }
      return out;
    }
  };
}

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const unitOf = async (db, code) =>
  (await getAirList(ctxOf(db))).find(u => u.AirCode === code);

/* ==================== บันทึก ==================== */

test('บันทึกแล้วได้เลขที่เอกสารจากชุดเลขเดียวกับทั้งระบบ', async () => {
  const db = freshDb();
  const res = await saveInstallForm(ctxOf(db), payload());

  assert.ok(/^CM\d{4}-\d+$/.test(res.docNo), 'ได้เลข ' + res.docNo);
  assert.equal(res.forms.length, 1);
});

test('ติดตั้งสองเครื่องในใบเดียว ได้เลขคนละเลข ไม่ซ้ำกัน', async () => {
  const db = freshDb();
  const res = await saveInstallForm(ctxOf(db), payload({
    AirCode2: 'KKN-CPE-AIR-2',
    Unit2_IndoorSerial: 'ใหม่-IN-2', AcceptResult2: 'ผ่าน'
  }));

  assert.ok(res.docNo, 'เครื่องที่ 1 ต้องมีเลข');
  assert.ok(res.docNo2, 'เครื่องที่ 2 ต้องมีเลข');
  assert.notEqual(res.docNo, res.docNo2, 'เลขสองเครื่องห้ามซ้ำกัน');
});

test('ไม่เลือกเครื่องเลย ต้องฟ้อง', async () => {
  const db = freshDb();
  await assert.rejects(
    () => saveInstallForm(ctxOf(db), payload({ AirCode1: '' })),
    /อย่างน้อย 1 เครื่อง/
  );
});

test('เลือกเครื่องซ้ำกันสองช่อง ต้องฟ้อง ไม่ใช่บันทึกซ้ำสองรอบ', async () => {
  const db = freshDb();
  await assert.rejects(
    () => saveInstallForm(ctxOf(db), payload({ AirCode2: 'KKN-CPE-AIR-1' })),
    /ซ้ำกัน/
  );
});

test('ไม่ใส่วันที่ ต้องฟ้อง', async () => {
  const db = freshDb();
  await assert.rejects(() => saveInstallForm(ctxOf(db), payload({ Date: '' })), /วันที่/);
});

/* ==================== เขียนกลับทะเบียน (จุดที่ต่างจากอีกสองเอกสาร) ==================== */

test('ข้อมูลเครื่องตัวใหม่ต้องถูกเขียนกลับเข้าทะเบียน', async () => {
  const db = freshDb();
  await saveInstallForm(ctxOf(db), payload());

  const unit = await unitOf(db, 'KKN-CPE-AIR-1');
  assert.equal(unit.IndoorSN, 'ใหม่-IN-1', 'Serial ในทะเบียนต้องเป็นของเครื่องตัวใหม่');
  assert.equal(unit.IndoorAsset, 'ใหม่-A-1');
  assert.equal(unit.OutdoorSN, 'ใหม่-OUT-1');
  assert.equal(unit.OutdoorAsset, 'ใหม่-A-2');
  assert.equal(unit.Brand, 'Daikin', 'ยี่ห้อต้องเปลี่ยนตามเครื่องใหม่');
  assert.equal(String(unit.BTU), '24000');
});

test('วันที่ติดตั้งในทะเบียนต้องอัปเดตตามใบนี้', async () => {
  const db = freshDb();
  await saveInstallForm(ctxOf(db), payload());

  const unit = await unitOf(db, 'KKN-CPE-AIR-1');
  assert.ok(String(unit.InstallDate).startsWith('2026-09-24'), 'ได้ ' + unit.InstallDate);
});

test('ช่องที่ช่างเว้นว่าง ต้องไม่ไปลบข้อมูลเดิมในทะเบียนทิ้ง', async () => {
  const db = freshDb();
  await saveInstallForm(ctxOf(db), payload({
    Unit1_IndoorSerial: 'ใหม่-IN-1',
    Unit1_IndoorAsset: '', Unit1_OutdoorSerial: '', Unit1_OutdoorAsset: '',
    Unit1_Brand: '', Unit1_BTU: ''
  }));

  const unit = await unitOf(db, 'KKN-CPE-AIR-1');
  assert.equal(unit.IndoorSN, 'ใหม่-IN-1', 'ช่องที่กรอกต้องเปลี่ยน');
  assert.equal(unit.IndoorAsset, 'เก่า-A-1', 'ช่องที่เว้นว่างต้องคงของเดิม');
  assert.equal(unit.OutdoorSN, 'เก่า-OUT-1');
  assert.equal(unit.Brand, 'Carrier');
});

test('ตรวจรับผ่าน เครื่องต้องกลับมาใช้งานปกติ', async () => {
  const db = freshDb();
  await saveInstallForm(ctxOf(db), payload({
    AirCode1: 'KKN-CPE-AIR-2',
    Unit1_IndoorSerial: 'ใหม่-IN-2',
    AcceptResult1: 'ผ่าน'
  }));

  const unit = await unitOf(db, 'KKN-CPE-AIR-2');
  assert.equal(unit.Status, 'ใช้งานปกติ');
});

test('ตรวจรับไม่ผ่าน ต้องไม่ตั้งสถานะเป็นใช้งานปกติ', async () => {
  // ไม่ผ่านแปลว่ายังมีอะไรต้องแก้ ถ้าตั้งเป็นปกติให้ เรื่องจะหลุดจากสายตาคนตามงาน
  const db = freshDb();
  await saveInstallForm(ctxOf(db), payload({
    AirCode1: 'KKN-CPE-AIR-2',
    Unit1_IndoorSerial: 'ใหม่-IN-2',
    AcceptResult1: 'ไม่ผ่าน'
  }));

  const unit = await unitOf(db, 'KKN-CPE-AIR-2');
  assert.equal(unit.Status, 'ชำรุด', 'ต้องคงสถานะเดิมไว้ให้คนตามต่อ');
});

test('ติดตั้งสองเครื่อง ทะเบียนต้องอัปเดตทั้งสองตัว ไม่สลับกัน', async () => {
  const db = freshDb();
  await saveInstallForm(ctxOf(db), payload({
    AirCode2: 'KKN-CPE-AIR-2',
    Unit2_IndoorSerial: 'ใหม่-IN-2', Unit2_IndoorAsset: 'ใหม่-A-3',
    Unit2_OutdoorSerial: 'ใหม่-OUT-2', Unit2_OutdoorAsset: 'ใหม่-A-4',
    AcceptResult2: 'ผ่าน'
  }));

  const u1 = await unitOf(db, 'KKN-CPE-AIR-1');
  const u2 = await unitOf(db, 'KKN-CPE-AIR-2');

  assert.equal(u1.IndoorSN, 'ใหม่-IN-1');
  assert.equal(u2.IndoorSN, 'ใหม่-IN-2');
  assert.equal(u1.OutdoorSN, 'ใหม่-OUT-1');
  assert.equal(u2.OutdoorSN, 'ใหม่-OUT-2');
});

/* ==================== ประวัติ ==================== */

test('ลงประวัติ "ติดตั้ง" ให้ทุกเครื่องในใบ', async () => {
  const db = freshDb();
  await saveInstallForm(ctxOf(db), payload({
    AirCode2: 'KKN-CPE-AIR-2', Unit2_IndoorSerial: 'ใหม่-IN-2', AcceptResult2: 'ผ่าน'
  }));

  const history = await getHistory(ctxOf(db));
  const installs = history.filter(h => h.EventType === 'ติดตั้ง');

  assert.equal(installs.length, 2, 'ต้องมีประวัติของทั้งสองเครื่อง');
  assert.deepEqual(
    installs.map(h => h.AirCode).sort(),
    ['KKN-CPE-AIR-1', 'KKN-CPE-AIR-2']
  );
});

test('ประวัติต้องอ้างเลขที่เอกสารของเครื่องตัวนั้น', async () => {
  const db = freshDb();
  const res = await saveInstallForm(ctxOf(db), payload({
    AirCode2: 'KKN-CPE-AIR-2', Unit2_IndoorSerial: 'ใหม่-IN-2'
  }));

  const history = await getHistory(ctxOf(db));
  const h1 = history.find(h => h.AirCode === 'KKN-CPE-AIR-1' && h.EventType === 'ติดตั้ง');
  const h2 = history.find(h => h.AirCode === 'KKN-CPE-AIR-2' && h.EventType === 'ติดตั้ง');

  assert.ok(h1.Note.includes(res.docNo), 'เครื่องที่ 1 ต้องอ้างเลขของตัวเอง');
  assert.ok(h2.Note.includes(res.docNo2), 'เครื่องที่ 2 ต้องอ้างเลขของตัวเอง');
});

test('ผลตรวจรับต้องติดไปในประวัติด้วย', async () => {
  const db = freshDb();
  await saveInstallForm(ctxOf(db), payload({ AcceptResult1: 'ไม่ผ่าน' }));

  const history = await getHistory(ctxOf(db));
  const h = history.find(h => h.EventType === 'ติดตั้ง');
  assert.ok(h.Detail.includes('ไม่ผ่าน'), 'ได้ ' + h.Detail);
});

/* ==================== รูปและไฟล์ ==================== */

test('รูปเก็บในโฟลเดอร์ของงานติดตั้ง ไม่ปนกับงานล้างหรืองานซ่อม', async () => {
  const db = freshDb();
  const photos = fakePhotos();
  const ctx = ctxOf(db, { photos });

  await saveInstallForm(ctx, payload());
  const [form] = await getInstallForms(ctx);
  await saveInstallPhoto(ctx, { row: form._row, slot: 1, index: 1, dataUrl: PNG });
  await settleDocPdfQueue();

  assert.deepEqual([...photos.kinds], ['install']);
});

test('รูปของเครื่องที่ 2 ต้องเก็บแยกจากเครื่องที่ 1', async () => {
  const db = freshDb();
  const photos = fakePhotos();
  const ctx = ctxOf(db, { photos });

  await saveInstallForm(ctx, payload({
    AirCode2: 'KKN-CPE-AIR-2', Unit2_IndoorSerial: 'ใหม่-IN-2'
  }));
  const [form] = await getInstallForms(ctx);

  await saveInstallPhoto(ctx, { row: form._row, slot: 1, index: 1, dataUrl: PNG });
  await saveInstallPhoto(ctx, { row: form._row, slot: 2, index: 1, dataUrl: PNG });
  await settleDocPdfQueue();

  const kept = photos.readAll('install', form.DocNo);
  assert.deepEqual(Object.keys(kept).sort(), ['1-1', '2-1']);
});

test('แนบรูปให้เครื่องที่ไม่มีในใบ ต้องฟ้อง', async () => {
  const db = freshDb();
  const ctx = ctxOf(db, { photos: fakePhotos() });

  await saveInstallForm(ctx, payload());   // มีเครื่องเดียว
  const [form] = await getInstallForms(ctx);

  await assert.rejects(
    () => saveInstallPhoto(ctx, { row: form._row, slot: 2, index: 1, dataUrl: PNG }),
    /ไม่มีเครื่องที่ 2/
  );
  await settleDocPdfQueue();
});

/* ==================== เอกสารและการลบ ==================== */

test('เปิดเอกสารได้ และเป็นแบบฟอร์มติดตั้งจริง', async () => {
  const db = freshDb();
  const ctx = ctxOf(db);

  await saveInstallForm(ctx, payload());
  const [form] = await getInstallForms(ctx);
  const html = await getInstallDocHtml(ctx, form._row);

  assert.ok(html.includes('ITEL-FM-NE-006'));
  assert.ok(html.includes('บันทึกผลการติดตั้งเครื่องปรับอากาศ'));
  assert.ok(html.includes('ใหม่-IN-1'), 'ต้องเห็น Serial ของเครื่องตัวใหม่');
});

test('ลบใบที่เลขแถวเลื่อนไปแล้ว ต้องไม่ไปโดนใบอื่น', async () => {
  const db = freshDb();
  const ctx = ctxOf(db);

  await saveInstallForm(ctx, payload());
  await saveInstallForm(ctx, payload({ AirCode1: 'KKN-CPE-AIR-2', Unit1_IndoorSerial: 'ใหม่-IN-2' }));

  const forms = await getInstallForms(ctx);
  const target = forms[0];

  await assert.rejects(
    () => deleteInstallForm(ctx, target._row, 'IF-ไม่มีจริง'),
    /เอกสารเลขที่/
  );

  assert.equal((await getInstallForms(ctx)).length, 2, 'ห้ามลบอะไรเมื่อตรวจไม่ผ่าน');
});

test('ลบใบที่ถูกต้อง ต้องลบได้จริง', async () => {
  const db = freshDb();
  const ctx = ctxOf(db);

  await saveInstallForm(ctx, payload());
  const [form] = await getInstallForms(ctx);

  const left = await deleteInstallForm(ctx, form._row, form.ID);
  assert.equal(left.length, 0);
});

test('กรองตามรหัสเครื่อง เจอทั้งใบที่เครื่องอยู่ช่อง 1 และช่อง 2', async () => {
  const db = freshDb();
  const ctx = ctxOf(db);

  await saveInstallForm(ctx, payload({
    AirCode2: 'KKN-CPE-AIR-2', Unit2_IndoorSerial: 'ใหม่-IN-2'
  }));

  assert.equal((await getInstallForms(ctx, 'KKN-CPE-AIR-1')).length, 1);
  assert.equal((await getInstallForms(ctx, 'KKN-CPE-AIR-2')).length, 1, 'ช่องที่ 2 ต้องค้นเจอด้วย');
});
