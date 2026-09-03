import { SHEETS } from '../schema.js';
import { formatDate, normalizeCode, normalizeRegion, ymd, ymdhms } from '../values.js';
import { addHistoryRaw, getHistory } from './history.js';

/**
 * รายการเครื่องปรับอากาศ (Master Data)
 * พอร์ตมาจากส่วน "1. AIR LIST" ของ Code.gs เดิม
 *
 * หมายเหตุการพอร์ต: โค้ดเดิมเขียนข้อมูลด้วยการวางทั้งแถวตามลำดับใน AIRLIST_HEADERS
 * ซึ่งจะเขียนผิดช่องทันทีถ้าลำดับคอลัมน์จริงในชีตไม่ตรงกับในโค้ด
 * เวอร์ชันนี้เปลี่ยนมาเขียนโดยอ้างชื่อคอลัมน์แทน จึงปลอดภัยกับชีตที่เคย migrate มาแล้ว
 */

/**
 * แปลงการเปลี่ยนสถานะของเครื่อง เป็นชื่อเหตุการณ์ที่จะบันทึกลงประวัติ
 *
 * เดิมสถานะอะไรก็ตามที่ไม่ใช่ "รอซ่อม" ถูกบันทึกเป็น "อื่นๆ" ทั้งหมด
 * ทำให้ไล่ประวัติย้อนหลังไม่ออกว่าเกิดอะไรขึ้นกับเครื่อง
 * ทั้งที่วงจรชีวิตของเครื่องมีแค่ไม่กี่เหตุการณ์และแยกออกจากกันได้ชัดเจน
 *
 *   ใช้งานปกติ ──แจ้งซ่อม──> รอซ่อม ──ปิดงาน──> ใช้งานปกติ
 *        │                                          ▲
 *        └──ชำรุด/ปลดระวาง──> ... ──กลับมาใช้งาน────┘
 *
 * ต้องรู้สถานะเดิมด้วย เพราะการกลับมา "ใช้งานปกติ" มีความหมายต่างกัน
 * ถ้ามาจากรอซ่อมคือซ่อมเสร็จ แต่ถ้ามาจากปลดระวางคือเอาเครื่องกลับมาใช้ใหม่
 *
 * @param {string} status สถานะใหม่
 * @param {string} [oldStatus] สถานะเดิมก่อนเปลี่ยน
 */
export function statusChangeEvent(status, oldStatus) {
  const now = String(status || '').trim();
  const before = String(oldStatus || '').trim();

  if (now === 'รอซ่อม') return 'แจ้งซ่อม';

  // เช็คปลดระวางก่อนชำรุด เพื่อให้ค่าเดิม "ชำรุด/ปลดระวาง" ที่ยังค้างอยู่
  // ถูกจัดเป็นปลดระวาง ไม่ใช่ชำรุด
  if (now.includes('ปลดระวาง')) return 'ปลดระวาง';
  if (now.includes('ชำรุด')) return 'ชำรุด';

  if (now === 'ใช้งานปกติ') {
    return before.includes('ปลดระวาง') ? 'กลับมาใช้งาน' : 'ซ่อมแล้ว';
  }

  return 'อื่นๆ';
}

export async function getAirList(ctx) {
  await ctx.requireAccess();
  if (!(await ctx.canView('airlist'))) return [];
  await ctx.ensureBase();

  let list = ctx.ss.objects(SHEETS.AIRLIST).map(o => ({
    ...o,
    InstallDate: formatDate(o.InstallDate),
    WarrantyExpire: formatDate(o.WarrantyExpire),
    UpdatedAt: formatDate(o.UpdatedAt)
  }));

  const info = await ctx.userInfo();
  if (info.role !== 'Admin') {
    list = list.filter(a => (info.regions || []).includes(normalizeRegion(a.Region)));
  }
  return list;
}

export async function getConfig(ctx) {
  await ctx.requireAccess();
  await ctx.ensureBase();

  const headers = ctx.ss.headers(SHEETS.CONFIG);
  const values = ctx.ss.values(SHEETS.CONFIG);
  const cols = {};

  headers.forEach((h, i) => {
    if (!h) return;
    const out = [];
    for (let r = 1; r < values.length; r++) {
      const v = (values[r] || [])[i];
      if (v !== '' && v !== null && v !== undefined) out.push(v);
    }
    cols[h] = out;
  });
  return cols;
}

