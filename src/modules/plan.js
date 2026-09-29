import { SHEETS, PLAN_HEADERS } from '../schema.js';
import { formatDate, isRetiredStatus, normalizeCode, safeParseDate, todayStart } from '../values.js';
import { addHistoryRaw, getHistory } from './history.js';
import { jobKey } from '../context.js';

/**
 * แผนล้างแอร์ประจำปี
 * พอร์ตมาจากส่วน "2. CLEANING PLAN" ของ Code.gs เดิม
 *
 * แผนแต่ละปีเก็บเป็นชีตแยกชื่อ Plan_YYYY โดยหนึ่งแถวคือหนึ่งเครื่อง
 * และมี 3 รอบการล้างต่อปี (R1/R2/R3) รอบละ 6 คอลัมน์เรียงติดกัน
 */

const planSheet = year => 'Plan_' + year;

/**
 * แปลงค่าที่อ่านมาจากชีตให้กลับไปเขียนลงชีตได้อย่างปลอดภัย สำหรับ "คอลัมน์วันที่"
 *
 * จำเป็นมาก: เราอ่านค่าจาก Sheets มาเป็นตัวเลขลำดับวัน (serial number)
 * ถ้าเขียนตัวเลขนั้นกลับลงไปตรงๆ Google จะบันทึกเป็น "ตัวเลข 45000"
 * ไม่ใช่ "วันที่" อีกต่อไป ข้อมูลวันที่ทั้งคอลัมน์จะพังทันที
 * จึงต้องแปลงกลับเป็นข้อความ yyyy-MM-dd ก่อนเสมอ
 */
const dateOut = v => (v === '' || v === null || v === undefined ? '' : formatDate(v));

export async function getPlanYears(ctx) {
  await ctx.requireAccess();
  await ctx.connect();
  const names = await ctx.ss.sheetNames();
  return names.filter(n => /^Plan_\d{4}$/.test(n)).sort().reverse();
}

export async function getCleaningPlan(ctx, year) {
  await ctx.requireAccess();
  if (!(await ctx.canView('plan'))) return [];

  const name = planSheet(year);
  await ctx.connect();
  if (!(await ctx.ss.hasSheet(name))) return [];

  await ctx.ss.load(name);
  await ctx.ss.ensureColumns(name, PLAN_HEADERS);

  // ตารางแผนไม่ได้เก็บภูมิภาคไว้ (อยู่ในรายการเครื่อง) แต่หน้าเว็บต้องใช้กรอง
  // จึงแปะติดไปกับแถวตอนส่งออก เหมือนที่ตารางแผนเก็บ NodeName/SiteCode ซ้ำไว้อยู่แล้ว
  // ถ้าให้หน้าเว็บไปหาเองจะพังตอนเปิดหน้าแผนก่อนหน้ารายการเครื่อง เพราะยังไม่มีข้อมูลเครื่องในมือ
  await ctx.ensureBase();
  const regionOf = new Map();
  const retiredSet = new Set();
  for (const u of ctx.ss.objects(SHEETS.AIRLIST)) {
    if (!u.AirCode) continue;
    const code = normalizeCode(u.AirCode);
    regionOf.set(code, String(u.Region || '').trim());
    if (isRetiredStatus(u.Status)) retiredSet.add(code);
  }

  let list = ctx.ss.objects(name).map(o => {
    const out = { ...o };
    ['R1_PlanDate', 'R1_ActualDate', 'R2_PlanDate', 'R2_ActualDate', 'R3_PlanDate', 'R3_ActualDate']
      .forEach(k => { out[k] = formatDate(o[k]); });
    out.Region = regionOf.get(normalizeCode(o.AirCode)) || '';

    // เครื่องที่รื้อถอน/Write off ไปแล้ว แถวแผนของมันยังอยู่ (ลบทิ้งไม่ได้ เพราะรอบที่ล้างไปแล้ว
    // เป็นเงินที่จ่ายจริง) แต่ต้องบอกทุกที่ที่ใช้แถวนี้ว่าไม่ต้องไปล้างอีกแล้ว
    out.Retired = retiredSet.has(normalizeCode(o.AirCode));

    // เครื่องที่ถูกลบออกจากทะเบียนไปเลย ก็ไม่ต้องไปล้างเหมือนกัน
    // แถวแผนไม่ได้ถูกลบตามไปด้วย ถ้าไม่ทำเครื่องหมายไว้ มันจะค้างเป็นงานที่ต้องทำตลอดไป
    out.Removed = !regionOf.has(normalizeCode(o.AirCode));
    return out;
  });

  const info = await ctx.userInfo();
  if (info.role !== 'Admin') {
    const allowed = await ctx.allowedAirCodes();
    list = list.filter(o => allowed.has(normalizeCode(o.AirCode)));
  }

  // ชื่อผู้รับเหมาของแต่ละรอบ — แผนเก็บแค่รหัส หน้าเว็บต้องการชื่อไปแสดง
  const names = contractorNames(ctx);
  for (const o of list) {
    for (const r of [1, 2, 3]) {
      const id = String(o['R' + r + '_ContractorID'] || '').trim();
      o['R' + r + '_ContractorName'] = id ? (names.get(id.toUpperCase()) || id) : '';
    }
  }

  // ผู้รับเหมาเห็นเครื่องที่มีงานของตัวเอง แต่เครื่องเดียวกันอาจมีรอบอื่นเป็นของเจ้าอื่น
  // รอบพวกนั้นต้องไม่เห็นราคา ชื่อช่าง และหมายเหตุ (คือค่าจ้างของคู่แข่ง)
  // เหลือไว้แค่วันที่กับสถานะ ให้รู้ว่าเครื่องนี้มีคนดูแลรอบนั้นอยู่
  if (info.role === 'Contractor') {
    const jobs = new Set(info.jobs || []);
    for (const o of list) {
      for (const r of [1, 2, 3]) {
        const mine = jobs.has(jobKey(year, r, normalizeCode(o.AirCode)));
        o['R' + r + '_Mine'] = mine;
        if (mine) continue;
        for (const k of ['Price', 'Technician', 'Note', 'FormUrl', 'ContractorID', 'ContractorName']) {
          o['R' + r + '_' + k] = '';
        }
      }
    }
  }
  return list;
}

