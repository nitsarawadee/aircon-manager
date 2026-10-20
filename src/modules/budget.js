import { SHEETS, BUDGET_HEADERS } from '../schema.js';
import { partsOf, safeParseDate, ymdhms } from '../values.js';
import { getPlanYears } from './plan.js';

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
  await ctx.ss.ensureSheet(SHEETS.BUDGET, BUDGET_HEADERS);
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
 * แยกหมวดด้วยเกณฑ์เดียวกับยอดรวมทั้งปี เพื่อให้ผลบวก 12 เดือน
 * เท่ากับยอดรวมเสมอ ถ้าใช้คนละเกณฑ์ตัวเลขสองที่จะไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก
 *
 * 4 หมวดตามไฟล์งบของพี่เลี้ยง (15/10/2569) — ดู costCategory · ค่าติดตั้งอยู่ที่ใบติดตั้ง ไม่ได้ลงประวัติ
 *
 * @param {Array<Object>} historyRows แถวประวัติทั้งหมด
 * @param {number} year ปีที่ต้องการ
 * @param {Array<Object>} [installForms] ใบติดตั้งทั้งหมด — นับช่องค่าติดตั้งตามวันที่ของใบ
 * @returns {Array<{month:number,label:string,cleaning:number,repair:number,purchase:number,install:number,total:number}>}
 */
export function monthlyBreakdown(historyRows, year, installForms = []) {
  const months = MONTH_LABELS.map((label, i) => ({
    month: i + 1, label, cleaning: 0, repair: 0, purchase: 0, install: 0, total: 0
  }));

  const add = (date, rawCost, cat) => {
    const d = safeParseDate(date);
    if (!d) return;

    // ใช้เวลาไทยเหมือนยอดรวมทั้งปี ไม่งั้นรายการวันที่ 1 ของเดือน
    // จะตกไปอยู่เดือนก่อนหน้าเวลารันบนเครื่องที่ใช้เวลา UTC
    const { y, m } = partsOf(d);
    if (y !== Number(year)) return;

    const cost = Number(rawCost) || 0;
    if (!cost) return;

    const slot = months[m - 1];
    if (!slot) return;

    slot[cat] += cost;
    slot.total += cost;
  };

  for (const h of historyRows) add(h.Date, h.Cost, costCategory(h.EventType));
  for (const f of installForms) add(f.Date, f.Cost, 'install');

  return months;
}

/**
 * หมวดค่าใช้จ่ายของประวัติหนึ่งแถว
 *   "ล้าง…"         → cleaning (ล้างแอร์)
 *   "เปลี่ยนเครื่อง"   → purchase (จัดซื้อเครื่องใหม่ — ค่าเปลี่ยนเครื่องที่กรอกตอนกดเปลี่ยนเครื่อง)
 *   "ติดตั้ง"         → install (ปกติไม่มีค่าใช้จ่าย ค่าติดตั้งอยู่ในใบติดตั้ง)
 *   อื่นทั้งหมด        → repair (รวม "เปลี่ยนอะไหล่" — เทียบชื่อเหตุการณ์ตรงตัว ไม่ใช่แค่มีคำว่าเปลี่ยน)
 */
export function costCategory(eventType) {
  const t = String(eventType == null ? '' : eventType).trim();
  if (t.includes('ล้าง')) return 'cleaning';
  if (t === 'เปลี่ยนเครื่อง') return 'purchase';
  if (t === 'ติดตั้ง') return 'install';
  return 'repair';
}

/** หมวดงบทั้งหมด — ชื่อช่องในตาราง Budget กับชื่อที่ส่งให้หน้าเว็บ */
export const BUDGET_CATEGORIES = [
  { key: 'cleaning', column: 'CleaningBudget', label: 'งบล้างแอร์' },
  { key: 'repair', column: 'RepairBudget', label: 'งบซ่อมบำรุง' },
  { key: 'purchase', column: 'PurchaseBudget', label: 'งบจัดซื้อเครื่องใหม่' },
  { key: 'install', column: 'InstallBudget', label: 'งบติดตั้ง' }
];

