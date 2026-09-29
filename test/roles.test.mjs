/**
 * ชื่อบทบาท — Infrastructure / Regional / Staff / Supervisor / Subcontract
 *
 * เจ้าของงานให้เปลี่ยนชื่อบทบาทให้ตรงกับที่บริษัทใช้ และเพิ่ม Staff กับ Supervisor
 * ที่ทำหน้าที่เหมือน Regional ทุกอย่าง
 *
 * ค่าที่เก็บในคอลัมน์ Role กับรหัสบทบาทในโค้ดไม่เปลี่ยน (ดู ROLE_TITLES ใน schema.js)
 * เทสต์ชุดนี้ล็อกว่า Staff/Supervisor ได้สิทธิ์แบบ Regional จริง ไม่มากไม่น้อยกว่า
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createTableStatements } from '../src/db/schema.js';
import { Ctx } from '../src/context.js';
import { getAirList, saveAirUnit } from '../src/modules/airlist.js';
import { saveUser, getUsers } from '../src/modules/users.js';
import { updatePlanBulk } from '../src/modules/plan.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  for (const sql of createTableStatements()) db.exec(sql);
  const user = db.prepare('INSERT INTO users (Username, Name, Role, Regions, Permissions, Active, Password, ContractorID) VALUES (?,?,?,?,?,?,?,?)');
  user.run('infra', 'Infrastructure', 'Admin', '', '', 1, 'x', '');
  user.run('reg', 'Regional', 'RegionAdmin', '3', '', 1, 'x', '');
  user.run('staff', 'Staff', 'Staff', '3', '', 1, 'x', '');
  user.run('sup', 'Supervisor', 'Supervisor', '3', 'airlist:view', 1, 'x', '');
  user.run('sub', 'Subcontract', 'Contractor', '', '', 1, 'x', 'CT001');
  db.prepare("INSERT INTO contractors (ID, Name, Active) VALUES ('CT001','บริษัท เอ',1)").run();
  const unit = db.prepare('INSERT INTO air_units (AirCode, NodeName, SiteCode, Region, Status) VALUES (?,?,?,?,?)');
  unit.run('CMI-CKN-AIR-1', 'เชียงคาน', 'CMI-CKN', '3', 'ใช้งานปกติ');
  unit.run('BKK-LPA-AIR-1', 'ลาดพร้าว', 'BKK-LPA', '1', 'ใช้งานปกติ');
  return db;
}

const state = { async acquireLock() { return true; }, async releaseLock() {}, async destroySessionsOf() {} };
const as = (db, u) => { const c = new Ctx({}, state, db); c.username = u; return c; };

test('ชื่อบทบาทที่โชว์ ตรงตามที่เจ้าของงานกำหนด', async () => {
  const db = freshDb();
  const titles = {};
  for (const u of ['infra', 'reg', 'staff', 'sup', 'sub']) titles[u] = (await as(db, u).userInfo()).title;
  assert.deepEqual(titles, {
    infra: 'Infrastructure', reg: 'Regional', staff: 'Staff', sup: 'Supervisor', sub: 'Subcontract'
  });
});

test('Staff และ Supervisor ทำงานเป็น Regional — เห็นเฉพาะภูมิภาคที่กำหนด', async () => {
  const db = freshDb();
  for (const u of ['staff', 'sup']) {
    const info = await as(db, u).userInfo();
    assert.equal(info.role, 'RegionAdmin', u + ' ต้องใช้กติกาเดียวกับ Regional');
    assert.deepEqual(info.regions, ['3']);
    assert.deepEqual((await getAirList(as(db, u))).map(a => a.AirCode), ['CMI-CKN-AIR-1'], u + ' ต้องไม่เห็นภาค 1');
  }
});

test('Staff/Supervisor ใช้สิทธิ์รายเมนูเหมือน Regional — ตั้งดูอย่างเดียวก็แก้ไม่ได้', async () => {
  const db = freshDb();
  // sup ตั้งไว้ airlist:view
  await assert.rejects(() => saveAirUnit(as(db, 'sup'), { AirCode: 'CMI-CKN-AIR-2', Region: '3', NodeName: 'เชียงคาน' }), /รายการเครื่อง/);
});

test('Staff/Supervisor ทำงานของ Infrastructure ไม่ได้ (จัดการผู้ใช้)', async () => {
  const db = freshDb();
  for (const u of ['staff', 'sup']) {
    await assert.rejects(() => getUsers(as(db, u)), /Infrastructure/);
  }
});

test('สร้างผู้ใช้บทบาท Staff / Supervisor — เก็บค่าของตัวเอง ภูมิภาคและสิทธิ์รายเมนูใช้ได้', async () => {
  const db = freshDb();
  for (const role of ['Staff', 'Supervisor']) {
    const name = 'new' + role.toLowerCase();
    await saveUser(as(db, 'infra'), {
      Username: name, Password: 'secret1', Role: role, Regions: ['2'], Permissions: { airlist: 'view' }
    });
    const u = (await getUsers(as(db, 'infra'))).find(x => x.Username === name);
    assert.equal(u.Role, role);
    assert.equal(u.Regions, '2');
    assert.match(u.Permissions, /airlist:view/);
    const info = await as(db, name).userInfo();
    assert.equal(info.title, role);
    assert.equal(info.role, 'RegionAdmin');
  }
});

test('ค่าบทบาทที่ไม่รู้จัก ถือเป็น Regional ไม่ใช่ Infrastructure', async () => {
  const db = freshDb();
  await saveUser(as(db, 'infra'), { Username: 'weird', Password: 'secret1', Role: 'SuperBoss', Regions: ['1'] });
  const u = (await getUsers(as(db, 'infra'))).find(x => x.Username === 'weird');
  assert.equal(u.Role, 'RegionAdmin');
});

test('ชื่อบทบาทในหน้าเว็บ ตรงกับของเซิร์ฟเวอร์ทุกตัว', async () => {
  const { readFileSync } = await import('node:fs');
  const { ROLE_TITLES, REGIONAL_ROLES } = await import('../src/schema.js');
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const web = html.match(/const ROLE_TITLES = (\{[\s\S]*?\});/)[1];
  assert.deepEqual(new Function('return ' + web)(), ROLE_TITLES);
  const regional = html.match(/const REGIONAL_ROLES = (\[[^\]]*\]);/)[1];
  assert.deepEqual(new Function('return ' + regional)(), REGIONAL_ROLES);
});

test('นำเข้าแผนล้างจาก Excel/CSV — เฉพาะ Infrastructure', async () => {
  const db = freshDb();
  // sup ในชุดนี้ตั้งไว้แค่ airlist:view จึงโดนปฏิเสธจากสิทธิ์รายเมนูก่อน — ใช้สองคนที่แก้แผนได้
  for (const u of ['reg', 'staff']) {
    await assert.rejects(() => updatePlanBulk(as(db, u), 2026, []), /Infrastructure/, u);
  }
});
