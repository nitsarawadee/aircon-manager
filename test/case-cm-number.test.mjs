/**
 * งานซ่อมเรื่องเดียวกันใช้เลข CM เลขเดียวทั้งหมด — ไม่มีเลขเคส IC แยกแล้ว (เจ้าของงานกำหนด 15/10/2569)
 *
 * - เลขเคส = เลขอ้างอิง (CM) ของใบแรกของเคส (ใบแจ้งซ่อม)
 * - ทุกเหตุการณ์ในเคส (อนุมัติซ่อม · ซ่อมไม่ได้ · เปลี่ยนเครื่อง) ถือเลขเคสนั้น
 * - ใบซ่อมของเคสใช้เลขเดียวกับเคส · ใบติดตั้งหลังเปลี่ยนเครื่อง (ปิดเคส) ก็ใช้เลขเดียวกับเคส
 * - เคสเก่าที่เป็น IC แปลงเป็นเลขของใบแรก ทุกตารางที่เก็บเลขเคส (caseIdsToFirstEventNo)
 */

import { strict as assert } from 'node:assert';
import test, { mock } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { caseIdsToFirstEventNo } from '../src/db/migrate.js';
import { Ctx } from '../src/context.js';
import { saveAirUnit, replaceAirUnit } from '../src/modules/airlist.js';
import { reportRepair, markCannotRepair } from '../src/modules/history.js';
import { saveRepairForm } from '../src/modules/repairform.js';
import { saveInstallForm } from '../src/modules/installform.js';

