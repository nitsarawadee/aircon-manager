/**
 * ลิงก์กรอกเอกสารซ่อม — คนถือลิงก์กรอกได้โดยไม่ต้องล็อกอิน
 *
 * ============================================================================
 * ทำไมชุดนี้ต้องละเอียด
 * ============================================================================
 * คำสั่งของลิงก์เป็นคำสั่งเดียวในระบบที่ "ไม่ต้องล็อกอิน" แล้วเขียนข้อมูลได้
 * สิ่งเดียวที่กั้นไว้คือรหัสในลิงก์ ถ้าตรวจพลาดตรงไหน คนนอกจะปิดงานซ่อม
 * ของเครื่องไหนก็ได้ หรืออ่านข้อมูลในระบบได้โดยไม่มีบัญชี
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - ฐานข้อมูลเก็บแค่แฮช ไม่มีตัวรหัส
 * - ลิงก์หนึ่งปิดงานได้เฉพาะเครื่องของตัวเอง ส่งรหัสเครื่องอื่นมาก็ไม่มีผล
 * - ส่งได้ครั้งเดียว · หมดอายุได้ · ยกเลิกได้ · สร้างใหม่ = ของเก่าใช้ไม่ได้
 * - ลิงก์ที่ใช้ไม่ได้ ไม่ส่งข้อมูลเครื่องออกไป
 * - ส่งแล้วปิดงานเหมือนกรอกในระบบทุกอย่าง (ใบ + ประวัติ + คืนสถานะเครื่อง)
 * - งานที่เจ้าหน้าที่ปิดไปทางอื่นแล้ว ลิงก์ส่งไม่ได้
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import {
  getRepairLink, submitRepairLink, saveRepairLinkPhoto, getRepairLinkPdf,
  createRepairLink, getRepairLinks, revokeRepairLink
} from '../src/modules/repairlink.js';
import { saveRepairForm } from '../src/modules/repairform.js';
import { settleDocPdfQueue } from '../src/modules/doc-pdf-queue.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  const user = db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  user.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x', '');
  user.run('staff3', 'เจ้าหน้าที่ภาค 3', 'RegionAdmin', '3', '', 1, 'x', '');
  user.run('ctA', 'ช่างเอ', 'Contractor', '', '', 1, 'x', 'CT001');
  db.prepare("INSERT INTO contractors (ID, Name, Active) VALUES ('CT001','บริษัท เอ แอร์',1)").run();

  const unit = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, Note, Brand, BTU, IndoorSN)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  unit.run('AYA-WNI-AIR-1', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'รอซ่อม', 'ไม่เย็น มีน้ำหยด', 'Daikin', 18000, 'IN-1');
  unit.run('AYA-WNI-AIR-2', 'วังน้อย', 'AYA-WNI', '1', 'อยุธยา', 'รอซ่อม', 'คอมไม่ติด', 'Daikin', 18000, 'IN-2');
  unit.run('AYA-BPI-AIR-1', 'บางปะอิน', 'AYA-BPI', '1', 'อยุธยา', 'ใช้งานปกติ', '', 'LG', 12000, 'IN-3');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };

/** ctx ของเจ้าหน้าที่ที่ล็อกอินแล้ว */
const as = (db, username) => { const c = new Ctx({}, state, db, {}); c.username = username; return c; };

/** ctx ของคนถือลิงก์ — ไม่มีผู้ใช้ (เหมือนคำสั่งที่มาทาง /api/public) */
function publicCtx(db, services = {}) {
  return new Ctx({}, state, db, services);
}

/** ที่เก็บรูปในหน่วยความจำ แทนดิสก์ */
function memPhotos() {
  const store = {};
  return {
    save(kind, docNo, slot, index, dataUrl) {
      if (!(index >= 1 && index <= 9)) throw new Error('ช่องรูปต้องอยู่ระหว่าง 1 ถึง 9');
      (store[docNo] ||= {})[slot + '-' + index] = dataUrl;
      return { bytes: 1 };
    },
    readAll(kind, docNo) { return { ...(store[docNo] || {}) }; },
    remove() {}, removeAll() {}
  };
}