/** รหัสผู้รับเหมา (ตัวพิมพ์ใหญ่) → ชื่อ */
function contractorNames(ctx) {
  return new Map(ctx.ss.objects(SHEETS.CONTRACTOR)
    .map(c => [String(c.ID || '').trim().toUpperCase(), String(c.Name || '').trim()]));
}

/**
 * ตรวจรหัสผู้รับเหมาที่จะมอบหมายงาน — ค่าว่าง = ไม่มอบหมายให้ใคร
 * คืนรหัสตามที่เก็บในตาราง (ตัวพิมพ์ตรงกับต้นฉบับ)
 */
function checkContractorId(ctx, id) {
  const want = String(id == null ? '' : id).trim();
  if (!want) return '';
  const c = ctx.ss.objects(SHEETS.CONTRACTOR)
    .find(x => String(x.ID || '').trim().toUpperCase() === want.toUpperCase());
  if (!c) throw new Error('ไม่พบผู้รับเหมารหัส ' + want + ' กรุณารีเฟรชหน้าจอแล้วเลือกใหม่');
  if (c.Active === false || String(c.Active).toUpperCase() === 'FALSE') {
    throw new Error('ผู้รับเหมา "' + c.Name + '" ถูกปิดใช้งานอยู่');
  }
  return String(c.ID).trim();
}

/**
 * ============================================================================
 * สรุปการล้างแอร์รายปี
 * ============================================================================
 *
 * ตารางแผนมี 457 แถว x 3 รอบ ซึ่งกวาดตาดูแล้วบอกภาพรวมไม่ได้เลย
 * ส่วนนี้ตอบคำถามที่คนถามจริงตอนสิ้นปีและตอนรายงานหัวหน้า
 *   ปีนี้ล้างไปแล้วกี่รอบ เหลืออีกเท่าไหร่ ใช้เงินไปเท่าไหร่
 *   และภูมิภาคไหนตามหลัง
 *
 * นับ "เสร็จ" จากสถานะเป็นหลัก แต่ถ้ามีวันที่ทำจริงบันทึกไว้ก็นับว่าเสร็จด้วย
 * เพราะข้อมูลที่ย้ายมาจากชีตเดิมบางแถวมีวันที่ทำจริงแต่สถานะยังไม่ได้อัปเดต
 * ถ้านับแต่สถานะอย่างเดียว งานที่ทำไปแล้วจริงจะหายจากรายงาน
 */

const ROUND_DONE = 'ล้างเสร็จสิ้น';
const ROUND_CANCELLED = 'ยกเลิก';

/**
 * เรียง Node ที่ค้างมากที่สุดไว้บน
 *
 * รายการนี้มีไว้ใช้ตามงาน ไม่ได้มีไว้ดูว่าทำได้ดีแค่ไหน
 * ที่ที่ยังไม่ได้ล้างเลยจึงต้องอยู่บนสุด ไม่ใช่ไปจมอยู่ท้ายรายการ 51 บรรทัด
 * Node ที่ยกเลิกทุกรอบไม่มีงานเหลือ ถือว่าเสร็จ (1) จะได้ไม่ลอยขึ้นมากวน
 */
function sortNodesByProgress(nodes) {
  const rate = n => (n.done + n.pending) ? n.done / (n.done + n.pending) : 1;
  return nodes.sort((a, b) => rate(a) - rate(b) || String(a.node).localeCompare(String(b.node), 'th'));
}

/**
 * สรุปสถานะของรอบหนึ่ง คืน 'done' | 'cancelled' | 'pending'
 *
 * รอบที่ยังไม่ได้ทำของเครื่องที่รื้อถอน/Write off ไปแล้ว นับเป็นยกเลิก
 * เพราะจะไม่มีวันได้ล้าง ถ้ายังนับเป็น "รอดำเนินการ" ความคืบหน้าจะไม่มีวันถึง 100%
 * และตัวหารจะไม่ตรงกับจำนวนเครื่องที่ใช้งานอยู่จริงบนแดชบอร์ด
 *
 * ส่วนรอบที่ล้างไปแล้วยังนับเป็นเสร็จตามเดิม เพราะงานทำไปจริงและเงินจ่ายไปจริง
 * ถ้าตัดทิ้งด้วย ค่าใช้จ่ายที่เคยรายงานไปแล้วจะหายไปจากสรุปเฉยๆ
 */
function roundState(row, r, retired) {
  const status = String(row['R' + r + '_Status'] || '').trim();
  if (status === ROUND_CANCELLED) return 'cancelled';
  if (status === ROUND_DONE) return 'done';
  if (String(row['R' + r + '_ActualDate'] || '').trim()) return 'done';
  return retired ? 'cancelled' : 'pending';
}

/**
 * สรุปแผนล้างแอร์ของปีหนึ่ง
 *
 * @param {Array<Object>} planRows แถวจากตารางแผน (กรองตามสิทธิ์มาแล้ว)
 * @param {Array<Object>} airUnits รายการเครื่อง ใช้หาว่าแต่ละเครื่องอยู่ภูมิภาคไหน
 * @param {number|string} year
 */
