import { SHEETS } from '../schema.js';
import { formatDate, normalizeCode, partsOf, safeParseDate, ymdhms } from '../values.js';

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
 * ============================================================================
 * เลขที่เอกสารของรายการประวัติ
 * ============================================================================
 *
 * รูปแบบ:  <PM|CM><ปี 2 หลัก><เดือน 2 หลัก>-<ลำดับ>
 *
 *   PM2609-01     งานล้างแอร์ เดือน ก.ย. 2026 ลำดับที่ 1
 *   CM2611-123    งานซ่อม เดือน พ.ย. 2026 ลำดับที่ 123
 *
 * ปีใช้ 2 หลักเพราะ "20" ไม่ได้บอกอะไรและจะเป็น 20 ไปอีกหลายสิบปี
 * ขีดคั่นแยก "ปีเดือน" ออกจาก "ลำดับ" ซึ่งเป็นคนละความหมายกัน
 * ถ้าเขียนติดกันหมดจะอ่านแล้วแบ่งท่อนไม่ออก โดยเฉพาะตอนลำดับขึ้นหลักร้อย
 * (CM2611123 ต้องมานั่งนับหลัก แต่ CM2611-123 เห็นทันที)
 *
 * PM = งานล้างตามแผน (Preventive)  ใช้กับเหตุการณ์ที่มีคำว่า "ล้าง"
 * CM = งานแก้ไข (Corrective)       ใช้กับเหตุการณ์อื่นทั้งหมด
 *                                  เช่น ซ่อม ติดตั้ง แจ้งซ่อม ปลดระวาง
 *
 * ⚠️ ลำดับนับใหม่ทุกเดือน (ไม่ใช่นับต่อทั้งปี)
 * เลือกแบบนี้เพราะเลขเดือนอยู่ในรหัสอยู่แล้ว การนับต่อทั้งปีจะทำให้เลขเดือน
 * ไม่มีความหมาย ถ้าต้องการให้นับต่อทั้งปีแทน แก้ที่ stem ให้ตัดเดือนออกจากการเทียบ
 *
 * เลขที่ถูกลบไปจะไม่ถูกเอากลับมาใช้ซ้ำ เพราะถ้าใช้เลขเดิมซ้ำ
 * เอกสารที่เคยอ้างเลขนั้นไว้จะชี้ไปผิดรายการ
 * ============================================================================
 */

/** งานล้างเป็นงานตามแผน นอกนั้นถือเป็นงานแก้ไขทั้งหมด */
export function historyPrefix(eventType) {
  return String(eventType || '').includes('ล้าง') ? 'PM' : 'CM';
}

/**
 * สร้างเลขที่เอกสารของรายการประวัติ
 *
 * @param {string} eventType ประเภทเหตุการณ์ ใช้เลือก PM หรือ CM
 * @param {*} date วันที่ของเหตุการณ์ ใช้เป็นปีและเดือนในรหัส
 * @param {Array<string>} existingIds เลขที่มีอยู่แล้วทั้งหมด
 * @returns {string}
 */
export function makeHistoryId(eventType, date, existingIds) {
  const d = safeParseDate(date) || new Date();

  // ใช้เวลาไทย ไม่งั้นรายการวันที่ 1 ของเดือนจะได้เลขเดือนก่อนหน้า
  // เวลารันบนเครื่องที่ตั้งเวลาเป็น UTC
  const { y, m } = partsOf(d);
  const stem = historyPrefix(eventType) + String(y).slice(-2) + String(m).padStart(2, '0') + '-';

  let max = 0;
  for (const id of existingIds || []) {
    const s = String(id == null ? '' : id).trim();
    if (!s.startsWith(stem)) continue;

    const tail = s.slice(stem.length);
    // ต้องเป็นตัวเลขล้วนเท่านั้น กัน ID รูปแบบอื่นที่บังเอิญขึ้นต้นเหมือนกัน
    if (!/^\d+$/.test(tail)) continue;

    const n = Number(tail);
    if (n > max) max = n;
  }

  // เติมศูนย์ให้อย่างน้อย 2 หลัก ลำดับที่ 1 จึงเป็น 01 ส่วน 123 คงเป็น 123
  return stem + String(max + 1).padStart(2, '0');
}

/**
 * เขียนแถวประวัติลงคิว (ยังไม่บันทึกจริง — รอ flush ตอนจบคำสั่ง)
 * เทียบเท่า addHistoryRecordRaw_() ของเดิม
 *
 * เลขที่คำนวณใหม่ทุกครั้งจากแถวที่มีอยู่ ณ ตอนนั้น ไม่ได้เก็บตัวนับไว้ในหน่วยความจำ
 * จึงถูกต้องแม้เขียนหลายแถวรวดเดียว (เช่นเปลี่ยนเครื่อง = เขียน 2 แถวติดกัน)
 * เพราะแถวที่เพิ่งเขียนไปเข้าคิวแล้วและถูกนับรวมในรอบถัดไปทันที
 */
export async function addHistoryRaw(ctx, record) {
  await ctx.ensureBase();
  const id = makeHistoryId(record.EventType, record.Date, ctx.ss.objects(SHEETS.HISTORY).map(r => r.ID));
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
      EventType: 'ซ่อมแล้ว',
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
