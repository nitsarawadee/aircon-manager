/**
 * การอนุมัติซ่อม (เปลี่ยนสถานะเป็น "รอซ่อม") เป็นสิทธิ์ของผู้ดูแลระบบเท่านั้น
 *
 * ============================================================================
 * ทำไมต้องกันที่เซิร์ฟเวอร์ ไม่ใช่แค่ซ่อนปุ่ม
 * ============================================================================
 * "รอซ่อม" ไม่ใช่แค่คำบอกสถานะ แต่แปลว่าค่าใช้จ่ายได้รับอนุมัติแล้ว
 * ถ้ากันด้วยการซ่อนปุ่มในหน้าเว็บอย่างเดียว คนที่รู้วิธีก็ยิงคำสั่งตรงเข้ามาได้
 * โดยไม่ผ่านหน้าเว็บเลย การซ่อนปุ่มกันได้แค่การกดพลาด ไม่ใช่การกันสิทธิ์
 *
 * และเพราะสถานะเปลี่ยนได้จากสองหน้า (ปุ่มลัดในหน้างานซ่อม กับฟอร์มแก้ไขเครื่อง)
 * ซึ่งเข้ามาที่ saveAirUnit เหมือนกัน การตรวจที่จุดนั้นจุดเดียวจึงคุมได้ทั้งสองทาง
 * เทสต์ชุดนี้พิสูจน์ว่าคุมได้จริง ไม่ใช่แค่ตั้งใจให้คุม
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { getAirList, saveAirUnit } from '../src/modules/airlist.js';
import { getHistory } from '../src/modules/history.js';

/** สิทธิ์ระดับแก้ไขได้ทุกโมดูล — RegionAdmin ที่ทำงานได้เต็มที่ในเขตตัวเอง */
const ALL_EDIT = 'airlist:edit,plan:edit,history:edit,repair:edit,cleaningform:edit,budget:edit';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);

  const addUser = db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  );
  addUser.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  addUser.run('somchai', 'หัวหน้าภาค 1', 'RegionAdmin', '1', ALL_EDIT, 1, 'x');

  db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, Status, Note)
      VALUES ('AYA-BPC-AIR-1','สถานีรถไฟบ้านภาชี','AYA-BPC','1','อยุธยา','ชำรุด','คอมเพรสเซอร์เสีย')`).run();
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };

const ctxAs = (db, username) => {
  const c = new Ctx({}, state, db);
  c.username = username;
  return c;
};

/** ข้อมูลเครื่องชุดเต็มพร้อมสถานะใหม่ — รูปแบบเดียวกับที่หน้าเว็บส่งขึ้นมา */
async function unitWithStatus(db, username, status) {
  const [unit] = await getAirList(ctxAs(db, username));
  return { ...unit, Status: status };
}

const statusOf = async db => (await getAirList(ctxAs(db, 'boss')))[0].Status;

test('ผู้ดูแลระบบอนุมัติซ่อมได้ สถานะเปลี่ยนเป็นรอซ่อม', async () => {
  const db = freshDb();
  await saveAirUnit(ctxAs(db, 'boss'), await unitWithStatus(db, 'boss', 'รอซ่อม'));
  assert.equal(await statusOf(db), 'รอซ่อม');
});

test('RegionAdmin ที่มีสิทธิ์แก้ไขครบ ยังอนุมัติซ่อมไม่ได้', async () => {
  const db = freshDb();
  const unit = await unitWithStatus(db, 'somchai', 'รอซ่อม');

  await assert.rejects(
    () => saveAirUnit(ctxAs(db, 'somchai'), unit),
    /Admin/,
    'ต้องถูกปฏิเสธ ถึงจะมีสิทธิ์ airlist:edit และอยู่ในภูมิภาคของตัวเองก็ตาม'
  );
});

test('ถูกปฏิเสธแล้วต้องไม่มีอะไรเปลี่ยนเลยสักอย่าง', async () => {
  // ถ้าเขียนไปบางส่วนก่อนแล้วค่อยปฏิเสธ ข้อมูลจะเพี้ยนแบบหาสาเหตุไม่เจอ
  const db = freshDb();
  const unit = await unitWithStatus(db, 'somchai', 'รอซ่อม');
  unit.Note = 'แก้หมายเหตุไปด้วยพร้อมกัน';

  await assert.rejects(() => saveAirUnit(ctxAs(db, 'somchai'), unit), /Admin/);

  const [after] = await getAirList(ctxAs(db, 'boss'));
  assert.equal(after.Status, 'ชำรุด', 'สถานะต้องเป็นค่าเดิม');
  assert.equal(after.Note, 'คอมเพรสเซอร์เสีย', 'หมายเหตุต้องไม่ถูกเขียนทับ');
  assert.equal((await getHistory(ctxAs(db, 'boss'))).length, 0, 'ต้องไม่มีประวัติงอกขึ้นมา');
});

test('RegionAdmin ยังแก้ข้อมูลช่องอื่นได้ตามปกติ ตราบใดที่ไม่แตะสถานะ', async () => {
  // กันการกันสิทธิ์ที่กว้างเกินไป จนทำงานประจำวันไม่ได้
  const db = freshDb();
  const [unit] = await getAirList(ctxAs(db, 'somchai'));
  await saveAirUnit(ctxAs(db, 'somchai'), { ...unit, Note: 'ตรวจแล้ววันนี้' });

  const [after] = await getAirList(ctxAs(db, 'boss'));
  assert.equal(after.Note, 'ตรวจแล้ววันนี้');
  assert.equal(after.Status, 'ชำรุด');
});

test('RegionAdmin ยังตั้งสถานะอื่นในวงจรงานซ่อมได้', async () => {
  // แจ้งชำรุดและปลดระวางเป็นงานหน้างาน ไม่ใช่การอนุมัติค่าใช้จ่าย
  for (const status of ['รื้อถอน/ปลดระวาง', 'ใช้งานปกติ']) {
    const db = freshDb();
    await saveAirUnit(ctxAs(db, 'somchai'), await unitWithStatus(db, 'somchai', status));
    assert.equal(await statusOf(db), status, 'ตั้งสถานะ "' + status + '" ควรทำได้');
  }
});

test('เปิดฟอร์มมาแก้ช่องอื่นโดยสถานะยังเป็นรอซ่อมเหมือนเดิม ต้องไม่ถูกปฏิเสธ', async () => {
  // สถานะ "ไม่เปลี่ยน" ไม่ใช่การอนุมัติ จึงไม่ควรต้องเป็น Admin
  const db = freshDb();
  await saveAirUnit(ctxAs(db, 'boss'), await unitWithStatus(db, 'boss', 'รอซ่อม'));

  const [unit] = await getAirList(ctxAs(db, 'somchai'));
  assert.equal(unit.Status, 'รอซ่อม');
  await saveAirUnit(ctxAs(db, 'somchai'), { ...unit, Note: 'ช่างนัดวันพรุ่งนี้' });

  const [after] = await getAirList(ctxAs(db, 'boss'));
  assert.equal(after.Note, 'ช่างนัดวันพรุ่งนี้');
  assert.equal(after.Status, 'รอซ่อม');
});

test('หน้าเว็บซ่อนตัวเลือกที่ตั้งไม่ได้ แต่ระบุไว้ว่าด่านจริงอยู่ที่เซิร์ฟเวอร์', async () => {
  // กันไม่ให้ใครในอนาคตเข้าใจผิดว่าการซ่อนปุ่มคือการกันสิทธิ์
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

  const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
  assert.ok(html.includes('function statusChoices('), 'ต้องมีตัวกรองตัวเลือกสถานะ');
  assert.ok(html.includes('statusChoices(data.Status)'), 'ฟอร์มแก้ไขต้องใช้ตัวกรองนั้น');

  const airlist = readFileSync(join(ROOT, 'src', 'modules', 'airlist.js'), 'utf8');
  assert.ok(airlist.includes('ADMIN_ONLY_STATUS'), 'ด่านฝั่งเซิร์ฟเวอร์ต้องยังอยู่');
});
