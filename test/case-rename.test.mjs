/**
 * เปลี่ยนเลขเคสเก่า RC → IC ตอนเปิดเซิร์ฟเวอร์ (renameRepairCaseIds)
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { renameRepairCaseIds } from '../src/db/migrate.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const h = db.prepare('INSERT INTO history (ID, AirCode, EventType, CaseID) VALUES (?,?,?,?)');
  h.run('CM2609-01', 'A-1', 'แจ้งซ่อม', 'RC2609-01');
  h.run('CM2609-02', 'A-1', 'ซ่อมแล้ว', 'RC2609-01');
  h.run('CM2609-03', 'B-1', 'แจ้งซ่อม', 'RC2609-02');
  h.run('CM2609-04', 'C-1', 'แจ้งซ่อม', 'IC2609-02');   // เคสใหม่ที่เปิดหลังเปลี่ยนเป็น IC แล้ว
  h.run('PM2609-01', 'A-1', 'ล้างแอร์', '');
  db.prepare("INSERT INTO repair_forms (ID, AirCode, CaseID) VALUES ('RF1', 'A-1', 'RC2609-01')").run();
  return db;
}
const caseOf = (db, id) => db.prepare('SELECT CaseID FROM history WHERE ID = ?').get(id).CaseID;

test('RC → IC เลขลำดับเดิม ทุกใบของเคสเดียวกันเปลี่ยนพร้อมกัน รวมใบซ่อม', () => {
  const db = freshDb();
  assert.equal(renameRepairCaseIds(db), 2);
  assert.equal(caseOf(db, 'CM2609-01'), 'IC2609-01');
  assert.equal(caseOf(db, 'CM2609-02'), 'IC2609-01');
  assert.equal(db.prepare("SELECT CaseID FROM repair_forms WHERE ID = 'RF1'").get().CaseID, 'IC2609-01');
  assert.equal(caseOf(db, 'PM2609-01'), '', 'ใบที่ไม่มีเคสไม่ถูกแตะ');
});

test('เลข IC ที่มีคนใช้แล้ว — ต้องไม่ชน ได้เลขว่างถัดไปของเดือนนั้นแทน', () => {
  const db = freshDb();
  renameRepairCaseIds(db);
  assert.equal(caseOf(db, 'CM2609-04'), 'IC2609-02', 'เคสใหม่คงเลขเดิม');
  assert.equal(caseOf(db, 'CM2609-03'), 'IC2609-03', 'RC2609-02 ชนกับ IC2609-02 จึงได้ IC2609-03');
});

test('รันซ้ำได้ — ไม่เหลือ RC ก็ไม่ทำอะไร', () => {
  const db = freshDb();
  renameRepairCaseIds(db);
  assert.equal(renameRepairCaseIds(db), 0);
});
