/**
 * รอบที่ปิดแล้ว เปลี่ยนสถานะกลับไม่ได้ (เจ้าของงานกำหนด 16/10/2569)
 *
 * เดิมหน้าต่างรอบเลือกสถานะอื่นให้รอบที่ล้างแล้วได้ แต่วันที่ล้างจริงยังค้าง — สรุปแผนนับเสร็จ
 * การ์ดนัดโชว์เป็นนัด รอบถัดไปบันทึกไม่ได้ "ยกเลิก" ทำค่าล้างหายจากสรุปแผนแต่ยังอยู่ในงบ
 *
 *   ปิดด้วยใบล้าง          ห้ามเปลี่ยน (เปิดรอบกลับ = ลบใบล้าง)
 *   ปิดจากระบบเดิม ไม่มีใบ  Infrastructure แก้ได้ และวันล้างจริงถูกล้างออก
 *   ตั้งวันทั้ง Node / นำเข้าแผน  ไม่ทับวันนัดและผู้รับเหมาของรอบที่ปิดแล้ว
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { saveCleaningForm } from '../src/modules/cleaningform.js';
import {
  getCleaningPlan, updateCleaningRound, updatePlanDatesByNode, updatePlanBulk
} from '../src/modules/plan.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  user.run('boss', 'ผู้ดูแลระบบ', 'Admin', '', '', 1, 'x', '');
  user.run('reg1', 'ภาค 1', 'RegionAdmin', '1', '', 1, 'x', '');
  user.run('ctA', 'ช่าง A', 'Contractor', '', '', 1, 'x', 'CT001');
  const ct = db.prepare('INSERT INTO contractors (ID, Name, Active) VALUES (?,?,?)');
  ct.run('CT001', 'บริษัท เอ', 1);
  ct.run('CT002', 'บริษัท บี', 1);
  const unit = db.prepare(`INSERT INTO air_units
      (AirCode, NodeName, SiteCode, Region, Province, LocationType, Status, CleaningPricePerRound)
      VALUES (?,?,?,?,?,?,?,?)`);
  unit.run('ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 500);
  unit.run('ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '1', 'อ่างทอง', 'Shop House', 'ใช้งานปกติ', 500);
  const plan = db.prepare(`INSERT INTO plans (Year, AirCode, NodeName, SiteCode, R1_PlanDate, R1_Status, R1_ActualDate, R1_Price, R1_ContractorID)
      VALUES (?,?,?,?,?,?,?,?,?)`);
  // AIR-1 จะปิดด้วยใบล้างในเทสต์ · AIR-2 ปิดมาจากระบบเดิม (ไม่มีใบ)
  plan.run(2026, 'ATG-PMK-AIR-1', 'ป่าโมก', 'ATG-PMK', '2026-09-10', 'นัดหมายแล้ว', '', 500, 'CT001');
  plan.run(2026, 'ATG-PMK-AIR-2', 'ป่าโมก', 'ATG-PMK', '2026-08-01', 'ล้างเสร็จสิ้น', '2026-08-02', 500, 'CT001');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {} };
const as = (db, username) => { const c = new Ctx({}, state, db, {}); c.username = username; return c; };
const r1 = (db, code) => db.prepare('SELECT R1_PlanDate AS plan, R1_Status AS status, R1_ActualDate AS actual, R1_ContractorID AS cid FROM plans WHERE AirCode = ?').get(code);
const rowOf = { 'ATG-PMK-AIR-1': 2, 'ATG-PMK-AIR-2': 3 };
const round = (over = {}) => ({ planDate: '2026-09-10', actualDate: '2026-09-15', price: 500, technician: '', contractorId: 'CT001', status: 'ล้างเสร็จสิ้น', note: '', ...over });

async function closeWithForm(db) {
  await saveCleaningForm(as(db, 'boss'), {
    NodeName: 'ป่าโมก', SiteCode: 'ATG-PMK', Region: '1', Date: '2026-09-15', PlanYear: 2026, PlanRound: 1,
    AirCode1: 'ATG-PMK-AIR-1', Price1: 500, TechnicianName: 'ช่าง', Checklist: []
  });
}

test('รอบที่ปิดด้วยใบล้าง — เปลี่ยนเป็นสถานะอื่นไม่ได้ แม้เป็น Infrastructure และบอกเลขใบ', async () => {
  const db = freshDb();
  await closeWithForm(db);

  for (const status of ['รอดำเนินการ', 'นัดหมายแล้ว', 'ยกเลิก']) {
    await assert.rejects(
      () => updateCleaningRound(as(db, 'boss'), 2026, rowOf['ATG-PMK-AIR-1'], 1, round({ status })),
      /ปิดงานด้วยใบล้างเลขที่ PM2609-01 แล้ว เปลี่ยนสถานะไม่ได้/
    );
  }
  assert.deepEqual({ ...r1(db, 'ATG-PMK-AIR-1') }, { plan: '2026-09-10', status: 'ล้างเสร็จสิ้น', actual: '2026-09-15', cid: 'CT001' });
});

test('รอบที่ปิดด้วยใบล้าง — ยังแก้ราคาได้ และวันล้างจริงคงเดิม ไม่รับจากหน้าเว็บ', async () => {
  const db = freshDb();
  await closeWithForm(db);
  await updateCleaningRound(as(db, 'boss'), 2026, rowOf['ATG-PMK-AIR-1'], 1, round({ price: 650, actualDate: '' }));

  const row = db.prepare('SELECT R1_Status AS s, R1_ActualDate AS a, R1_Price AS p FROM plans WHERE AirCode = ?').get('ATG-PMK-AIR-1');
  assert.deepEqual({ ...row }, { s: 'ล้างเสร็จสิ้น', a: '2026-09-15', p: 650 });
});

test('รอบที่ปิดจากระบบเดิม (ไม่มีใบ) — Infrastructure เปลี่ยนได้และวันล้างจริงถูกล้างออก · คนอื่นเปลี่ยนไม่ได้', async () => {
  const db = freshDb();
  await assert.rejects(
    () => updateCleaningRound(as(db, 'reg1'), 2026, rowOf['ATG-PMK-AIR-2'], 1, round({ status: 'รอดำเนินการ', actualDate: '2026-08-02' })),
    /เปลี่ยนสถานะได้เฉพาะ Infrastructure/
  );
  assert.equal(r1(db, 'ATG-PMK-AIR-2').status, 'ล้างเสร็จสิ้น');

  await updateCleaningRound(as(db, 'boss'), 2026, rowOf['ATG-PMK-AIR-2'], 1,
    round({ planDate: '2026-08-01', status: 'รอดำเนินการ', actualDate: '2026-08-02' }));
  const after = r1(db, 'ATG-PMK-AIR-2');
  assert.equal(after.actual, '', 'วันล้างจริงต้องถูกล้าง ไม่งั้นสรุปแผนยังนับว่าเสร็จ');
  assert.equal(after.status, 'นัดหมายแล้ว');   // มีวันตามแผน = นัดหมายแล้ว (กติกาเดิม)
});

test('หน้าแผนได้เลขใบล้างของรอบที่ปิดด้วยใบ — ผู้รับเหมาไม่เห็นเลขของรอบเจ้าอื่น', async () => {
  const db = freshDb();
  await closeWithForm(db);
  const plan = await getCleaningPlan(as(db, 'boss'), 2026);
  assert.equal(plan.find(p => p.AirCode === 'ATG-PMK-AIR-1').R1_DocNo, 'PM2609-01');
  assert.equal(plan.find(p => p.AirCode === 'ATG-PMK-AIR-2').R1_DocNo, '');

  db.prepare("UPDATE plans SET R1_ContractorID = 'CT002' WHERE AirCode = 'ATG-PMK-AIR-1'").run();
  db.prepare("UPDATE plans SET R2_ContractorID = 'CT001' WHERE AirCode = 'ATG-PMK-AIR-1'").run();
  const seen = await getCleaningPlan(as(db, 'ctA'), 2026);
  assert.equal(seen.find(p => p.AirCode === 'ATG-PMK-AIR-1').R1_DocNo, '');
});

test('ตั้งวันทั้ง Node — ไม่ทับวันนัดและผู้รับเหมาของรอบที่ปิดแล้ว', async () => {
  const db = freshDb();
  await closeWithForm(db);
  await updatePlanDatesByNode(as(db, 'boss'), 2026, 'ป่าโมก', { r1: '2026-10-20' }, { r1: 'CT002' });

  assert.deepEqual({ ...r1(db, 'ATG-PMK-AIR-1') }, { plan: '2026-09-10', status: 'ล้างเสร็จสิ้น', actual: '2026-09-15', cid: 'CT001' });
  assert.deepEqual({ ...r1(db, 'ATG-PMK-AIR-2') }, { plan: '2026-08-01', status: 'ล้างเสร็จสิ้น', actual: '2026-08-02', cid: 'CT001' });
});

test('นำเข้าแผน — ไม่ทับวันนัดของรอบที่ปิดแล้ว และนับรอบที่ข้ามไว้รอบละครั้ง', async () => {
  const db = freshDb();
  const res = await updatePlanBulk(as(db, 'boss'), 2026, [
    { AirCode: 'ATG-PMK-AIR-1', R1_PlanDate: '20/10/2026' },
    { AirCode: 'ATG-PMK-AIR-2', R1_PlanDate: '20/10/2026', R1_Contractor: 'บริษัท เอ' }
  ]);

  assert.equal(r1(db, 'ATG-PMK-AIR-1').plan, '2026-10-20', 'รอบที่ยังไม่ล้างรับวันจากไฟล์ตามปกติ');
  assert.deepEqual({ ...r1(db, 'ATG-PMK-AIR-2') }, { plan: '2026-08-01', status: 'ล้างเสร็จสิ้น', actual: '2026-08-02', cid: 'CT001' });
  assert.equal(res.skippedDoneRounds, 1);
});
