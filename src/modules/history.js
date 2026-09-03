import { SHEETS } from '../schema.js';
import { formatDate, normalizeCode, ymdhms } from '../values.js';

/**
 * ประวัติการทำงานและงานซ่อมบำรุง
 * พอร์ตมาจากส่วน "3. HISTORY & REPAIR" ของ Code.gs เดิม
 */

export async function getHistory(ctx, airCode) {
  await ctx.requireAccess();
  if (!(await ctx.canView('history'))) return [];
  await ctx.ensureBase();

  let list = ctx.ss.objects(SHEETS.HISTORY).map(o => ({
    ...o,
    Date: formatDate(o.Date),
    CreatedAt: formatDate(o.CreatedAt)
  }));

  if (airCode) {
    const nc = normalizeCode(airCode);
    list = list.filter(o => normalizeCode(o.AirCode) === nc);
  }

  const info = await ctx.userInfo();
  if (info.role !== 'Admin') {
    const allowed = await ctx.allowedAirCodes();
    list = list.filter(o => allowed.has(normalizeCode(o.AirCode)));
  }

  return list.sort((a, b) => (a.Date < b.Date ? 1 : -1));
}

/**
 * หาเลขรันถัดไปของประวัติ จากเลขที่มีอยู่แล้วทั้งหมด
 *
 * รูปแบบ H-0001 H-0002 ไล่ไปเรื่อยๆ เพื่อให้อ้างอิงกันได้ด้วยปากเปล่า
 * เช่น "รายการ H-0042 คืองานซ่อมตัวนั้น" ซึ่งเลขเวลาแบบเดิม (H1785308032365)
 * ทำแบบนี้ไม่ได้เลย เพราะจำไม่ได้และอ่านไม่ออกว่ารายการที่เท่าไหร่
 *
 * ข้ามเลขที่ถูกลบไปเสมอ ไม่วนกลับมาใช้ซ้ำ เพราะถ้าเอาเลขเดิมมาใช้ใหม่
 * เอกสารหรือข้อความที่เคยอ้างเลขนั้นไว้จะชี้ไปผิดรายการ
 *
 * @param {Array<Object>} rows แถวประวัติที่มีอยู่
 * @returns {string} เลขถัดไป เช่น 'H-0062'
 */
export function nextHistoryId(rows) {
  let max = 0;
  for (const r of rows) {
    const m = /^H-(\d+)$/.exec(String(r && r.ID || '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'H-' + String(max + 1).padStart(4, '0');
}

/**
 * เขียนแถวประวัติลงคิว (ยังไม่บันทึกจริง — รอ flush ตอนจบคำสั่ง)
 * เทียบเท่า addHistoryRecordRaw_() ของเดิม
 *
 * เลขรันคำนวณใหม่ทุกครั้งจากแถวที่มีอยู่ ณ ตอนนั้น ไม่ได้เก็บตัวนับไว้ในหน่วยความจำ
 * จึงถูกต้องแม้เขียนหลายแถวรวดเดียว (เช่นเปลี่ยนเครื่อง = เขียน 2 แถวติดกัน)
 * เพราะแถวที่เพิ่งเขียนไปเข้าคิวแล้วและถูกนับรวมในรอบถัดไปทันที
 */
export async function addHistoryRaw(ctx, record) {
  await ctx.ensureBase();
  const id = nextHistoryId(ctx.ss.objects(SHEETS.HISTORY));
  const me = await ctx.currentUser();

  const byName = {
    ID: id,
    AirCode: record.AirCode,
    Date: record.Date,
    EventType: record.EventType,
    Detail: record.Detail || '',
    Cost: record.Cost || '',
    Technician: record.Technician || '',
    Note: record.Note || '',
    CreatedAt: ymdhms(new Date()),
    RecordedBy: me
  };

  // เรียงตามหัวตาราง "จริง" ในชีต ไม่ใช่ลำดับใน HISTORY_HEADERS ของโค้ด
  // เผื่อกรณีชีตเคย migrate มาแล้วลำดับคอลัมน์ไม่ตรงกัน
  const headers = ctx.ss.headers(SHEETS.HISTORY);
  const row = headers.map(h => (byName[h] !== undefined ? byName[h] : ''));
  ctx.ss.appendRow(SHEETS.HISTORY, row);
}

/** บันทึกประวัติเดี่ยวๆ จากหน้าเว็บ */
export async function addHistoryRecord(ctx, record) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('history');
    await ctx.assertAirCodeAccess(record.AirCode);
    await addHistoryRaw(ctx, record);
    await ctx.ss.flush();
    return getHistory(ctx);
  });
}

export async function deleteHistoryRecord(ctx, row) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('history');
    await ctx.ensureBase();

    const headers = ctx.ss.headers(SHEETS.HISTORY);
    const airCode = ctx.ss.cell(SHEETS.HISTORY, row, headers.indexOf('AirCode') + 1);
    await ctx.assertAirCodeAccess(airCode);

    await ctx.ss.deleteRow(SHEETS.HISTORY, row);
    await ctx.ss.flush();
    return getHistory(ctx);
  });
}

/** ปิดงานซ่อม: บันทึกประวัติการซ่อม แล้วเปลี่ยนสถานะเครื่องกลับเป็น "ใช้งานปกติ" */
export async function completeRepairRecord(ctx, record) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('repair');
    await ctx.ensureBase();

    const airHeaders = ctx.ss.headers(SHEETS.AIRLIST);
    const list = ctx.ss.objects(SHEETS.AIRLIST);
    const target = normalizeCode(record.AirCode);
    const found = list.find(a => normalizeCode(a.AirCode) === target);

    if (!found) {
      throw new Error('ไม่พบรหัสเครื่อง ' + record.AirCode + ' ในระบบ ไม่สามารถปิดงานซ่อมได้');
    }
    await ctx.assertRegionAccess(found.Region);

    await addHistoryRaw(ctx, {
      AirCode: record.AirCode,
      Date: record.Date,
      EventType: 'ซ่อม',
      Detail: record.Detail,
      Cost: record.Cost,
      Technician: record.Technician
    });

    ctx.ss.writeByHeaders(SHEETS.AIRLIST, found._row, {
      Status: 'ใช้งานปกติ',
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: await ctx.currentUser()
    });

    await ctx.ss.flush();

    const { getAirList } = await import('./airlist.js');
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}
