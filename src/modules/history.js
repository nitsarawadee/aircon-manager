import { SHEETS, INSTALL_PENDING_NOTE } from '../schema.js';
import { formatDate, isRetiredStatus, normalizeCode, partsOf, safeParseDate, ymd, ymdhms } from '../values.js';
import { ensureCaseId, isRepairStatus, openCaseOf } from './repair-case.js';

/**
 * ประวัติการทำงานและงานซ่อมบำรุง
 * พอร์ตมาจากส่วน "3. HISTORY & REPAIR" ของ Code.gs เดิม
 */

export async function getHistory(ctx, airCode) {
  await ctx.requireAccess();
  if (!(await ctx.canView('history'))) return [];
  await ctx.ensureBase();

  // แปะภูมิภาคของเครื่องติดไปกับแต่ละแถว เพื่อให้หน้าประวัติกรองตามภูมิภาคได้
  // ประวัติเก็บแค่รหัสเครื่อง ไม่ได้เก็บภูมิภาคไว้เอง และไม่ควรเก็บ
  // เพราะเครื่องย้ายภูมิภาคได้ ถ้าเก็บซ้ำไว้ในประวัติจะกลายเป็นข้อมูลที่ไม่ตรงกัน
  const regionOf = new Map();
  for (const u of ctx.ss.objects(SHEETS.AIRLIST)) {
    if (u.AirCode) regionOf.set(normalizeCode(u.AirCode), String(u.Region || '').trim());
  }

  let list = ctx.ss.objects(SHEETS.HISTORY).map(o => ({
    ...o,
    Region: regionOf.get(normalizeCode(o.AirCode)) || '',
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

  return list.sort(newestFirst('Date'));
}

/**
 * เรียงใหม่ก่อนเก่า โดยใช้ลำดับที่บันทึกเข้ามาเป็นตัวตัดสินรอง
 *
 * ============================================================================
 * ทำไมต้องคืน 0 ตอนค่าเท่ากัน
 * ============================================================================
 * ของเดิมเขียนว่า (a.Date < b.Date ? 1 : -1) ซึ่งคืน -1 ทั้งสองทิศทางเมื่อวันที่
 * เท่ากัน แปลว่าตัวเปรียบเทียบบอกว่า "a มาก่อน b" และ "b มาก่อน a" พร้อมกัน
 *
 * ตัวเรียงของ JavaScript ไม่ได้การันตีผลลัพธ์เมื่อเจอตัวเปรียบเทียบที่ขัดแย้งกันเอง
 * รายการที่วันที่ตรงกันจึงสลับที่กันเองได้ทุกครั้งที่โหลด และในข้อมูลจริงมีวันที่
 * ที่มีรายการซ้อนกันถึง 22 รายการ
 *
 * ใช้ _row เป็นตัวตัดสินรอง เพราะเป็นลำดับที่ข้อมูลถูกบันทึกเข้ามาจริง
 * รายการที่บันทึกทีหลังจึงอยู่บนสุดในกลุ่มที่วันที่เท่ากัน ซึ่งตรงกับที่คนคาด
 */
export function newestFirst(field) {
  return (a, b) => {
    const x = String(a[field] == null ? '' : a[field]);
    const y = String(b[field] == null ? '' : b[field]);
    if (x !== y) return x < y ? 1 : -1;
    return (Number(b._row) || 0) - (Number(a._row) || 0);
  };
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
 * ลำดับเริ่มนับใหม่ทุกครั้งที่ขึ้นเดือนใหม่ และขึ้นปีใหม่
 *
 *   PM2609-45   งานล้างใบที่ 45 ของเดือน ก.ย. 2026
 *   PM2610-01   ขึ้นเดือน ต.ค. เริ่มนับ 01 ใหม่
 *   PM2710-01   ขึ้นปี 2027 เดือน ต.ค. ก็เริ่ม 01 ใหม่อีกครั้ง
 *
 * ทำได้เองโดยไม่ต้องเขียนเงื่อนไขแยก เพราะตัวนับเทียบจาก stem
 * ซึ่งมีทั้งปีและเดือนอยู่ในตัวแล้ว พอปีหรือเดือนเปลี่ยน stem ก็เป็นคนละชุดทันที
 *
 * ผลคือเลขบอกได้ในตัวว่าเป็นใบที่เท่าไหร่ของเดือนนั้น
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
/**
 * เลขทั้งหมดที่ถูกใช้ไปแล้ว ทั้งใบประวัติและเอกสาร
 *
 * สองอย่างนี้ใช้ชุดเลขเดียวกัน (PM/CM + ปีเดือน + ลำดับ) เพราะคนที่ถือกระดาษ
 * อยู่ในมือควรเอาเลขไปค้นแล้วเจอของชิ้นเดียว ไม่ใช่เจอสองชิ้นคนละเรื่อง
 *
 * ตัวออกเลขจึงต้องเห็นทั้งสองที่ ถ้าดูแค่ตารางประวัติอย่างเดียว เอกสารที่ออกเลข
 * ไปแล้วจะถูกมองข้าม แล้วใบประวัติใบถัดไปจะได้เลขเดียวกับเอกสาร
 * (เคยเกิดจริงตอนเพิ่มเลขเอกสารครั้งแรก เทสต์ doc-number จับได้ก่อนขึ้นระบบ)
 *
 * export ไว้ให้โมดูลเอกสารเรียกใช้ตัวเดียวกันนี้ จะได้ไม่มีสองความจริง
 */
export function usedDocNumbers(ctx) {
  const ids = ctx.ss.objects(SHEETS.HISTORY).map(r => r.ID);

  // ตารางเอกสารอาจยังไม่ถูกโหลดในบาง request ที่ไม่ได้ยุ่งกับเอกสารเลย
  // กรณีนั้นถือว่าไม่มีเลขเอกสารให้หลบ ซึ่งถูกต้อง เพราะไม่มีการออกเลขเอกสารด้วย
  let docNos = [];
  try {
    // เอกสารใบเดียวมีได้ถึงสองเลข เพราะการล้างของแต่ละเครื่องมีเลขของตัวเอง
    // ต้องนับทั้งสองช่อง ไม่งั้นเลขของเครื่องตัวที่สองจะถูกออกซ้ำให้รายการอื่น
    docNos = ctx.ss.objects(SHEETS.CLEANFORM).flatMap(f => [f.DocNo, f.DocNo2]);
  } catch { /* ยังไม่ได้โหลดตารางเอกสาร */ }

  // เอกสารซ่อมใช้เลขชุดเดียวกัน (ขึ้นต้น CM เหมือนใบประวัติงานซ่อม)
  // ถ้าไม่นับด้วย ใบประวัติใบถัดไปจะได้เลขเดียวกับเอกสารซ่อมที่ออกไปแล้ว
  let repairNos = [];
  try {
    repairNos = ctx.ss.objects(SHEETS.REPAIRFORM).map(f => f.DocNo);
  } catch { /* ยังไม่ได้โหลดตารางเอกสารซ่อม */ }

  // เอกสารติดตั้งก็ใช้เลข CM ชุดเดียวกัน (มีสองช่องเหมือนใบล้าง) — เดิมลืมนับ
  // ใบประวัติแจ้งซ่อมเลยเคยได้เลขเดียวกับใบติดตั้งที่ออกไปแล้ว (CM2609-87 ในข้อมูลจริง)
  let installNos = [];
  try {
    installNos = ctx.ss.objects(SHEETS.INSTALLFORM).flatMap(f => [f.DocNo, f.DocNo2]);
  } catch { /* ยังไม่ได้โหลดตารางเอกสารติดตั้ง */ }

  return [...ids, ...docNos, ...repairNos, ...installNos].filter(Boolean);
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.docNo] เลขเอกสารที่แถวนี้เป็นบันทึกของมัน (ใบล้างของเครื่องนั้น)
 *   ใช้เป็นเลขของแถวประวัติเลย คนถือกระดาษเลขไหนค้นในหน้าประวัติก็เจอเลขเดียวกัน
 *   แยกเป็นพารามิเตอร์ ไม่อ่านจาก record.ID เพราะ record มาจากหน้าเว็บได้ (addHistoryRecord)
 *   ถ้าเลขนั้นมีแถวประวัติอยู่แล้ว (เช่นบันทึกเครื่องเดิมซ้ำในใบเดิม) ออกเลขใหม่ ไม่ให้ ID ซ้ำ
 */
export async function addHistoryRaw(ctx, record, opts = {}) {
  await ctx.ensureBase();
  const docNo = String(opts.docNo || '').trim();
  const taken = docNo && ctx.ss.objects(SHEETS.HISTORY).some(r => String(r.ID || '').trim() === docNo);
  const id = (docNo && !taken) ? docNo : makeHistoryId(record.EventType, record.Date, usedDocNumbers(ctx));
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
    // ส่งมาเองได้ สำหรับงานที่ไม่ได้มาจากผู้ใช้ที่ล็อกอิน (เช่นใบซ่อมที่กรอกผ่านลิงก์)
    RecordedBy: record.RecordedBy || me,
    // ใบที่เป็นส่วนหนึ่งของเคสงานซ่อมจะถือเลขเคสไว้ ใบอื่นเว้นว่าง
    CaseID: record.CaseID || ''
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

export async function deleteHistoryRecord(ctx, row, expectId) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('history');
    await ctx.ensureBase();
    ctx.assertRowIs(SHEETS.HISTORY, row, 'ID', expectId, 'ประวัติเลขที่');

    const headers = ctx.ss.headers(SHEETS.HISTORY);
    const airCode = ctx.ss.cell(SHEETS.HISTORY, row, headers.indexOf('AirCode') + 1);
    await ctx.assertAirCodeAccess(airCode);

    await ctx.ss.deleteRow(SHEETS.HISTORY, row);
    await ctx.ss.flush();
    return getHistory(ctx);
  });
}

/**
 * แจ้งซ่อม — ขาเปิดเรื่อง คู่กับ completeRepairRecord ที่เป็นขาปิด
 *
 * แยกออกมาจากการแก้ข้อมูลเครื่องโดยตั้งใจ ด้วยเหตุผลสองข้อ
 *
 * 1. คนแจ้งไม่ควรต้องเปิดหน้าจอที่แก้ยี่ห้อ/BTU/SN/Node ได้ทั้งหมด
 *    เพื่อจะพิมพ์ประโยคเดียวว่าแอร์ไม่เย็น
 * 2. สิทธิ์ควรตรงกับงาน — ตรวจด้วยโมดูล repair เหมือนขาปิดเรื่อง
 *    ช่างที่มีสิทธิ์ซ่อมจึงแจ้งซ่อมได้ โดยไม่ต้องให้สิทธิ์แก้ทะเบียนเครื่อง
 *
 * เขียนลงตารางเครื่องได้แค่สถานะกับอาการเสีย ช่องอื่นแตะไม่ได้เลยแม้แต่ช่องเดียว
 */
export async function reportRepair(ctx, record) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('repair');
    await ctx.ensureBase();

    const list = ctx.ss.objects(SHEETS.AIRLIST);
    const target = normalizeCode(record.AirCode);
    const found = list.find(a => normalizeCode(a.AirCode) === target);

    if (!found) {
      throw new Error('ไม่พบรหัสเครื่อง ' + record.AirCode + ' ในระบบ ไม่สามารถแจ้งซ่อมได้');
    }
    await ctx.assertRegionAccess(found.Region);

    const detail = String(record.Detail || '').trim();
    if (!detail) throw new Error('กรุณาระบุอาการเสีย');

    // เครื่องที่ออกจากการใช้งานไปแล้วไม่รับแจ้งซ่อม ไม่งั้นการแจ้งจะดึงสถานะกลับมาเงียบๆ
    // ทั้งที่เครื่องถูกถอดออกจากหน้างานหรือขายออกไปแล้ว
    if (isRetiredStatus(found.Status)) {
      throw new Error('เครื่อง ' + found.AirCode + ' อยู่ในสถานะ "' + found.Status +
                      '" ไม่ได้ใช้งานแล้ว จึงแจ้งซ่อมไม่ได้');
    }

    // เปิดเคสใหม่ เว้นแต่เครื่องนี้มีเคสค้างอยู่แล้ว — แจ้งซ้ำต้องไปต่อในเคสเดิม
    // ไม่ใช่เปิดเคสใหม่ซ้อน ไม่งั้นเรื่องเดียวจะกลายเป็นสองเคสที่ไม่รู้ว่าอันไหนจริง
    const caseId = ensureCaseId(ctx.ss.objects(SHEETS.HISTORY), found.AirCode);

    await addHistoryRaw(ctx, {
      AirCode: found.AirCode,
      Date: record.Date || ymd(new Date()),
      EventType: 'แจ้งซ่อม',
      Detail: detail,
      Cost: '',
      Technician: '',
      CaseID: caseId
    });

    // เปิดเคสแล้วเครื่องเป็น "ชำรุด" ยังไม่ใช่ "รอซ่อม"
    // รอซ่อมหมายถึงตกลงกันแล้วว่าจะซ่อม ซึ่งเป็นขั้นถัดไปที่กดจากหน้างานซ่อม
    ctx.ss.writeByHeaders(SHEETS.AIRLIST, found._row, {
      Status: 'ชำรุด',
      Note: detail,
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: await ctx.currentUser()
    });

    await ctx.ss.flush();

    const { getAirList } = await import('./airlist.js');
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}

/**
 * หาเครื่องพร้อมตรวจสิทธิ์ — ใช้ร่วมกันทุกขั้นของเคสงานซ่อม
 *
 * แยกออกมาเพราะทุกขั้นต้องทำสามอย่างเหมือนกันเป๊ะ คือหาเครื่องให้เจอ
 * ตรวจว่าคนกดมีสิทธิ์ในภูมิภาคนั้น และต้องมีเคสค้างอยู่จริง
 * เขียนซ้ำสามรอบแล้วมีโอกาสลืมข้อใดข้อหนึ่งในรอบใดรอบหนึ่ง
 */
async function unitWithOpenCase(ctx, airCode, verb) {
  const list = ctx.ss.objects(SHEETS.AIRLIST);
  const target = normalizeCode(airCode);
  const found = list.find(a => normalizeCode(a.AirCode) === target);
  if (!found) throw new Error('ไม่พบรหัสเครื่อง ' + airCode + ' ในระบบ');
  await ctx.assertRegionAccess(found.Region);

  // ไม่มีเคสค้างก็ออกเลขใหม่ให้ ไม่ปฏิเสธ — เครื่องที่ค้างสถานะซ่อมมาตั้งแต่ก่อนมีระบบเคส
  // ต้องเดินต่อได้ ไม่งั้นจะติดค้างถาวร กดปุ่มไหนก็ไม่ได้
  const caseId = ensureCaseId(ctx.ss.objects(SHEETS.HISTORY), found.AirCode);
  return { found, openCase: { caseId } };
}

/**
 * ตัวเลขแดงบนเมนู "งานซ่อมและติดตั้ง" — งานที่ค้างให้ลงมือ กันลืมมากรอก (แบบเดียวกับเมนูเอกสารรออนุมัติ)
 *
 * นับให้ตรงกับสองตารางบนหน้านั้น:
 *   repair  = เคสงานซ่อมที่ยังไม่ปิด — เครื่องสถานะ ชำรุด / รอซ่อม / รื้อถอน (รอเครื่องใหม่มาแทน)
 *   install = งานติดตั้งที่ยังไม่ได้กรอกเอกสาร เครื่องละหนึ่ง — เฉพาะคนที่ดูเอกสารติดตั้งได้
 *             (คนที่ไม่มีสิทธิ์ไม่เห็นตารางนี้ นับให้ก็กดไปกรอกไม่ได้)
 */
export async function getRepairWorkCount(ctx) {
  await ctx.requireAccess();
  if (!(await ctx.canView('repair'))) return { repair: 0, install: 0, total: 0 };
  await ctx.ensureBase();

  const inScope = await ctx.scopeFilter();
  const units = ctx.ss.objects(SHEETS.AIRLIST).filter(inScope);
  const repair = units.filter(u => isRepairStatus(u.Status)).length;

  let install = 0;
  if (await ctx.canView('installform')) {
    const mine = new Set(units.map(u => normalizeCode(u.AirCode)));
    const waiting = new Set();
    for (const h of ctx.ss.objects(SHEETS.HISTORY)) {
      const code = normalizeCode(h.AirCode);
      if (String(h.Note || '').trim() === INSTALL_PENDING_NOTE && mine.has(code)) waiting.add(code);
    }
    install = waiting.size;
  }

  return { repair, install, total: repair + install };
}

/**
 * ซ่อมไม่ได้ — เครื่องถูกรื้อถอน/ปลดระวาง แต่เคสยังไม่ปิด
 *
 * เคสค้างไว้เพราะตำแหน่งนั้นยังไม่มีแอร์ใช้งาน ต้องรอเครื่องใหม่มาแทน
 * ซึ่งมักมาทีหลังหลายวัน ถ้าปิดเคสตรงนี้จะไม่เหลืออะไรเตือนว่ายังค้างอยู่
 * เคสจะปิดเมื่อกดเปลี่ยนเครื่องเสร็จ
 *
 * บังคับให้ระบุเหตุผล เพราะการปลดระวางเครื่องเป็นการตัดทรัพย์สินออกจากระบบ
 * ต้องตอบได้ว่าทำไม ไม่ใช่แค่เปลี่ยนสถานะเงียบๆ
 */
export async function markCannotRepair(ctx, record) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('repair');
    await ctx.ensureBase();

    const reason = String(record.Reason || '').trim();
    if (!reason) throw new Error('กรุณาระบุเหตุผลที่ซ่อมไม่ได้');

    const { found, openCase } = await unitWithOpenCase(ctx, record.AirCode, 'ปิดงานแบบซ่อมไม่ได้');

    await addHistoryRaw(ctx, {
      CaseID: openCase.caseId,
      AirCode: found.AirCode,
      Date: record.Date || ymd(new Date()),
      EventType: 'รื้อถอน/ปลดระวาง',
      Detail: 'ซ่อมไม่ได้ — ' + reason,
      Cost: record.Cost || '',
      Technician: record.Technician || ''
    });

    ctx.ss.writeByHeaders(SHEETS.AIRLIST, found._row, {
      Status: 'รื้อถอน/ปลดระวาง',
      Note: 'รอเครื่องใหม่มาแทน — ' + reason,
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: await ctx.currentUser()
    });

    await ctx.ss.flush();
    const { getAirList } = await import('./airlist.js');
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}

