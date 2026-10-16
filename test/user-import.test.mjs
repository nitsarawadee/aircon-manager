/**
 * นำเข้าผู้ใช้หลายคนทีเดียว (หน้าจัดการผู้ใช้)
 *
 * - ดูผลก่อน (plan) ไม่เขียนอะไร · ยืนยัน (apply) ผิดแถวเดียวไม่เขียนเลย
 * - Username ที่มีอยู่แล้วถูกข้าม ไม่ทับข้อมูล ไม่เปลี่ยนรหัสผ่าน
 * - สิทธิ์รายเมนูได้ค่าตั้งต้นเดียวกับฟอร์มเพิ่มผู้ใช้ · ผู้รับเหมาใช้สิทธิ์ตายตัว
 * - รหัสผ่านถูกแฮช และไม่โผล่ในผลที่ส่งกลับหน้าเว็บ
 * - เฉพาะ Infrastructure
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { planUserImport, applyUserImport, getUserImportTemplate, USER_IMPORT_COLUMNS } from '../src/modules/user-import.js';
import { REGIONAL_DEFAULT_PERMISSIONS } from '../src/schema.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password) VALUES (?,?,?,?,?,?,?)');
  user.run('infra', 'อินฟรา', 'Admin', '', '', 1, 'x');
  user.run('staff', 'สตาฟ', 'Staff', '1', 'airlist:edit', 1, 'x');
  user.run('exist', 'คนเดิม', 'Staff', '2', 'airlist:view', 1, 'oldpass');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };
function as(db, username, backups = []) {
  const c = new Ctx({}, state, db, { backup: reason => { backups.push(reason); return 'backup.db'; } });
  c.username = username;
  return c;
}

const row = (o = {}) => ({ 'Username': 'new.user', 'ชื่อ-นามสกุล': 'คนใหม่', 'อีเมล': '', 'บทบาท': 'Staff', 'Region': '1', 'รหัสผ่าน': 'secret1', 'บริษัทผู้รับเหมา': '', ...o });
const count = db => db.prepare('SELECT COUNT(*) n FROM users').get().n;

test('ดูผลก่อน: นับเพิ่ม/ข้าม/ผิดพลาดถูก และไม่เขียนอะไร', async () => {
  const db = freshDb();
  const plan = await planUserImport(as(db, 'infra'), [
    row({ Username: 'a.one' }),
    row({ Username: 'EXIST', 'บทบาท': 'Staff' }),          // มีแล้ว (ไม่สนตัวพิมพ์) → ข้าม
    row({ Username: 'b.two', 'บทบาท': 'Supervisor', 'Region': '2,3' }),
    row({ Username: '' , 'รหัสผ่าน': '', 'บทบาท': '' }),   // แถวว่างเกือบทั้งแถว
    row({ Username: 'bad name' })
  ]);
  assert.deepEqual(plan.counts, { adds: 2, skips: 1, errors: 2 });
  assert.equal(plan.errors.find(e => e.username === 'bad name').row, 6);   // แถว Excel = ลำดับ + 2
  assert.equal(count(db), 3, 'ดูผลไม่เขียนอะไร');
  assert.ok(!JSON.stringify(plan).includes('secret1'), 'ผลที่ส่งกลับต้องไม่มีรหัสผ่าน');
});

test('กฎตรวจแถว: รหัสผ่านสั้น · บทบาท · Region · ผู้รับเหมา · Username ซ้ำในไฟล์', async () => {
  const db = freshDb();
  const plan = await planUserImport(as(db, 'infra'), [
    row({ Username: 'p.short', 'รหัสผ่าน': '123' }),
    row({ Username: 'p.role', 'บทบาท': 'หัวหน้า' }),
    row({ Username: 'p.noregion', 'Region': '' }),
    row({ Username: 'p.badregion', 'Region': '9' }),
    row({ Username: 'p.sub', 'บทบาท': 'Subcontract', 'บริษัทผู้รับเหมา': '' }),
    row({ Username: 'dup.u' }), row({ Username: 'DUP.u' }),
    row({ Username: 'p.admin', 'บทบาท': 'Infrastructure', 'Region': '' })   // Infrastructure ไม่ต้องมี Region
  ]);
  const msg = u => (plan.errors.find(e => e.username === u) || {}).message || '';
  assert.match(msg('p.short'), /6 ตัว/);
  assert.match(msg('p.role'), /ไม่รู้จักบทบาท/);
  assert.match(msg('p.noregion'), /ต้องระบุ Region/);
  assert.match(msg('p.badregion'), /ไม่มี Region 9/);
  assert.match(msg('p.sub'), /ต้องระบุผู้รับเหมา/);
  assert.match(msg('DUP.u'), /ซ้ำกับแถว/);
  assert.equal(plan.adds.map(a => a.username).sort().join(), 'dup.u,p.admin');
});

test('สร้างบัญชีจริง: แฮชรหัส · สิทธิ์ตั้งต้น · ผู้รับเหมาใหม่ถูกสร้าง · สำรองก่อนเขียน', async () => {
  const db = freshDb();
  const backups = [];
  const rows = [
    row({ Username: 'r.one', 'Region': '1,2' }),
    row({ Username: 'c.one', 'บทบาท': 'Subcontract', 'Region': '', 'บริษัทผู้รับเหมา': 'บริษัท เอ แอร์ จำกัด' }),
    row({ Username: 'c.two', 'บทบาท': 'Subcontract', 'Region': '', 'บริษัทผู้รับเหมา': 'บริษัท  เอ  แอร์ จำกัด' }),  // ชื่อเดียวกัน เว้นวรรคต่างกัน
    row({ Username: 'exist' })                                                                                      // ข้าม
  ];
  const plan = await planUserImport(as(db, 'infra'), rows);
  assert.deepEqual(plan.counts, { adds: 3, skips: 1, errors: 0 });

  const res = await applyUserImport(as(db, 'infra', backups), { rows, expect: { adds: plan.counts.adds } });
  assert.equal(res.added, 3);
  assert.deepEqual(backups, ['ก่อนนำเข้าผู้ใช้']);
  assert.equal(count(db), 6);

  const r = db.prepare("SELECT * FROM users WHERE Username='r.one'").get();
  assert.equal(r.Role, 'Staff');
  assert.equal(r.Regions, '1,2');
  assert.ok(String(r.PasswordHash).startsWith('pbkdf2$'), 'รหัสต้องเป็นแฮช');
  assert.equal(r.Password, '');
  const perms = Object.fromEntries(r.Permissions.split(',').map(p => p.split(':')));
  assert.deepEqual(perms, REGIONAL_DEFAULT_PERMISSIONS);

  const c1 = db.prepare("SELECT * FROM users WHERE Username='c.one'").get();
  const c2 = db.prepare("SELECT * FROM users WHERE Username='c.two'").get();
  assert.equal(c1.Role, 'Contractor');
  assert.equal(c1.Regions, '');
  assert.ok(c1.ContractorID && c1.ContractorID === c2.ContractorID, 'ชื่อบริษัทเดียวกันต้องได้ผู้รับเหมารายเดียว');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM contractors').get().n, 1);
  assert.ok(!JSON.stringify(res).includes('secret1') && !JSON.stringify(res).includes('PasswordHash'), 'ผลที่ส่งกลับต้องไม่มีรหัสหรือแฮช');

  const old = db.prepare("SELECT * FROM users WHERE Username='exist'").get();
  assert.equal(old.Name, 'คนเดิม', 'ผู้ใช้เดิมต้องไม่ถูกทับ');
  assert.equal(old.Password, 'oldpass', 'รหัสผ่านเดิมต้องไม่ถูกเปลี่ยน');
});

test('ผิดแถวเดียว = ไม่เขียนอะไรเลย · จำนวนที่ยืนยันไม่ตรง = หยุด', async () => {
  const db = freshDb();
  const good = row({ Username: 'g.one' });
  await assert.rejects(() => applyUserImport(as(db, 'infra'), { rows: [good, row({ Username: 'g.bad', 'รหัสผ่าน': '1' })], expect: { adds: 1 } }), /ข้อผิดพลาด 1 แถว/);
  assert.equal(count(db), 3);
  await assert.rejects(() => applyUserImport(as(db, 'infra'), { rows: [good], expect: { adds: 5 } }), /เปลี่ยนไประหว่างที่ดูผลอยู่/);
  assert.equal(count(db), 3);
  await assert.rejects(() => applyUserImport(as(db, 'infra'), { rows: [row({ Username: 'exist' })], expect: { adds: 0 } }), /ไม่มีบัญชีใหม่/);
});

test('เฉพาะ Infrastructure · Template ตรงกับคอลัมน์ที่ระบบอ่าน · จำกัดจำนวนแถว', async () => {
  const db = freshDb();
  await assert.rejects(() => planUserImport(as(db, 'staff'), [row()]), /เฉพาะบทบาท Infrastructure/);
  await assert.rejects(() => applyUserImport(as(db, 'staff'), { rows: [row()], expect: { adds: 1 } }), /เฉพาะบทบาท Infrastructure/);
  await assert.rejects(() => getUserImportTemplate(as(db, 'staff')), /เฉพาะบทบาท Infrastructure/);
  const t = await getUserImportTemplate(as(db, 'infra'));
  assert.deepEqual(t.columns.map(c => c.name), USER_IMPORT_COLUMNS.map(c => c.name));
  await assert.rejects(() => planUserImport(as(db, 'infra'), Array.from({ length: 501 }, (_, i) => row({ Username: 'u' + i }))), /ไม่เกิน 500/);
  await assert.rejects(() => planUserImport(as(db, 'infra'), []), /ไม่พบข้อมูลในไฟล์/);
});