export function summarizeCleaning(planRows, airUnits, year) {
  const regionOf = new Map();
  const retiredSet = new Set();
  for (const u of airUnits || []) {
    if (!u.AirCode) continue;
    const code = normalizeCode(u.AirCode);
    regionOf.set(code, String(u.Region || '').trim() || 'ไม่ระบุ');
    if (isRetiredStatus(u.Status)) retiredSet.add(code);
  }

  const blank = () => ({ done: 0, pending: 0, cancelled: 0, cost: 0 });
  const rounds = [1, 2, 3].map(r => ({ round: r, ...blank() }));
  const byRegion = new Map();

  let neverCleaned = 0;

  for (const row of planRows || []) {
    // แถวยังอยู่ในตาราง แต่ไม่นับเป็น "เครื่องที่ต้องล้าง" อีกแล้ว
    //
    // สองกรณีนี้ต่างกันที่เหตุผล แต่ผลเหมือนกันคือไม่มีใครไปล้างมันได้
    //   รื้อถอน/Write off  ยังอยู่ในทะเบียน แต่เลิกใช้แล้ว
    //   ถูกลบ              ไม่อยู่ในทะเบียนแล้ว (แถวแผนไม่ได้ถูกลบตามไปด้วย)
    const code = normalizeCode(row.AirCode);
    const retired = retiredSet.has(code) || !regionOf.has(code);

    const region = regionOf.get(normalizeCode(row.AirCode)) || 'ไม่ระบุ';
    if (!byRegion.has(region)) byRegion.set(region, { region, units: 0, ...blank(), nodes: new Map() });
    const reg = byRegion.get(region);
    if (!retired) reg.units++;

    // ยอดรวมของภูมิภาคบอกได้แค่ว่าคืบหน้าเท่าไหร่ ไม่ได้บอกว่า "ที่ไหน" ยังไม่ได้ล้าง
    // ซึ่งเป็นคำถามที่ต้องใช้ตอนตามงานจริง จึงต้องแยกย่อยลงไปถึงระดับ Node
    const nodeName = String(row.NodeName || '').trim() || 'ไม่ระบุ Node';
    if (!reg.nodes.has(nodeName)) {
      reg.nodes.set(nodeName, {
        node: nodeName,
        siteCode: String(row.SiteCode || '').trim(),
        units: 0, ...blank(), lastDone: ''
      });
    }
    const nd = reg.nodes.get(nodeName);
    if (!retired) nd.units++;

    let doneThisUnit = 0;

    for (const r of [1, 2, 3]) {
      // บัญชีผู้รับเหมา: รอบที่เป็นงานของเจ้าอื่นไม่ใช่งานของตัวเอง ไม่นับทั้งเสร็จและค้าง
      // (ธงนี้มีเฉพาะแถวที่ getCleaningPlan ส่งให้ผู้รับเหมา เจ้าหน้าที่นับครบทุกรอบเหมือนเดิม)
      if (row['R' + r + '_Mine'] === false) continue;

      const state = roundState(row, r, retired);
      const cost = Number(row['R' + r + '_Price']) || 0;

      rounds[r - 1][state]++;
      reg[state]++;
      nd[state]++;

      if (state === 'done') {
        doneThisUnit++;
        rounds[r - 1].cost += cost;
        reg.cost += cost;
        nd.cost += cost;

        // เทียบวันที่เป็นข้อความได้เลย เพราะรูปแบบ ปปปป-ดด-วว เรียงตามตัวอักษร
        // แล้วได้ลำดับตรงกับเรียงตามเวลาพอดี ไม่ต้องแปลงเป็น Date ให้เสี่ยงเรื่องเขตเวลา
        const at = String(row['R' + r + '_ActualDate'] || '').trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(at) && at > nd.lastDone) nd.lastDone = at;
      }
    }

    // เครื่องที่ยังไม่ได้ล้างเลยสักรอบ คือรายการที่ต้องตามงานจริงๆ
    // ต่างจากตัวเลขรวมที่บอกแค่ว่าเหลืออีกเท่าไหร่
    // เครื่องที่ถูกรื้อถอนไปแล้วไม่นับ เพราะไม่ใช่งานที่ตามได้
    if (!doneThisUnit && !retired) neverCleaned++;
  }

  const sum = k => rounds.reduce((s, x) => s + x[k], 0);
  const done = sum('done');
  const planned = done + sum('pending');   // ไม่รวมรอบที่ยกเลิก เพราะไม่ใช่งานที่ต้องทำแล้ว

  return {
    year: Number(year),
    // นับเฉพาะเครื่องที่ยังใช้งานอยู่ ให้ตรงกับการ์ด "เครื่องทั้งหมด" บนแดชบอร์ด
    units: [...byRegion.values()].reduce((n, r) => n + r.units, 0),
    rounds,
    done,
    pending: sum('pending'),
    cancelled: sum('cancelled'),
    planned,
    cost: sum('cost'),
    percent: planned ? Math.round((done / planned) * 100) : 0,
    neverCleaned,
    byRegion: [...byRegion.values()]
      .map(r => ({ ...r, nodes: sortNodesByProgress([...r.nodes.values()]) }))
      .sort((a, b) => String(a.region).localeCompare(String(b.region), 'th'))
  };
}

/**
 * ============================================================================
 * ปฏิทินนัดหมายล้างแอร์
 * ============================================================================
 *
 * รายการนัดหมายแบบลิสต์บอกได้แค่ว่า "อีก 30 วันมีอะไรบ้าง" ซึ่งวางแผนงานไม่ได้
 * เพราะมองไม่เห็นว่าวันไหนงานกระจุก วันไหนว่าง และวันหยุดชนกับนัดหรือเปล่า
 * ปฏิทินทั้งเดือนตอบเรื่องพวกนี้ได้ในตาเดียว
 */

/**
 * จัดนัดหมายของเดือนหนึ่งลงเป็นรายวัน
 *
 * @param {Array<Object>} planRows แถวจากตารางแผน (กรองตามสิทธิ์มาแล้ว)
 * @param {number} year
 * @param {number} month 1-12
 * @returns {{year, month, days: Object, total: number}}
 *          days คือ map จากเลขวันที่ -> รายการนัดของวันนั้น
 */
export function planCalendar(planRows, year, month) {
  const y = Number(year);
  const m = Number(month);
  const prefix = y + '-' + String(m).padStart(2, '0') + '-';

  const days = {};
  let total = 0;

  for (const row of planRows || []) {
    for (const r of [1, 2, 3]) {
      // บัญชีผู้รับเหมา: รอบของเจ้าอื่นไม่ใช่นัดของตัวเอง ไม่ต้องขึ้นในปฏิทิน
      // (ธงนี้มีเฉพาะแถวที่ getCleaningPlan ส่งให้ผู้รับเหมา)
      if (row['R' + r + '_Mine'] === false) continue;

      const raw = String(row['R' + r + '_PlanDate'] || '').trim();
      if (!raw.startsWith(prefix)) continue;

      // เทียบด้วยข้อความตรงๆ ไม่แปลงเป็น Date ก่อน
      // เพราะการแปลงเป็น Date แล้วอ่านเดือนกลับออกมา ทำให้วันที่ 1 ของเดือน
      // ตกไปอยู่เดือนก่อนหน้าเมื่อรันบนเครื่องที่ตั้งเวลาเป็น UTC
      const day = Number(raw.slice(prefix.length, prefix.length + 2));
      if (!day) continue;

      (days[day] ||= []).push({
        AirCode: row.AirCode,
        NodeName: row.NodeName || '',
        // ปีของแผนที่นัดนี้สังกัด ไม่ใช่ปีของวันที่นัด (สองอย่างนี้ไม่จำเป็นต้องตรงกัน)
        planYear: String(row.PlanYear || ''),
        round: r,
        status: String(row['R' + r + '_Status'] || '').trim(),
        state: roundState(row, r),
        actualDate: String(row['R' + r + '_ActualDate'] || '').trim()
      });
      total++;
    }
  }

  // เรียงในแต่ละวันให้คงที่ เพื่อให้หน้าจอไม่สลับตำแหน่งเองทุกครั้งที่โหลด
  // เครื่องเดียวกันโผล่ได้หลายแผน จึงต้องมีปีของแผนเป็นตัวตัดสินซ้อนเข้าไปด้วย
  for (const d of Object.keys(days)) {
    days[d].sort((a, b) =>
      String(a.AirCode).localeCompare(String(b.AirCode), 'th') ||
      String(a.planYear).localeCompare(String(b.planYear)) ||
      a.round - b.round);
  }

  return { year: y, month: m, days, total };
}

