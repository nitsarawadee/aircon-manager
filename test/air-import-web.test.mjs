/**
 * นำเข้าข้อมูลเครื่องจากหน้าเว็บ — ดูผลก่อน แล้วค่อยยืนยัน
 *
 * ============================================================================
 * ทำไมต้องมีชุดนี้แยกจาก import.test.mjs
 * ============================================================================
 * import.test.mjs คุมตรรกะการนำเข้าล้วนๆ (planImport/applyImport) ซึ่งไม่รู้เรื่อง
 * สิทธิ์ ไม่รู้เรื่องล็อก และคำสั่ง command line ก็ใช้ตัวเดียวกัน
 *
 * ชุดนี้คุม "ชั้นที่หน้าเว็บเรียก" ซึ่งมีเรื่องที่ command line ไม่มี:
 * สิทธิ์แก้ไข สิทธิ์รายภูมิภาค การสำรองก่อนเขียน และการกันข้อมูลเก่าค้างในมือ
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - ดูผลต้องไม่เขียนอะไรเลย
 * - RegionAdmin แตะเครื่องนอกภูมิภาคตัวเองไม่ได้ ทั้งเพิ่มใหม่และแก้ของเดิม
 *   และย้ายเครื่องออกไปภูมิภาคที่ตัวเองไม่ได้ดูแลก็ไม่ได้
 * - มีข้อผิดพลาดแม้จุดเดียว = ไม่เขียนอะไรเลยทั้งไฟล์
 * - ต้องสำรองฐานข้อมูลก่อนเขียนเสมอ
 * - ตัวเลขที่คนกดยืนยันต้องตรงกับที่จะเขียนจริง ไม่ตรง = หยุด
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import {
  planAirUnitImport, applyAirUnitImport, getAirUnitImportFile, getAirList
} from '../src/modules/airlist.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  const addUser = db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  );
  addUser.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  // รูปแบบสิทธิ์คือ "โมดูล:ระดับ" คั่นด้วยลูกน้ำ (ดู parsePermissions ใน context.js)
  addUser.run('r1', 'ดูแลภาค 1', 'RegionAdmin', '1', 'airlist:edit', 1, 'x');
  addUser.run('viewer', 'ดูอย่างเดียว', 'RegionAdmin', '1', 'airlist:view', 1, 'x');

  const add = db.prepare(
    'INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, Brand, BTU)' +
    ' VALUES (?,?,?,?,?,?,?,?,?)'
  );
  add.run('ATG-ATG-AIR-1', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 'Carrier', 18000);
  add.run('CNX-CNX-AIR-1', 'เชียงใหม่', 'CNX-CNX', '2', 'เชียงใหม่', 'Container', 'ใช้งานปกติ', 'Daikin', 24000);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };

const ctxOf = (db, opts = {}) => {
  const c = new Ctx({}, state, db, opts.services || {});
  c.username = opts.user || 'boss';
  return c;
};

/** แถวหนึ่งของไฟล์นำเข้า เติมช่องบังคับให้ครบไว้ก่อน */
const row = (over = {}) => ({
  Region: '1', Province: 'อ่างทอง', NodeName: 'อ่างทอง', SiteCode: 'ATG-ATG',
  LocationType: 'Shop House', AirNo: '1', Status: 'ใช้งานปกติ',
  ...over
});

const codesIn = db =>
  db.prepare('SELECT AirCode FROM air_units ORDER BY AirCode').all().map(r => r.AirCode);

/* ==================== ดูผลก่อน ==================== */

test('ดูผลต้องบอกว่าจะเพิ่ม/แก้/เหมือนเดิมกี่รายการ โดยไม่เขียนอะไรเลย', async () => {
  const db = freshDb();
  const before = codesIn(db);

  const plan = await planAirUnitImport(ctxOf(db), [
    row({ Brand: 'Mitsubishi' }),                                  // แก้ของเดิม
    row({ SiteCode: 'ATG-ATG', AirNo: '2', Brand: 'Carrier' }),    // เพิ่มใหม่
    row({ SiteCode: 'CNX-CNX', AirNo: '1', Region: '2', Province: 'เชียงใหม่',
          NodeName: 'เชียงใหม่', LocationType: 'Container', Brand: 'Daikin', BTU: '24000' })
  ]);

  assert.equal(plan.counts.adds, 1);
  assert.equal(plan.counts.updates, 1);
  assert.equal(plan.counts.unchanged, 1);
  assert.equal(plan.counts.errors, 0);
  assert.deepEqual(codesIn(db), before, 'ดูผลแล้วข้อมูลต้องไม่ขยับเลย');
});