// ข้อมูลทดสอบไฟล์นี้ใช้ปี 2030 — ตั้งนาฬิกาให้เป็นปลายปี 2030
// เพราะวันที่ปิดงานห้ามเป็นวันล่วงหน้า (assertNotFuture · ผู้ใช้ขอ 20/10/2569)
mock.timers.enable({ apis: ['Date'], now: new Date('2030-12-31T05:00:00Z') });

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  const a = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Province, Status, BTU, Brand, IndoorSN)
                        VALUES (?,?,?,?,?,?,?,?,?)`);
  a.run('ATG-ATG-AIR-1', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'ใช้งานปกติ', 18000, 'Carrier', 'OLD-1');
  a.run('ATG-ATG-AIR-2', 'อ่างทอง', 'ATG-ATG', '1', 'อ่างทอง', 'ใช้งานปกติ', 18000, 'Carrier', 'OLD-2');
  return db;
}
const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };
const infra = db => { const c = new Ctx({}, state, db, {}); c.username = 'infra'; return c; };
const rowOf = (db, code) => db.prepare('SELECT rowid AS r FROM air_units WHERE AirCode = ?').get(code).r + 1;
const histOf = (db, code) => db.prepare('SELECT ID, CaseID, EventType FROM history WHERE AirCode = ? ORDER BY rowid').all(code);
const approve = async (db, code) => {
  const u = db.prepare('SELECT * FROM air_units WHERE AirCode = ?').get(code);
  await saveAirUnit(infra(db), { _row: rowOf(db, code), AirCode: code, Region: u.Region, Status: 'รอซ่อม' });
};

test('แจ้งซ่อม → อนุมัติ → ใบซ่อม: ทั้งเรื่องใช้เลข CM ของใบแจ้งซ่อม รวมเลขที่ใบซ่อม', async () => {
  const db = freshDb();
  await reportRepair(infra(db), { AirCode: 'ATG-ATG-AIR-1', Detail: 'ไม่เย็น', Date: '2030-01-10' });
  const caseNo = histOf(db, 'ATG-ATG-AIR-1')[0].ID;
  assert.match(caseNo, /^CM\d{4}-\d+$/);

  await approve(db, 'ATG-ATG-AIR-1');
  const res = await saveRepairForm(infra(db), { AirCode: 'ATG-ATG-AIR-1', Date: '2030-01-12', Symptom: 'ไม่เย็น', Fix: 'เติมน้ำยา', TechnicianName: 'ช่าง', Checklist: [], Parts: [] });

  assert.equal(res.docNo, caseNo, 'เลขที่ใบซ่อม = เลขของเรื่อง');
  assert.equal(res.caseId, caseNo);
  const rows = histOf(db, 'ATG-ATG-AIR-1');
  assert.deepEqual(rows.map(r => r.EventType), ['แจ้งซ่อม', 'รอซ่อม', 'ซ่อมแล้ว']);
  assert.ok(rows.every(r => r.CaseID === caseNo), 'ทุกเหตุการณ์ของเรื่องถือเลขเดียวกัน');
  assert.equal(new Set(rows.map(r => r.ID)).size, 3, 'แต่ละแถวยังมีเลขของตัวเองไม่ซ้ำ (ใช้ลบ/อ้างอิงภายใน)');

  // เสียรอบใหม่ = เรื่องใหม่ ได้เลขใหม่
  await reportRepair(infra(db), { AirCode: 'ATG-ATG-AIR-1', Detail: 'น้ำหยด', Date: '2030-02-01' });
  const again = histOf(db, 'ATG-ATG-AIR-1').pop();
  assert.notEqual(again.CaseID, caseNo);
  assert.equal(again.CaseID, again.ID);
});

test('ซ่อมไม่ได้ → เปลี่ยนเครื่อง → ใบติดตั้ง: ใช้เลขเดียวกับเรื่องซ่อม', async () => {
  const db = freshDb();
  await reportRepair(infra(db), { AirCode: 'ATG-ATG-AIR-2', Detail: 'ไหม้', Date: '2030-01-10' });
  const caseNo = histOf(db, 'ATG-ATG-AIR-2')[0].ID;
  await markCannotRepair(infra(db), { AirCode: 'ATG-ATG-AIR-2', Reason: 'คอมเสีย', Date: '2030-01-11' });
  await replaceAirUnit(infra(db), rowOf(db, 'ATG-ATG-AIR-2'), { IndoorSN: 'NEW-2', InstallDate: '2030-01-15' }, 'ATG-ATG-AIR-2');
  assert.ok(histOf(db, 'ATG-ATG-AIR-2').every(r => r.CaseID === caseNo), 'ซ่อมไม่ได้/เปลี่ยนเครื่อง อยู่ในเรื่องเดียวกัน');

  const ins = await saveInstallForm(infra(db), { NodeName: 'อ่างทอง', AirCode2: 'ATG-ATG-AIR-2', Date: '2030-01-15', SlotBase: 0, Checklist: [], AcceptResult2: 'ผ่าน' });
  assert.equal(ins.docNo2, caseNo, 'ใบติดตั้งของเครื่องที่เปลี่ยน = เลขของเรื่อง');
});

test('ข้อมูลเดิม: เลขเคส IC → เลข CM ของใบแรก ทุกตารางพร้อมกัน · รันซ้ำไม่ทำอะไร', () => {
  const db = freshDb();
  const h = db.prepare('INSERT INTO history (ID, AirCode, Date, EventType, CaseID, CreatedAt) VALUES (?,?,?,?,?,?)');
  h.run('CM2610-02', 'ATG-ATG-AIR-1', '2026-10-15', 'แจ้งซ่อม', 'IC2610-01', '2026-10-15 11:07:45');
  h.run('CM2610-05', 'ATG-ATG-AIR-1', '2026-10-15', 'รอซ่อม', 'IC2610-01', '2026-10-15 11:20:00');
  h.run('CM2610-09', 'ATG-ATG-AIR-2', '2026-10-15', 'แจ้งซ่อม', 'IC2610-02', '2026-10-15 12:00:00');
  db.prepare("INSERT INTO repair_forms (ID, AirCode, DocNo, CaseID) VALUES ('RF1','ATG-ATG-AIR-1','CM2610-07','IC2610-01')").run();
  db.prepare("INSERT INTO job_assignments (ID, Kind, AirCode, RefID, ContractorID) VALUES ('JA1','repair','ATG-ATG-AIR-1','IC2610-01','CT001')").run();
  db.prepare("INSERT INTO job_assignments (ID, Kind, AirCode, RefID, ContractorID) VALUES ('JA2','install','ATG-ATG-AIR-2','IC2610-02','CT001')").run();
  db.prepare("INSERT INTO warehouse_units (ID, AirCode, CaseID) VALUES ('WH1','ATG-ATG-AIR-2','IC2610-02')").run();

  assert.equal(caseIdsToFirstEventNo(db), 2);
  const caseOf = id => db.prepare('SELECT CaseID FROM history WHERE ID = ?').get(id).CaseID;
  assert.equal(caseOf('CM2610-02'), 'CM2610-02');
  assert.equal(caseOf('CM2610-05'), 'CM2610-02', 'ทั้งเรื่องได้เลขของใบแรก');
  assert.equal(caseOf('CM2610-09'), 'CM2610-09');
  assert.equal(db.prepare("SELECT CaseID FROM repair_forms WHERE ID = 'RF1'").get().CaseID, 'CM2610-02');
  assert.equal(db.prepare("SELECT DocNo FROM repair_forms WHERE ID = 'RF1'").get().DocNo, 'CM2610-07', 'เลขที่ที่พิมพ์ลงเอกสารไปแล้วไม่ถูกแตะ');
  assert.equal(db.prepare("SELECT RefID FROM job_assignments WHERE ID = 'JA1'").get().RefID, 'CM2610-02');
  assert.equal(db.prepare("SELECT RefID FROM job_assignments WHERE ID = 'JA2'").get().RefID, 'IC2610-02', 'งานติดตั้งไม่ได้อ้างเลขเคส ไม่แตะ');
  assert.equal(db.prepare("SELECT CaseID FROM warehouse_units WHERE ID = 'WH1'").get().CaseID, 'CM2610-09');
  assert.equal(caseIdsToFirstEventNo(db), 0, 'รันซ้ำไม่เหลืออะไรให้แปลง');
});
