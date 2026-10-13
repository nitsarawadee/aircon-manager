/**
 * บันทึกและจัดการเอกสารซ่อม
 *
 * ============================================================================
 * สิ่งที่ล็อกไว้
 * ============================================================================
 * - บันทึกแล้วต้องได้เลขที่เอกสารขึ้นต้น CM จากชุดเลขเดียวกับทั้งระบบ
 * - เลขต้องไม่ซ้ำกับใบประวัติหรือเอกสารล้าง (ทั้งสามใช้ชุดเดียวกัน)
 * - ต้องลงประวัติ "ซ่อมแล้ว" ให้เอง ซึ่งเป็นตัวปิดเคสตามกติกาเดิม
 * - ต้องเกาะเคสที่เปิดค้างอยู่ของเครื่องนั้น ไม่ใช่เปิดเคสใหม่ทุกครั้ง
 * - ไม่มีการรวมใบ — ซ่อมสองครั้งคือสองใบเสมอ แม้เครื่องเดียวกันวันเดียวกัน
 * - ไฟล์และรูปเก็บแยกโฟลเดอร์จากงานล้าง
 * - ลบใบต้องตรวจก่อนว่าแถวนั้นยังเป็นใบเดิม (ลำดับแถวเลื่อนได้)
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { getHistory } from '../src/modules/history.js';
import { saveCleaningForm } from '../src/modules/cleaningform.js';
import {
  getRepairForms, saveRepairForm, deleteRepairForm,
  saveRepairPhoto, getRepairPhotos, getRepairDocHtml, settleDocPdfQueue
} from '../src/modules/repairform.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');

  db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, Brand, BTU, IndoorSN, OutdoorSN)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run('KKN-CPE-AIR-1', 'ชุมแพ', 'KKN-CPE', '3', 'ขอนแก่น', 'Shop House', 'รอซ่อม',
         'Carrier', 18000, 'IN-111', 'OUT-111');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };

const ctxOf = (db, services = {}) => {
  const c = new Ctx({}, state, db, services);
  c.username = 'boss';
  return c;
};

/** ส่งเอกสารซ่อมได้เฉพาะเครื่องที่ "รอซ่อม" — ใบแรกปิดงานไปแล้ว ใบถัดไปต้องอนุมัติซ่อมใหม่ */
const readyForRepair = db => db.exec("UPDATE air_units SET Status = 'รอซ่อม' WHERE AirCode = 'KKN-CPE-AIR-1'");