/**
 * ปีที่ให้เลือกได้ในหน้างบประมาณ
 *
 * เดิมหน้าเว็บใช้ช่องกรอกตัวเลข พิมพ์ปีอะไรก็ได้ ซึ่งกดพลาดเป็นปี 202 หรือ 20266
 * แล้วได้หน้าว่างเปล่าโดยไม่มีอะไรบอกว่าพิมพ์ผิด จึงเปลี่ยนมาเป็นรายการปิด
 *
 * เกณฑ์ว่าปีไหนควรอยู่ในรายการ
 *   ตั้งงบไว้แล้ว   ต้องเข้าไปดูย้อนหลังได้
 *   มีประวัติ       มีค่าใช้จ่ายเกิดขึ้นจริง ต้องเทียบกับงบได้
 *   มีแผนล้าง       รู้ล่วงหน้าว่าจะใช้เงิน ต้องตั้งงบรอไว้ได้
 *   ปีนี้/ปีหน้า      ตั้งงบล่วงหน้าได้เสมอ แม้ยังไม่ได้สร้างแผน
 *
 * ข้อสุดท้ายสำคัญ เพราะช่องปีในกล่องตั้งงบเป็น readonly คือยึดตามปีที่เลือกอยู่
 * ถ้ารายการมีแต่ปีที่มีข้อมูลแล้ว จะไม่เหลือทางตั้งงบให้ปีใหม่เลย
 */
async function budgetYears(ctx, currentYear) {
  const nowY = new Date().getFullYear();
  const years = new Set([nowY, nowY + 1, currentYear]);

  for (const r of ctx.ss.objects(SHEETS.BUDGET)) {
    const y = Number(r.Year);
    if (y) years.add(y);
  }
  for (const h of ctx.ss.objects(SHEETS.HISTORY)) {
    const d = safeParseDate(h.Date);
    if (d) years.add(partsOf(d).y);
  }
  for (const name of await getPlanYears(ctx)) {
    const y = Number(name.replace('Plan_', ''));
    if (y) years.add(y);
  }

  return [...years].filter(Boolean).sort((a, b) => b - a);
}

export async function getBudgetSummary(ctx, year) {
  await ctx.requireAccess();
  const currentYear = Number(year) || new Date().getFullYear();

  if (!(await ctx.canView('budget'))) {
    // ต้องคืน monthly ครบ 12 เดือนด้วย ไม่งั้นหน้าเว็บที่วาดกราฟจะพังทั้งหน้า
    // สำหรับคนที่ไม่มีสิทธิ์ดูงบ ซึ่งเป็นคนละเรื่องกับการไม่ให้เห็นตัวเลข
    const zero = Object.fromEntries(BUDGET_CATEGORIES.flatMap(c => [[budgetKey(c), 0], [expenseKey(c), 0], [remainKey(c), 0]]));
    return {
      year: currentYear, availableYears: [currentYear],
      ...zero, totalBudget: 0, totalExpense: 0, remaining: 0,
      monthly: monthlyBreakdown([], currentYear), note: ''
    };
  }

  await ctx.ensureBase();
  await ensureBudgetSheet(ctx);

  const row = ctx.ss.objects(SHEETS.BUDGET).find(r => Number(r.Year) === currentYear);
  const note = row ? row.Note || '' : '';

  // ค่าใช้จ่ายจริงคิดจากประวัติทั้งหมดของปีนั้น + ค่าติดตั้งในใบติดตั้ง (ไม่กรองภูมิภาค เพราะเป็นงบรวมทั้งบริษัท)
  //
  // ยอดรวมทั้งปีบวกมาจากรายเดือนโดยตรง ไม่ได้นับแยกกันคนละรอบ
  // เพื่อให้เป็นไปไม่ได้ที่ตัวเลขบนการ์ดสรุปกับตัวเลขบนกราฟจะไม่ตรงกัน
  const monthly = monthlyBreakdown(ctx.ss.objects(SHEETS.HISTORY), currentYear, ctx.ss.objects(SHEETS.INSTALLFORM));

  // ชื่อช่องเดิม (budgetCleaning, expenseRepair, remainCleaning …) คงไว้ — หน้าเว็บและชุดทดสอบเดิมอ่านชื่อนี้
  const out = { year: currentYear, availableYears: await budgetYears(ctx, currentYear) };
  let totalBudget = 0, totalExpense = 0;
  for (const c of BUDGET_CATEGORIES) {
    const budget = row ? Number(row[c.column]) || 0 : 0;
    const expense = monthly.reduce((s, m) => s + m[c.key], 0);
    out[budgetKey(c)] = budget;
    out[expenseKey(c)] = expense;
    out[remainKey(c)] = budget - expense;
    totalBudget += budget;
    totalExpense += expense;
  }
  return { ...out, totalBudget, totalExpense, remaining: totalBudget - totalExpense, monthly, note };
}

