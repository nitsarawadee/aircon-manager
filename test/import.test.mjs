/**
 * ทดสอบตรรกะการนำเข้าข้อมูล
 *
 * เทสต์ชุดนี้คุ้มครองข้อมูลจริงของบริษัท 457 เครื่อง
 * ความผิดพลาดตรงนี้ไม่ได้ทำให้หน้าจอเพี้ยน แต่ทำให้ข้อมูลหายถาวร
 * และฐานข้อมูลไม่ได้ขึ้น git ด้วย เลยกู้จากที่อื่นไม่ได้
 *
 * เน้นหนักที่กฎ 3 ข้อ: ห้ามลบ, ห้ามล้างคอลัมน์ที่ไฟล์ไม่มี, ต้องคำนวณก่อนเขียน
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { planImport, applyImport, toExportRows, IMPORT_FIELDS } from '../src/import.js';

/** เครื่องที่มีอยู่ในระบบแล้ว 2 ตัว โดยตัวแรกมีพิกัดกับที่อยู่ซึ่งไฟล์นำเข้าไม่มีคอลัมน์นี้ */
const existing = () => ([
  {
    _row: 2, AirCode: 'ATG-ATG-AIR-1', Region: '1', Province: 'อ่างทอง', NodeName: 'อ่างทอง',
    SiteCode: 'ATG-ATG', LocationType: 'Shop House', Brand: 'Carrier', BTU: '18000',
    ModelIndoor: '', ModelOutdoor: '', IndoorAsset: 'AIR00929', IndoorSN: '22505915',
    OutdoorAsset: 'AIR00930', OutdoorSN: '22600647', InstallDate: '', WarrantyExpire: '',
    CleaningPricePerRound: '450', Status: 'ใช้งานปกติ', Note: '',
    Lat: '14.5896', Long: '100.4550', Address: 'ถนนเทศบาล 1'
  },
  {
    _row: 3, AirCode: 'ATG-ATG-AIR-2', Region: '1', Province: 'อ่างทอง', NodeName: 'อ่างทอง',
    SiteCode: 'ATG-ATG', LocationType: 'Shop House', Brand: 'Carrier', BTU: '18000',
    Status: 'ใช้งานปกติ', CleaningPricePerRound: '450', Note: '',
    Lat: '', Long: '', Address: ''
  }
]);

/** แถวจากไฟล์ 1 แถว ครบทุกช่องที่บังคับ */
const fileRow = (over = {}) => ({
  __line: 2,
  Region: '1', Province: 'อ่างทอง', NodeName: 'อ่างทอง', SiteCode: 'ATG-ATG',
  LocationType: 'Shop House', AirNo: '1', Brand: 'Carrier', BTU: '18000',
  ModelIndoor: '', ModelOutdoor: '', IndoorAsset: 'AIR00929', IndoorSN: '22505915',
  OutdoorAsset: 'AIR00930', OutdoorSN: '22600647', InstallDate: '', WarrantyExpire: '',
  CleaningPricePerRound: '450', Status: 'ใช้งานปกติ', Note: '',
  ...over
});

/* ==================== กฎข้อ 1: ห้ามลบ ==================== */

test('ไฟล์ที่มีแค่แถวเดียว ต้องไม่ทำให้เครื่องอื่นหายไป', () => {
  const plan = planImport(existing(), [fileRow()]);

  // ตัวที่ 2 ไม่ได้อยู่ในไฟล์ ต้องไม่มีอะไรเกิดขึ้นกับมันเลย
  const touched = [...plan.adds, ...plan.updates].map(x => x.airCode);
  assert.ok(!touched.includes('ATG-ATG-AIR-2'), 'เครื่องที่ไม่ได้อยู่ในไฟล์ต้องไม่ถูกแตะ');
  assert.equal(typeof plan.deletes, 'undefined', 'แผนต้องไม่มีแนวคิดเรื่องการลบอยู่เลย');
});

/* ==================== กฎข้อ 2: ห้ามล้างคอลัมน์ที่ไฟล์ไม่มี ==================== */

test('พิกัดและที่อยู่ต้องไม่ถูกล้าง เพราะไฟล์นำเข้าไม่มีคอลัมน์พวกนี้', () => {
  const plan = planImport(existing(), [fileRow({ Status: 'รอซ่อม' })]);
  const u = plan.updates[0];

  assert.equal(u.changes.length, 1, 'ควรเปลี่ยนแค่สถานะอย่างเดียว');
  for (const col of ['Lat', 'Long', 'Address']) {
    assert.ok(!(col in u.values), col + ' ต้องไม่ถูกเขียนทับ');
  }
});

test('คอลัมน์ที่ไฟล์นำเข้าดูแล ต้องไม่รวมพิกัดและที่อยู่', () => {
  for (const col of ['Lat', 'Long', 'Address', 'UpdatedAt', 'UpdatedBy']) {
    assert.ok(!IMPORT_FIELDS.includes(col), col + ' ไม่ควรอยู่ในไฟล์นำเข้า');
  }
});