const repair = (over = {}) => ({
  Date: '2026-09-25', Symptom: 'ไม่เย็น', Cause: 'น้ำยารั่ว', Fix: 'เชื่อมท่อ เติมน้ำยา',
  Cost: 2500, CompanyName: 'บริษัท เอ แอร์', TechnicianName: 'ช่างเอ', Checklist: [], Parts: [],
  ...over
});

/* ==================== สร้างลิงก์ ==================== */

test('สร้างลิงก์ได้รหัสยาวสุ่ม และฐานข้อมูลเก็บแค่แฮช ไม่มีตัวรหัส', async () => {
  const db = freshDb();
  const link = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1', 7);

  assert.match(link.token, /^[A-Za-z0-9_-]{43}$/, '32 ไบต์ในรูป base64url');
  const row = db.prepare('SELECT * FROM repair_links').get();
  assert.equal(row.AirCode, 'AYA-WNI-AIR-1');
  assert.match(row.TokenHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(row).includes(link.token), 'ตัวรหัสต้องไม่อยู่ในฐานข้อมูลเลย');
});

test('สร้างลิงก์ได้เฉพาะงานที่อนุมัติซ่อมแล้ว (รอซ่อม)', async () => {
  await assert.rejects(() => createRepairLink(as(freshDb(), 'boss'), 'AYA-BPI-AIR-1'), /อนุมัติซ่อมแล้ว/);
});

test('ผู้รับเหมาและเจ้าหน้าที่ต่างภาค สร้างลิงก์ไม่ได้', async () => {
  const db = freshDb();
  await assert.rejects(() => createRepairLink(as(db, 'ctA'), 'AYA-WNI-AIR-1'), /ผู้รับเหมา/);
  await assert.rejects(() => createRepairLink(as(db, 'staff3'), 'AYA-WNI-AIR-1'), /ไม่พบเครื่อง/);
});

test('สร้างลิงก์ใหม่ของงานเดิม — ลิงก์เก่าใช้ไม่ได้ทันที', async () => {
  const db = freshDb();
  const old = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  const fresh = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');

  assert.equal((await getRepairLink(publicCtx(db), old.token)).state, 'revoked');
  assert.equal((await getRepairLink(publicCtx(db), fresh.token)).state, 'open');
  await assert.rejects(() => submitRepairLink(publicCtx(db), old.token, repair()), /ยกเลิก/);
});

test('รายการลิงก์ของเจ้าหน้าที่ ไม่มีรหัสและไม่มีแฮช', async () => {
  const db = freshDb();
  const link = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  const list = await getRepairLinks(as(db, 'boss'));

  assert.equal(list.length, 1);
  assert.equal(list[0].state, 'open');
  assert.equal(list[0].TokenHash, undefined);
  assert.ok(!JSON.stringify(list).includes(link.token));
});

/* ==================== เปิดลิงก์ ==================== */

test('เปิดลิงก์ได้ข้อมูลเครื่องของงานนั้น พร้อมอาการที่แจ้งไว้', async () => {
  const db = freshDb();
  const { token } = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  const info = await getRepairLink(publicCtx(db), token);

  assert.equal(info.state, 'open');
  assert.equal(info.unit.AirCode, 'AYA-WNI-AIR-1');
  assert.equal(info.unit.Note, 'ไม่เย็น มีน้ำหยด');
});

test('รหัสผิด / สั้น / แปลก — ตอบว่าไม่ถูกต้อง และไม่มีข้อมูลเครื่องหลุดออกไป', async () => {
  const db = freshDb();
  await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');

  for (const bad of ['', 'abc', 'x'.repeat(43), "' OR 1=1 --", null]) {
    const info = await getRepairLink(publicCtx(db), bad);
    assert.equal(info.state, 'invalid');
    assert.equal(info.unit, undefined);
  }
});

test('ลิงก์หมดอายุ — ไม่มีข้อมูลเครื่อง และส่งไม่ได้', async () => {
  const db = freshDb();
  const { token } = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  db.prepare("UPDATE repair_links SET ExpiresAt = '2020-01-01 00:00:00'").run();

  const info = await getRepairLink(publicCtx(db), token);
  assert.equal(info.state, 'expired');
  assert.equal(info.unit, undefined);
  await assert.rejects(() => submitRepairLink(publicCtx(db), token, repair()), /หมดอายุ/);
});