/**
 * ปฏิทินนัดหมายของเดือนที่ระบุ รวมนัดจากแผนทุกปีที่มีในระบบ
 *
 * ต้องรวมทุกแผน เพราะ "แผนปี 2027" ไม่ได้แปลว่านัดทุกใบอยู่ในปี 2027
 * แผนปีถัดไปมักเริ่มลงนัดตั้งแต่ปลายปีก่อนหน้า เช่นแผนปี 2027 มีนัดเดือน ก.ย. 2026
 * ถ้าเปิดปฏิทินเดือน ก.ย. 2026 แล้วดูแค่แผนปี 2026 นัดพวกนั้นจะหายไปทั้งที่มีอยู่จริง
 * (เป็นบั๊กที่เจอจากหน้าแดชบอร์ด: รายการนัดขึ้น แต่กดดูปฏิทินแล้วว่างเปล่า)
 */
export async function getPlanCalendar(ctx, year, month) {
  await ctx.requireAccess();
  if (!(await ctx.canView('plan'))) return null;

  const years = await getPlanYears(ctx);

  // ใช้ getCleaningPlan เพื่อให้กรองตามสิทธิ์ชุดเดียวกับตารางแผน
  const rows = [];
  for (const name of years) {
    const py = name.replace('Plan_', '');
    for (const row of await getCleaningPlan(ctx, py)) rows.push({ ...row, PlanYear: py });
  }

  return planCalendar(rows, year, month);
}

/* ==================== นัดหมาย 30 วันข้างหน้า ==================== */

/** แสดงกี่รายการ — เกินนี้หน้าจอรก คนดูต่อในปฏิทินทั้งเดือนได้ */
export const UPCOMING_LIMIT = 12;

/**
 * นัดล้างที่ยังไม่เสร็จ ในช่วง 30 วันข้างหน้า จากแผนปีเดียว
 *
 * ใช้ร่วมกันระหว่างแดชบอร์ดของเจ้าหน้าที่กับของผู้รับเหมา
 * ถ้าต่างคนต่างนับ วันหนึ่งสองหน้าจะบอกนัดไม่ตรงกัน
 *
 * @param {Array}  plan  แถวจาก getCleaningPlan (กรองตามสิทธิ์มาแล้ว)
 * @param {string} py    ปีของแผน
 * @param {Date}   today เที่ยงคืนของวันนี้ตามเวลาไทย
 */
export function upcomingFromPlan(plan, py, today) {
  const futureLimit = new Date(today.getTime() + 30 * 86400000 + 86399999);
  const out = [];

  for (const p of plan || []) {
    // เครื่องที่รื้อถอน/Write off หรือถูกลบออกจากทะเบียนไปแล้ว ต้องไม่ขึ้นเป็นนัดหมาย
    // ไม่งั้นพอถึงวันนัด จะมีคนถูกส่งไปล้างเครื่องที่ไม่มีอยู่แล้ว
    if (p.Retired || p.Removed) continue;

    for (const r of [1, 2, 3]) {
      // บัญชีผู้รับเหมา: รอบของเจ้าอื่นไม่ใช่นัดของตัวเอง
      if (p['R' + r + '_Mine'] === false) continue;
      const status = p['R' + r + '_Status'];
      if (status === 'ล้างเสร็จสิ้น' || status === 'ยกเลิก') continue;
      if (!p['R' + r + '_PlanDate']) continue;

      const pDate = safeParseDate(p['R' + r + '_PlanDate']);
      if (pDate && pDate >= today && pDate <= futureLimit) {
        out.push({
          AirCode: p.AirCode,
          NodeName: p.NodeName,
          Round: r,
          PlanYear: py,
          PlanDate: p['R' + r + '_PlanDate'],
          RawDate: pDate.getTime()
        });
      }
    }
  }
  return out;
}

/**
 * นัดหมาย 30 วันข้างหน้าจากทุกแผน — สำหรับแดชบอร์ดของผู้รับเหมา
 * (แดชบอร์ดของเจ้าหน้าที่ได้รายการเดียวกันนี้มากับ getDashboardSummary)
 *
 * ต้องมองทุกแผน ไม่ใช่แค่ปีล่าสุด เพราะแผนปีหน้ามักลงนัดตั้งแต่ปลายปีนี้
 */
export async function getUpcomingCleanings(ctx) {
  await ctx.requireAccess();
  if (!(await ctx.canView('plan'))) return [];

  const today = todayStart();
  const out = [];
  for (const name of await getPlanYears(ctx)) {
    const py = name.replace('Plan_', '');
    out.push(...upcomingFromPlan(await getCleaningPlan(ctx, py), py, today));
  }
  return out.sort((a, b) => a.RawDate - b.RawDate).slice(0, UPCOMING_LIMIT);
}

/** สรุปการล้างแอร์ของปีที่ระบุ สำหรับแสดงหัวหน้าตารางแผน */
export async function getCleaningSummary(ctx, year) {
  await ctx.requireAccess();
  if (!(await ctx.canView('plan'))) return null;

  // ใช้ getCleaningPlan เพื่อให้การกรองตามสิทธิ์เป็นชุดเดียวกับที่ตารางเห็น
  // ถ้าเขียนการกรองซ้ำอีกชุด ตัวเลขสรุปกับตารางจะไม่ตรงกันเมื่อสิทธิ์เปลี่ยน
  const plan = await getCleaningPlan(ctx, year);
  await ctx.ensureBase();

  return summarizeCleaning(plan, ctx.ss.objects(SHEETS.AIRLIST), year);
}