test('ดูผลต้องบอกด้วยว่าแต่ละเครื่องเปลี่ยนช่องไหน จากอะไรเป็นอะไร', async () => {
  const db = freshDb();
  const plan = await planAirUnitImport(ctxOf(db), [row({ Brand: 'Mitsubishi' })]);

  assert.deepEqual(plan.updates[0].changes, [{ column: 'Brand', from: 'Carrier', to: 'Mitsubishi' }]);
});

test('ไฟล์ผิดรูปแบบ ต้องบอกเลขบรรทัดของไฟล์ ไม่ใช่ลำดับในอาร์เรย์', async () => {
  // คนใช้เปิดไฟล์ใน Excel แล้วต้องกระโดดไปบรรทัดนั้นได้เลย
  // แถวข้อมูลแรกคือบรรทัดที่ 2 เพราะบรรทัดแรกเป็นหัวตาราง
  const db = freshDb();
  const plan = await planAirUnitImport(ctxOf(db), [
    row(),
    row({ SiteCode: 'ATG-ATG', AirNo: '9', Region: '' })
  ]);

  assert.equal(plan.counts.errors, 1);
  assert.equal(plan.errors[0].line, 3);
  assert.equal(plan.errors[0].column, 'Region');
});

/* ==================== ไฟล์สำหรับโหลดไปแก้ ==================== */

test('ไฟล์ที่โหลดไปแก้ ต้องนำเข้ากลับได้ทันทีโดยไม่มีอะไรเปลี่ยน', async () => {
  // นี่คือหัวใจของวิธีแก้ข้อมูลเป็นชุด — โหลด แก้ใน Excel แล้วนำเข้ากลับ
  // ถ้าไฟล์ที่โหลดไปนำเข้ากลับเฉยๆ แล้วมีอะไรเปลี่ยน แปลว่าสองฝั่งไม่ตรงกัน
  const db = freshDb();
  const file = await getAirUnitImportFile(ctxOf(db));

  const plan = await planAirUnitImport(ctxOf(db), file.rows);
  assert.equal(plan.counts.errors, 0, 'ไฟล์ของระบบเองต้องไม่มีข้อผิดพลาด');
  assert.equal(plan.counts.adds, 0);
  assert.equal(plan.counts.updates, 0);
  assert.equal(plan.counts.unchanged, 2);
});

test('ไฟล์สำหรับแก้ต้องมีคอลัมน์ AirNo ซึ่งไฟล์ดาวน์โหลดของตารางไม่มี', async () => {
  const db = freshDb();
  const file = await getAirUnitImportFile(ctxOf(db));

  assert.ok(file.headers.includes('AirNo'), 'ขาด AirNo แล้วประกอบรหัสเครื่องไม่ได้');
  assert.ok(!file.headers.includes('AirCode'), 'AirCode ระบบสร้างให้เอง ไม่ควรให้คนกรอก');
  assert.equal(file.rows[0].AirNo, '1');
});

test('RegionAdmin โหลดได้เฉพาะเครื่องที่ตัวเองแก้ได้', async () => {
  const db = freshDb();
  const file = await getAirUnitImportFile(ctxOf(db, { user: 'r1' }));

  assert.equal(file.rows.length, 1);
  assert.equal(file.rows[0].SiteCode, 'ATG-ATG');
});

/* ==================== สิทธิ์ ==================== */

test('คนที่มีสิทธิ์แค่ดู ต้องนำเข้าไม่ได้ แม้แต่ขั้นดูผล', async () => {
  const db = freshDb();
  await assert.rejects(() => planAirUnitImport(ctxOf(db, { user: 'viewer' }), [row()]), /ไม่มีสิทธิ์แก้ไข/);
  await assert.rejects(
    () => applyAirUnitImport(ctxOf(db, { user: 'viewer' }), { rows: [row()] }),
    /ไม่มีสิทธิ์แก้ไข/
  );
});

test('RegionAdmin แก้เครื่องนอกภูมิภาคตัวเองไม่ได้', async () => {
  const db = freshDb();
  const plan = await planAirUnitImport(ctxOf(db, { user: 'r1' }), [
    row({ SiteCode: 'CNX-CNX', AirNo: '1', Region: '2', Province: 'เชียงใหม่',
          NodeName: 'เชียงใหม่', LocationType: 'Container', Brand: 'เปลี่ยนยี่ห้อ' })
  ]);

  assert.equal(plan.counts.updates, 0, 'ต้องไม่นับเป็นรายการที่จะแก้');
  assert.equal(plan.counts.errors, 1);
  assert.match(plan.errors[0].message, /ภูมิภาค "2" ซึ่งคุณไม่ได้ดูแล/);
});

test('RegionAdmin เพิ่มเครื่องเข้าภูมิภาคอื่นไม่ได้', async () => {
  const db = freshDb();
  const plan = await planAirUnitImport(ctxOf(db, { user: 'r1' }), [
    row({ SiteCode: 'CNX-CNX', AirNo: '5', Region: '2', Province: 'เชียงใหม่',
          NodeName: 'เชียงใหม่', LocationType: 'Container' })
  ]);

  assert.equal(plan.counts.adds, 0);
  assert.equal(plan.counts.errors, 1);
});