const payload = (over = {}) => ({
  AirCode: 'KKN-CPE-AIR-1',
  Date: '2026-09-22',
  Symptom: 'แอร์ไม่เย็น',
  Cause: 'ท่อน้ำทิ้งอุดตัน',
  Fix: 'ล้างท่อน้ำทิ้ง',
  Suggestion: 'ล้างท่อทุกรอบ',
  TechnicianName: 'ช่างสมชาย',
  CompanyName: 'หจก. ทดสอบ',
  Cost: 850,
  Checklist: [{ no: 1, value: '225' }],
  Parts: [{ name: 'ข้อต่อแป๊บ', qty: '2' }],
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

/* ==================== บันทึก ==================== */

test('บันทึกแล้วต้องได้เลขที่เอกสารขึ้นต้น CM', async () => {
  const db = freshDb();
  const res = await saveRepairForm(ctxOf(db), payload());

  assert.ok(/^CM\d{4}-\d+$/.test(res.docNo), 'ได้เลข ' + res.docNo);
  assert.equal(res.forms.length, 1);
});

test('ข้อมูลเครื่องต้องถูกดึงจากทะเบียนมาเติมให้เอง', async () => {
  // หน้าเว็บส่งมาแค่รหัสเครื่อง ที่เหลือต้องมาจากทะเบียน จะได้ไม่มีสองความจริง
  const db = freshDb();
  await saveRepairForm(ctxOf(db), payload());

  const [form] = await getRepairForms(ctxOf(db));
  assert.equal(form.NodeName, 'ชุมแพ');
  assert.equal(form.Province, 'ขอนแก่น');
  assert.equal(form.Brand, 'Carrier');
  assert.equal(String(form.BTU), '18000');
  assert.equal(form.IndoorSerial, 'IN-111');
  assert.equal(form.Region, '3');
});

test('ไม่มีเครื่องรหัสนั้นในทะเบียน ต้องฟ้อง', async () => {
  const db = freshDb();
  await assert.rejects(() => saveRepairForm(ctxOf(db), payload({ AirCode: 'XXX-1' })), /ไม่พบเครื่องรหัส/);
});

test('ไม่ระบุเครื่องหรือวันที่ ต้องฟ้องก่อนเขียนอะไรลงไป', async () => {
  const db = freshDb();
  await assert.rejects(() => saveRepairForm(ctxOf(db), payload({ AirCode: '' })), /กรุณาเลือกเครื่อง/);
  await assert.rejects(() => saveRepairForm(ctxOf(db), payload({ Date: '' })), /กรุณาระบุวันที่/);

  assert.equal(db.prepare('SELECT COUNT(*) c FROM repair_forms').get().c, 0);
});

/* ==================== ประวัติและเคส ==================== */

test('บันทึกแล้วต้องลงประวัติ "ซ่อมแล้ว" ให้เอง', async () => {
  const db = freshDb();
  const res = await saveRepairForm(ctxOf(db), payload());

  const hist = await getHistory(ctxOf(db));
  assert.equal(hist.length, 1);
  assert.equal(hist[0].EventType, 'ซ่อมแล้ว');
  assert.equal(hist[0].AirCode, 'KKN-CPE-AIR-1');
  assert.equal(Number(hist[0].Cost), 850);
  assert.ok(String(hist[0].Note).includes(res.docNo), 'ประวัติต้องอ้างถึงเลขเอกสาร');
});

test('ต้องเกาะเคสที่เปิดค้างอยู่ ไม่ใช่เปิดเคสใหม่', async () => {
  // ช่างแจ้งซ่อมไว้ก่อน แล้วค่อยมาออกเอกสารตอนซ่อมเสร็จ ต้องเป็นเคสเดียวกัน
  const db = freshDb();
  db.prepare(
    'INSERT INTO history (ID, AirCode, Date, EventType, Detail, CaseID) VALUES (?,?,?,?,?,?)'
  ).run('CM2609-01', 'KKN-CPE-AIR-1', '2026-09-20', 'แจ้งซ่อม', 'แอร์ไม่เย็น', 'CASE-2609-01');

  const res = await saveRepairForm(ctxOf(db), payload());

  assert.equal(res.caseId, 'CASE-2609-01', 'ต้องใช้เคสเดิม');
  const [form] = await getRepairForms(ctxOf(db));
  assert.equal(form.CaseID, 'CASE-2609-01');
});

test('ไม่มีเคสเปิดอยู่ ต้องเปิดเคสใหม่ให้ ไม่ใช่ปฏิเสธ', async () => {
  // ช่างซ่อมหน้างานเลยโดยไม่ได้แจ้งล่วงหน้าเป็นเรื่องที่เกิดจริง
  const db = freshDb();
  const res = await saveRepairForm(ctxOf(db), payload());

  assert.ok(res.caseId, 'ต้องได้เลขเคส');
});

/* ==================== เลขเอกสารต้องไม่ซ้ำ ==================== */

test('เลขเอกสารซ่อมต้องไม่ซ้ำกับใบประวัติที่ออกไปแล้ว', async () => {
  const db = freshDb();
  const a = await saveRepairForm(ctxOf(db), payload());
  readyForRepair(db);
  const b = await saveRepairForm(ctxOf(db), payload());

  const hist = await getHistory(ctxOf(db));
  const all = [a.docNo, b.docNo, ...hist.map(h => h.ID)];

  assert.equal(new Set(all).size, all.length, 'เลขซ้ำกัน: ' + all.join(', '));
});

test('เลขเอกสารซ่อมต้องไม่ซ้ำกับเอกสารล้าง', async () => {
  // ทั้งสองใช้ชุดเลขเดียวกัน ถ้าตัวนับไม่เห็นใบซ่อม เลขจะถูกออกซ้ำ
  const db = freshDb();
  db.prepare(
    'INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_PlanDate, R1_Status) VALUES (?,?,?,?,?,?)'
  ).run(2026, 'KKN-CPE-AIR-1', 'ชุมแพ', 'KKN-CPE', '2026-09-10', 'รอดำเนินการ');

  const r1 = await saveRepairForm(ctxOf(db), payload());
  const c = await saveCleaningForm(ctxOf(db), {
    NodeName: 'ชุมแพ', SiteCode: 'KKN-CPE', Region: '3', Province: 'ขอนแก่น',
    Date: '2026-09-22', PlanYear: 2026, PlanRound: 1,
    AirCode1: 'KKN-CPE-AIR-1', Price1: 450, Checklist: []
  });
  readyForRepair(db);
  const r2 = await saveRepairForm(ctxOf(db), payload());

  const all = [r1.docNo, c.docNo, r2.docNo];
  assert.equal(new Set(all).size, 3, 'เลขซ้ำกัน: ' + all.join(', '));
});

/* ==================== ไม่มีการรวมใบ ==================== */

test('ซ่อมเครื่องเดียวกันวันเดียวกันสองครั้ง ต้องได้สองใบ', async () => {
  // ต่างจากใบล้างที่รวมใบ เพราะซ่อมสองครั้งคือสองเหตุการณ์ ไม่ใช่งานเดียวต่อเนื่อง
  const db = freshDb();
  await saveRepairForm(ctxOf(db), payload({ Symptom: 'ไม่เย็น' }));
  readyForRepair(db);
  await saveRepairForm(ctxOf(db), payload({ Symptom: 'มีเสียงดัง' }));

  const forms = await getRepairForms(ctxOf(db));
  assert.equal(forms.length, 2);
  assert.notEqual(forms[0].DocNo, forms[1].DocNo);
});

/* ==================== รูปถ่าย ==================== */

test('รูปของใบซ่อมต้องลงโฟลเดอร์ของงานซ่อม ไม่ปนกับงานล้าง', async () => {
  const db = freshDb();
  const photos = fakePhotos();
  const ctx = () => ctxOf(db, { photos });

  const res = await saveRepairForm(ctx(), payload());
  const [form] = await getRepairForms(ctx());
  await saveRepairPhoto(ctx(), { row: form._row, index: 3, dataUrl: PNG });

  assert.deepEqual([...photos.kinds], ['repair'], 'ต้องลงชนิด repair เท่านั้น');
  const got = await getRepairPhotos(ctx(), form._row);
  assert.equal(got.docNo, res.docNo);
  assert.deepEqual(Object.keys(got.photos), ['1-3'], 'ใบซ่อมมีเครื่องเดียว รูปอยู่ช่องที่ 1 เสมอ');
});

/* ==================== เอกสาร ==================== */

test('เปิดเอกสารได้ และต้องเป็นแบบฟอร์มซ่อม', async () => {
  const db = freshDb();
  await saveRepairForm(ctxOf(db), payload());
  const [form] = await getRepairForms(ctxOf(db));

  const html = await getRepairDocHtml(ctxOf(db), form._row);
  assert.ok(html.includes('บันทึกผลการซ่อมเครื่องปรับอากาศ'));
  assert.ok(html.includes('ITEL-FM-NE-005'));
  assert.ok(html.includes('แอร์ไม่เย็น'), 'อาการเสียที่กรอกไว้ต้องขึ้น');
  assert.ok(html.includes('ข้อต่อแป๊บ'), 'อะไหล่ที่กรอกไว้ต้องขึ้น');
});

/* ==================== ลบ ==================== */

test('ลบใบแล้วต้องหายจากรายการ และไฟล์ต้องถูกลบตาม', async () => {
  const db = freshDb();
  const photos = fakePhotos();
  const ctx = () => ctxOf(db, { photos });

  const res = await saveRepairForm(ctx(), payload());
  const [form] = await getRepairForms(ctx());
  await saveRepairPhoto(ctx(), { row: form._row, index: 1, dataUrl: PNG });

  const left = await deleteRepairForm(ctx(), form._row, form.ID);

  assert.equal(left.length, 0);
  assert.deepEqual(photos.readAll('repair', res.docNo), {}, 'รูปต้องถูกลบตาม');
});

test('ลบผิดใบไม่ได้ — ต้องตรงกับเลขที่ส่งมาด้วย', async () => {
  // ลำดับแถวเลื่อนได้ถ้ามีคนลบใบข้างบนไประหว่างที่อีกคนเปิดหน้าค้างไว้
  const db = freshDb();
  await saveRepairForm(ctxOf(db), payload());
  const [form] = await getRepairForms(ctxOf(db));

  await assert.rejects(() => deleteRepairForm(ctxOf(db), form._row, 'RF-ใบอื่น'));
  assert.equal((await getRepairForms(ctxOf(db))).length, 1, 'ต้องยังอยู่ครบ');
});

/* ==================== สิ่งที่ต้องไม่กระทบกัน ==================== */

test('ตารางเอกสารล้างต้องไม่ถูกแตะเลย', async () => {
  const db = freshDb();
  await saveRepairForm(ctxOf(db), payload());

  assert.equal(db.prepare('SELECT COUNT(*) c FROM cleaning_forms').get().c, 0);
});

test('ไม่มีที่เก็บไฟล์ ต้องยังบันทึกได้ตามปกติ', async () => {
  // ฝั่งที่ไม่มีดิสก์ ไฟล์เป็นแค่สำเนา ห้ามทำให้การบันทึกล้มเหลว
  const db = freshDb();
  const res = await saveRepairForm(ctxOf(db), payload());
  await settleDocPdfQueue();

  assert.ok(res.docNo);
  assert.equal((await getRepairForms(ctxOf(db))).length, 1);
});

/* ==================== ปิดงานจริง ไม่ใช่แค่ลงประวัติ ==================== */

test('ออกเอกสารแล้ว สถานะเครื่องต้องกลับเป็น "ใช้งานปกติ"', async () => {
  // ข้อนี้สำคัญที่สุดในไฟล์ — เจ้าของงานให้เอาปุ่ม "ปิดงานอย่างเดียว" ออก
  // การออกเอกสารจึงเป็นทางเดียวที่ปิดงานซ่อมได้ ถ้าไม่คืนสถานะ เครื่องจะค้าง
  // เป็น "รอซ่อม" ตลอดไป และไม่มีทางปิดงานได้อีกเลย
  const db = freshDb();
  assert.equal(db.prepare('SELECT Status s FROM air_units WHERE AirCode = ?').get('KKN-CPE-AIR-1').s, 'รอซ่อม');

  await saveRepairForm(ctxOf(db), payload());

  const after = db.prepare('SELECT Status s, Note n FROM air_units WHERE AirCode = ?').get('KKN-CPE-AIR-1');
  assert.equal(after.s, 'ใช้งานปกติ');
  assert.equal(String(after.n || ''), '', 'อาการที่แจ้งไว้ต้องถูกล้างออกจากข้อมูลเครื่อง');
});

test('อาการที่แจ้งไว้ต้องไม่หายไปจากระบบ ต้องย้ายไปอยู่ในประวัติ', async () => {
  // ล้าง Note ทิ้งโดยไม่เก็บไว้ที่ไหน = อาการเสียที่แจ้งไว้หายไปทั้งระบบ
  const db = freshDb();
  db.prepare("UPDATE air_units SET Note = ? WHERE AirCode = ?").run('คอมเพรสเซอร์ไม่ทำงาน', 'KKN-CPE-AIR-1');

  await saveRepairForm(ctxOf(db), payload({ Symptom: 'ไม่เย็นเลย' }));

  const [h] = await getHistory(ctxOf(db));
  assert.ok(String(h.Detail).includes('คอมเพรสเซอร์ไม่ทำงาน'), 'ได้ ' + h.Detail);
  assert.ok(String(h.Detail).includes('ไม่เย็นเลย'), 'อาการที่ช่างกรอกก็ต้องอยู่ด้วย');
});

test('คนกรอกลบอาการที่แจ้งไว้ทิ้ง ก็ต้องยังเก็บไว้ในประวัติ', async () => {
  // ไม่พึ่งข้อความที่หน้าเว็บส่งมา เพราะคนกรอกแก้ได้
  const db = freshDb();
  db.prepare("UPDATE air_units SET Note = ? WHERE AirCode = ?").run('น้ำยารั่ว', 'KKN-CPE-AIR-1');

  await saveRepairForm(ctxOf(db), payload({ Symptom: 'อย่างอื่นไปเลย' }));

  const [h] = await getHistory(ctxOf(db));
  assert.ok(String(h.Detail).includes('น้ำยารั่ว'));
});

// เจ้าของงานกำหนด (14/10/2569): ส่งเอกสารซ่อมได้เฉพาะงานที่ Infrastructure อนุมัติซ่อมแล้ว เหมือนส่งผ่านลิงก์
// เดิมเครื่องที่ใช้งานปกติ (ซ่อมหน้างานโดยไม่ได้แจ้ง) และเครื่องที่ยัง "ชำรุด" ออกเอกสารปิดงานได้เลย
for (const status of ['ใช้งานปกติ', 'ชำรุด']) {
  test('เครื่องที่ยัง "' + status + '" ส่งเอกสารซ่อมไม่ได้ — ต้องอนุมัติซ่อมก่อน', async () => {
    const db = freshDb();
    db.prepare('UPDATE air_units SET Status = ? WHERE AirCode = ?').run(status, 'KKN-CPE-AIR-1');

    await assert.rejects(() => saveRepairForm(ctxOf(db), payload()), /ต้องแจ้งซ่อม แล้วให้ Infrastructure อนุมัติซ่อม/);

    assert.equal((await getRepairForms(ctxOf(db))).length, 0, 'ต้องไม่มีใบงอกออกมา');
    assert.equal(db.prepare('SELECT Status s FROM air_units WHERE AirCode = ?').get('KKN-CPE-AIR-1').s, status);
  });
}