/** เพิ่มแถวใหม่ลง AirList (ไม่ล็อก) — ใช้ภายในฟังก์ชันที่ล็อกไว้แล้วเท่านั้น */
async function insertAirUnitRaw(ctx, unit) {
  if (!unit.AirCode) throw new Error('กรุณาระบุรหัสเครื่อง (AirCode)');

  const code = normalizeCode(unit.AirCode);
  const exists = ctx.ss.objects(SHEETS.AIRLIST).some(o => normalizeCode(o.AirCode) === code);
  if (exists) throw new Error('มีรหัสเครื่อง ' + unit.AirCode + ' อยู่แล้วในระบบ');

  const payload = {
    ...unit,
    UpdatedAt: ymdhms(new Date()),
    UpdatedBy: await ctx.currentUser()
  };

  const headers = ctx.ss.headers(SHEETS.AIRLIST);
  const row = headers.map(h => (payload[h] !== undefined && h !== '' ? payload[h] : ''));
  ctx.ss.appendRow(SHEETS.AIRLIST, row);
}

export async function saveAirUnit(ctx, unit) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    await ctx.ensureBase();

    const headers = ctx.ss.headers(SHEETS.AIRLIST);

    if (unit._row) {
      // ตรวจสิทธิ์ทั้งภูมิภาคเดิมและภูมิภาคใหม่ กันไม่ให้ RegionAdmin แก้ข้อมูลนอกเขต
      // หรือย้ายข้อมูลออกนอกเขตตัวเอง
      const oldRegion = ctx.ss.cell(SHEETS.AIRLIST, unit._row, headers.indexOf('Region') + 1);
      await ctx.assertRegionAccess(oldRegion);
      await ctx.assertRegionAccess(unit.Region);

      // เก็บสถานะเดิมไว้ก่อนเขียนทับ เพื่อเทียบว่าสถานะเปลี่ยนไปหรือไม่
      const oldStatus = ctx.ss.cell(SHEETS.AIRLIST, unit._row, headers.indexOf('Status') + 1);

      const payload = { ...unit, UpdatedAt: ymdhms(new Date()), UpdatedBy: await ctx.currentUser() };
      delete payload._row;
      ctx.ss.writeByHeaders(SHEETS.AIRLIST, unit._row, payload);

      // บันทึกประวัติอัตโนมัติทุกครั้งที่สถานะของเครื่องเปลี่ยน (เช่น แจ้งซ่อม/ปลดระวาง)
      // เพื่อให้หน้าประวัติ/งานซ่อมเห็นเหตุการณ์นี้โดยผู้ใช้ไม่ต้องกดบันทึกเพิ่มอีกขั้น
      if (unit.Status && String(unit.Status) !== String(oldStatus || '')) {
        await addHistoryRaw(ctx, {
          AirCode: unit.AirCode,
          Date: ymd(new Date()),
          EventType: statusChangeEvent(unit.Status, oldStatus),
          Detail: `เปลี่ยนสถานะจาก "${oldStatus || '-'}" เป็น "${unit.Status}"` +
                  (unit.Note ? ` — หมายเหตุ: ${unit.Note}` : ''),
          Cost: '',
          Technician: ''
        });
      }
    } else {
      await ctx.assertRegionAccess(unit.Region);
      await insertAirUnitRaw(ctx, unit);
      // บันทึกประวัติ "ติดตั้ง" อัตโนมัติทุกครั้งที่เพิ่มเครื่องใหม่เข้าระบบ
      await addHistoryRaw(ctx, {
        AirCode: unit.AirCode,
        Date: unit.InstallDate || ymd(new Date()),
        EventType: 'ติดตั้ง',
        Detail: `ติดตั้งเครื่องใหม่ที่ Node "${unit.NodeName || '-'}" (${unit.SiteCode || '-'})`,
        Cost: '',
        Technician: ''
      });
    }

    await ctx.ss.flush();
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}

/**
 * ย้ายเครื่องปรับอากาศจาก Node เดิมไปยัง Node ปลายทาง
 * อัปเดตตำแหน่งใน AirList และบันทึกประวัติ EventType 'ย้าย' ให้อัตโนมัติ
 */
