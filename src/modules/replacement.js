import { SHEETS, BUDGET_HEADERS, REPLACE_PRICE_HEADERS, REPLACE_PICK_HEADERS } from '../schema.js';
import { safeParseDate, partsOf, normalizeCode, isRetiredStatus, ymdhms } from '../values.js';

/**
 * แผนเปลี่ยนเครื่องประจำปี — ตามชีต "งบเปลี่ยนเครื่อง 2027" ในไฟล์ Data_AIR ของพี่เลี้ยง
 *
 * เกณฑ์: อายุ ณ สิ้นปีงบ (31 ธ.ค.) เกิน 8 ปี = ครบเกณฑ์เปลี่ยน
 * อายุนับเป็นปี พ.ศ./ค.ศ. ที่ต่างกัน (ปีงบ − ปีที่ติดตั้ง) แบบเดียวกับในไฟล์ — ติดตั้ง 15/05/2013 ณ สิ้นปี 2027 = 14 ปี
 * ราคาต่อเครื่อง = ค่าเครื่อง + ค่าติดตั้ง ตามช่วงขนาด BTU (แก้ได้รายปี)
 * เครื่องที่จะเปลี่ยนจริง = ติ๊กเลือกเอง (Infrastructure) ยอดรวมใช้ตั้งงบจัดซื้อ/ติดตั้งในหน้างบประมาณได้
 *
 * ดูได้ตามสิทธิ์งบประมาณ (เป็นตัวเลขระดับบริษัทเหมือนงบ ไม่กรองภูมิภาค) · แก้ได้เฉพาะ Infrastructure
 */

export const AGE_LIMIT = 8;

/** ช่วงขนาดเครื่องและราคาเริ่มต้น — ตามตาราง "ราคาต่อเครื่องและงบประมาณ" ในไฟล์ */
export const REPLACE_BANDS = [
  { band: 1, label: '≤ 17,999 BTU', min: 0, max: 17999, unitPrice: 14700, installPrice: 4000 },
  { band: 2, label: '18,000 – 25,999 BTU', min: 18000, max: 25999, unitPrice: 14700, installPrice: 4000 },
  { band: 3, label: '26,000 – 35,999 BTU', min: 26000, max: 35999, unitPrice: 45000, installPrice: 6000 },
  { band: 4, label: '≥ 36,000 BTU', min: 36000, max: Infinity, unitPrice: 55000, installPrice: 8000 }
];

/** ช่วงอายุแบบแดชบอร์ดผู้บริหาร: ปกติ 0–6 · เฝ้าระวัง 7–8 · ครบเกณฑ์ > 8 */
export function ageGroup(age) {
  if (age === null) return 'unknown';
  if (age > AGE_LIMIT) return 'due';
  if (age >= 7) return 'watch';
  return 'normal';
}

/** อายุ ณ สิ้นปีงบ (ปี) — ไม่มีวันติดตั้ง = null */
export function ageAtYearEnd(installDate, year) {
  const d = safeParseDate(installDate);
  if (!d) return null;
  return Number(year) - partsOf(d).y;
}

export function bandOf(btu) {
  const n = Number(String(btu || '').replace(/,/g, '')) || 0;
  return REPLACE_BANDS.find(b => n >= b.min && n <= b.max) || REPLACE_BANDS[0];
}

const isOn = v => v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1';

/**
 * แถวประวัติหนึ่งแถวเป็นงานแบบไหนของแผนนี้
 *   'replace'  ได้เครื่องใหม่ที่ตำแหน่งเดิม — ปุ่มเปลี่ยนเครื่อง (replaceAirUnit) · งาน CM ของระบบเดิมที่นำเข้า ("แทนเครื่องเดิม")
 *   'movein'   ย้ายเครื่องที่มีอยู่แล้วมาแทน (moveAirUnit ฝั่งปลายทาง) — นับว่าตำแหน่งนี้เปลี่ยนแล้ว แต่ไม่ได้ซื้อเครื่อง
 *   'add'      ติดตั้งเพิ่มที่ตำแหน่งใหม่ (เพิ่มเครื่อง / ย้ายไป Node ใหม่)
 *   ''         อย่างอื่น รวมถึง "ย้ายเครื่องออก … ตำแหน่งว่าง" (ยังไม่มีเครื่องใหม่)
 */