test('เจ้าหน้าที่ยกเลิกลิงก์ — ส่งไม่ได้', async () => {
  const db = freshDb();
  const link = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  await revokeRepairLink(as(db, 'boss'), link.id);

  assert.equal((await getRepairLink(publicCtx(db), link.token)).state, 'revoked');
  await assert.rejects(() => submitRepairLink(publicCtx(db), link.token, repair()), /ยกเลิก/);
});

/* ==================== ส่งเอกสาร ==================== */

test('ส่งผ่านลิงก์ = ปิดงานซ่อมเหมือนกรอกในระบบ', async () => {
  const db = freshDb();
  const { token } = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');

  const res = await submitRepairLink(publicCtx(db), token, repair());
  assert.match(res.docNo, /^CM/);

  const form = db.prepare('SELECT * FROM repair_forms').get();
  assert.equal(form.AirCode, 'AYA-WNI-AIR-1');
  assert.equal(form.Fix, 'เชื่อมท่อ เติมน้ำยา');
  assert.match(form.RecordedBy, /^ลิงก์ RL\d+ \(สร้างโดย boss\)$/, 'ต้องย้อนดูได้ว่ามาจากลิงก์ไหน');

  const unit = db.prepare("SELECT Status, Note FROM air_units WHERE AirCode = 'AYA-WNI-AIR-1'").get();
  assert.equal(unit.Status, 'ใช้งานปกติ', 'เครื่องต้องกลับมาใช้งานปกติ');
  assert.equal(unit.Note, '');

  const hist = db.prepare("SELECT * FROM history WHERE AirCode = 'AYA-WNI-AIR-1'").get();
  assert.equal(hist.EventType, 'ซ่อมแล้ว');
  assert.match(hist.Detail, /อาการที่แจ้งไว้: ไม่เย็น มีน้ำหยด/, 'อาการตอนเปิดงานต้องไม่หาย');
  assert.match(hist.RecordedBy, /^ลิงก์ RL/);
});

test('ส่งได้ครั้งเดียว — กดส่งซ้ำไม่ได้ใบที่สอง', async () => {
  const db = freshDb();
  const { token } = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  const first = await submitRepairLink(publicCtx(db), token, repair());

  await assert.rejects(() => submitRepairLink(publicCtx(db), token, repair()), new RegExp(first.docNo));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM repair_forms').get().n, 1);
});

test('ส่งรหัสเครื่องอื่นมาในข้อมูล — ต้องปิดงานของเครื่องในลิงก์เท่านั้น', async () => {
  const db = freshDb();
  const { token } = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  await submitRepairLink(publicCtx(db), token, repair({ AirCode: 'AYA-WNI-AIR-2' }));

  assert.equal(db.prepare('SELECT AirCode FROM repair_forms').get().AirCode, 'AYA-WNI-AIR-1');
  const other = db.prepare("SELECT Status FROM air_units WHERE AirCode = 'AYA-WNI-AIR-2'").get();
  assert.equal(other.Status, 'รอซ่อม', 'งานของเครื่องอื่นต้องไม่ถูกปิด');
});

test('ช่องที่จำเป็นว่าง — ส่งไม่ได้ และลิงก์ยังใช้ได้อยู่', async () => {
  const db = freshDb();
  const { token } = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');

  await assert.rejects(() => submitRepairLink(publicCtx(db), token, repair({ Fix: '  ' })), /การแก้ไข/);
  await assert.rejects(() => submitRepairLink(publicCtx(db), token, repair({ Date: '' })), /วันที่/);
  assert.equal((await getRepairLink(publicCtx(db), token)).state, 'open');
});

