/**
 * บันทึกและจัดการเอกสารติดตั้ง
 *
 * ============================================================================
 * สิ่งที่ล็อกไว้ — เน้นจุดที่ต่างจากอีกสองเอกสาร
 * ============================================================================
 * - **ห้ามแตะทะเบียนเครื่องเลย** — การเปลี่ยนเครื่องเป็นหน้าที่ของปุ่ม
 *   "เปลี่ยนเครื่อง" ในหน้ารายการเครื่อง ซึ่งเก็บสเปกเครื่องเก่าไว้ในประวัติให้ด้วย
 * - ข้อมูลเครื่องในเอกสารต้องคัดมาจากทะเบียน ไม่ใช่จากที่หน้าเว็บส่งมา
 * - สองเครื่องต่อใบ ได้เลขที่คนละเลข และต้องไม่ซ้ำกัน
 * - ลงประวัติ "ติดตั้ง" ให้ทุกเครื่องในใบ
 * - ไฟล์และรูปเก็บแยกโฟลเดอร์จากงานล้างและงานซ่อม
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { getHistory, addHistoryRecord, getRepairWorkCount } from '../src/modules/history.js';
import { getAirList, replaceAirUnit } from '../src/modules/airlist.js';
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

/** ช่องว่างอาจกลับมาเป็น '' หรือ null แล้วแต่ทาง — เทียบเป็นข้อความเสมอ */
const plainOf = v => String(v == null ? '' : v).trim();

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

test('ตัวเลขบนเมนูงานซ่อมและติดตั้ง = เคสที่ยังไม่ปิด + งานติดตั้งที่รอเอกสาร และลดเมื่อกรอกแล้ว', async () => {
  const db = freshDb();
  // ข้อมูลตั้งต้น: AIR-2 ชำรุด = เคสค้าง 1
  assert.deepEqual(await getRepairWorkCount(ctxOf(db)), { repair: 1, install: 0, total: 1 });

  const [unit] = (await getAirList(ctxOf(db))).filter(a => a.AirCode === 'KKN-CPE-AIR-1');
  await replaceAirUnit(ctxOf(db), unit._row, { Brand: 'Daikin', IndoorSN: 'ใหม่-IN-1' }, unit.AirCode);
  assert.deepEqual(await getRepairWorkCount(ctxOf(db)), { repair: 1, install: 1, total: 2 }, 'เปลี่ยนเครื่องแล้วรอเอกสารติดตั้ง');

  await saveInstallForm(ctxOf(db), payload());
  assert.deepEqual(await getRepairWorkCount(ctxOf(db)), { repair: 1, install: 0, total: 1 }, 'กรอกใบติดตั้งแล้วต้องหายจากตัวเลข');
});