/* ==================== กฎข้อ 3: คำนวณก่อน ไม่เขียน ==================== */

test('planImport ต้องไม่เขียนอะไรเลย', () => {
  const data = existing();
  const before = JSON.stringify(data);
  planImport(data, [fileRow({ Status: 'รอซ่อม' })]);
  assert.equal(JSON.stringify(data), before, 'ข้อมูลเดิมต้องไม่ถูกแก้ระหว่างคำนวณ');
});

test('applyImport ต้องปฏิเสธถ้าแผนยังมีข้อผิดพลาดค้างอยู่', async () => {
  const plan = planImport(existing(), [fileRow({ Region: '9' })]);
  assert.ok(plan.errors.length, 'ควรมีข้อผิดพลาด');
  await assert.rejects(() => applyImport({}, plan), /ข้อผิดพลาด/);
});

/* ==================== การแยกเพิ่ม / แก้ / ไม่เปลี่ยน ==================== */

test('แถวที่ข้อมูลเหมือนเดิมทุกช่อง ต้องนับเป็นไม่เปลี่ยนแปลง', () => {
  const plan = planImport(existing(), [fileRow()]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.unchanged.length, 1);
});

test('รหัสเครื่องที่ยังไม่มีในระบบ ต้องนับเป็นเพิ่มใหม่', () => {
  const plan = planImport(existing(), [fileRow({ AirNo: '3', __line: 5 })]);
  assert.equal(plan.adds.length, 1);
  assert.equal(plan.adds[0].airCode, 'ATG-ATG-AIR-3');
});

test('ต้องบอกได้ว่าเปลี่ยนช่องไหน จากอะไรเป็นอะไร', () => {
  const plan = planImport(existing(), [fileRow({ Status: 'รอซ่อม', CleaningPricePerRound: '500' })]);
  const changes = plan.updates[0].changes;

  assert.equal(changes.length, 2);
  const status = changes.find(c => c.column === 'Status');
  assert.equal(status.from, 'ใช้งานปกติ');
  assert.equal(status.to, 'รอซ่อม');
});

test('ตัวเลขกับข้อความที่หน้าตาเหมือนกัน ต้องไม่ถูกนับว่าเปลี่ยน', () => {
  // ฐานข้อมูลคืนค่า BTU มาเป็นตัวเลข แต่ไฟล์เป็นข้อความ ถ้าเทียบตรงๆ จะขึ้นว่าเปลี่ยนทุกแถว
  const data = existing();
  data[0].BTU = 18000;
  data[0].CleaningPricePerRound = 450;
  const plan = planImport(data, [fileRow()]);
  assert.equal(plan.updates.length, 0, 'ไม่ควรมีอะไรเปลี่ยน');
});

/* ==================== ความผิดพลาดจากคน ==================== */

test('รหัสเครื่องซ้ำกันในไฟล์ ต้องเป็นข้อผิดพลาด ไม่ใช่ให้แถวหลังทับแถวหน้าเงียบๆ', () => {
  const plan = planImport(existing(), [fileRow(), fileRow({ __line: 3, Status: 'รอซ่อม' })]);
  assert.ok(plan.errors.some(e => /ซ้ำ/.test(e.message)));
});

test('แถวที่ข้อมูลผิด ต้องไม่ถูกเอาเข้าแผน แม้แถวอื่นจะถูกต้อง', () => {
  const plan = planImport(existing(), [
    fileRow({ AirNo: '3', Region: '9', __line: 2 }),   // ผิด
    fileRow({ AirNo: '4', __line: 3 })                  // ถูก
  ]);
  assert.equal(plan.adds.length, 1, 'ควรเข้าแผนแค่แถวที่ถูกต้อง');
  assert.equal(plan.adds[0].airCode, 'ATG-ATG-AIR-4');
});

/* ==================== ส่งออกแล้วนำเข้ากลับได้ ==================== */

test('ไฟล์ที่ส่งออก ต้องนำเข้ากลับได้โดยไม่มีอะไรเปลี่ยน', () => {
  // นี่คือท่าที่แนะนำให้ผู้ใช้ใช้จริง: ส่งออก -> แก้ใน Excel -> นำเข้ากลับ
  // ถ้าส่งออกแล้วนำเข้ากลับทันทีมีอะไรเปลี่ยน แปลว่าสองฝั่งไม่ตรงกัน
  const data = existing();
  const rows = toExportRows(data).map((r, i) => ({ ...r, __line: i + 2 }));
  const plan = planImport(data, rows);

  assert.equal(plan.errors.length, 0, 'ไฟล์ที่ระบบส่งออกเองต้องไม่มีข้อผิดพลาด');
  assert.equal(plan.adds.length, 0, 'ต้องไม่มีเครื่องใหม่');
  assert.equal(plan.updates.length, 0, 'ต้องไม่มีอะไรเปลี่ยน');
  assert.equal(plan.unchanged.length, 2);
});