test('RegionAdmin ย้ายเครื่องของตัวเองไปให้ภูมิภาคอื่นก็ไม่ได้', async () => {
  // ปลายทางก็เป็นข้อมูลของคนอื่นเหมือนกัน ไม่ใช่ดูแลต้นทางแล้วจะส่งไปไหนก็ได้
  const db = freshDb();
  const plan = await planAirUnitImport(ctxOf(db, { user: 'r1' }), [
    row({ Region: '3', Province: 'ขอนแก่น' })
  ]);

  assert.equal(plan.counts.updates, 0);
  assert.equal(plan.counts.errors, 1);
});

test('RegionAdmin แก้เครื่องในภูมิภาคตัวเองได้ตามปกติ', async () => {
  const db = freshDb();
  const services = { backup: () => 'สำรอง.db' };
  const res = await applyAirUnitImport(
    ctxOf(db, { user: 'r1', services }),
    { rows: [row({ Brand: 'Mitsubishi' })], expect: { adds: 0, updates: 1 } }
  );

  assert.equal(res.updated, 1);
  assert.equal(db.prepare('SELECT Brand b FROM air_units WHERE AirCode = ?').get('ATG-ATG-AIR-1').b, 'Mitsubishi');
});

test('เครื่องของภูมิภาคอื่นต้องไม่ถูกมองว่ายังไม่มีในระบบ แล้วสร้างซ้ำขึ้นมาอีกตัว', async () => {
  // getAirList กรองตามภูมิภาคให้ ถ้าเอาผลนั้นไปเทียบ เครื่องของภาคอื่นจะกลายเป็น "เพิ่มใหม่"
  const db = freshDb();
  const plan = await planAirUnitImport(ctxOf(db, { user: 'r1' }), [
    row({ SiteCode: 'CNX-CNX', AirNo: '1', Region: '2', Province: 'เชียงใหม่',
          NodeName: 'เชียงใหม่', LocationType: 'Container', Brand: 'Daikin', BTU: '24000' })
  ]);

  assert.equal(plan.counts.adds, 0, 'ต้องไม่ถือว่าเป็นเครื่องใหม่');
});

/* ==================== เขียนจริง ==================== */

test('ยืนยันแล้วต้องเขียนจริง และสำรองฐานข้อมูลก่อนเสมอ', async () => {
  const db = freshDb();
  const labels = [];
  const services = { backup: label => { labels.push(label); return 'สำรอง.db'; } };

  const res = await applyAirUnitImport(ctxOf(db, { services }), {
    rows: [row({ SiteCode: 'ATG-ATG', AirNo: '2', Brand: 'Carrier' })],
    expect: { adds: 1, updates: 0 }
  });

  assert.equal(res.added, 1);
  assert.equal(labels.length, 1, 'ต้องสำรองก่อนเขียนหนึ่งครั้ง');
  assert.ok(codesIn(db).includes('ATG-ATG-AIR-2'));
});

test('สำรองไม่สำเร็จ ต้องไม่เขียนอะไรเลย', async () => {
  // ถ้ายังเขียนต่อทั้งที่สำรองไม่ได้ วันที่นำเข้าผิดจะไม่มีทางย้อนกลับ
  const db = freshDb();
  const before = codesIn(db);
  const services = { backup: () => { throw new Error('ดิสก์เต็ม'); } };

  await assert.rejects(
    () => applyAirUnitImport(ctxOf(db, { services }), {
      rows: [row({ SiteCode: 'ATG-ATG', AirNo: '2' })],
      expect: { adds: 1, updates: 0 }
    }),
    /ดิสก์เต็ม/
  );
  assert.deepEqual(codesIn(db), before);
});

test('มีข้อผิดพลาดแม้จุดเดียว ต้องไม่เขียนอะไรเลยทั้งไฟล์', async () => {
  const db = freshDb();
  const before = codesIn(db);

  await assert.rejects(
    () => applyAirUnitImport(ctxOf(db, { services: { backup: () => 'x' } }), {
      rows: [
        row({ SiteCode: 'ATG-ATG', AirNo: '2' }),   // แถวนี้ถูกต้อง
        row({ SiteCode: 'ATG-ATG', AirNo: '3', Region: '9' })   // แถวนี้ผิด
      ]
    }),
    /ยังมีข้อผิดพลาด 1 จุด/
  );
  assert.deepEqual(codesIn(db), before, 'แถวที่ถูกต้องก็ต้องไม่ถูกเขียน');
});