export async function createCleaningPlan(ctx, year) {
  return ctx.withLock(async () => {
    await ctx.ensureBase();
    // การสร้างแผนประจำปีกระทบเครื่องทุกภูมิภาคทั่วบริษัทในครั้งเดียว
    // จึงจำกัดให้เฉพาะ Admin เท่านั้นที่ทำได้
    await ctx.assertAdmin();

    const name = planSheet(year);
    if (await ctx.ss.hasSheet(name)) {
      throw new Error('มีแผนล้างแอร์ปี ' + year + ' อยู่แล้ว');
    }

    // เช็คข้อมูลแอร์ก่อนสร้างชีต เพื่อป้องกันการสร้างตารางเปล่าค้างไว้
    //
    // เครื่องที่รื้อถอนหรือขายออกไปแล้วต้องไม่ถูกดึงเข้าแผน ไม่งั้นช่างจะได้ใบสั่ง
    // ไปล้างแอร์ที่ไม่มีอยู่ที่หน้างานแล้ว และตัวเลขคืบหน้าจะไม่มีวันเต็ม 100%
    const airList = ctx.ss.objects(SHEETS.AIRLIST).filter(a => !isRetiredStatus(a.Status));
    if (airList.length === 0) {
      throw new Error('ยังไม่มีข้อมูลเครื่องปรับอากาศที่ใช้งานอยู่ในระบบ กรุณาเพิ่มแอร์ก่อนสร้างแผนครับ');
    }

    await ctx.ss.ensureSheet(name, PLAN_HEADERS);

    // เขียนตาม "ชื่อคอลัมน์" ไม่ใช่ลำดับช่อง
    //
    // เดิมเรียงค่าเป็นลำดับตามแบบชีตเก่า (รอบละ 6 ช่อง) แต่ตาราง plans มีช่อง R*_FormUrl
    // ต่อท้ายทุกรอบ ค่าจึงเลื่อน — รอบ 2 เลื่อน 1 ช่อง รอบ 3 เลื่อน 2 ช่อง ราคาไปโผล่ในช่อง
    // วันที่ และชื่อคนสร้างไปอยู่ในช่องสถานะ (เจอจริงตอนสร้างแผนปี 2028, 2029)
    // เขียนตามชื่อแล้ว ลำดับคอลัมน์ในฐานข้อมูลจะเปลี่ยนยังไงก็ไม่เลื่อนอีก
    const me = await ctx.currentUser();
    const headers = ctx.ss.headers(name);
    const rows = airList.map(a => {
      const rec = { AirCode: a.AirCode, NodeName: a.NodeName, SiteCode: a.SiteCode, BTU: a.BTU, UpdatedBy: me };
      for (const r of [1, 2, 3]) {
        rec['R' + r + '_Price'] = a.CleaningPricePerRound || '';
        rec['R' + r + '_Status'] = 'รอดำเนินการ';
      }
      return headers.map(h => (rec[h] !== undefined ? rec[h] : ''));
    });
    ctx.ss.setValues(name, 2, 1, rows);

    await ctx.ss.flush();
    return getCleaningPlan(ctx, year);
  });
}

/**
 * ลบแผนล้างทั้งปี — มีไว้แก้กรณีกดสร้างแผนผิดปี
 *
 * ลบได้เฉพาะแผนที่ยังไม่มีงานจริงเกิดขึ้นเลย รอบไหนล้างไปแล้ว (มีวันที่ล้างจริง
 * หรือสถานะเสร็จ) หรือมีใบบันทึกผลการล้างผูกกับปีนั้น ถือเป็นงานที่จ่ายเงินไปจริง
 * ลบทิ้งแล้วค่าใช้จ่ายที่เคยรายงานจะหายไปเฉยๆ จึงไม่ยอมเด็ดขาด
 *
 * confirmYear ต้องตรงกับปี — กันหน้าเว็บส่งปีผิด เช่นกล่องเลือกปีเปลี่ยนระหว่างที่ยืนยันอยู่
 */
export async function deleteCleaningPlan(ctx, year, confirmYear) {
  return ctx.withLock(async () => {
    await ctx.ensureBase();
    // แผนหนึ่งปีครอบคลุมเครื่องทุกภูมิภาค คนเดียวกับที่สร้างได้เท่านั้นที่ลบได้
    await ctx.assertAdmin();

    const y = String(year == null ? '' : year).trim();
    if (!/^\d{4}$/.test(y)) throw new Error('ปีของแผนไม่ถูกต้อง');
    if (String(confirmYear == null ? '' : confirmYear).trim() !== y) {
      throw new Error('ปีที่พิมพ์ยืนยันไม่ตรงกับแผนที่จะลบ กรุณาลองใหม่');
    }

    const name = planSheet(y);
    if (!(await ctx.ss.hasSheet(name))) throw new Error('ไม่พบแผนล้างแอร์ปี ' + y);

    await ctx.ss.load(name);
    const done = ctx.ss.objects(name).reduce((n, row) =>
      n + [1, 2, 3].filter(r => roundState(row, r, false) === 'done').length, 0);
    if (done > 0) {
      throw new Error('แผนปี ' + y + ' มีรอบที่ล้างไปแล้ว ' + done + ' รอบ ลบไม่ได้ ' +
        'เพราะเป็นงานที่ทำและจ่ายเงินไปจริง');
    }
    const forms = ctx.ss.objects(SHEETS.CLEANFORM)
      .filter(f => String(f.PlanYear == null ? '' : f.PlanYear).trim() === y).length;
    if (forms > 0) {
      throw new Error('แผนปี ' + y + ' มีใบบันทึกผลการล้างผูกอยู่ ' + forms + ' ใบ ลบไม่ได้');
    }

    // สำรองก่อนลบเสมอ — ลบทีเดียวหายหลายร้อยแถว ถ้าสำรองไม่ได้ต้องหยุด ไม่ใช่ลบต่อ
    let backupName = '';
    if (ctx.backup) backupName = ctx.backup('ก่อนลบแผนล้างปี ' + y);

    const deleted = ctx.ss.deletePlanYear(y);
    return { year: y, deleted, backupName };
  });
}

/**
 * มีเอกสารของการล้างครั้งนั้นอยู่จริงหรือยัง
 *
 * "ครั้งนั้น" = เครื่องตัวนี้ ปีนี้ รอบนี้ ซึ่งตรงกับที่ฟอร์มบันทึกผลการล้าง
 * และการแนบเอกสารเขียนมือเก็บไว้ทั้งคู่
 */