test('ส่งออกต้องแยกเลขเครื่องกลับออกมาจากรหัสเครื่องได้', () => {
  const rows = toExportRows(existing());
  assert.equal(rows[0].AirNo, '1');
  assert.equal(rows[1].AirNo, '2');
});

/* ==================== การเขียนจริง ==================== */

test('applyImport เขียนครบทั้งแก้และเพิ่ม พร้อมบันทึกว่าใครทำเมื่อไหร่', async () => {
  const writes = [];
  const appends = [];
  let flushed = false;

  const ss = {
    headers: () => ['AirCode', 'Region', 'Status', 'Lat', 'UpdatedAt', 'UpdatedBy'],
    writeByHeaders: (name, row, payload) => writes.push({ row, payload }),
    appendRow: (name, values) => appends.push(values),
    flush: async () => { flushed = true; }
  };

  const plan = planImport(existing(), [
    fileRow({ Status: 'รอซ่อม' }),
    fileRow({ AirNo: '3', __line: 3 })
  ]);
  const result = await applyImport(ss, plan, { user: 'นิศราวดี', now: '2026-09-03 10:00:00' });

  assert.deepEqual(result, { added: 1, updated: 1, unchanged: 0 });
  assert.equal(writes[0].row, 2, 'ต้องแก้ที่แถวเดิมของเครื่องนั้น');
  assert.equal(writes[0].payload.UpdatedBy, 'นิศราวดี');
  assert.equal(appends.length, 1);
  assert.ok(flushed, 'ต้องสั่งบันทึกลงฐานข้อมูลจริง');
});

test('เครื่องที่เพิ่มใหม่ ต้องเว้นคอลัมน์ที่ไฟล์ไม่มีไว้ว่าง ไม่ใช่ใส่ค่ามั่ว', async () => {
  const appends = [];
  const ss = {
    headers: () => ['AirCode', 'Region', 'Lat', 'UpdatedBy'],
    writeByHeaders: () => {},
    appendRow: (name, values) => appends.push(values),
    flush: async () => {}
  };

  const plan = planImport(existing(), [fileRow({ AirNo: '9', __line: 2 })]);
  await applyImport(ss, plan, { user: 'test' });

  assert.deepEqual(appends[0], ['ATG-ATG-AIR-9', '1', '', 'test']);
});

/* ==================== ช่องว่าง = ไม่ยุ่ง ไม่ใช่ล้างทิ้ง ==================== */

test('ช่องที่เว้นว่างในไฟล์ ต้องไม่ล้างข้อมูลเดิมทิ้ง', () => {
  // นี่คือวิธีใช้งานจริง: ทยอยเติมข้อมูลทีละรอบ
  // รอบนี้หาวันติดตั้งมาได้ ก็กรอกแค่ช่องนั้น ช่องอื่นเว้นว่าง
  // ถ้าช่องว่างล้างค่าเดิม ข้อมูลที่สะสมมาจะหายทั้งแถวโดยคนกรอกไม่รู้ตัว
  const plan = planImport(existing(), [fileRow({
    Brand: '', BTU: '', IndoorSN: '', CleaningPricePerRound: '', Status: '', Note: '',
    InstallDate: '2020-03-15'
  })]);

  const changes = plan.updates[0].changes;
  assert.equal(changes.length, 1, 'ควรเปลี่ยนแค่ช่องที่กรอกมาจริง');
  assert.equal(changes[0].column, 'InstallDate');
  assert.equal(changes[0].to, '2020-03-15');
});

test('ไฟล์ที่กรอกแต่ช่องบังคับ ต้องไม่ทำให้ข้อมูลเดิมหายสักช่อง', () => {
  const plan = planImport(existing(), [{
    __line: 2, Region: '1', Province: 'อ่างทอง', NodeName: 'อ่างทอง',
    SiteCode: 'ATG-ATG', LocationType: 'Shop House', AirNo: '1',
    Brand: '', BTU: '', ModelIndoor: '', ModelOutdoor: '',
    IndoorAsset: '', IndoorSN: '', OutdoorAsset: '', OutdoorSN: '',
    InstallDate: '', WarrantyExpire: '', CleaningPricePerRound: '', Status: '', Note: ''
  }]);

  assert.equal(plan.updates.length, 0, 'ไม่มีอะไรเปลี่ยน');
  assert.equal(plan.unchanged.length, 1);
});

test('เครื่องใหม่ที่กรอกไม่ครบ ยังเพิ่มได้ ช่องที่เว้นก็เว้นไป', () => {
  const plan = planImport(existing(), [fileRow({
    AirNo: '7', __line: 3, Brand: '', BTU: '', IndoorSN: '', Note: ''
  })]);

  assert.equal(plan.adds.length, 1);
  assert.equal(plan.adds[0].values.Brand, undefined, 'ช่องที่เว้นต้องไม่ถูกใส่ค่าว่างเข้าไป');
  assert.equal(plan.adds[0].values.Province, 'อ่างทอง');
});
