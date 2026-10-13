/**
 * แยกสิทธิ์เอกสารเป็น 3 แบบ (ล้าง / ซ่อม / ติดตั้ง)
 *
 * ============================================================================
 * ทำไมต้องมีเทสต์ชุดนี้
 * ============================================================================
 * เดิมเอกสารทั้งสามแบบใช้สิทธิ์ cleaningform ดอกเดียว ให้สิทธิ์กรอกใบล้าง
 * ก็เท่ากับให้สิทธิ์กรอกใบซ่อมกับใบติดตั้งไปด้วย
 *
 * เทสต์เดิมทุกตัวใช้บัญชี Admin ซึ่งผ่านทุกสิทธิ์อยู่แล้ว จึงพิสูจน์เรื่องนี้ไม่ได้
 * ชุดนี้ใช้เจ้าหน้าที่ภาคที่ตั้งสิทธิ์ไว้จริง
 *
 * ============================================================================
 * สิ่งที่ล็อกไว้
 * ============================================================================
 * - ผู้ใช้ที่ตั้งสิทธิ์ไว้ก่อนแยก (มีแค่ cleaningform) ต้องใช้งานได้เหมือนเดิม
 *   ไม่เสียสิทธิ์เอกสารซ่อมกับติดตั้งทันทีที่อัปเดตระบบ
 * - พอตั้งสิทธิ์แยกแล้ว แต่ละแบบต้องคุมกันเองจริง ที่ฝั่งเซิร์ฟเวอร์
 * - สิทธิ์ที่ตั้งไว้ชัดเจนต้องชนะการสืบทอดเสมอ
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx, parsePermissions } from '../src/context.js';
import { getCleaningForms } from '../src/modules/cleaningform.js';
import { getRepairForms, saveRepairForm } from '../src/modules/repairform.js';
import { getInstallForms, saveInstallForm } from '../src/modules/installform.js';

/* ==================== ตัวอ่านสิทธิ์ ==================== */

test('ผู้ใช้เดิมที่มีแค่ cleaningform ได้สิทธิ์ซ่อมกับติดตั้งเท่ากันไปด้วย', () => {
  // หน้าตาเดียวกับที่เจ้าหน้าที่ภาคในระบบจริงเก็บไว้ตอนนี้
  const p = parsePermissions('airlist:view,plan:edit,history:edit,repair:edit,cleaningform:edit,budget:none');

  assert.equal(p.cleaningform, 'edit');
  assert.equal(p.repairform, 'edit', 'ต้องไม่เสียสิทธิ์เอกสารซ่อมที่เคยใช้ได้');
  assert.equal(p.installform, 'edit', 'ต้องไม่เสียสิทธิ์เอกสารติดตั้งที่เคยใช้ได้');
});

test('สืบทอดระดับเดียวกัน ไม่ยกขึ้น — ดูอย่างเดียวก็ยังเป็นดูอย่างเดียว', () => {
  const p = parsePermissions('cleaningform:view');

  assert.equal(p.repairform, 'view', 'ห้ามยกขึ้นเป็นแก้ไขได้');
  assert.equal(p.installform, 'view');
});

test('สิทธิ์ที่ตั้งไว้ชัดเจน ต้องชนะการสืบทอด', () => {
  const p = parsePermissions('cleaningform:edit,repairform:none,installform:view');

  assert.equal(p.cleaningform, 'edit');
  assert.equal(p.repairform, 'none', 'ตั้งว่าไม่ให้เข้าถึงแล้ว ต้องไม่ได้สิทธิ์จากใบล้าง');
  assert.equal(p.installform, 'view');
});

test('ไม่มี cleaningform ด้วย สิทธิ์ใหม่ต้องเป็นไม่ให้เข้าถึง ไม่ใช่เดาให้', () => {
  const p = parsePermissions('airlist:edit');

  assert.equal(p.repairform, 'none');
  assert.equal(p.installform, 'none');
});

