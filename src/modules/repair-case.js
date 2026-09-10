import { SHEETS } from '../schema.js';
import { normalizeCode, partsOf, safeParseDate } from '../values.js';

/**
 * เคสงานซ่อม — ร้อยทุกเหตุการณ์ของการซ่อมครั้งหนึ่งเข้าด้วยกัน
 *
 * ============================================================================
 * ทำไมไม่มีตารางเคสแยก
 * ============================================================================
 * ถ้ามีทั้งตารางเคสและตารางประวัติ จะมีสองที่ที่บอกสถานะของเรื่องเดียวกัน
 * แล้ววันหนึ่งมันจะไม่ตรงกัน โดยไม่มีใครรู้ว่าอันไหนถูก
 *
 * ที่นี่ "เคส" ไม่ใช่ของที่เก็บไว้ แต่เป็นสิ่งที่อ่านออกมาจากใบประวัติที่ถือ
 * เลขเคสเดียวกัน ขั้นปัจจุบันของเคส = ใบล่าสุดของเคสนั้น จึงมีแหล่งเดียวเสมอ
 *
 * ============================================================================
 * เส้นทางของเคส
 * ============================================================================
 *   เปิดเคส (แจ้งซ่อม)     -> เครื่องเป็น "ชำรุด"            เคสเปิด
 *   เริ่มซ่อม              -> เครื่องเป็น "รอซ่อม"           เคสเปิด
 *   ซ่อมแล้ว               -> เครื่องเป็น "ใช้งานปกติ"        เคสปิด
 *   รื้อถอน/ปลดระวาง       -> เครื่องเป็น "รื้อถอน/ปลดระวาง"  เคสเปิด (รอเครื่องใหม่)
 *   เปลี่ยนเครื่อง          -> เครื่องเป็น "ใช้งานปกติ"        เคสปิด
 *
 * รื้อถอนแล้วเคสยังไม่ปิด เพราะเครื่องใหม่มักมาทีหลังหลายวัน
 * ถ้าปิดตรงนั้นจะไม่เหลืออะไรเตือนว่ายังมีตำแหน่งที่รอเครื่องอยู่
 */

/** ใบที่ทำให้เคสจบ ไม่มีอะไรต้องทำต่อแล้ว */
const CLOSING_EVENTS = new Set(['ซ่อมแล้ว', 'เปลี่ยนเครื่อง']);

/** ใบที่เปิดเคสใหม่ */
export const CASE_OPEN_EVENT = 'แจ้งซ่อม';

/**
 * ออกเลขเคสใหม่ — RC + ปี 2 หลัก + เดือน 2 หลัก + ลำดับในเดือนนั้น
 *
 * รูปแบบเดียวกับเลขที่เอกสารในประวัติ (PM/CM) เพื่อให้คนอ่านคุ้นตา
 * แต่ใช้อักษรนำต่างกันเพื่อไม่ให้สับสนว่าอันไหนเลขใบ อันไหนเลขเคส
 *
 * ใช้เวลาไทยเสมอ ไม่งั้นเคสที่เปิดวันที่ 1 จะได้เลขเดือนก่อนหน้า
 * เวลารันบนเครื่องที่ตั้งเวลาเป็น UTC
 */
export function makeCaseId(existingIds, now = new Date()) {
  const { y, m } = partsOf(now);
  const stem = 'RC' + String(y).slice(-2) + String(m).padStart(2, '0') + '-';

  let max = 0;
  for (const id of existingIds || []) {
    const s = String(id == null ? '' : id).trim();
    if (!s.startsWith(stem)) continue;
    const tail = s.slice(stem.length);
    if (!/^\d+$/.test(tail)) continue;
    const n = Number(tail);
    if (n > max) max = n;
  }
  return stem + String(max + 1).padStart(2, '0');
}

/**
 * รวมใบประวัติเป็นเคส
 *
 * @param {Array<Object>} historyRows แถวประวัติทั้งหมด
 * @returns {Array<Object>} เคสทั้งหมด ใหม่สุดขึ้นก่อน
 */
