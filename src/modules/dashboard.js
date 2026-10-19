import { SHEETS } from '../schema.js';
import { isAwaitingInstall, isRetiredStatus, normalizeCode, partsOf, safeParseDate, todayStart } from '../values.js';
import { getPlanYears, getCleaningPlan, summarizeCleaning, upcomingFromPlan, UPCOMING_LIMIT } from './plan.js';
import { getHistory } from './history.js';
import { monthlyBreakdown } from './budget.js';

/**
 * ข้อมูลสรุปสำหรับหน้าแดชบอร์ด
 * พอร์ตมาจากส่วน "4. DASHBOARD" ของ Code.gs เดิม
 */

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/**
 * ข้อมูลสรุปหน้าแดชบอร์ด ของปีที่เลือก
 *
 * ตัวเลขบนหน้านี้มีสองแบบปนกัน ต้องแยกให้ชัดว่าอันไหนขึ้นกับปี
 *
 *   ขึ้นกับปี   ความคืบหน้าล้างแอร์ · ค่าใช้จ่าย · กราฟแนวโน้ม
 *   ไม่ขึ้นกับปี จำนวนเครื่อง · อายุเครื่อง · เครื่องรอซ่อม · นัดหมาย 30 วันข้างหน้า
 *
 * กลุ่มหลังเป็นสภาพ ณ ตอนนี้ ไม่ใช่ผลของปีใดปีหนึ่ง เลือกปีย้อนหลังแล้วก็ยังเป็นค่าเดิม
 * ถ้าไปผูกกับปีด้วยจะได้ตัวเลขที่ไม่มีความหมาย เช่น "เครื่องรอซ่อมของปี 2026"
 *
 * @param {number|string} [year] ปีที่ต้องการดู ไม่ระบุ = ปีปัจจุบัน
 */