/** ปิดงานซ่อม: บันทึกประวัติการซ่อม แล้วเปลี่ยนสถานะเครื่องกลับเป็น "ใช้งานปกติ" */
/**
 * ⚠️ ไม่ได้เปิดให้หน้าเว็บเรียกแล้ว (ถอดออกจากทะเบียนใน api.js)
 *
 * เจ้าของงานให้ปิดงานซ่อมได้ทางเดียวคือออกเอกสารตามแบบฟอร์มควบคุม
 * ด้วยเหตุผลเดียวกับที่หน้าแผนล้างแอร์ปิดรอบเองไม่ได้ — ปิดงานได้โดยไม่มีหลักฐาน
 * แปลว่าตัวเลขเดินไปโดยไม่มีอะไรยืนยันย้อนหลัง
 *
 * งานที่ตัวนี้เคยทำ ย้ายไปอยู่ใน saveRepairForm แล้วทั้งหมด (คืนสถานะเครื่อง
 * ล้างอาการที่แจ้งไว้ และเก็บอาการนั้นลงประวัติก่อนล้าง)
 *
 * เก็บโค้ดกับเทสต์ไว้เฉยๆ เผื่อวันหนึ่งอยากเปิดทางลัดกลับมา ถ้าแน่ใจว่าไม่เอาแล้ว
 * ลบทั้งฟังก์ชันนี้กับเทสต์ใน repair-case.test.mjs ได้เลย
 */
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

    // ปิดงานได้เฉพาะตอนที่เคสเดินมาถึงขั้น "รอซ่อม" แล้วเท่านั้น
    //
    // ขั้น "ชำรุด" คือเพิ่งเปิดเคส ยังอยู่ระหว่างขออนุมัติค่าใช้จ่าย ยังไม่มีใครลงมือซ่อม
    // ปิดงานตอนนั้นจะได้ประวัติที่บอกว่าซ่อมเสร็จทั้งที่ยังไม่ได้เริ่ม
    //
    // ตรวจที่ฝั่งเซิร์ฟเวอร์ด้วย ไม่ใช่แค่ซ่อนปุ่มในหน้าเว็บ เพราะการซ่อนปุ่มกันได้แค่
    // การกดพลาด กันไม่ได้ถ้าหน้าเว็บค้างอยู่ในสถานะเก่าแล้วกดตามที่เห็น
    const status = String(found.Status || '').trim();
    if (status !== 'รอซ่อม') {
      throw new Error(
        'เครื่อง ' + found.AirCode + ' อยู่ในสถานะ "' + (status || '-') + '" ยังปิดงานซ่อมไม่ได้ — ' +
        'ต้องอนุมัติซ่อมแล้วเปลี่ยนสถานะเป็น "รอซ่อม" ก่อน (กดปุ่มในหน้างานซ่อม หรือแก้ที่หน้ารายการเครื่องก็ได้)'
      );
    }

    // เก็บอาการเสียที่แจ้งไว้ลงประวัติก่อน แล้วค่อยล้างออกจากข้อมูลเครื่อง
    // ไม่พึ่งข้อความที่หน้าเว็บเติมมาให้ เพราะคนกรอกลบทิ้งได้
    // ถ้าไม่ดักตรงนี้ อาการเสียจะหายไปจากระบบทั้งหมดโดยไม่มีใครรู้
    const reported = String(found.Note || '').trim();
    let detail = String(record.Detail || '').trim();
    if (reported && !detail.includes(reported)) {
      detail = 'อาการที่แจ้งไว้: ' + reported + (detail ? ' — ' + detail : '');
    }

    const caseId = ensureCaseId(ctx.ss.objects(SHEETS.HISTORY), record.AirCode);

    await addHistoryRaw(ctx, {
      CaseID: caseId,
      AirCode: record.AirCode,
      Date: record.Date,
      EventType: 'ซ่อมแล้ว',
      Detail: detail,
      Cost: record.Cost,
      Technician: record.Technician
    });

    // ล้างอาการเสียทิ้งพร้อมกับปิดงาน ไม่งั้นเครื่องที่ซ่อมเสร็จแล้วจะยังขึ้นอาการเดิมค้างอยู่
    // ตัวอาการไม่หายไปไหน ย้ายไปอยู่ในประวัติของงานซ่อมใบนี้แทน
    ctx.ss.writeByHeaders(SHEETS.AIRLIST, found._row, {
      Status: 'ใช้งานปกติ',
      Note: '',
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: await ctx.currentUser()
    });

    await ctx.ss.flush();

    const { getAirList } = await import('./airlist.js');
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}