test('ช่องสิทธิ์ว่างทั้งหมด ยังได้แก้ไขทุกโมดูลเหมือนเดิม รวมเอกสารใหม่ด้วย', () => {
  const p = parsePermissions('');

  assert.equal(p.cleaningform, 'edit');
  assert.equal(p.repairform, 'edit');
  assert.equal(p.installform, 'edit');
});

test('การสืบทอดใช้กับสิทธิ์เอกสารใหม่เท่านั้น ไม่ลามไปโมดูลอื่น', () => {
  // budget ไม่ได้แยกออกมาจากอะไร ต้องยังเป็นไม่ให้เข้าถึงตามกติกาปกติ
  const p = parsePermissions('cleaningform:edit');

  assert.equal(p.budget, 'none');
  assert.equal(p.airlist, 'none');
});

/* ==================== บังคับใช้จริงที่เซิร์ฟเวอร์ ==================== */

function freshDb(permissions) {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('staff', 'เจ้าหน้าที่ภาค 3', 'RegionAdmin', '3', permissions, 1, 'x');

  db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, Brand, BTU, IndoorSN)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('KKN-CPE-AIR-1', 'ชุมแพ', 'KKN-CPE', '3', 'ขอนแก่น', 'Shop House', 'รอซ่อม',
         'Carrier', 18000, 'IN-111');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => { const c = new Ctx({}, state, db, {}); c.username = 'staff'; return c; };

const repair = { AirCode: 'KKN-CPE-AIR-1', Date: '2026-09-24', Symptom: 'ไม่เย็น', Fix: 'เติมน้ำยา' };
const install = { AirCode1: 'KKN-CPE-AIR-1', Date: '2026-09-24' };

test('เจ้าหน้าที่ที่ตั้งสิทธิ์ไว้ก่อนแยก ยังกรอกเอกสารซ่อมกับติดตั้งได้เหมือนเดิม', async () => {
  // สิทธิ์ของเจ้าหน้าที่ภาค 2 คนในระบบจริง ณ วันที่แยกสิทธิ์
  const db = freshDb('airlist:view,plan:edit,history:edit,repair:edit,cleaningform:edit,budget:none');

  const r = await saveRepairForm(ctxOf(db), repair);
  assert.ok(r.docNo, 'บันทึกเอกสารซ่อมต้องได้เหมือนเดิม');

  const i = await saveInstallForm(ctxOf(db), install);
  assert.ok(i.docNo, 'บันทึกเอกสารติดตั้งต้องได้เหมือนเดิม');
});

test('ตัดสิทธิ์เอกสารซ่อม แต่ยังกรอกใบล้างได้ — ต้องบันทึกใบซ่อมไม่ได้', async () => {
  const db = freshDb('cleaningform:edit,repairform:none');

  await assert.rejects(() => saveRepairForm(ctxOf(db), repair), /เอกสารซ่อม/,
    'ต้องฟ้องด้วยชื่อสิทธิ์ที่ขาด ไม่ใช่ชื่อของใบล้าง');
});

test('ตัดสิทธิ์เอกสารซ่อม — รายการเอกสารซ่อมต้องว่าง ไม่ใช่แค่ซ่อนปุ่ม', async () => {
  const db = freshDb('cleaningform:edit,repairform:none');
  // ใส่ใบซ่อมตรงลงฐานข้อมูล เพื่อพิสูจน์ว่ามีข้อมูลอยู่จริงแต่ถูกกรองทิ้ง
  db.prepare("INSERT INTO repair_forms (ID, AirCode, Region, Date) VALUES ('RF1','KKN-CPE-AIR-1','3','2026-09-24')").run();

  assert.deepEqual(await getRepairForms(ctxOf(db)), []);
  // ใบล้างยังดูได้ตามปกติ (ไม่มีใบ แต่ต้องไม่โยน error)
  assert.deepEqual(await getCleaningForms(ctxOf(db)), []);
});

test('ให้สิทธิ์ติดตั้งอย่างเดียว — กรอกติดตั้งได้ แต่กรอกซ่อมไม่ได้', async () => {
  const db = freshDb('installform:edit');

  const i = await saveInstallForm(ctxOf(db), install);
  assert.ok(i.docNo, 'สิทธิ์ติดตั้งต้องใช้ได้โดยไม่ต้องมีสิทธิ์ใบล้าง');

  await assert.rejects(() => saveRepairForm(ctxOf(db), repair), /เอกสารซ่อม/);
});