export function replacementKind(h) {
  const t = String(h.EventType || '').trim(), d = String(h.Detail || '').trim();
  if (t === 'เปลี่ยนเครื่อง') {
    if (d.startsWith('เปลี่ยนตัวเครื่องใหม่')) return 'replace';
    if (d.startsWith('ย้ายเครื่องมาจาก')) return 'movein';
    return '';
  }
  if (t === 'ติดตั้ง') return /แทนเครื่องเดิม/.test(d) ? 'replace' : 'add';
  return '';
}

/**
 * คำนวณแผนทั้งหมดจากข้อมูลดิบ — แยกจากการอ่านฐานข้อมูลเพื่อให้ทดสอบได้ตรงๆ
 *
 * ความคืบหน้า (ช่วงที่สอง): ดูจากประวัติของปีนั้น ไม่ต้องกรอกเพิ่ม
 * - เครื่องที่ติ๊กไว้ แล้วเปลี่ยนในปีนั้น = "เปลี่ยนแล้ว" อยู่ในรายการต่อ (ทั้งที่อายุกลับเป็น 0 แล้ว) พร้อมวันที่และค่าใช้จ่ายจริง
 * - เปลี่ยนในปีนั้นแต่ไม่ได้ติ๊ก = "เปลี่ยนนอกแผน" · ติดตั้งที่ตำแหน่งใหม่ = "ติดตั้งเพิ่ม" (แยกไว้ ไม่ปนกับแผน)
 * - ค่าใช้จ่ายจริง = ค่าใช้จ่ายในแถวประวัติ + ค่าติดตั้งในใบติดตั้งของปีนั้น (ใบละสองเครื่องแบ่งครึ่ง)
 *
 * @param {Array} units   แถวทะเบียนเครื่อง
 * @param {Array} picks   แถว ReplacePick ของปีนั้น { AirCode, Selected }
 * @param {Array} prices  แถว ReplacePrice ของปีนั้น { Band, UnitPrice, InstallPrice } (ไม่มี = ราคาเริ่มต้น)
 * @param {number} year
 * @param {Array} [history]       แถวประวัติทั้งหมด
 * @param {Array} [installForms]  ใบติดตั้งทั้งหมด
 */
