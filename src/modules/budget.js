import { SHEETS, BUDGET_HEADERS } from '../schema.js';
import { partsOf, safeParseDate, ymdhms } from '../values.js';
import { Ctx } from '../context.js';

/**
 * งบประมาณประจำปี — ภาพรวมทั้งบริษัท ไม่จำกัดตามภูมิภาค
 * พอร์ตมาจากส่วน "5. BUDGET" ของ Code.gs เดิม
 *
 * หมายเหตุการพอร์ต: โค้ดเดิมอ่านค่าใช้จ่ายจากชีต History ด้วยตำแหน่งคอลัมน์ตายตัว
 * (hData[i][2] = วันที่, [3] = ประเภท, [5] = ค่าใช้จ่าย) ซึ่งจะอ่านผิดช่องทันที
 * ถ้ามีใครสลับคอลัมน์ในชีต เวอร์ชันนี้อ่านโดยอ้างชื่อคอลัมน์แทน
 */

async function ensureBudgetSheet(ctx) {
  await ctx.connect();
  if (await ctx.ss.ensureSheet(SHEETS.BUDGET, BUDGET_HEADERS)) Ctx.invalidateMeta();
  await ctx.ss.load(SHEETS.BUDGET);
  await ctx.ss.ensureColumns(SHEETS.BUDGET, BUDGET_HEADERS);
}

/** ชื่อเดือนแบบสั้น ใช้เป็นป้ายกำกับบนกราฟ */
export const MONTH_LABELS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

/**
 * แยกค่าใช้จ่ายของปีหนึ่งออกเป็นรายเดือน
 *
 * คืนครบ 12 เดือนเสมอ แม้เดือนที่ไม่มีรายการเลยก็คืนศูนย์
 * เพราะกราฟที่ข้ามเดือนที่ไม่มีข้อมูลจะอ่านผิด — เดือนที่ไม่ได้ใช้เงิน
 * กับเดือนที่ยังไม่ถึง ดูเหมือนกันหมดถ้าไม่มีแกนครบ
 *
 * แยกล้าง/ซ่อมด้วยเกณฑ์เดียวกับยอดรวมทั้งปี เพื่อให้ผลบวก 12 เดือน
 * เท่ากับยอดรวมเสมอ ถ้าใช้คนละเกณฑ์ตัวเลขสองที่จะไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก
 *
 * @param {Array<Object>} historyRows แถวประวัติทั้งหมด
 * @param {number} year ปีที่ต้องการ
 * @returns {Array<{month:number,label:string,cleaning:number,repair:number,total:number}>}
 */
export function monthlyBreakdown(historyRows, year) {
  const months = MONTH_LABELS.map((label, i) => ({
    month: i + 1, label, cleaning: 0, repair: 0, total: 0
  }));

  for (const h of historyRows) {
    const d = safeParseDate(h.Date);
    if (!d) continue;

    // ใช้เวลาไทยเหมือนยอดรวมทั้งปี ไม่งั้นรายการวันที่ 1 ของเดือน
    // จะตกไปอยู่เดือนก่อนหน้าเวลารันบนเครื่องที่ใช้เวลา UTC
    const { y, m } = partsOf(d);
    if (y !== Number(year)) continue;

    const cost = Number(h.Cost) || 0;
    if (!cost) continue;

    const slot = months[m - 1];
    if (!slot) continue;

    if (String(h.EventType).includes('ล้าง')) slot.cleaning += cost;
    else slot.repair += cost;
    slot.total += cost;
  }

  return months;
}

export async function getBudgetSummary(ctx, year) {
  await ctx.requireAccess();
  const currentYear = Number(year) || new Date().getFullYear();

  if (!(await ctx.canView('budget'))) {
    // ต้องคืน monthly ครบ 12 เดือนด้วย ไม่งั้นหน้าเว็บที่วาดกราฟจะพังทั้งหน้า
    // สำหรับคนที่ไม่มีสิทธิ์ดูงบ ซึ่งเป็นคนละเรื่องกับการไม่ให้เห็นตัวเลข
    return {
      year: currentYear, budgetCleaning: 0, budgetRepair: 0, totalBudget: 0,
      expenseCleaning: 0, expenseRepair: 0, totalExpense: 0,
      remainCleaning: 0, remainRepair: 0, remaining: 0,
      monthly: monthlyBreakdown([], currentYear), note: ''
    };
  }

  await ctx.ensureBase();
  await ensureBudgetSheet(ctx);

  let budgetCleaning = 0;
  let budgetRepair = 0;
  let note = '';

  const row = ctx.ss.objects(SHEETS.BUDGET).find(r => Number(r.Year) === currentYear);
  if (row) {
    budgetCleaning = Number(row.CleaningBudget) || 0;
    budgetRepair = Number(row.RepairBudget) || 0;
    note = row.Note || '';
  }

  // ค่าใช้จ่ายจริงคิดจากประวัติทั้งหมดของปีนั้น (ไม่กรองภูมิภาค เพราะเป็นงบรวมทั้งบริษัท)
  //
  // ยอดรวมทั้งปีบวกมาจากรายเดือนโดยตรง ไม่ได้นับแยกกันคนละรอบ
  // เพื่อให้เป็นไปไม่ได้ที่ตัวเลขบนการ์ดสรุปกับตัวเลขบนกราฟจะไม่ตรงกัน
  const monthly = monthlyBreakdown(ctx.ss.objects(SHEETS.HISTORY), currentYear);
  const expenseCleaning = monthly.reduce((s, m) => s + m.cleaning, 0);
  const expenseRepair = monthly.reduce((s, m) => s + m.repair, 0);

  return {
    year: currentYear,
    budgetCleaning,
    budgetRepair,
    totalBudget: budgetCleaning + budgetRepair,
    expenseCleaning,
    expenseRepair,
    totalExpense: expenseCleaning + expenseRepair,
    remainCleaning: budgetCleaning - expenseCleaning,
    remainRepair: budgetRepair - expenseRepair,
    remaining: (budgetCleaning + budgetRepair) - (expenseCleaning + expenseRepair),
    monthly,
    note
  };
}

export async function saveBudgetRecord(ctx, year, budgetCleaning, budgetRepair, note) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('budget');
    await ctx.ensureBase();
    await ensureBudgetSheet(ctx);

    const me = await ctx.currentUser();
    const payload = {
      Year: year,
      CleaningBudget: budgetCleaning,
      RepairBudget: budgetRepair,
      Note: note,
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: me
    };

    const existing = ctx.ss.objects(SHEETS.BUDGET).find(r => Number(r.Year) === Number(year));
    if (existing) {
      ctx.ss.writeByHeaders(SHEETS.BUDGET, existing._row, payload);
    } else {
      const headers = ctx.ss.headers(SHEETS.BUDGET);
      ctx.ss.appendRow(SHEETS.BUDGET, headers.map(h => (payload[h] !== undefined ? payload[h] : '')));
    }

    await ctx.ss.flush();
    return getBudgetSummary(ctx, year);
  });
}