test('ดูเอกสารติดตั้งได้อย่างเดียว — เปิดรายการได้ แต่บันทึกไม่ได้', async () => {
  const db = freshDb('installform:view');

  assert.ok(Array.isArray(await getInstallForms(ctxOf(db))), 'ต้องเปิดรายการได้');
  await assert.rejects(() => saveInstallForm(ctxOf(db), install), /เอกสารติดตั้ง/);
});

/* ==================== สิทธิ์เอกสารต้องไม่ผูกกับสิทธิ์เมนูรายการเครื่อง ==================== */

/**
 * บั๊กที่เจอตอนแยกสิทธิ์: การกรอกเอกสารไปหาข้อมูลเครื่องผ่าน getAirList ซึ่งคืนค่าว่าง
 * ถ้าไม่มีสิทธิ์เมนูรายการเครื่อง ผลคือกรอกเอกสารไม่ได้ และระบบฟ้องว่า "ไม่พบเครื่อง"
 * ทั้งที่เครื่องอยู่ตรงนั้น ไม่มีใครเจอเพราะผู้ใช้จริงทุกคนบังเอิญมีสิทธิ์ดูรายการเครื่อง
 */
test('ไม่มีสิทธิ์เมนูรายการเครื่อง ก็ยังกรอกเอกสารซ่อมได้', async () => {
  const db = freshDb('airlist:none,repairform:edit');

  const r = await saveRepairForm(ctxOf(db), repair);
  assert.ok(r.docNo, 'สิทธิ์เอกสารต้องพอสำหรับการกรอกเอกสาร');
});

test('ไม่มีสิทธิ์เมนูรายการเครื่อง ก็ยังเลือก Node ในฟอร์มได้', async () => {
  const { getCleaningFormNodes } = await import('../src/modules/cleaningform.js');
  const db = freshDb('airlist:none,installform:edit');

  const nodes = await getCleaningFormNodes(ctxOf(db));
  assert.equal(nodes.length, 1, 'ต้องเห็น Node ในภูมิภาคตัวเอง');
});

test('ไม่มีสิทธิ์เอกสารเลย — ต้องไม่ได้รายชื่อ Node แม้อยู่ภาคเดียวกัน', async () => {
  // ตัวเลือก Node เลิกพึ่งสิทธิ์เมนูรายการเครื่องแล้ว จึงต้องตรวจสิทธิ์เอกสารเอง
  const { getCleaningFormNodes } = await import('../src/modules/cleaningform.js');
  const db = freshDb('airlist:none,plan:edit');

  assert.deepEqual(await getCleaningFormNodes(ctxOf(db)), []);
});

test('เลิกพึ่งสิทธิ์เมนูแล้ว แต่ขอบเขตภูมิภาคยังบังคับเหมือนเดิม', async () => {
  // การแก้นี้เอาการตรวจออกไปหนึ่งชั้น ต้องพิสูจน์ว่าไม่ได้เปิดช่องข้ามภูมิภาค
  const db = freshDb('repairform:edit,installform:edit');
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status)
              VALUES ('BKK-X-AIR-1','กรุงเทพ','BKK-X','1','กรุงเทพฯ','รอซ่อม')`).run();

  await assert.rejects(
    () => saveRepairForm(ctxOf(db), { ...repair, AirCode: 'BKK-X-AIR-1' }),
    /ไม่มีสิทธิ์จัดการข้อมูลในภูมิภาค "1"/, 'เจ้าหน้าที่ภาค 3 ต้องกรอกเอกสารของเครื่องภาค 1 ไม่ได้'
  );
  await assert.rejects(
    () => saveInstallForm(ctxOf(db), { ...install, AirCode1: 'BKK-X-AIR-1' }),
    /ไม่มีสิทธิ์จัดการข้อมูลในภูมิภาค "1"/
  );
});