export async function getDashboardSummary(ctx, year) {
  await ctx.requireAccess();
  await ctx.ensureBase();

  const nowY = partsOf(new Date()).y;
  const viewYear = Number(year) || nowY;

  // กรองตามขอบเขตของผู้ใช้ (ภูมิภาค หรือ Node ของผู้รับเหมา)
  let airList = ctx.ss.objects(SHEETS.AIRLIST).filter(await ctx.scopeFilter());

  // เครื่องที่รื้อถอนหรือขายออกไปแล้วไม่นับเป็นของที่มีอยู่
  // ข้อมูลยังอยู่ในระบบเพราะต้องเก็บประวัติ แต่ถ้านับรวมด้วย ยอดจะบวมขึ้นทุกปี
  // จนไม่ตรงกับจำนวนเครื่องที่ต้องดูแลจริง ซึ่งเป็นตัวเลขที่คนเอาไปใช้วางแผน
  airList = airList.filter(a => !isRetiredStatus(a.Status));
  // เครื่องใหม่ที่ใบติดตั้งยังอนุมัติไม่ครบ ยังไม่นับว่ามีอยู่จริง (ดู isAwaitingInstall)
  airList = airList.filter(a => !isAwaitingInstall(a.Status));

  const totalUnits = airList.length;
  const byRegion = {};
  const byStatus = {};
  const today = todayStart();

  let warrantySoon = 0;
  let oldUnits = 0;

  airList.forEach(a => {
    byRegion[a.Region || 'ไม่ระบุ'] = (byRegion[a.Region || 'ไม่ระบุ'] || 0) + 1;
    byStatus[a.Status || 'ไม่ระบุ'] = (byStatus[a.Status || 'ไม่ระบุ'] || 0) + 1;

    // ใช้ safeParseDate กันกรณีวันที่ในชีตเป็นข้อความที่แปลงไม่ได้
    // ถ้าแปลงไม่ได้จะข้ามไปเงียบๆ แทนที่จะคำนวณผิดพลาด
    const w = safeParseDate(a.WarrantyExpire);
    if (w) {
      const diffDays = (w - today) / 86400000;
      if (diffDays >= 0 && diffDays <= 90) warrantySoon++;
    }
    const inst = safeParseDate(a.InstallDate);
    if (inst) {
      const years = (today - inst) / (86400000 * 365);
      if (years >= 8) oldUnits++;
    }
  });

  const years = await getPlanYears(ctx);
  let latestPlanSummary = null;
  let upcomingPlans = []; // กำหนดการล้างแอร์ใน 30 วันล่วงหน้า

  if (years.length > 0) {

    // นัดหมายต้องมองทุกแผน ไม่ใช่แค่แผนปีล่าสุด
    // เพราะแผนคนละปีลงนัดคาบเกี่ยวกันได้ (แผนปี 2027 มีนัดตั้งแต่ปลายปี 2026)
    // ถ้าดูแค่แผนล่าสุด นัดของแผนปีก่อนที่ยังไม่ถึงกำหนดจะหายไปเงียบๆ
    // และต้องเป็นชุดเดียวกับที่ปฏิทินเห็น ไม่งั้นสองที่จะบอกไม่ตรงกัน
    for (const name of years) {
      const py = name.replace('Plan_', '');
      const plan = await getCleaningPlan(ctx, py); // กรองตามภูมิภาคมาแล้ว

      upcomingPlans.push(...upcomingFromPlan(plan, py, today));

      // ความคืบหน้าคิดจากแผนของปีที่เลือกปีเดียว การ์ดบอกชัดอยู่แล้วว่าเป็นของปีไหน
      //
      // ใช้ตัวสรุปตัวเดียวกับหน้าแผน ไม่นับเองซ้ำอีกชุด
      // เดิมนับเองด้วยสูตร plan.length * 3 ซึ่งรวมทั้งรอบที่ยกเลิกและเครื่องที่รื้อถอนไปแล้ว
      // ทำให้การ์ดบอก 29/1371 แต่หน้าแผนบอก 29/1364 ทั้งที่เป็นเรื่องเดียวกัน
      if (Number(py) === viewYear) {
        const sum = summarizeCleaning(plan, ctx.ss.objects(SHEETS.AIRLIST), py);
        latestPlanSummary = { year: py, done: sum.done, total: sum.planned };
      }
    }

    // เรียงตามวันที่ใกล้สุดก่อน และแสดงแค่ 12 รายการแรกเพื่อไม่ให้หน้าจอรก
    upcomingPlans.sort((a, b) => a.RawDate - b.RawDate);
    upcomingPlans = upcomingPlans.slice(0, UPCOMING_LIMIT);
  }

  const hList = await getHistory(ctx); // กรองตามภูมิภาคมาแล้ว

  // นับเฉพาะรายการของปีที่เลือก ไม่ใช่ยอดสะสมตลอดกาล
  // ยอดตลอดกาลเอาไปเทียบกับงบประมาณซึ่งตั้งเป็นรายปีไม่ได้ จึงไม่มีที่ใช้จริง
  let totalCleaningCost = 0;
  let totalRepairCost = 0;
  hList.forEach(h => {
    const hd = safeParseDate(h.Date);
    if (!hd || partsOf(hd).y !== viewYear) return;
    const cost = Number(h.Cost) || 0;
    if (String(h.EventType).includes('ล้าง')) totalCleaningCost += cost;
    else totalRepairCost += cost;
  });

  // --- เครื่องที่ควรจับตา: เครื่องที่กำลังติดสถานะ "รอซ่อม" อยู่ในขณะนี้ ---
  // อาการเสียเก็บอยู่ในคอลัมน์ Note ของ AirList เดียวกับที่ใช้ในหน้า "งานซ่อม"
  // เรียงตามวันที่อัปเดตล่าสุดก่อน และจำกัดไม่เกิน 8 รายการกันรกจอ
  const watchlist = airList
    .filter(a => a.Status === 'รอซ่อม')
    .map(a => {
      const u = safeParseDate(a.UpdatedAt);
      return {
        AirCode: a.AirCode,
        NodeName: a.NodeName,
        Note: a.Note || '',
        SortKey: u ? u.getTime() : 0
      };
    })
    .sort((a, b) => b.SortKey - a.SortKey)
    .slice(0, 8);

  // --- ค่าใช้จ่ายราย ม.ค.–ธ.ค. ของปีที่เลือก ---
  //
  // เดิมเป็นย้อนหลัง 12 เดือนนับจากวันนี้ ซึ่งใช้กับปีที่เลือกเองไม่ได้
  // เลือกปี 2026 แล้วได้กราฟคาบเกี่ยว 2025-2026 จะเทียบกับงบของปีนั้นไม่ได้เลย
  //
  // ใช้ partsOf() หาปี/เดือนตามเวลาไทยเสมอ ไม่ใช้ getMonth() ตรงๆ
  // เพราะ Worker รันด้วยเวลา UTC รายการของวันที่ 1 จะตกไปอยู่เดือนก่อนหน้า
  //
  // แยก 4 หมวดแบบเดียวกับกราฟหน้างบประมาณ (ล้าง · ซ่อม · จัดซื้อเครื่อง · ติดตั้ง) — ใช้ตัวคำนวณตัวเดียวกัน
  // ต่างกันแค่หน้านี้กรองตามขอบเขตผู้ใช้ · ใบติดตั้งนับเมื่อมีเครื่องในใบอยู่ในขอบเขต
  const scopeCodes = new Set(ctx.ss.objects(SHEETS.AIRLIST).filter(await ctx.scopeFilter()).map(a => normalizeCode(a.AirCode)));
  const scopedForms = ctx.ss.objects(SHEETS.INSTALLFORM).filter(f => [f.AirCode1, f.AirCode2].some(c => c && scopeCodes.has(normalizeCode(c))));
  const monthlyTrend = monthlyBreakdown(hList, viewYear, scopedForms).map((m, i) => ({ ...m, label: THAI_MONTHS[i] + ' ' + viewYear }));

  // ปีที่ให้เลือกได้ = ปีที่มีแผน + ปีที่มีประวัติ + ปีปัจจุบัน
  // สร้างจากข้อมูลจริง จะได้ไม่มีตัวเลือกที่กดแล้วหน้าว่างเปล่า
  const yearSet = new Set([nowY, viewYear]);
  for (const n of years) yearSet.add(Number(n.replace('Plan_', '')));
  for (const h of hList) {
    const hd = safeParseDate(h.Date);
    if (hd) yearSet.add(partsOf(hd).y);
  }
  const availableYears = [...yearSet].filter(Boolean).sort((a, b) => b - a);

  return {
    year: viewYear, availableYears,
    totalUnits, byRegion, byStatus, warrantySoon, oldUnits, latestPlanSummary,
    totalCleaningCost, totalRepairCost, upcomingPlans, watchlist, monthlyTrend
  };
}