function hasCleaningDoc(ctx, airCode, year, round) {
  const want = normalizeCode(airCode);
  const y = String(year == null ? '' : year).trim();
  const r = String(round == null ? '' : round).trim();

  return ctx.ss.objects(SHEETS.CLEANFORM).some(f =>
    String(f.PlanYear == null ? '' : f.PlanYear).trim() === y &&
    String(f.PlanRound == null ? '' : f.PlanRound).trim() === r &&
    [f.AirCode1, f.AirCode2].some(c => c && normalizeCode(c) === want)
  );
}

export async function updateCleaningRound(ctx, year, row, round, data) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('plan');

    const name = planSheet(year);
    await ctx.connect();
    // ต้องมีตารางเอกสารในมือ เพื่อตรวจว่าการปิดงานรอบนี้มีเอกสารรองรับหรือยัง
    await ctx.ensureBase();
    if (!(await ctx.ss.hasSheet(name))) throw new Error('ไม่พบแผนล้างแอร์ปี ' + year);
    await ctx.ss.load(name);
    await ctx.ss.ensureColumns(name, PLAN_HEADERS);

    const headers = ctx.ss.headers(name);
    const airCode = ctx.ss.cell(name, row, headers.indexOf('AirCode') + 1);
    await ctx.assertAirCodeAccess(airCode);

    const startCol = headers.indexOf('R' + round + '_PlanDate') + 1;
    if (startCol <= 0) throw new Error('ไม่พบข้อมูลรอบที่ ' + round + ' ในแผนปีนี้');

    // ผู้รับเหมาของรอบนี้ — ตรวจก่อนเขียนอะไรลงไป
    // หน้าเว็บรุ่นเก่าไม่ส่งค่านี้มา (undefined) ต้องไม่ล้างของเดิมทิ้ง
    const contractorId = data.contractorId === undefined ? undefined : checkContractorId(ctx, data.contractorId);

    // อ่านสถานะเดิมไว้ก่อน เพื่อดูว่ารอบนี้ "เพิ่งถูกปิดงาน" หรือ "ปิดอยู่แล้ว"
    const wasDone = String(ctx.ss.cell(name, row, startCol + 4)).trim() === 'ล้างเสร็จสิ้น';

    // ============================================================================
    // ปิดงานได้ต่อเมื่อมีเอกสารรองรับ
    // ============================================================================
    // ช่องสถานะในหน้าแผนกดเปลี่ยนเป็น "ล้างเสร็จสิ้น" ได้เลยโดยไม่ต้องมีหลักฐานอะไร
    // ซึ่งทำให้ตัวเลขความคืบหน้าและงบประมาณเดินไปได้ทั้งที่ไม่มีใบงานสักใบ
    //
    // ทางที่ถูกคือกรอกฟอร์มบันทึกผลการล้าง หรือแนบเอกสารที่ช่างเขียนมือ
    // แล้วระบบจะปิดงานให้เองพร้อมลงประวัติและค่าใช้จ่ายให้ครบ
    //
    // ตรวจเฉพาะตอน "เพิ่งเปลี่ยนเป็นเสร็จ" รอบที่ปิดไปแล้วยังแก้ราคา/ชื่อช่างได้ตามปกติ
    if (data.status === 'ล้างเสร็จสิ้น' && !wasDone && !hasCleaningDoc(ctx, airCode, year, round)) {
      throw new Error(
        'ยังปิดงานรอบที่ ' + round + ' ของเครื่อง ' + airCode + ' ไม่ได้ ' +
        'เพราะยังไม่มีเอกสารของการล้างครั้งนี้ — ' +
        'กรุณากรอกฟอร์มบันทึกผลการล้าง หรือแนบเอกสารที่เขียนด้วยมือก่อน ' +
        'แล้วระบบจะปิดงานให้เองพร้อมบันทึกประวัติและค่าใช้จ่าย'
      );
    }

    ctx.ss.setValues(name, row, startCol, [[
      data.planDate || '', data.actualDate || '', data.price || '',
      data.technician || '', data.status || 'รอดำเนินการ', data.note || ''
    ]]);
    ctx.ss.setValue(name, row, headers.indexOf('UpdatedBy') + 1, await ctx.currentUser());

    if (contractorId !== undefined) {
      ctx.ss.setValue(name, row, headers.indexOf('R' + round + '_ContractorID') + 1, contractorId);
    }

    // บันทึกประวัติเฉพาะตอนที่ "เพิ่งเปลี่ยนเป็นล้างเสร็จสิ้น" เท่านั้น
    // ถ้ารอบนี้ถูกปิดไปแล้ว (เช่น ปิดจากการกรอกฟอร์ม แล้วมาแก้ราคาทีหลัง)
    // การเขียนประวัติซ้ำจะทำให้ค่าใช้จ่ายถูกนับซ้ำในงบประมาณ
    if (data.actualDate && data.status === 'ล้างเสร็จสิ้น' && !wasDone) {
      await addHistoryRaw(ctx, {
        AirCode: airCode,
        Date: data.actualDate,
        EventType: 'ล้างแอร์',
        Detail: `ล้างแอร์ รอบที่ ${round}/${year} ` + (data.note ? `(PR: ${data.note})` : ''),
        Cost: data.price || '',
        Technician: data.technician || ''
      });
    }

    await ctx.ss.flush();
    return { plan: await getCleaningPlan(ctx, year), history: await getHistory(ctx) };
  });
}

/**
 * ตั้งวันตามแผนของทุกเครื่องใน Node เดียวกันพร้อมกัน
 *
 * เขียนกลับเป็น "รายคอลัมน์" (คอลัมน์ละ 1 ช่วง) แทนการเขียนทีละแถว
 * จำนวนคำสั่งจึงคงที่ไม่กี่ช่วงเสมอ ไม่ว่าจะมีกี่ร้อยเครื่องก็ตาม
 *
 * @param {Object} [contractors] ผู้รับเหมารายรอบ { r1, r2, r3 } — ไม่ส่งรอบไหน = ไม่แตะรอบนั้น
 *   ค่าว่าง = ยกเลิกการมอบหมาย (มอบหมายทั้ง Node ทีเดียว แทนการกดทีละเครื่องทีละรอบ)
 * @param {Object} [units] เครื่องที่จะล้างรายรอบ { r1: [รหัสเครื่อง], ... } — ไม่ส่งรอบไหน = ทุกเครื่องเหมือนเดิม
 *   รอบที่ส่งมา: เครื่องที่เลือกได้วัน/ผู้รับเหมา (ถ้าเคยยกเลิกไว้ กลับเป็นรอดำเนินการ)
 *   เครื่องที่ไม่ได้เลือก = รอบนั้นเป็น "ยกเลิก" (ไม่นับเป็นงานค้างและค่าใช้จ่าย)
 *   ยกเว้นรอบที่ล้างไปแล้ว ไม่ถูกแตะ — เป็นงานที่ทำจริงแล้ว ยกเลิกย้อนหลังไม่ได้
 */
