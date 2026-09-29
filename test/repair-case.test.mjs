/**
 * ล็อกเส้นทางของเคสงานซ่อม
 *
 * ทุกใบตั้งแต่เปิดเคสจนปิดเคสต้องถือเลขเคสเดียวกัน ไม่งั้นจะไม่มีอะไรบอกว่า
 * ใบไหนเป็นเรื่องเดียวกัน ต้องเดาเอาจากวันที่กับลำดับ ซึ่งผิดได้ง่ายเมื่อ
 * เครื่องตัวเดียวเสียหลายรอบในเดือนเดียว
 *
 * และสถานะของเครื่องต้องเดินตามขั้นของเคสเสมอ กดปุ่มเดียวเปลี่ยนทั้งสองอย่าง
 * พร้อมกัน ไม่ใช่ให้คนไปเปลี่ยนสถานะเองอีกที่หนึ่ง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { getAirList, replaceAirUnit, saveAirUnit } from '../src/modules/airlist.js';
import {
  getHistory, reportRepair, markCannotRepair, completeRepairRecord
} from '../src/modules/history.js';
import { buildCases, openCaseOf, makeCaseId } from '../src/modules/repair-case.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare(
    'INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)'
  ).run('tester', 'ผู้ทดสอบ', 'Admin', '', '', 1, 'x');
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, IndoorSN)
              VALUES ('A-AIR-1','โหนดทดสอบ','A','1','ใช้งานปกติ','SN-เก่า')`).run();
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const ctxOf = db => { const c = new Ctx({}, state, db); c.username = 'tester'; return c; };
const unit = async db => (await getAirList(ctxOf(db)))[0];
const hist = db => getHistory(ctxOf(db));

/**
 * เปลี่ยนสถานะผ่านหน้าแก้ไขข้อมูลเครื่อง — ทางเดียวที่ผู้ใช้เลื่อนขั้นเคสจริง
 *
 * ไม่มีปุ่มลัดในหน้างานซ่อมแล้ว การเลื่อนจาก "ชำรุด" ไป "รอซ่อม" ทำที่ฟอร์มนี้
 * เทสต์จึงต้องเดินทางเดียวกับผู้ใช้ ไม่ใช่เรียกฟังก์ชันลัดที่ไม่มีใครใช้
 */
const setStatus = async (db, status) => {
  const u = await unit(db);
  return saveAirUnit(ctxOf(db), { ...u, Status: status });
};

/* ==================== การออกเลขเคส ==================== */

test('เลขเคสรันต่อกันในเดือนเดียวกัน และขึ้นต้นด้วย IC', () => {
  const at = new Date('2026-09-15T03:00:00Z');
  assert.equal(makeCaseId([], at), 'IC2609-01');
  assert.equal(makeCaseId(['IC2609-01'], at), 'IC2609-02');
  assert.equal(makeCaseId(['IC2609-01', 'IC2609-09'], at), 'IC2609-10');
});

test('เลขเคสของเดือนอื่นไม่กวนกัน', () => {
  const sep = new Date('2026-09-15T03:00:00Z');
  assert.equal(makeCaseId(['IC2608-07'], sep), 'IC2609-01', 'ของเดือนสิงหาไม่ควรดันเลขเดือนกันยา');
});

/* ==================== เส้นทางปกติ: เปิด -> เริ่มซ่อม -> ปิด ==================== */

test('แจ้งซ่อมต้องเปิดเคสใหม่ และเครื่องเป็น "ชำรุด" ไม่ใช่ "รอซ่อม"', async () => {
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'คอมเพรสเซอร์ดัง' });

  assert.equal((await unit(db)).Status, 'ชำรุด', 'เปิดเคสแล้วยังไม่ถึงขั้นรอซ่อม');

  const rows = await hist(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].EventType, 'แจ้งซ่อม');
  assert.ok(/^IC\d{4}-\d+$/.test(rows[0].CaseID), 'ต้องได้เลขเคส: ' + rows[0].CaseID);
});