test('ใบประวัติที่ออกเลขทีหลัง ต้องไม่ได้เลขเดียวกับใบติดตั้ง · ประวัติติดตั้งใช้เลขของใบนั้น', async () => {
  // เคยเกิดจริง: เปลี่ยนเครื่อง → ใบติดตั้งไปแปะเลขที่แถวประวัติเดิม เลขใบจึงไม่อยู่ในประวัติ
  // ตัวออกเลขไม่นับเลขใบติดตั้ง แจ้งซ่อมเครื่องอื่นเลยได้ CM2609-87 ซ้ำกับใบติดตั้ง
  const db = freshDb();
  const [unit] = (await getAirList(ctxOf(db))).filter(a => a.AirCode === 'KKN-CPE-AIR-1');
  await replaceAirUnit(ctxOf(db), unit._row, { Brand: 'Daikin', IndoorSN: 'ใหม่-IN-1' }, unit.AirCode);
  const res = await saveInstallForm(ctxOf(db), payload());
  await addHistoryRecord(ctxOf(db), {
    AirCode: 'KKN-CPE-AIR-2', Date: '2026-09-25', EventType: 'แจ้งซ่อม', Detail: 'ไม่เย็น'
  });

  const hist = await getHistory(ctxOf(db));
  const report = hist.find(h => h.EventType === 'แจ้งซ่อม');
  assert.notEqual(report.ID, res.docNo, 'แจ้งซ่อมได้เลขซ้ำใบติดตั้ง ' + res.docNo);

  // ใบติดตั้งของเครื่องที่ไม่ได้มาจากการเปลี่ยน — ประวัติ "ติดตั้ง" ใช้เลขเดียวกับใบ
  const res2 = await saveInstallForm(ctxOf(db), payload({ AirCode1: 'KKN-CPE-AIR-2', Date: '2026-09-26' }));
  const installed = (await getHistory(ctxOf(db))).find(h => h.EventType === 'ติดตั้ง' && h.AirCode === 'KKN-CPE-AIR-2');
  assert.equal(installed.ID, res2.docNo, 'ประวัติติดตั้งต้องถือเลขของใบ');
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

test('ติดตั้งเพิ่มเฉพาะเครื่องที่ 2 ข้อมูลต้องอยู่ช่องที่ 2 ไม่เลื่อนมาช่องแรก', async () => {
  // ติดตั้งเพิ่มทีละตัวเป็นเรื่องปกติ และคนอ่านเอกสารดูจากตำแหน่งคอลัมน์ว่า
  // เป็นแอร์ตัวไหนของ Node ถ้าเลื่อนขึ้นมาช่องแรกจะกลายเป็นคนละเครื่องทันที
  const db = freshDb();
  const res = await saveInstallForm(ctxOf(db), {
    Date: '2026-09-24',
    AirCode2: 'KKN-CPE-AIR-2',
    AcceptResult2: 'ผ่าน',
    TechnicianName: 'ช่างสมชาย',
    Checklist: [{ no: 1, val2: 'ผ่าน' }]
  });

  const [form] = await getInstallForms(ctxOf(db));
  assert.equal(plainOf(form.AirCode1), '', 'ช่องที่ 1 ต้องว่าง');
  assert.equal(form.AirCode2, 'KKN-CPE-AIR-2');
  assert.equal(plainOf(form.Unit1_IndoorSerial), '', 'ข้อมูลเครื่องช่องที่ 1 ต้องว่างด้วย');
  assert.equal(form.Unit2_IndoorSerial, 'เก่า-IN-2');

  // เลขไปอยู่ช่องของเครื่องที่ 2 ส่วนช่องที่ 1 ว่าง
  assert.equal(res.docNo1, '', 'ช่องที่ 1 ไม่มีเครื่อง จึงไม่ออกเลขให้');
  assert.ok(/^CM\d{4}-\d+$/.test(res.docNo2), 'ได้เลข ' + res.docNo2);
  assert.equal(res.docNo, res.docNo2, 'ชื่อไฟล์ต้องใช้เลขที่ออกจริง ไม่ใช่ช่องที่ 1 ที่ว่างอยู่');
  assert.ok(res.id, 'ต้องคืน ID ไว้ให้หน้าเว็บหาแถวที่เพิ่งบันทึก');
});

test('ติดตั้งเฉพาะเครื่องที่ 2 รูปกับไฟล์ PDF ต้องไปอยู่ชื่อเดียวกัน', async () => {
  // ถ้าใช้ DocNo ตรงๆ ชื่อจะกลายเป็น ID ภายใน แล้วรูปกับ PDF ของใบเดียวกัน
  // จะไปคนละชื่อ หาไม่เจอทั้งคู่
  const db = freshDb();
  const photos = fakePhotos();
  const ctx = ctxOf(db, { photos });

  const res = await saveInstallForm(ctx, {
    Date: '2026-09-24', AirCode2: 'KKN-CPE-AIR-2', TechnicianName: 'ช่างสมชาย'
  });

  const [form] = await getInstallForms(ctx);
  await saveInstallPhoto(ctx, { row: form._row, unitSlot: 2, index: 1, dataUrl: PNG });
  await settleDocPdfQueue();

  assert.deepEqual(Object.keys(photos.readAll('install', res.docNo)), ['2-1'],
    'รูปต้องอยู่ใต้เลขที่เดียวกับที่คืนกลับมา');
});

test('ติดตั้งเฉพาะเครื่องที่ 2 ลงประวัติให้เครื่องนั้นตัวเดียว', async () => {
  const db = freshDb();
  await saveInstallForm(ctxOf(db), {
    Date: '2026-09-24', AirCode2: 'KKN-CPE-AIR-2', TechnicianName: 'ช่างสมชาย'
  });

  const installs = (await getHistory(ctxOf(db))).filter(h => h.EventType === 'ติดตั้ง');
  assert.equal(installs.length, 1);
  assert.equal(installs[0].AirCode, 'KKN-CPE-AIR-2');
});

/* ==================== ห้ามแตะทะเบียนเครื่อง ==================== */

/**
 * ============================================================================
 * ทำไมเทสต์ชุดนี้กลับด้านจากตอนแรก
 * ============================================================================
 * เวอร์ชันแรกให้ใบติดตั้งเขียนข้อมูลเครื่องกลับเข้าทะเบียน ด้วยเหตุผลว่าติดตั้ง
 * คือจุดที่ตัวเครื่องจริงเปลี่ยน — ซึ่งผิด เพราะระบบมีปุ่ม "เปลี่ยนเครื่อง"
 * (replaceAirUnit) ทำหน้าที่นั้นอยู่แล้ว และทำได้ครบกว่า: แยกช่องของตัวเครื่อง
 * ออกจากช่องของตำแหน่ง เก็บสเปกเครื่องเก่าไว้ในประวัติ และปิดเคสงานซ่อมให้
 *
 * ของที่ใบติดตั้งทำ ทับสเปกเครื่องเก่าทิ้งโดยไม่เก็บไว้ที่ไหนเลย
 * เทสต์ชุดนี้กันไม่ให้ใครเผลอเอากลับมาใส่อีก
 */

test('บันทึกเอกสารแล้ว ต้องไม่ไปแตะข้อมูลเครื่องในทะเบียนเลย', async () => {
  const db = freshDb();
  const before = await unitOf(db, 'KKN-CPE-AIR-1');

  await saveInstallForm(ctxOf(db), payload());

  const after = await unitOf(db, 'KKN-CPE-AIR-1');
  for (const field of ['IndoorSN', 'IndoorAsset', 'OutdoorSN', 'OutdoorAsset',
                       'Brand', 'BTU', 'InstallDate', 'Status']) {
    assert.equal(String(after[field] ?? ''), String(before[field] ?? ''),
      'ช่อง ' + field + ' ในทะเบียนต้องไม่ถูกเอกสารแก้');
  }
});

test('ข้อมูลเครื่องในเอกสาร ต้องคัดมาจากทะเบียน ไม่ใช่จากที่หน้าเว็บส่งมา', async () => {
  // หน้าเว็บส่งค่ามั่วมา ก็ต้องไม่ถูกใช้ ไม่งั้นเอกสารจะไม่ตรงกับทะเบียน
  const db = freshDb();
  await saveInstallForm(ctxOf(db), payload({
    Unit1_IndoorSerial: 'มั่ว-IN', Unit1_Brand: 'มั่ว-ยี่ห้อ', Unit1_BTU: '99999'
  }));

  const [form] = await getInstallForms(ctxOf(db));
  assert.equal(form.Unit1_IndoorSerial, 'เก่า-IN-1', 'ต้องเป็นค่าจากทะเบียน');
  assert.equal(form.Unit1_IndoorAsset, 'เก่า-A-1');
  assert.equal(form.Unit1_OutdoorSerial, 'เก่า-OUT-1');
  assert.equal(form.Unit1_Brand, 'Carrier');
  assert.equal(String(form.Unit1_BTU), '18000');
});

test('เปลี่ยนเครื่องในทะเบียนก่อน แล้วออกเอกสาร ต้องได้ Serial ของเครื่องใหม่', async () => {
  // นี่คือลำดับงานที่ถูกต้องตามที่เจ้าของงานกำหนด
  const db = freshDb();
  const ctx = ctxOf(db);

  const unit = await unitOf(db, 'KKN-CPE-AIR-1');
  await replaceAirUnit(ctx, unit._row, {
    IndoorSN: 'ใหม่-IN-1', IndoorAsset: 'ใหม่-A-1',
    OutdoorSN: 'ใหม่-OUT-1', OutdoorAsset: 'ใหม่-A-2',
    Brand: 'Daikin', BTU: 24000, InstallDate: '2026-09-24'
  }, 'KKN-CPE-AIR-1');

  await saveInstallForm(ctxOf(db), payload());

  const [form] = await getInstallForms(ctxOf(db));
  assert.equal(form.Unit1_IndoorSerial, 'ใหม่-IN-1', 'เอกสารต้องได้ Serial ของเครื่องใหม่');
  assert.equal(form.Unit1_OutdoorSerial, 'ใหม่-OUT-1');
  assert.equal(form.Unit1_Brand, 'Daikin');
});

test('สเปกเครื่องเก่ายังอยู่ในประวัติ หลังเปลี่ยนเครื่องแล้วออกเอกสาร', async () => {
  // ข้อมูลเครื่องเก่ามีที่อยู่ที่เดียวคือใบประวัติ "เปลี่ยนเครื่อง"
  // ถ้าใบติดตั้งไปทับทะเบียนเอง ข้อมูลนี้จะไม่มีอยู่เลย
  const db = freshDb();
  const ctx = ctxOf(db);

  const unit = await unitOf(db, 'KKN-CPE-AIR-1');
  await replaceAirUnit(ctx, unit._row, { IndoorSN: 'ใหม่-IN-1' }, 'KKN-CPE-AIR-1');
  await saveInstallForm(ctxOf(db), payload());

  const history = await getHistory(ctxOf(db));
  const swap = history.find(h => h.EventType === 'เปลี่ยนเครื่อง');
  assert.ok(swap, 'ต้องมีใบเปลี่ยนเครื่อง');
  assert.ok(swap.Detail.includes('เก่า-IN-1'), 'สเปกเครื่องเก่าต้องถูกเก็บไว้ — ได้ ' + swap.Detail);
});

test('ตรวจรับไม่ผ่าน ก็ยังไม่แตะสถานะเครื่อง', async () => {
  const db = freshDb();
  await saveInstallForm(ctxOf(db), payload({
    AirCode1: 'KKN-CPE-AIR-2', AcceptResult1: 'ไม่ผ่าน'
  }));

  const unit = await unitOf(db, 'KKN-CPE-AIR-2');
  assert.equal(unit.Status, 'ชำรุด', 'สถานะเป็นเรื่องของหน้ารายการเครื่อง ไม่ใช่ของเอกสาร');
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
  await saveInstallPhoto(ctx, { row: form._row, unitSlot: 1, index: 1, dataUrl: PNG });
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

  await saveInstallPhoto(ctx, { row: form._row, unitSlot: 1, index: 1, dataUrl: PNG });
  await saveInstallPhoto(ctx, { row: form._row, unitSlot: 2, index: 1, dataUrl: PNG });
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
    () => saveInstallPhoto(ctx, { row: form._row, unitSlot: 2, index: 1, dataUrl: PNG }),
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
  assert.ok(html.includes('เก่า-IN-1'), 'ต้องเห็น Serial ที่อยู่ในทะเบียน ณ วันออกเอกสาร');
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