test('ตัวเลขที่คนกดยืนยันไม่ตรงกับที่จะเขียนจริง ต้องหยุดให้ดูใหม่', async () => {
  // คนกดดูผลตอนที่ไฟล์จะเพิ่มเครื่องใหม่ 2 ตัว แล้วมีคนอื่นเพิ่มตัวหนึ่งเข้าระบบ
  // คั่นระหว่างที่หน้าต่างยืนยันเปิดค้างอยู่ — เหลือของจริงที่จะเพิ่มแค่ตัวเดียว
  const db = freshDb();
  const rows = [
    row({ SiteCode: 'ATG-ATG', AirNo: '2' }),
    row({ SiteCode: 'ATG-ATG', AirNo: '3' })
  ];

  const plan = await planAirUnitImport(ctxOf(db), rows);
  assert.equal(plan.counts.adds, 2, 'ตอนกดดูผล ต้องขึ้นว่าจะเพิ่ม 2 ตัว');

  db.prepare('INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status)' +
             ' VALUES (?,?,?,?,?,?,?)')
    .run('ATG-ATG-AIR-2', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ');

  await assert.rejects(
    () => applyAirUnitImport(ctxOf(db, { services: { backup: () => 'x' } }), {
      rows, expect: { adds: 2, updates: 0 }
    }),
    /ข้อมูลในระบบเปลี่ยนไประหว่างที่ดูผลอยู่/
  );
  assert.ok(!codesIn(db).includes('ATG-ATG-AIR-3'), 'ต้องไม่เขียนอะไรเลย');
});

test('ไฟล์ที่ไม่มีอะไรต้องเปลี่ยน ต้องบอกให้รู้ ไม่ใช่ทำเงียบๆ แล้วจบ', async () => {
  const db = freshDb();
  await assert.rejects(
    () => applyAirUnitImport(ctxOf(db, { services: { backup: () => 'x' } }), { rows: [row()] }),
    /ไม่มีอะไรต้องเปลี่ยน/
  );
});

test('นำเข้าต้องไม่ลบเครื่องที่ไม่ได้อยู่ในไฟล์', async () => {
  const db = freshDb();
  await applyAirUnitImport(ctxOf(db, { services: { backup: () => 'x' } }), {
    rows: [row({ Brand: 'Mitsubishi' })],
    expect: { adds: 0, updates: 1 }
  });

  assert.deepEqual(codesIn(db), ['ATG-ATG-AIR-1', 'CNX-CNX-AIR-1'], 'เครื่องของภาคอื่นต้องอยู่ครบ');
});

test('ช่องที่เว้นว่างในไฟล์ ต้องไม่ล้างค่าเดิมทิ้ง', async () => {
  const db = freshDb();
  await applyAirUnitImport(ctxOf(db, { services: { backup: () => 'x' } }), {
    rows: [row({ Brand: 'Mitsubishi', BTU: '' })],
    expect: { adds: 0, updates: 1 }
  });

  const got = db.prepare('SELECT Brand b, BTU t FROM air_units WHERE AirCode = ?').get('ATG-ATG-AIR-1');
  assert.equal(got.b, 'Mitsubishi');
  assert.equal(Number(got.t), 18000, 'BTU เดิมต้องยังอยู่');
});

test('ผลลัพธ์ต้องส่งรายการเครื่องล่าสุดกลับไปให้หน้าเว็บวาดใหม่', async () => {
  const db = freshDb();
  const res = await applyAirUnitImport(ctxOf(db, { services: { backup: () => 'x' } }), {
    rows: [row({ SiteCode: 'ATG-ATG', AirNo: '2' })],
    expect: { adds: 1, updates: 0 }
  });

  assert.equal(res.air.length, (await getAirList(ctxOf(db))).length);
  assert.ok(res.air.some(a => a.AirCode === 'ATG-ATG-AIR-2'));
});

/* ==================== Template ==================== */

test('Template — คอลัมน์ตรงกับที่ตัวนำเข้ารับเป๊ะ พร้อมคำอธิบาย/ตัวอย่าง/ค่าที่ใช้ได้ · คนที่ดูได้อย่างเดียวโหลดไม่ได้', async () => {
  const { getAirUnitImportTemplate } = await import('../src/modules/airlist.js');
  const { HEADERS } = await import('../src/import-spec.js');
  const db = freshDb();
  const t = await getAirUnitImportTemplate(ctxOf(db));
  assert.deepEqual(t.columns.map(c => c.name), HEADERS);
  const region = t.columns.find(c => c.name === 'Region');
  assert.equal(region.required, true);
  assert.ok(region.allowed.includes('1'));
  assert.ok(t.columns.find(c => c.name === 'AirNo').desc.includes('รหัสเครื่อง'));
  await assert.rejects(() => getAirUnitImportTemplate(ctxOf(db, { user: 'viewer' })), /ไม่มีสิทธิ์แก้ไข/);
});
