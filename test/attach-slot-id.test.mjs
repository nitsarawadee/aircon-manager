/**
 * แนบเอกสารล้าง — ใช้ตรรกะเดียวกับกรอกฟอร์ม (16/10/2569)
 *
 * เดิม uploadNodeDocuments
 *   - ใช้ ID 'CF' + เวลา ตรงๆ (ไม่ใช่ freshFormId) สองใบในมิลลิวินาทีเดียวกันได้ ID ซ้ำ
 *     ขั้นอนุมัติผูกกับ ID — ซ้ำแล้วอนุมัติใบหนึ่งไปโดนอีกใบ
 *   - วางเครื่องตามลำดับที่เลือก ไม่ใช่เลขเครื่อง แนบ AIR-2 ตัวเดียวได้ AIR-2 ในช่องที่ 1
 *   - ไม่ตรวจคู่เครื่อง แนบ AIR-1 กับ AIR-3 ได้ในใบเดียว
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { uploadNodeDocuments, getCleaningAttachments, getCleaningForms } from '../src/modules/cleaningform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const unit = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, Brand)
      VALUES (?,?,?,?,?,?,?,?)`);
  for (const n of [1, 2, 3]) unit.run('ATG-PMK-AIR-' + n, 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'ยี่ห้อ' + n);
  const plan = db.prepare("INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_Status) VALUES (2026, ?, 'ป่าโมก', 'ATG-PMK', 'นัดหมายแล้ว')");
  for (const n of [1, 2, 3]) plan.run('ATG-PMK-AIR-' + n);
  return db;
}

/** ที่เก็บไฟล์จำลอง — จำว่าเก็บไว้ใต้ชื่อไหน ตัวเปิดไฟล์ต้องหาเจอด้วยชื่อเดียวกัน */
function fakeStore() {
  const saved = new Map();
  return {
    saved,
    save(key, date, files) { saved.set(key, files.map(f => ({ name: f.name }))); return saved.get(key); },
    list(key) { return saved.get(key) || []; },
    read() { return null; },
    removeAll(key) { saved.delete(key); }
  };
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = (db, store) => { const c = new Ctx({}, state, db, { attachments: store }); c.username = 'boss'; return c; };
const payload = codes => ({
  nodeName: 'ป่าโมก', files: [{ name: 'ใบล้าง.jpg', mimeType: 'image/jpeg', data: 'AA==' }],
  closeout: { date: '2026-09-15', year: 2026, round: 1, units: codes.map(c => ({ airCode: c, price: 500, condition: 'ปกติ' })) }
});
const forms = db => db.prepare('SELECT ID, DocNo, DocNo2, AirCode1, AirCode2, Unit1_Brand, Unit2_Brand, SlotBase FROM cleaning_forms').all().map(r => ({ ...r }));

test('แนบ AIR-2 ตัวเดียว — ลงช่องที่ 2 ได้เลข DocNo2 ไฟล์เปิดได้จากตาราง', async () => {
  const db = freshDb(), store = fakeStore();
  const res = await uploadNodeDocuments(ctxOf(db, store), payload(['ATG-PMK-AIR-2']));

  const [f] = forms(db);
  assert.equal(f.AirCode1, '');
  assert.equal(f.AirCode2, 'ATG-PMK-AIR-2');
  assert.equal(f.DocNo, '');
  assert.equal(f.DocNo2, 'PM2609-01');
  assert.equal(f.Unit1_Brand, '');
  assert.equal(f.Unit2_Brand, 'ยี่ห้อ2');
  assert.equal(res.docNo, 'PM2609-01');

  const row = (await getCleaningForms(ctxOf(db, store)))[0]._row;
  assert.deepEqual(await getCleaningAttachments(ctxOf(db, store), row), [{ name: 'ใบล้าง.jpg' }],
    'ไฟล์ต้องเก็บใต้ชื่อเดียวกับที่ตัวเปิดไฟล์หา');
});

test('เลือก AIR-2 ก่อน AIR-1 — ยังลงช่องตามเลขเครื่อง', async () => {
  const db = freshDb();
  await uploadNodeDocuments(ctxOf(db, fakeStore()), payload(['ATG-PMK-AIR-2', 'ATG-PMK-AIR-1']));
  const [f] = forms(db);
  assert.deepEqual([f.AirCode1, f.AirCode2, f.Unit1_Brand, f.Unit2_Brand], ['ATG-PMK-AIR-1', 'ATG-PMK-AIR-2', 'ยี่ห้อ1', 'ยี่ห้อ2']);
});

test('AIR-1 กับ AIR-3 คนละคู่ — ปฏิเสธ ไม่เขียนอะไร · AIR-3 ตัวเดียวได้ใบคู่ 3–4', async () => {
  const db = freshDb(), store = fakeStore();
  await assert.rejects(() => uploadNodeDocuments(ctxOf(db, store), payload(['ATG-PMK-AIR-1', 'ATG-PMK-AIR-3'])),
    /เครื่องที่เลือกอยู่คนละใบ/);
  assert.equal(forms(db).length, 0);
  assert.equal(store.saved.size, 0, 'ต้องไม่เก็บไฟล์ก่อนตรวจผ่าน');

  await uploadNodeDocuments(ctxOf(db, store), payload(['ATG-PMK-AIR-3']));
  const [f] = forms(db);
  assert.deepEqual([f.AirCode1, f.SlotBase], ['ATG-PMK-AIR-3', 2]);
});

test('ID ของใบแนบไม่ซ้ำ แม้ส่งสองใบในมิลลิวินาทีเดียวกัน', async () => {
  const db = freshDb();
  const realNow = Date.now;
  Date.now = () => 1790000000000;   // ตรึงเวลา — แบบเดิมจะได้ CF1790000000000 ทั้งสองใบ
  try {
    await uploadNodeDocuments(ctxOf(db, fakeStore()), payload(['ATG-PMK-AIR-1']));
    await uploadNodeDocuments(ctxOf(db, fakeStore()), payload(['ATG-PMK-AIR-2']));
  } finally {
    Date.now = realNow;
  }
  const ids = forms(db).map(f => f.ID);
  assert.equal(new Set(ids).size, 2, 'ID ซ้ำ: ' + ids.join(', '));
  const apv = db.prepare("SELECT FormID FROM doc_approvals WHERE DocKind = 'cleaning'").all().map(r => r.FormID);
  assert.deepEqual(apv.sort(), [...ids].sort(), 'ขั้นอนุมัติต้องผูกกับใบละแถว');
});