export function buildReplacementPlan(units, picks, prices, year, history = [], installForms = []) {
  const Y = Number(year);
  const bands = REPLACE_BANDS.map(b => {
    const p = prices.find(x => Number(x.Band) === b.band);
    return { band: b.band, label: b.label, unitPrice: p ? Number(p.UnitPrice) || 0 : b.unitPrice, installPrice: p ? Number(p.InstallPrice) || 0 : b.installPrice };
  });
  const picked = new Map(picks.map(p => [normalizeCode(p.AirCode), isOn(p.Selected)]));
  const yearOf = v => { const d = safeParseDate(v); return d ? partsOf(d).y : null; };

  // งานของแต่ละเครื่องในปีนั้น
  const jobs = new Map();   // code -> { kind, date, cost }
  const lastReplace = new Map();   // code -> วันที่เปลี่ยนล่าสุด (ทุกปี) ไว้บอกเหตุที่ติ๊กไว้แต่ไม่ครบเกณฑ์
  for (const h of history) {
    const kind = replacementKind(h);
    if (!kind) continue;
    const code = normalizeCode(h.AirCode);
    if (kind !== 'add' && String(h.Date || '') > String(lastReplace.get(code) || '')) lastReplace.set(code, String(h.Date || '').slice(0, 10));
    if (yearOf(h.Date) !== Y) continue;
    const j = jobs.get(code) || { kind, date: '', cost: 0 };
    if (kind !== 'add') j.kind = kind;
    if (String(h.Date || '') > j.date) j.date = String(h.Date || '').slice(0, 10);
    j.cost += Number(h.Cost) || 0;
    jobs.set(code, j);
  }
  for (const f of installForms) {
    if (yearOf(f.Date) !== Y || !(Number(f.Cost) > 0)) continue;
    const codes = [f.AirCode1, f.AirCode2].map(normalizeCode).filter(Boolean);
    for (const c of codes) if (jobs.has(c)) jobs.get(c).cost += Number(f.Cost) / codes.length;
  }

  const ageGroups = { normal: 0, watch: 0, due: 0, unknown: 0 };
  const list = [], unplanned = [], added = [], staleUnits = [];
  for (const u of units) {
    if (isRetiredStatus(u.Status)) continue;
    const code = normalizeCode(u.AirCode);
    const age = ageAtYearEnd(u.InstallDate, Y);
    ageGroups[ageGroup(age)]++;
    const job = jobs.get(code);
    const isPicked = picked.get(code) === true;
    const done = !!job && job.kind !== 'add';
    const b = bands[bandOf(u.BTU).band - 1];
    const row = {
      airCode: u.AirCode, region: String(u.Region || ''), province: u.Province || '', siteCode: u.SiteCode || '', nodeName: u.NodeName || '',
      brand: u.Brand || '', model: u.ModelIndoor || '', btu: Number(u.BTU) || 0, band: b.band, installDate: u.InstallDate || '', age,
      unitPrice: b.unitPrice, installPrice: b.installPrice, total: b.unitPrice + b.installPrice, selected: isPicked,
      status: done ? 'done' : isPicked ? 'pending' : 'none',
      doneDate: done ? job.date : '', doneKind: done ? job.kind : '', actualCost: done ? Math.round(job.cost * 100) / 100 : 0
    };
    // อยู่ในรายการ: ครบเกณฑ์ตามอายุตอนนี้ หรือ ติ๊กไว้แล้วเปลี่ยนไปแล้วในปีนี้ (อายุกลับเป็น 0 แต่ยังเป็นงานของแผน)
    if (ageGroup(age) === 'due' || (isPicked && done)) list.push(row);
    else {
      if (done) unplanned.push(row);
      // ติ๊กไว้แต่ไม่ครบเกณฑ์แล้ว — ไม่นับในยอด แต่ยังแสดงในตาราง (สีแดง พร้อมเหตุ) ไม่ต้องให้ Infrastructure ไปเอาติ๊กออกเอง
      if (isPicked) staleUnits.push({ ...row, status: 'stale', replacedOn: lastReplace.get(code) || '' });
    }
    if (job && job.kind === 'add') added.push({ ...row, doneDate: job.date, actualCost: Math.round(job.cost * 100) / 100 });
  }
  // เครื่องครบเกณฑ์ที่เปลี่ยนนอกแผนก็อยู่ในรายการหลักแล้ว (ไม่ได้ติ๊ก) — นับรวมในนอกแผนด้วย
  for (const x of list) if (x.status === 'done' && !x.selected) unplanned.push(x);
  // อายุมากก่อน แล้วตามวันติดตั้ง/รหัส — ลำดับเดียวกับรายชื่อในไฟล์ · ที่เปลี่ยนแล้ว (อายุใหม่) ไว้ท้าย
  const sortAge = x => (x.status === 'done' && (x.age === null || x.age <= AGE_LIMIT) ? -1 : x.age ?? -1);
  list.sort((a, b) => sortAge(b) - sortAge(a) || String(a.installDate).localeCompare(String(b.installDate)) || a.airCode.localeCompare(b.airCode));

  const sum = arr => arr.reduce((s, x) => ({ purchase: s.purchase + x.unitPrice, install: s.install + x.installPrice }), { purchase: 0, install: 0 });
  const actual = arr => Math.round(arr.reduce((s, x) => s + x.actualCost, 0) * 100) / 100;
  const sel = list.filter(x => x.selected);
  const doneSel = sel.filter(x => x.status === 'done'), left = sel.filter(x => x.status !== 'done');
  const t = sum(sel), tl = sum(left);
  const regions = [...new Set(list.map(x => x.region))].sort((a, b) => Number(a) - Number(b));
  const byRegion = regions.map(r => {
    const all = list.filter(x => x.region === r), s = all.filter(x => x.selected), m = sum(s);
    return { region: r, due: all.filter(x => ageGroup(x.age) === 'due').length, selected: s.length, done: s.filter(x => x.status === 'done').length,
      purchase: m.purchase, install: m.install, total: m.purchase + m.install, sites: new Set(s.map(x => x.siteCode)).size };
  });
  const byBand = bands.map(b => {
    const all = list.filter(x => x.band === b.band), s = all.filter(x => x.selected);
    return { ...b, due: all.filter(x => ageGroup(x.age) === 'due').length, selected: s.length, purchase: s.length * b.unitPrice, install: s.length * b.installPrice };
  });
  // ติ๊กไว้แต่ไม่อยู่ในแผนแล้ว (ไม่ครบเกณฑ์ และไม่ได้เปลี่ยนในปีนี้) — ไม่นับในยอด แต่บอกเหตุให้รู้
  const inList = new Set(list.map(x => normalizeCode(x.airCode)));
  const staleSelected = picks.filter(p => isOn(p.Selected) && !inList.has(normalizeCode(p.AirCode)))
    .map(p => ({ airCode: p.AirCode, replacedOn: lastReplace.get(normalizeCode(p.AirCode)) || '' }));

  return {
    year: Y, ageLimit: AGE_LIMIT, ageGroups, bands, units: list, byRegion, byBand, staleSelected, staleUnits, unplanned, added,
    summary: {
      due: list.filter(x => ageGroup(x.age) === 'due').length, selected: sel.length, purchase: t.purchase, install: t.install, total: t.purchase + t.install,
      done: doneSel.length, doneActual: actual(doneSel), remaining: left.length, remainingTotal: tl.purchase + tl.install,
      unplanned: unplanned.length, unplannedActual: actual(unplanned), added: added.length, addedActual: actual(added)
    }
  };
}