test('เริ่มซ่อมต้องอยู่ในเคสเดิม และเครื่องเป็น "รอซ่อม"', async () => {
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'คอมเพรสเซอร์ดัง' });
  const caseId = (await hist(db))[0].CaseID;

  await setStatus(db, 'รอซ่อม');

  assert.equal((await unit(db)).Status, 'รอซ่อม');
  const rows = await hist(db);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.CaseID === caseId), 'ทุกใบต้องถือเลขเคสเดียวกัน');
});

test('ปิดงานซ่อมต้องอยู่ในเคสเดิม เครื่องกลับมาใช้งานปกติ และเคสปิด', async () => {
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'คอมเพรสเซอร์ดัง' });
  await setStatus(db, 'รอซ่อม');
  await completeRepairRecord(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'เปลี่ยนคอม', Cost: 3200 });

  assert.equal((await unit(db)).Status, 'ใช้งานปกติ');

  const cases = buildCases(await hist(db));
  assert.equal(cases.length, 1, 'ต้องเป็นเคสเดียวตลอดทั้งเรื่อง');
  assert.equal(cases[0].events.length, 3);
  assert.equal(cases[0].closed, true, 'ซ่อมเสร็จแล้วเคสต้องปิด');
  assert.equal(cases[0].cost, 3200);
});

/* ==================== เส้นทางซ่อมไม่ได้: เปิด -> รื้อถอน -> เปลี่ยนเครื่อง -> ปิด ==================== */

test('ซ่อมไม่ได้ต้องบังคับให้ระบุเหตุผล', async () => {
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'คอมเพรสเซอร์ดัง' });

  await assert.rejects(
    () => markCannotRepair(ctxOf(db), { AirCode: 'A-AIR-1', Reason: '   ' }),
    /ระบุเหตุผล/
  );
  assert.equal((await unit(db)).Status, 'ชำรุด', 'ถูกปฏิเสธแล้วต้องไม่เปลี่ยนสถานะ');
});

test('ซ่อมไม่ได้แล้วเคสต้องยังเปิดค้าง เพราะรอเครื่องใหม่', async () => {
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'คอมเพรสเซอร์ดัง' });
  await markCannotRepair(ctxOf(db), { AirCode: 'A-AIR-1', Reason: 'อะไหล่เลิกผลิต' });

  const u = await unit(db);
  assert.equal(u.Status, 'รื้อถอน/ปลดระวาง');
  assert.ok(u.Note.includes('อะไหล่เลิกผลิต'), 'เหตุผลต้องติดอยู่กับเครื่องด้วย');

  const cases = buildCases(await hist(db));
  assert.equal(cases[0].closed, false, 'ยังไม่ปิด เพราะตำแหน่งนี้ยังไม่มีแอร์ใช้งาน');
});

test('เปลี่ยนเครื่องหลังซ่อมไม่ได้ ต้องอยู่ในเคสเดิมและปิดเคส', async () => {
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'คอมเพรสเซอร์ดัง' });
  await markCannotRepair(ctxOf(db), { AirCode: 'A-AIR-1', Reason: 'อะไหล่เลิกผลิต' });

  const u = await unit(db);
  await replaceAirUnit(ctxOf(db), u._row, { IndoorSN: 'SN-ใหม่', Brand: 'Daikin' }, 'A-AIR-1');

  assert.equal((await unit(db)).Status, 'ใช้งานปกติ');
  assert.equal((await unit(db)).IndoorSN, 'SN-ใหม่');

  const cases = buildCases(await hist(db));
  assert.equal(cases.length, 1, 'ทั้งเรื่องต้องเป็นเคสเดียว');
  assert.deepEqual(cases[0].events.map(e => e.EventType),
    ['แจ้งซ่อม', 'รื้อถอน/ปลดระวาง', 'เปลี่ยนเครื่อง']);
  assert.equal(cases[0].closed, true, 'เปลี่ยนเครื่องเสร็จแล้วเคสต้องปิด');
});

/* ==================== กันเปิดเคสซ้อน ==================== */

test('แจ้งซ่อมซ้ำตอนที่ยังมีเคสค้าง ต้องไปต่อในเคสเดิม ไม่เปิดเคสใหม่', async () => {
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'คอมเพรสเซอร์ดัง' });
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'เพิ่มเติม: มีน้ำหยดด้วย' });

  const cases = buildCases(await hist(db));
  assert.equal(cases.length, 1, 'เรื่องเดียวต้องไม่กลายเป็นสองเคส');
  assert.equal(cases[0].events.length, 2);
});