const cap = c => c.key[0].toUpperCase() + c.key.slice(1);
const budgetKey = c => 'budget' + cap(c);
const expenseKey = c => 'expense' + cap(c);
const remainKey = c => 'remain' + cap(c);

/**
 * บันทึกงบของปีหนึ่ง
 * งบจัดซื้อ/ติดตั้งต่อท้ายพารามิเตอร์เดิม — หน้าเว็บรุ่นเก่าไม่ส่งมา (undefined) = ไม่แตะค่าที่ตั้งไว้
 */
export async function saveBudgetRecord(ctx, year, budgetCleaning, budgetRepair, note, budgetPurchase, budgetInstall) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('budget');
    for (const [label, v] of [['งบล้างแอร์', budgetCleaning], ['งบซ่อมแอร์', budgetRepair],
      ['งบจัดซื้อเครื่องใหม่', budgetPurchase], ['งบติดตั้ง', budgetInstall]]) {
      if (v === '' || v === null || v === undefined) continue;
      if (!Number.isFinite(Number(v)) || Number(v) < 0) throw new Error(label + 'ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    }
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
    if (budgetPurchase !== undefined) payload.PurchaseBudget = budgetPurchase;
    if (budgetInstall !== undefined) payload.InstallBudget = budgetInstall;

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

/* ============== ส่งออก / นำเข้างบที่ตั้งไว้รายปี (Excel/CSV) ============== */

/** หัวคอลัมน์ของไฟล์ — ใช้ทั้งตอนส่งออกและนำเข้า */
export const BUDGET_IMPORT_COLUMNS = ['Year', ...BUDGET_CATEGORIES.map(c => c.column), 'Note'];

/** งบที่ตั้งไว้ทุกปี เรียงปีใหม่ก่อน — ใช้ทำไฟล์ส่งออก (ไฟล์เดียวกับที่แก้แล้วนำเข้ากลับได้) */
export async function getBudgetRows(ctx) {
  await ctx.requireAccess();
  if (!(await ctx.canView('budget'))) throw new Error('คุณไม่มีสิทธิ์ดูข้อมูลส่วนงบประมาณ');
  await ctx.ensureBase();
  await ensureBudgetSheet(ctx);
  return ctx.ss.objects(SHEETS.BUDGET)
    .filter(r => Number(r.Year))
    .sort((a, b) => Number(b.Year) - Number(a.Year))
    .map(r => Object.fromEntries(BUDGET_IMPORT_COLUMNS.map(k => [k, k === 'Note' ? r.Note || '' : Number(r[k]) || 0])));
}

/**
 * อ่านแถวจากไฟล์ — ผิดแม้แถวเดียวไม่รับทั้งไฟล์ (ไม่บันทึกครึ่งๆ)
 * ช่องว่าง = ไม่แก้ค่าเดิม · ตัวเลขมีจุลภาคได้ · ปีซ้ำในไฟล์ไม่รับ
 */
export function parseBudgetImport(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('ไม่พบข้อมูลในไฟล์');
  if (!Object.keys(rows[0]).includes('Year')) throw new Error('ไฟล์ไม่ถูกต้อง (ต้องมีคอลัมน์ Year) — ใช้ไฟล์จากปุ่ม Template');
  const out = [], seen = new Set(), errors = [];
  rows.forEach((r, i) => {
    const line = i + 2;   // แถว 1 คือหัวตาราง
    const blank = v => v === undefined || v === null || String(v).trim() === '';
    if (BUDGET_IMPORT_COLUMNS.every(k => blank(r[k]))) return;   // แถวว่างทั้งแถว ข้ามไป
    const year = Number(String(r.Year).trim());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { errors.push(`แถว ${line}: ปี "${r.Year}" ไม่ถูกต้อง`); return; }
    if (seen.has(year)) { errors.push(`แถว ${line}: ปี ${year} ซ้ำในไฟล์`); return; }
    seen.add(year);
    const values = {};
    for (const c of BUDGET_CATEGORIES) {
      if (blank(r[c.column])) continue;
      const n = Number(String(r[c.column]).replace(/,/g, '').trim());
      if (!Number.isFinite(n) || n < 0) { errors.push(`แถว ${line} (ปี ${year}): ${c.label} "${r[c.column]}" ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป`); continue; }
      values[c.column] = n;
    }
    if (!blank(r.Note)) values.Note = String(r.Note).trim();
    out.push({ year, values });
  });
  if (errors.length) throw new Error('นำเข้าไม่ได้ ยังไม่ได้บันทึกอะไร:\n' + errors.slice(0, 10).join('\n') + (errors.length > 10 ? `\nและอีก ${errors.length - 10} รายการ` : ''));
  if (!out.length) throw new Error('ไม่พบข้อมูลในไฟล์');
  return out;
}

/** เทียบไฟล์กับงบในระบบ — คืนเฉพาะช่องที่จะเปลี่ยน */
function diffBudgetImport(ctx, parsed) {
  const existing = ctx.ss.objects(SHEETS.BUDGET);
  const labels = Object.fromEntries([...BUDGET_CATEGORIES.map(c => [c.column, c.label]), ['Note', 'หมายเหตุ']]);
  return parsed.map(p => {
    const row = existing.find(r => Number(r.Year) === p.year);
    const fields = Object.entries(p.values)
      .map(([k, to]) => ({ column: k, label: labels[k], from: row ? (k === 'Note' ? row.Note || '' : Number(row[k]) || 0) : (k === 'Note' ? '' : 0), to }))
      .filter(f => f.from !== f.to);
    return { year: p.year, isNew: !row, row, fields };
  }).filter(c => c.fields.length);
}

/** ดูผลก่อนนำเข้า — ยังไม่บันทึก */
export async function previewBudgetImport(ctx, rows) {
  await ctx.assertModuleEdit('budget');
  const parsed = parseBudgetImport(rows);
  await ctx.ensureBase();
  await ensureBudgetSheet(ctx);
  const changes = diffBudgetImport(ctx, parsed).map(({ row, ...c }) => c);
  return { changes, unchangedYears: parsed.length - changes.length };
}

/** นำเข้าจริง — คิดผลใหม่ใน lock (ข้อมูลอาจเปลี่ยนระหว่างดูผล) แล้วเขียนเฉพาะช่องที่เปลี่ยน */
export async function applyBudgetImport(ctx, rows) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('budget');
    const parsed = parseBudgetImport(rows);
    await ctx.ensureBase();
    await ensureBudgetSheet(ctx);
    const changes = diffBudgetImport(ctx, parsed);
    const me = await ctx.currentUser(), now = ymdhms(new Date());
    const headers = ctx.ss.headers(SHEETS.BUDGET);
    for (const c of changes) {
      const payload = { ...Object.fromEntries(c.fields.map(f => [f.column, f.to])), UpdatedAt: now, UpdatedBy: me };
      if (c.row) ctx.ss.writeByHeaders(SHEETS.BUDGET, c.row._row, payload);
      else {
        const full = { Year: c.year, ...payload };
        ctx.ss.appendRow(SHEETS.BUDGET, headers.map(h => (full[h] !== undefined ? full[h] : (BUDGET_CATEGORIES.some(x => x.column === h) ? 0 : ''))));
      }
    }
    await ctx.ss.flush();
    return { changedYears: changes.map(c => c.year) };
  });
}