async function ensureSheets(ctx) {
  await ctx.connect();
  for (const [name, headers] of [[SHEETS.REPLACE_PRICE, REPLACE_PRICE_HEADERS], [SHEETS.REPLACE_PICK, REPLACE_PICK_HEADERS], [SHEETS.BUDGET, BUDGET_HEADERS]]) {
    await ctx.ss.ensureSheet(name, headers);
    await ctx.ss.load(name);
    await ctx.ss.ensureColumns(name, headers);
  }
}

async function assertCanView(ctx) {
  await ctx.requireAccess();
  if (!(await ctx.canView('budget'))) throw new Error('คุณไม่มีสิทธิ์ดูข้อมูลส่วนงบประมาณ');
}

function validYear(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2600) throw new Error('ปีไม่ถูกต้อง');
  return y;
}

export async function getReplacementPlan(ctx, year) {
  await assertCanView(ctx);
  const y = validYear(year);
  await ctx.ensureBase();
  await ensureSheets(ctx);
  const ofYear = name => ctx.ss.objects(name).filter(r => Number(r.Year) === y);
  const plan = buildReplacementPlan(ctx.ss.objects(SHEETS.AIRLIST), ofYear(SHEETS.REPLACE_PICK), ofYear(SHEETS.REPLACE_PRICE), y,
    ctx.ss.objects(SHEETS.HISTORY), ctx.ss.objects(SHEETS.INSTALLFORM));
  const b = ctx.ss.objects(SHEETS.BUDGET).find(r => Number(r.Year) === y);
  plan.budget = { purchase: b ? Number(b.PurchaseBudget) || 0 : 0, install: b ? Number(b.InstallBudget) || 0 : 0, exists: !!b };
  plan.canEdit = (await ctx.userInfo()).role === 'Admin';
  return plan;
}

/**
 * ติ๊ก/เอาติ๊กออก หลายเครื่องพร้อมกัน (Infrastructure)
 * รับเฉพาะเครื่องที่มีในทะเบียน — รหัสที่ไม่รู้จักปฏิเสธทั้งชุด ไม่บันทึกครึ่งๆ
 */
export async function setReplacementPicks(ctx, year, airCodes, selected) {
  return ctx.withLock(async () => {
    await ctx.assertAdmin();
    const y = validYear(year);
    await ctx.ensureBase();
    await ensureSheets(ctx);
    const codes = (Array.isArray(airCodes) ? airCodes : [airCodes]).map(c => String(c || '').trim()).filter(Boolean);
    if (!codes.length) throw new Error('ไม่ได้เลือกเครื่อง');
    const known = new Map(ctx.ss.objects(SHEETS.AIRLIST).map(u => [normalizeCode(u.AirCode), u.AirCode]));
    const unknown = codes.filter(c => !known.has(normalizeCode(c)));
    if (unknown.length) throw new Error('ไม่พบเครื่อง ' + unknown.slice(0, 5).join(', ') + (unknown.length > 5 ? ` และอีก ${unknown.length - 5} เครื่อง` : ''));

    const me = await ctx.currentUser(), now = ymdhms(new Date());
    const rows = ctx.ss.objects(SHEETS.REPLACE_PICK).filter(r => Number(r.Year) === y);
    const headers = ctx.ss.headers(SHEETS.REPLACE_PICK);
    for (const c of codes) {
      const code = known.get(normalizeCode(c));
      const payload = { Year: y, AirCode: code, Selected: !!selected, UpdatedAt: now, UpdatedBy: me };
      const ex = rows.find(r => normalizeCode(r.AirCode) === normalizeCode(code));
      if (ex) ctx.ss.writeByHeaders(SHEETS.REPLACE_PICK, ex._row, payload);
      else ctx.ss.appendRow(SHEETS.REPLACE_PICK, headers.map(h => (payload[h] !== undefined ? payload[h] : '')));
    }
    await ctx.ss.flush();
    return getReplacementPlan(ctx, y);
  });
}