export async function updatePlanDatesByNode(ctx, year, nodeName, dates, contractors, units) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('plan');

    const name = planSheet(year);
    await ctx.connect();
    await ctx.ensureBase();   // ต้องมีรายชื่อผู้รับเหมาในมือไว้ตรวจรหัส
    if (!(await ctx.ss.hasSheet(name))) throw new Error('ไม่พบแผนล้างแอร์ปี ' + year);
    await ctx.ss.load(name);
    await ctx.ss.ensureColumns(name, PLAN_HEADERS);

    const info = await ctx.userInfo();
    const allowed = info.role === 'Admin' ? null : await ctx.allowedAirCodes();

    const headers = ctx.ss.headers(name);
    const values = ctx.ss.values(name);
    const idx = {
      code: headers.indexOf('AirCode'),
      node: headers.indexOf('NodeName'),
      r1: headers.indexOf('R1_PlanDate'),
      r2: headers.indexOf('R2_PlanDate'),
      r3: headers.indexOf('R3_PlanDate'),
      c1: headers.indexOf('R1_ContractorID'),
      c2: headers.indexOf('R2_ContractorID'),
      c3: headers.indexOf('R3_ContractorID'),
      s1: headers.indexOf('R1_Status'),
      s2: headers.indexOf('R2_Status'),
      s3: headers.indexOf('R3_Status'),
      a1: headers.indexOf('R1_ActualDate'),
      a2: headers.indexOf('R2_ActualDate'),
      a3: headers.indexOf('R3_ActualDate'),
      by: headers.indexOf('UpdatedBy')
    };
    // เครื่องที่เลือกล้างรายรอบ — null = รอบนั้นไม่ได้ส่งมา ใช้ทุกเครื่อง (แบบเดิม)
    const picked = {};
    for (const r of [1, 2, 3]) {
      const list = units && units['r' + r];
      picked[r] = Array.isArray(list) ? new Set(list.map(normalizeCode)) : null;
    }
    // ตรวจรหัสผู้รับเหมาทุกตัวก่อนแตะแถวไหน
    const cids = {};
    for (const r of [1, 2, 3]) {
      const v = contractors && contractors['r' + r];
      if (v !== undefined && v !== null) cids[r] = checkContractorId(ctx, v);
    }

    const me = await ctx.currentUser();

    let matched = 0;
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      if (String(row[idx.node]) !== String(nodeName)) continue;
      // ข้ามเครื่องนอกภูมิภาคที่ตนดูแล
      if (allowed && !allowed.has(normalizeCode(row[idx.code]))) continue;

      matched++;
      const code = normalizeCode(row[idx.code]);
      for (const r of [1, 2, 3]) {
        const status = String(row[idx['s' + r]] || '').trim();
        if (picked[r] && !picked[r].has(code)) {
          // ไม่ล้างรอบนี้ = ยกเลิก — แต่รอบที่ล้างไปแล้วต้องคงไว้ตามจริง
          const done = status === ROUND_DONE || String(row[idx['a' + r]] || '').trim();
          if (!done) row[idx['s' + r]] = ROUND_CANCELLED;
          continue;
        }
        // เลือกล้างรอบนี้ แต่เคยยกเลิกไว้ = กลับมาเป็นงานที่ต้องทำ
        if (picked[r] && status === ROUND_CANCELLED) row[idx['s' + r]] = 'รอดำเนินการ';
        if (dates['r' + r]) row[idx['r' + r]] = dates['r' + r];
        if (cids[r] !== undefined) row[idx['c' + r]] = cids[r];
      }
      if (idx.by > -1) row[idx.by] = me;
      values[i] = row;
    }

    if (matched === 0) {
      throw new Error('ไม่พบเครื่องปรับอากาศใน Node "' + nodeName + '" ที่คุณมีสิทธิ์จัดการในแผนปีนี้');
    }

    writeBackColumns(ctx, name, values, [
      [idx.r1, dateOut], [idx.r2, dateOut], [idx.r3, dateOut], [idx.by, String],
      [idx.c1, String], [idx.c2, String], [idx.c3, String],
      [idx.s1, String], [idx.s2, String], [idx.s3, String]
    ]);

    await ctx.ss.flush();
    return getCleaningPlan(ctx, year);
  });
}

