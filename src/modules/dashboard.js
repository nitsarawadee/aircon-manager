import { SHEETS } from '../schema.js';
import { isRetiredStatus, normalizeRegion, partsOf, safeParseDate, todayStart } from '../values.js';
import { getPlanYears, getCleaningPlan } from './plan.js';
import { getHistory } from './history.js';

/**
 * ข้อมูลสรุปสำหรับหน้าแดชบอร์ด
 * พอร์ตมาจากส่วน "4. DASHBOARD" ของ Code.gs เดิม
 */

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export async function getDashboardSummary(ctx) {
  await ctx.requireAccess();
  await ctx.ensureBase();

  let airList = ctx.ss.objects(SHEETS.AIRLIST);

  const info = await ctx.userInfo();
  if (info.role !== 'Admin') {
    airList = airList.filter(a => (info.regions || []).includes(normalizeRegion(a.Region)));
  }

  // เครื่องที่รื้อถอนหรือขายออกไปแล้วไม่นับเป็นของที่มีอยู่
  // ข้อมูลยังอยู่ในระบบเพราะต้องเก็บประวัติ แต่ถ้านับรวมด้วย ยอดจะบวมขึ้นทุกปี
  // จนไม่ตรงกับจำนวนเครื่องที่ต้องดูแลจริง ซึ่งเป็นตัวเลขที่คนเอาไปใช้วางแผน
  airList = airList.filter(a => !isRetiredStatus(a.Status));

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
    // years[0] คือชื่อชีตเต็ม เช่น "Plan_2026" ต้องตัด "Plan_" ออกก่อน
    // เพราะ getCleaningPlan จะเติม "Plan_" นำหน้าปีที่ส่งเข้าไปเองอีกชั้น
    const latestYear = years[0].replace('Plan_', '');
    const futureLimit = new Date(today.getTime() + 30 * 86400000 + 86399999);

    // นัดหมายต้องมองทุกแผน ไม่ใช่แค่แผนปีล่าสุด
    // เพราะแผนคนละปีลงนัดคาบเกี่ยวกันได้ (แผนปี 2027 มีนัดตั้งแต่ปลายปี 2026)
    // ถ้าดูแค่แผนล่าสุด นัดของแผนปีก่อนที่ยังไม่ถึงกำหนดจะหายไปเงียบๆ
    // และต้องเป็นชุดเดียวกับที่ปฏิทินเห็น ไม่งั้นสองที่จะบอกไม่ตรงกัน
    for (const name of years) {
      const py = name.replace('Plan_', '');
      const plan = await getCleaningPlan(ctx, py); // กรองตามภูมิภาคมาแล้ว

      let done = 0;

      plan.forEach(p => {
        [1, 2, 3].forEach(r => {
          if (p['R' + r + '_Status'] === 'ล้างเสร็จสิ้น') {
            done++;
          } else if (p['R' + r + '_PlanDate']) {
            // ดึงเฉพาะแผนที่ยังไม่เสร็จ และอยู่ในช่วง 30 วันข้างหน้า
            const pDate = safeParseDate(p['R' + r + '_PlanDate']);
            if (pDate && pDate >= today && pDate <= futureLimit && p['R' + r + '_Status'] !== 'ยกเลิก') {
              upcomingPlans.push({
                AirCode: p.AirCode,
                NodeName: p.NodeName,
                Round: r,
                PlanYear: py,
                PlanDate: p['R' + r + '_PlanDate'],
                RawDate: pDate.getTime()
              });
            }
          }
        });
      });

      // ความคืบหน้ายังคิดจากแผนปีล่าสุดปีเดียว เพราะการ์ดบอกชัดว่าเป็นของปีไหน
      if (py === latestYear) latestPlanSummary = { year: latestYear, done, total: plan.length * 3 };
    }

    // เรียงตามวันที่ใกล้สุดก่อน และแสดงแค่ 12 รายการแรกเพื่อไม่ให้หน้าจอรก
    upcomingPlans.sort((a, b) => a.RawDate - b.RawDate);
    upcomingPlans = upcomingPlans.slice(0, 12);
  }

  const hList = await getHistory(ctx); // กรองตามภูมิภาคมาแล้ว
  let totalCleaningCost = 0;
  let totalRepairCost = 0;
  hList.forEach(h => {
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

  // --- แนวโน้มค่าใช้จ่ายย้อนหลัง 12 เดือน (รวมเดือนปัจจุบัน) แยกล้าง/ซ่อม ---
  // ใช้ partsOf() หาปี/เดือนตามเวลาไทยเสมอ ไม่ใช้ getMonth() ตรงๆ
  // เพราะ Worker รันด้วยเวลา UTC รายการของวันที่ 1 จะตกไปอยู่เดือนก่อนหน้า
  const nowTh = partsOf(new Date());
  const monthBuckets = {};
  const monthOrder = [];
  for (let i = 11; i >= 0; i--) {
    // ใช้ Date.UTC เพื่อให้การทดเดือน/ปีถูกต้อง แล้วอ่านค่ากลับด้วย getUTC*
    const d = new Date(Date.UTC(nowTh.y, nowTh.m - 1 - i, 1));
    const key = d.getUTCFullYear() + '-' + d.getUTCMonth();
    monthOrder.push(key);
    monthBuckets[key] = {
      label: THAI_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(),
      clean: 0,
      repair: 0
    };
  }
  hList.forEach(h => {
    const hd = safeParseDate(h.Date);
    if (!hd) return;
    const p = partsOf(hd);
    const key = p.y + '-' + (p.m - 1);
    if (!monthBuckets[key]) return;
    const cost = Number(h.Cost) || 0;
    if (String(h.EventType).includes('ล้าง')) monthBuckets[key].clean += cost;
    else monthBuckets[key].repair += cost;
  });
  const monthlyTrend = monthOrder.map(k => monthBuckets[k]);

  return {
    totalUnits, byRegion, byStatus, warrantySoon, oldUnits, latestPlanSummary,
    totalCleaningCost, totalRepairCost, upcomingPlans, watchlist, monthlyTrend
  };
}