/** แก้ราคาเครื่อง/ค่าติดตั้งของช่วง BTU (Infrastructure) — prices: [{ band, unitPrice, installPrice }] */
export async function saveReplacementPrices(ctx, year, prices) {
  return ctx.withLock(async () => {
    await ctx.assertAdmin();
    const y = validYear(year);
    if (!Array.isArray(prices) || !prices.length) throw new Error('ไม่มีราคาให้บันทึก');
    for (const p of prices) {
      if (!REPLACE_BANDS.some(b => b.band === Number(p.band))) throw new Error('ช่วงขนาดเครื่องไม่ถูกต้อง');
      for (const [label, v] of [['ราคาเครื่อง', p.unitPrice], ['ค่าติดตั้ง', p.installPrice]]) {
        if (!Number.isFinite(Number(v)) || Number(v) < 0 || String(v).trim() === '') throw new Error(label + 'ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
      }
    }
    await ctx.ensureBase();
    await ensureSheets(ctx);
    const me = await ctx.currentUser(), now = ymdhms(new Date());
    const rows = ctx.ss.objects(SHEETS.REPLACE_PRICE).filter(r => Number(r.Year) === y);
    const headers = ctx.ss.headers(SHEETS.REPLACE_PRICE);
    for (const p of prices) {
      const payload = { Year: y, Band: Number(p.band), UnitPrice: Number(p.unitPrice), InstallPrice: Number(p.installPrice), UpdatedAt: now, UpdatedBy: me };
      const ex = rows.find(r => Number(r.Band) === Number(p.band));
      if (ex) ctx.ss.writeByHeaders(SHEETS.REPLACE_PRICE, ex._row, payload);
      else ctx.ss.appendRow(SHEETS.REPLACE_PRICE, headers.map(h => (payload[h] !== undefined ? payload[h] : '')));
    }
    await ctx.ss.flush();
    return getReplacementPlan(ctx, y);
  });
}

/**
 * ใช้ยอดเครื่องที่เลือกเป็นงบจัดซื้อ/ติดตั้งของปีนั้น (Infrastructure)
 * งบล้าง งบซ่อม และหมายเหตุเดิมไม่แตะ
 */
export async function applyReplacementToBudget(ctx, year) {
  return ctx.withLock(async () => {
    await ctx.assertAdmin();
    const y = validYear(year);
    await ctx.ensureBase();
    await ensureSheets(ctx);
    const ofYear = name => ctx.ss.objects(name).filter(r => Number(r.Year) === y);
    // ส่งประวัติด้วย — เครื่องที่ติ๊กไว้และเปลี่ยนไปแล้วยังเป็นงานของแผน ต้องอยู่ในยอดงบ
    const { summary } = buildReplacementPlan(ctx.ss.objects(SHEETS.AIRLIST), ofYear(SHEETS.REPLACE_PICK), ofYear(SHEETS.REPLACE_PRICE), y,
      ctx.ss.objects(SHEETS.HISTORY), ctx.ss.objects(SHEETS.INSTALLFORM));
    const me = await ctx.currentUser(), now = ymdhms(new Date());
    const payload = { Year: y, PurchaseBudget: summary.purchase, InstallBudget: summary.install, UpdatedAt: now, UpdatedBy: me };
    const ex = ctx.ss.objects(SHEETS.BUDGET).find(r => Number(r.Year) === y);
    if (ex) ctx.ss.writeByHeaders(SHEETS.BUDGET, ex._row, payload);
    else {
      const headers = ctx.ss.headers(SHEETS.BUDGET);
      ctx.ss.appendRow(SHEETS.BUDGET, headers.map(h => (payload[h] !== undefined ? payload[h] : '')));
    }
    await ctx.ss.flush();
    return getReplacementPlan(ctx, y);
  });
}