test('เจ้าหน้าที่ปิดงานเองไปก่อนแล้ว — ลิงก์ส่งไม่ได้', async () => {
  const db = freshDb();
  const { token } = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  await saveRepairForm(as(db, 'boss'), { ...repair(), AirCode: 'AYA-WNI-AIR-1' });

  assert.equal((await getRepairLink(publicCtx(db), token)).state, 'closed');
  await assert.rejects(() => submitRepairLink(publicCtx(db), token, repair()), /ถูกปิดไปแล้ว/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM repair_forms').get().n, 1);
});

/* ==================== หลังส่ง: รูปกับ PDF ==================== */

test('แนบรูปได้หลังส่งแล้วเท่านั้น และลงใบของลิงก์นั้น', async () => {
  const db = freshDb();
  const photos = memPhotos();
  const { token } = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  const pub = () => publicCtx(db, { photos });

  await assert.rejects(() => saveRepairLinkPhoto(pub(), token, 1, 'data:image/jpeg;base64,AAAA'), /ใช้ทำรายการนี้ไม่ได้/);

  const { docNo } = await submitRepairLink(pub(), token, repair());
  const res = await saveRepairLinkPhoto(pub(), token, 3, 'data:image/jpeg;base64,AAAA');
  await settleDocPdfQueue();

  assert.deepEqual(res.photos, ['1-3']);
  assert.deepEqual(Object.keys(photos.readAll('repair', docNo)), ['1-3']);
  const info = await getRepairLink(pub(), token);
  assert.equal(info.state, 'done');
  assert.equal(info.docNo, docNo);
  assert.deepEqual(info.photos, ['1-3']);
});

test('โหลด PDF ได้หลังส่ง — ก่อนส่งไม่ได้', async () => {
  const db = freshDb();
  let rendered = '';
  const pdf = { baseUrl: '', async render(html) { rendered = html; return 'UERG'; } };
  const { token } = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');

  await assert.rejects(() => getRepairLinkPdf(publicCtx(db, { pdf }), token));
  const { docNo } = await submitRepairLink(publicCtx(db), token, repair());

  const file = await getRepairLinkPdf(publicCtx(db, { pdf }), token);
  assert.equal(file.fileName, docNo + '.pdf');
  assert.equal(file.base64, 'UERG');
  assert.ok(rendered.includes('เชื่อมท่อ เติมน้ำยา'), 'ต้องเป็นเอกสารของใบที่ส่งจริง');
});

test('พ้นช่วงหลังส่งแล้ว — ลิงก์ปิด แนบรูปหรือโหลด PDF ไม่ได้อีก', async () => {
  const db = freshDb();
  const photos = memPhotos();
  const { token } = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  await submitRepairLink(publicCtx(db), token, repair());
  db.prepare("UPDATE repair_links SET UsedAt = '2020-01-01 00:00:00', ExpiresAt = '2020-01-02 00:00:00'").run();

  const info = await getRepairLink(publicCtx(db), token);
  assert.equal(info.state, 'closed');
  assert.equal(info.unit, undefined);
  await assert.rejects(() => saveRepairLinkPhoto(publicCtx(db, { photos }), token, 1, 'data:image/jpeg;base64,AAAA'), /ลิงก์ปิดแล้ว/);
});

test('ลิงก์ที่ส่งไปแล้ว เจ้าหน้าที่ยกเลิกไม่ได้', async () => {
  const db = freshDb();
  const link = await createRepairLink(as(db, 'boss'), 'AYA-WNI-AIR-1');
  await submitRepairLink(publicCtx(db), link.token, repair());

  await assert.rejects(() => revokeRepairLink(as(db, 'boss'), link.id), /ส่งเอกสารไปแล้ว/);
});

/* ==================== ผ่านทาง API จริง ==================== */

test('คำสั่งของลิงก์เรียกได้ทาง /api/public ส่วนการสร้างลิงก์ต้องล็อกอิน', async () => {
  const { handleApi } = await import('../src/api.js');
  const db = freshDb();
  const sessions = { async touchSession(t) { return t === 'tok-boss' ? 'boss' : ''; } };
  const st = { ...state, ...sessions };

  const denied = await handleApi({ pathname: '/api/public', body: { fn: 'createRepairLink', args: ['AYA-WNI-AIR-1'] }, env: {}, state: st, db });
  assert.equal(denied.status, 404, 'สร้างลิงก์ต้องไม่อยู่ในคำสั่งที่ไม่ต้องล็อกอิน');

  const made = await handleApi({ pathname: '/api/call', body: { token: 'tok-boss', fn: 'createRepairLink', args: ['AYA-WNI-AIR-1'] }, env: {}, state: st, db });
  assert.equal(made.status, 200);

  const opened = await handleApi({ pathname: '/api/public', body: { fn: 'getRepairLink', args: [made.payload.result.token] }, env: {}, state: st, db });
  assert.equal(opened.payload.result.state, 'open');
});