/** นำเข้าวันตามแผนแบบกลุ่มจากไฟล์ Excel/CSV */
export async function updatePlanBulk(ctx, year, importedData) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('plan');

    const name = planSheet(year);
    await ctx.connect();
    if (!(await ctx.ss.hasSheet(name))) throw new Error('ไม่พบแผนปี ' + year);
    await ctx.ss.load(name);
    await ctx.ss.ensureColumns(name, PLAN_HEADERS);

    // ตรวจว่าไฟล์นำเข้ามีคอลัมน์วันที่อย่างน้อย 1 คอลัมน์
    // ป้องกันการนำเข้าไฟล์ผิด template แบบเงียบๆ
    const hasAnyDateColumn = (importedData || []).some(item =>
      item.R1_PlanDate !== undefined || item.R2_PlanDate !== undefined || item.R3_PlanDate !== undefined
    );
    if (!hasAnyDateColumn) {
      throw new Error('ไฟล์นำเข้าไม่มีคอลัมน์ R1_PlanDate / R2_PlanDate / R3_PlanDate กรุณาใช้ Template ที่ระบบสร้างให้');
    }

    const info = await ctx.userInfo();
    const allowed = info.role === 'Admin' ? null : await ctx.allowedAirCodes();

    const headers = ctx.ss.headers(name);
    const values = ctx.ss.values(name);
    const idx = {
      code: headers.indexOf('AirCode'),
      r1: headers.indexOf('R1_PlanDate'),
      r2: headers.indexOf('R2_PlanDate'),
      r3: headers.indexOf('R3_PlanDate'),
      by: headers.indexOf('UpdatedBy')
    };
    const me = await ctx.currentUser();

    const mapImport = {};
    importedData.forEach(item => {
      if (item.AirCode) mapImport[normalizeCode(item.AirCode)] = item;
    });

    const matchedCodes = new Set();
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const code = normalizeCode(row[idx.code]);
      const imp = mapImport[code];
      if (!imp) continue;
      if (allowed && !allowed.has(code)) continue; // ข้ามเครื่องนอกภูมิภาคที่ตนดูแล

      if (imp.R1_PlanDate) row[idx.r1] = imp.R1_PlanDate;
      if (imp.R2_PlanDate) row[idx.r2] = imp.R2_PlanDate;
      if (imp.R3_PlanDate) row[idx.r3] = imp.R3_PlanDate;
      if (idx.by > -1) row[idx.by] = me;
      values[i] = row;
      matchedCodes.add(code);
    }

    // รวบรวมรหัสในไฟล์ที่หาไม่เจอ (หรือไม่มีสิทธิ์) เพื่อแจ้งผู้ใช้แทนการนิ่งเงียบ
    const notFound = Object.keys(mapImport).filter(code => !matchedCodes.has(code));

    writeBackColumns(ctx, name, values, [
      [idx.r1, dateOut], [idx.r2, dateOut], [idx.r3, dateOut], [idx.by, String]
    ]);

    await ctx.ss.flush();
    return {
      plan: await getCleaningPlan(ctx, year),
      matchedCount: matchedCodes.size,
      notFoundCodes: notFound
    };
  });
}

/**
 * เขียนข้อมูลกลับลงชีตทีละคอลัมน์เต็มความสูง
 * @param {Array<[number, Function]>} cols คู่ของ [ตำแหน่งคอลัมน์เริ่มที่ 0, ฟังก์ชันแปลงค่า]
 */
function writeBackColumns(ctx, name, values, cols) {
  const lastRow = values.length;
  if (lastRow < 2) return;

  cols.forEach(([colIdx, convert]) => {
    if (colIdx < 0) return;
    const block = [];
    for (let i = 1; i < lastRow; i++) {
      const v = (values[i] || [])[colIdx];
      block.push([v === '' || v === null || v === undefined ? '' : convert(v)]);
    }
    ctx.ss.setValues(name, 2, colIdx + 1, block);
  });
}

/**
 * ปิดงานล้างของ "หนึ่งเครื่อง หนึ่งรอบ" ในแผน
 *
 * ใช้ร่วมกันทั้งตอนกรอกฟอร์มในระบบ และตอนแนบเอกสารที่เขียนด้วยมือมา
 * เขียนเฉพาะช่องที่เกี่ยวข้องของรอบนั้น ไม่แตะแถวอื่นและไม่แตะโครงสร้างชีต
 *
 * ⚠️ ราคาที่ส่งเข้ามาต้องเป็น "ราคาของเครื่องนี้เครื่องเดียว" ไม่ใช่ยอดรวมทั้งใบ
 * ถ้าส่งยอดรวมมาแล้วเรียกซ้ำสองเครื่อง งบประมาณจะถูกนับเป็นสองเท่าทันที
 *
 * @param {Object} ctx
 * @param {Object} opts
 * @param {string|number} opts.year        ปีของแผน
 * @param {string|number} opts.round       รอบที่จะปิด (1-3)
 * @param {string} opts.airCode            รหัสเครื่อง
 * @param {string} opts.actualDate         วันที่ล้างจริง
 * @param {*}      [opts.price]            ราคาของเครื่องนี้ (ไม่ส่ง = คงค่าเดิมในแผน)
 * @param {string} [opts.technician]       ชื่อช่าง (ไม่ส่ง = คงค่าเดิม)
 * @param {string} [opts.docUrl]           ลิงก์เอกสาร (PDF ที่ระบบสร้าง หรือไฟล์ที่แนบมา)
 * @returns {Promise<number>} 1 ถ้าปิดงานสำเร็จ, 0 ถ้าหาแถวไม่เจอ
 */
export async function closePlanRound(ctx, opts) {
  const round = String(opts.round);
  if (['1', '2', '3'].indexOf(round) === -1) return 0;

  const name = planSheet(opts.year);
  if (!(await ctx.ss.hasSheet(name))) return 0;
  await ctx.ss.load(name);
  await ctx.ss.ensureColumns(name, PLAN_HEADERS);

  const headers = ctx.ss.headers(name);
  const codeIdx = headers.indexOf('AirCode');
  const values = ctx.ss.values(name);
  const want = normalizeCode(opts.airCode);

  let row = -1;
  for (let i = 1; i < values.length; i++) {
    if (normalizeCode((values[i] || [])[codeIdx]) === want) { row = i + 1; break; }
  }
  if (row === -1) return 0;

  // เขียนบล็อก 6 ช่องของรอบนั้น โดยคงวันที่ตามแผนกับหมายเหตุเดิมไว้
  const startCol = headers.indexOf('R' + round + '_PlanDate') + 1;
  if (startCol <= 0) return 0;

  const cur = [0, 1, 2, 3, 4, 5].map(i => ctx.ss.cell(name, row, startCol + i));
  const hasPrice = opts.price !== '' && opts.price !== null && opts.price !== undefined && !isNaN(Number(opts.price));

  ctx.ss.setValues(name, row, startCol, [[
    dateOut(cur[0]),                            // วันที่ตามแผน — คงไว้
    opts.actualDate,                            // วันที่ล้างจริง
    hasPrice ? Number(opts.price) : (cur[2] || ''),
    opts.technician || cur[3] || '',
    'ล้างเสร็จสิ้น',
    cur[5] || ''                                // หมายเหตุเดิม — คงไว้
  ]]);

  // ลิงก์เอกสารของรอบนั้น (คอลัมน์นี้อยู่ท้ายตาราง จึงเขียนแยก)
  if (opts.docUrl) {
    const urlCol = headers.indexOf('R' + round + '_FormUrl') + 1;
    if (urlCol > 0) ctx.ss.setValue(name, row, urlCol, opts.docUrl);
  }

  const byCol = headers.indexOf('UpdatedBy') + 1;
  if (byCol > 0) ctx.ss.setValue(name, row, byCol, await ctx.currentUser());

  return 1;
}
