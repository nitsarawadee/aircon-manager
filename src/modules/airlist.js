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
 * แปลงสถานะใหม่ของเครื่อง เป็นชื่อเหตุการณ์ที่จะบันทึกลงประวัติ
 *
 * วงจรของเครื่องมีแค่นี้ ตั้งใจให้คำศัพท์น้อยที่สุดเท่าที่ยังสื่อความได้
 *
 *   ใช้งานปกติ ──แจ้งซ่อม──> รอซ่อม ──ซ่อม──> ใช้งานปกติ
 *        └──────ชำรุด / ปลดระวาง
 *
 * การกลับมา "ใช้งานปกติ" บันทึกเป็น "ซ่อม" เสมอ ไม่ว่าจะมาจากทางไหน
 * และไม่ว่าจะกดปิดงานในหน้างานซ่อม หรือไปแก้สถานะเองในหน้ารายการเครื่อง
 * เพราะสำหรับคนอ่านประวัติมันคือเหตุการณ์เดียวกัน คือเครื่องกลับมาใช้ได้แล้ว
 * ส่วนรายละเอียดว่าเปลี่ยนมาจากสถานะไหน ดูได้จากช่องรายละเอียดอยู่แล้ว
 *
 * เดิมเคยแยกเป็น "ซ่อมแล้ว" กับ "กลับมาใช้งาน" ตามสถานะเดิม
 * แต่เป็นความละเอียดที่ไม่คุ้มกับการมีคำศัพท์เพิ่มให้จำ จึงยุบรวมกลับมา
 */
export function statusChangeEvent(status) {
  const now = String(status || '').trim();

  if (now === 'รอซ่อม') return 'แจ้งซ่อม';

  // เช็คขายออกก่อนรื้อถอน เพราะเป็นคนละขั้นของวงจรเดียวกัน
  // ถ้าเช็คกลับกัน การขายออกจะถูกบันทึกเป็นการรื้อถอนซ้ำอีกใบ
  if (/write\s*[-_]?\s*off/i.test(now)) return 'Write off';

  // เช็คปลดระวางก่อนชำรุด เพื่อให้ค่าเดิม "ชำรุด/ปลดระวาง" ที่ยังค้างอยู่
  // ถูกจัดเป็นปลดระวาง ไม่ใช่ชำรุด
  if (now.includes('ปลดระวาง') || now.includes('รื้อถอน')) return 'รื้อถอน/ปลดระวาง';
  if (now.includes('ชำรุด')) return 'ชำรุด';

  if (now === 'ใช้งานปกติ') return 'ซ่อมแล้ว';

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
      // ช่องรหัสเครื่องเป็น readonly ตอนแก้ข้อมูล ค่าที่ส่งมาจึงต้องตรงกับของเดิมเสมอ
      // ถ้าไม่ตรงแปลว่าลำดับแถวเลื่อนไปแล้ว ไม่ใช่ว่าผู้ใช้ตั้งใจเปลี่ยนรหัส
      ctx.assertRowIs(SHEETS.AIRLIST, unit._row, 'AirCode', unit.AirCode, 'เครื่องรหัส');

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
          EventType: statusChangeEvent(unit.Status),
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
export async function moveAirUnit(ctx, row, dest, note, expectCode) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    if (!dest || !dest.NodeName) throw new Error('กรุณาระบุ Node ปลายทาง');
    await ctx.ensureBase();
    ctx.assertRowIs(SHEETS.AIRLIST, row, 'AirCode', expectCode, 'เครื่องรหัส');

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
export async function replaceAirUnit(ctx, oldRow, newUnit, expectCode) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    await ctx.ensureBase();
    ctx.assertRowIs(SHEETS.AIRLIST, oldRow, 'AirCode', expectCode, 'เครื่องรหัส');

    const headers = ctx.ss.headers(SHEETS.AIRLIST);
    const oldUnit = {};
    headers.forEach((h, i) => { if (h) oldUnit[h] = ctx.ss.cell(SHEETS.AIRLIST, oldRow, i + 1); });

    await ctx.assertRegionAccess(oldUnit.Region);

    // ปลดระวางเครื่องเก่า
    const oldNote = oldUnit.Note ? oldUnit.Note + ' | ' : '';
    ctx.ss.writeByHeaders(SHEETS.AIRLIST, oldRow, {
      Status: 'รื้อถอน/ปลดระวาง',
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

export async function deleteAirUnit(ctx, row, expectCode) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    await ctx.ensureBase();
    ctx.assertRowIs(SHEETS.AIRLIST, row, 'AirCode', expectCode, 'เครื่องรหัส');

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