test('เสียรอบใหม่หลังปิดเคสแล้ว ต้องเป็นเคสใหม่', async () => {
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'รอบแรก' });
  await setStatus(db, 'รอซ่อม');
  await completeRepairRecord(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'ซ่อมเสร็จ', Cost: 500 });
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'รอบสอง' });

  const cases = buildCases(await hist(db));
  assert.equal(cases.length, 2, 'คนละรอบต้องคนละเคส');
  assert.equal(cases.filter(c => !c.closed).length, 1, 'เปิดค้างอยู่เคสเดียว');
});

test('เครื่องที่ค้างสถานะซ่อมมาแต่ไม่มีเลขเคส ต้องเดินต่อได้ ไม่ใช่ติดค้างถาวร', async () => {
  // เกิดกับข้อมูลที่มีอยู่ก่อนระบบเคส ประวัติเดิมไม่มีเลขเคสสักใบ
  // ถ้าปฏิเสธเพราะ "หาเคสไม่เจอ" เครื่องพวกนี้จะกดปุ่มไหนก็ไม่ได้ ต้องไปแก้ฐานข้อมูลเอง
  const db = freshDb();
  db.prepare("UPDATE air_units SET Status = 'ชำรุด' WHERE AirCode = 'A-AIR-1'").run();
  db.prepare(`INSERT INTO history (ID, AirCode, Date, EventType, Detail)
              VALUES ('CM2608-01','A-AIR-1','2026-08-01','แจ้งซ่อม','ของเก่าไม่มีเลขเคส')`).run();

  await setStatus(db, 'รอซ่อม');

  assert.equal((await unit(db)).Status, 'รอซ่อม');
  const withCase = (await hist(db)).filter(h => String(h.CaseID || '').trim());
  assert.equal(withCase.length, 1, 'ใบใหม่ต้องได้เลขเคส');
  assert.ok(/^IC\d{4}-\d+$/.test(withCase[0].CaseID));
});

test('openCaseOf ต้องคืนเฉพาะเคสที่ยังเปิดของเครื่องตัวนั้น', async () => {
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'x' });
  const rows = await hist(db);

  assert.ok(openCaseOf(rows, 'a-air-1'), 'ต้องไม่สนตัวพิมพ์เล็กใหญ่');
  assert.equal(openCaseOf(rows, 'ไม่มีเครื่องนี้'), null);
});

test('ปิดงานตอนยังเป็น "ชำรุด" ไม่ได้ ต้องกดเริ่มซ่อมก่อน', async () => {
  // ขั้นชำรุดคือเพิ่งเปิดเคส ยังไม่มีใครลงมือซ่อม ปิดงานตอนนั้นจะได้ประวัติ
  // ที่บอกว่าซ่อมเสร็จทั้งที่ยังไม่ได้เริ่ม
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'คอมเพรสเซอร์ดัง' });

  await assert.rejects(
    () => completeRepairRecord(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'ซ่อมเสร็จ', Cost: 100 }),
    /ยังปิดงานซ่อมไม่ได้/
  );

  assert.equal((await unit(db)).Status, 'ชำรุด', 'ถูกปฏิเสธแล้วต้องไม่เปลี่ยนอะไร');
  assert.equal((await hist(db)).length, 1, 'ต้องไม่มีใบซ่อมแล้วงอกขึ้นมา');
});

test('ปิดงานตอนที่รื้อถอนไปแล้วก็ไม่ได้เหมือนกัน', async () => {
  const db = freshDb();
  await reportRepair(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'x' });
  await markCannotRepair(ctxOf(db), { AirCode: 'A-AIR-1', Reason: 'อะไหล่เลิกผลิต' });

  await assert.rejects(
    () => completeRepairRecord(ctxOf(db), { AirCode: 'A-AIR-1', Detail: 'ซ่อมเสร็จ' }),
    /ยังปิดงานซ่อมไม่ได้/
  );
});