export function buildCases(historyRows) {
  const byCase = new Map();

  for (const h of historyRows || []) {
    const id = String(h.CaseID == null ? '' : h.CaseID).trim();
    if (!id) continue;   // ใบที่ไม่ใช่งานซ่อม ไม่ได้อยู่ในเคสไหน

    if (!byCase.has(id)) {
      byCase.set(id, { caseId: id, airCode: h.AirCode, events: [] });
    }
    byCase.get(id).events.push(h);
  }

  const out = [];
  for (const c of byCase.values()) {
    // เรียงตามเวลาที่บันทึกจริง ไม่ใช่วันที่ที่คนกรอก เพราะคนกรอกย้อนหลังได้
    // แต่ลำดับของเคสต้องตรงกับลำดับที่กดปุ่มเสมอ
    //
    // เวลาที่บันทึกละเอียดถึงระดับวินาที สองใบที่เกิดในวินาทีเดียวกันจึงเทียบไม่ออก
    // (เกิดจริงตอนกดซ่อมไม่ได้แล้วกดเปลี่ยนเครื่องต่อทันที) ต้องมีตัวตัดสินสำรอง
    // ใช้ลำดับแถวซึ่งเพิ่มขึ้นตามการบันทึกเสมอ จึงเป็นลำดับจริงที่เชื่อได้
    c.events.sort((a, b) =>
      String(a.CreatedAt || '').localeCompare(String(b.CreatedAt || '')) ||
      (Number(a._row) || 0) - (Number(b._row) || 0)
    );

    const first = c.events[0];
    const last = c.events[c.events.length - 1];

    c.openedAt = first.Date;
    c.symptom = first.Detail || '';
    c.lastEvent = last.EventType || '';
    c.closed = CLOSING_EVENTS.has(String(last.EventType || '').trim());
    c.closedAt = c.closed ? last.Date : '';
    c.cost = c.events.reduce((sum, e) => sum + (Number(e.Cost) || 0), 0);
    out.push(c);
  }

  // ใหม่สุดขึ้นก่อน ดูจากใบแรกของเคส เพื่อให้ลำดับคงที่แม้จะมีใบเพิ่มทีหลัง
  return out.sort((a, b) => {
    const at = a.events[0].CreatedAt || '';
    const bt = b.events[0].CreatedAt || '';
    return String(bt).localeCompare(String(at));
  });
}

/**
 * เคสที่ยังเปิดอยู่ของเครื่องตัวนี้ (ถ้ามี)
 *
 * ใช้ตอนกดปุ่มขั้นถัดไป เพื่อให้ใบใหม่ไปอยู่ในเคสเดิม ไม่ใช่เปิดเคสใหม่ซ้อน
 */
export function openCaseOf(historyRows, airCode) {
  const target = normalizeCode(airCode);
  return buildCases(historyRows)
    .find(c => !c.closed && normalizeCode(c.airCode) === target) || null;
}

/**
 * อ่านเคสทั้งหมดจาก ctx — ตัวช่วยสำหรับโมดูลที่ต้องใช้บ่อย
 */
export function casesFromCtx(ctx) {
  return buildCases(ctx.ss.objects(SHEETS.HISTORY));
}

/** สถานะที่แปลว่าเครื่องอยู่ระหว่างเคสงานซ่อม */
const IN_CASE_STATUS = new Set(['ชำรุด', 'รอซ่อม', 'รื้อถอน/ปลดระวาง']);

export function isRepairStatus(status) {
  return IN_CASE_STATUS.has(String(status == null ? '' : status).trim());
}

/**
 * หาเคสที่เปิดอยู่ ถ้าไม่มีก็ออกเลขใหม่ให้
 *
 * "ไม่มี" เกิดได้สองแบบ และทั้งสองแบบต้องเดินต่อได้ ไม่ใช่ปฏิเสธ
 *
 *   1. เครื่องเสียรอบใหม่ — เป็นเคสใหม่ตามปกติ
 *   2. เครื่องค้างสถานะซ่อมมาตั้งแต่ก่อนมีระบบเคส — ประวัติเดิมไม่มีเลขเคส
 *      ถ้าปฏิเสธ เครื่องพวกนี้จะติดค้างถาวร กดปุ่มไหนก็ไม่ได้ ต้องไปแก้ฐานข้อมูลเอง
 *
 * กรณีที่สองคือเหตุผลหลักที่ต้องมีตัวนี้ แทนที่จะโยน error เมื่อหาเคสไม่เจอ
 */
export function ensureCaseId(historyRows, airCode) {
  const open = openCaseOf(historyRows, airCode);
  if (open) return open.caseId;
  return makeCaseId((historyRows || []).map(r => r.CaseID));
}

/** วันที่ล่าสุดของเคส ใช้เรียงลำดับในหน้าเว็บ */
export function caseLastDate(c) {
  const last = c.events[c.events.length - 1];
  const d = safeParseDate(last && last.Date);
  return d ? d.getTime() : 0;
}