export async function moveAirUnit(ctx, row, dest, note) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    if (!dest || !dest.NodeName) throw new Error('กรุณาระบุ Node ปลายทาง');
    await ctx.ensureBase();

    const headers = ctx.ss.headers(SHEETS.AIRLIST);
    const unit = {};
    headers.forEach((h, i) => { if (h) unit[h] = ctx.ss.cell(SHEETS.AIRLIST, row, i + 1); });

    await ctx.assertRegionAccess(unit.Region);
    if (dest.Region) await ctx.assertRegionAccess(dest.Region);

    const oldNode = unit.NodeName || '-';
    const oldSite = unit.SiteCode || '-';

    const payload = {
      NodeName: dest.NodeName,
      SiteCode: dest.SiteCode || '',
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: await ctx.currentUser()
    };
    if (dest.Region) payload.Region = dest.Region;
    if (dest.Province) payload.Province = dest.Province;
    ctx.ss.writeByHeaders(SHEETS.AIRLIST, row, payload);

    await addHistoryRaw(ctx, {
      AirCode: unit.AirCode,
      Date: ymd(new Date()),
      EventType: 'ย้าย',
      Detail: `ย้ายจาก Node "${oldNode}" (${oldSite}) ไปยัง Node "${dest.NodeName}" (${dest.SiteCode || '-'})` +
              (note ? ` — หมายเหตุ: ${note}` : ''),
      Cost: '',
      Technician: ''
    });

    await ctx.ss.flush();
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}

/**
 * เปลี่ยนเครื่องปรับอากาศ: ใช้เมื่อเครื่องเดิมชำรุดซ่อมไม่ได้
 * เครื่องเก่าจะถูกปลดระวาง และสร้างเครื่องใหม่ที่ Node/Site เดิมให้อัตโนมัติ
 * พร้อมบันทึกประวัติทั้ง 'เปลี่ยนเครื่อง' (เครื่องเก่า) และ 'ติดตั้ง' (เครื่องใหม่)
 */
export async function replaceAirUnit(ctx, oldRow, newUnit) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    await ctx.ensureBase();

    const headers = ctx.ss.headers(SHEETS.AIRLIST);
    const oldUnit = {};
    headers.forEach((h, i) => { if (h) oldUnit[h] = ctx.ss.cell(SHEETS.AIRLIST, oldRow, i + 1); });

    await ctx.assertRegionAccess(oldUnit.Region);

    // ปลดระวางเครื่องเก่า
    const oldNote = oldUnit.Note ? oldUnit.Note + ' | ' : '';
    ctx.ss.writeByHeaders(SHEETS.AIRLIST, oldRow, {
      Status: 'ปลดระวาง',
      Note: oldNote + 'ถูกเปลี่ยนเครื่องใหม่แทนแล้ว (' + (newUnit.AirCode || '-') + ')',
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: await ctx.currentUser()
    });

    // สร้างเครื่องใหม่แทนที่ ณ ตำแหน่งเดิม เว้นแต่ผู้ใช้จะระบุใหม่เอง
    const merged = Object.assign({
      Region: oldUnit.Region, Province: oldUnit.Province, NodeName: oldUnit.NodeName,
      SiteCode: oldUnit.SiteCode, LocationType: oldUnit.LocationType, Status: 'ใช้งานปกติ'
    }, newUnit);
    await insertAirUnitRaw(ctx, merged);

    await addHistoryRaw(ctx, {
      AirCode: oldUnit.AirCode,
      Date: ymd(new Date()),
      EventType: 'เปลี่ยนเครื่อง',
      Detail: `เครื่องชำรุดซ่อมไม่ได้ เปลี่ยนเครื่องใหม่เป็น ${merged.AirCode}`,
      Cost: newUnit.ReplaceCost || '',
      Technician: newUnit.Technician || ''
    });
    await addHistoryRaw(ctx, {
      AirCode: merged.AirCode,
      Date: merged.InstallDate || ymd(new Date()),
      EventType: 'ติดตั้ง',
      Detail: `ติดตั้งทดแทนเครื่องเดิม ${oldUnit.AirCode} ที่ชำรุด`,
      Cost: '',
      Technician: newUnit.Technician || ''
    });

    await ctx.ss.flush();
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}

export async function deleteAirUnit(ctx, row) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    await ctx.ensureBase();

    const headers = ctx.ss.headers(SHEETS.AIRLIST);
    const unit = {};
    headers.forEach((h, i) => { if (h) unit[h] = ctx.ss.cell(SHEETS.AIRLIST, row, i + 1); });
    await ctx.assertRegionAccess(unit.Region);

    // บันทึกประวัติไว้ก่อนลบ กันไม่ให้การลบเครื่องออกจากระบบเงียบหายไปโดยไม่มีร่องรอย
    await addHistoryRaw(ctx, {
      AirCode: unit.AirCode,
      Date: ymd(new Date()),
      EventType: 'อื่นๆ',
      Detail: `ลบข้อมูลเครื่อง "${unit.AirCode}" (Node: ${unit.NodeName || '-'}) ออกจากระบบ`,
      Cost: '',
      Technician: ''
    });

    await ctx.ss.deleteRow(SHEETS.AIRLIST, row);
    await ctx.ss.flush();
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}
