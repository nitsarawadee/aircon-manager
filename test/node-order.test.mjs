/**
 * เรียงเครื่องให้ Node เดียวกันอยู่ติดกัน ตามเลขเครื่อง (orderByNode) — เจ้าของงานขอ
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - Node เดียวกันอยู่ติดกัน ลำดับ Node ตามที่โผล่ครั้งแรก (= ลำดับไฟล์ Excel เดิม) ไม่เรียง A→Z ใหม่
 * - ในแต่ละ Node เรียงตามเลขเครื่อง — มี 1 กับ 3 แล้วเพิ่ม 2 ต้องได้ 1, 2, 3
 * - ใช้กับตารางแผน / ฟอร์มแผนที่โหลดออก (getCleaningPlan) และไฟล์สำหรับแก้ของรายการเครื่อง
 * - แค่ลำดับที่ส่งออก แถวในฐานข้อมูลไม่ย้าย
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { orderByNode } from '../src/values.js';
import { createCleaningPlan, syncCleaningPlan, getCleaningPlan } from '../src/modules/plan.js';
import { getAirUnitImportFile } from '../src/modules/airlist.js';

const codes = rows => rows.map(r => r.AirCode);

test('orderByNode — Node ติดกัน ลำดับ Node คงเดิม ในแต่ละ Node เรียงเลขเครื่อง', () => {
  const rows = [
    { AirCode: 'CCO-BWA-AIR-1', SiteCode: 'CCO-BWA' },
    { AirCode: 'ATG-ATG-AIR-1', SiteCode: 'ATG-ATG' },
    { AirCode: 'ATG-ATG-AIR-3', SiteCode: 'ATG-ATG' },
    { AirCode: 'BKK-RCD-AIR-10', SiteCode: 'BKK-RCD' },
    { AirCode: 'BKK-RCD-AIR-9', SiteCode: 'BKK-RCD' },
    { AirCode: 'CCO-BWA-AIR-2', SiteCode: 'CCO-BWA' },   // เพิ่มทีหลัง ต่อท้าย
    { AirCode: 'ATG-ATG-AIR-2', SiteCode: 'ATG-ATG' }    // เพิ่มทีหลัง แทรกระหว่าง 1 กับ 3
  ];
  const copy = rows.slice();
  assert.deepEqual(codes(orderByNode(rows)), [
    'CCO-BWA-AIR-1', 'CCO-BWA-AIR-2',
    'ATG-ATG-AIR-1', 'ATG-ATG-AIR-2', 'ATG-ATG-AIR-3',
    'BKK-RCD-AIR-9', 'BKK-RCD-AIR-10'   // เลข ไม่ใช่ตัวอักษร (10 หลัง 9)
  ]);
  assert.deepEqual(rows, copy, 'ต้องไม่แก้ array ที่ส่งมา');
});

test('orderByNode — ไม่มี SiteCode ใช้ชื่อ Node / ต้นรหัส · รหัสไม่มีเลขเครื่องอยู่ท้าย Node', () => {
  const rows = [
    { AirCode: 'X-AIR-2', NodeName: 'เอ็กซ์' },
    { AirCode: 'Y-AIR-1' },
    { AirCode: 'X-SPARE', NodeName: 'เอ็กซ์' },
    { AirCode: 'X-AIR-1', NodeName: 'เอ็กซ์' },
    { AirCode: 'Y-AIR-2' }
  ];
  assert.deepEqual(codes(orderByNode(rows)), ['X-AIR-1', 'X-AIR-2', 'X-SPARE', 'Y-AIR-1', 'Y-AIR-2']);
});

/* ==================== แผน + ไฟล์สำหรับแก้ ==================== */

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)')
    .run('admin', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x');
  const a = db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, BTU, CleaningPricePerRound)
                        VALUES (?,?,?,?,?,?,?)`);
  a.run('CCO-BWA-AIR-1', 'บางวัว', 'CCO-BWA', '1', 'ใช้งานปกติ', 18000, 500);
  a.run('ATG-ATG-AIR-1', 'อ่างทอง', 'ATG-ATG', '1', 'ใช้งานปกติ', 18000, 450);
  a.run('ATG-ATG-AIR-3', 'อ่างทอง', 'ATG-ATG', '1', 'ใช้งานปกติ', 18000, 450);
  a.run('BKK-RCD-AIR-1', 'รัชดา', 'BKK-RCD', '1', 'ใช้งานปกติ', 36000, 750);
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = db => { const c = new Ctx({}, state, db); c.username = 'admin'; return c; };

test('แผน: เครื่องที่อัปเดตเข้าแผนทีหลังไปอยู่ใน Node ของตัวเอง ตามเลขเครื่อง (ไม่ใช่แถวสุดท้าย)', async () => {
  const db = freshDb();
  await createCleaningPlan(as(db), 2030, 3);
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status, BTU, CleaningPricePerRound)
              VALUES ('ATG-ATG-AIR-2','อ่างทอง','ATG-ATG','1','ใช้งานปกติ',12000,400)`).run();
  const preview = await syncCleaningPlan(as(db), 2030, false);
  await syncCleaningPlan(as(db), 2030, true, preview.counts);

  // ในฐานข้อมูลยังต่อท้าย (ไม่ย้ายแถว) แต่ที่ส่งออกเรียงแล้ว
  const stored = db.prepare('SELECT AirCode FROM plans WHERE Year = 2030 ORDER BY rowid').all().map(r => r.AirCode);
  assert.equal(stored[stored.length - 1], 'ATG-ATG-AIR-2');
  assert.deepEqual(codes(await getCleaningPlan(as(db), 2030)),
    ['CCO-BWA-AIR-1', 'ATG-ATG-AIR-1', 'ATG-ATG-AIR-2', 'ATG-ATG-AIR-3', 'BKK-RCD-AIR-1']);
});

test('ไฟล์สำหรับแก้ของรายการเครื่อง: Node เดียวกันเรียงต่อกันตามเลขเครื่อง', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status)
              VALUES ('ATG-ATG-AIR-2','อ่างทอง','ATG-ATG','1','ใช้งานปกติ')`).run();
  const file = await getAirUnitImportFile(as(db));
  assert.deepEqual(file.rows.map(r => r.SiteCode + '-AIR-' + r.AirNo),
    ['CCO-BWA-AIR-1', 'ATG-ATG-AIR-1', 'ATG-ATG-AIR-2', 'ATG-ATG-AIR-3', 'BKK-RCD-AIR-1']);
});
