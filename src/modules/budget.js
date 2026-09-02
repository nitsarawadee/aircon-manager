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

export async function getBudgetSummary(ctx, year) {
  await ctx.requireAccess();
  const currentYear = Number(year) || new Date().getFullYear();

  if (!(await ctx.canView('budget'))) {
    return {
      year: currentYear, budgetCleaning: 0, budgetRepair: 0, totalBudget: 0,
      expenseCleaning: 0, expenseRepair: 0, totalExpense: 0,
      remainCleaning: 0, remainRepair: 0, remaining: 0, note: ''
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
  let expenseCleaning = 0;
  let expenseRepair = 0;
  ctx.ss.objects(SHEETS.HISTORY).forEach(h => {
    const d = safeParseDate(h.Date);
    // เทียบปีตามเวลาไทย ไม่ใช้ getFullYear() ตรงๆ เพราะ Worker รันด้วยเวลา UTC
    // รายการวันที่ 1 ม.ค. จะถูกนับเข้าปีก่อนหน้า
    if (!d || partsOf(d).y !== currentYear) return;
    const cost = Number(h.Cost) || 0;
    if (String(h.EventType).includes('ล้าง')) expenseCleaning += cost;
    else expenseRepair += cost;
  });

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
