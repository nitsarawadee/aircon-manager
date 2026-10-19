import { SHEETS, PLAN_HEADERS } from '../schema.js';
import {
  formatDate, isAwaitingInstall, isRetiredStatus, normalizeCode, orderByNode, safeParseDate, todayStart
} from '../values.js';
import { addHistoryRaw, getHistory } from './history.js';
import { jobKey } from '../context.js';
import { toIsoDate } from '../import-spec.js';

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
  const docOf = new Map();
  for (const f of ctx.ss.objects(SHEETS.CLEANFORM)) {
    const y = String(f.PlanYear ?? '').trim(), r = String(f.PlanRound ?? '').trim();
    if (!y || !r) continue;
    for (const c of [f.AirCode1, f.AirCode2]) {
      if (c && String(c).trim()) docOf.set(y + '|' + r + '|' + normalizeCode(c), docNoOfUnit(f, c));
    }
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

    // เลขใบล้างของแต่ละรอบ — หน้าต่างรอบใช้ล็อกช่องสถานะของรอบที่ปิดด้วยใบล้าง (ดู updateCleaningRound)
    for (const r of [1, 2, 3]) out['R' + r + '_DocNo'] = docOf.get(year + '|' + r + '|' + normalizeCode(o.AirCode)) || '';
    return out;
  });

  const info = await ctx.userInfo();
  if (info.role !== 'Admin') {
    const allowed = await ctx.allowedAirCodes();
    list = list.filter(o => allowed.has(normalizeCode(o.AirCode)));
  }

  // เครื่องที่อัปเดตเข้าแผนทีหลังถูกต่อท้ายชีต — เรียงให้อยู่กับ Node ของตัวเอง (ตาราง + ฟอร์มแผนที่โหลดออก)
  // แค่ลำดับที่ส่งออก แถวในชีตไม่ย้าย การแก้ไขอ้างเลขแถว (_row) เหมือนเดิม
  list = orderByNode(list);

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
        for (const k of ['Price', 'Technician', 'Note', 'FormUrl', 'ContractorID', 'ContractorName', 'DocNo']) {
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
export function checkContractorId(ctx, id) {
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
const ROUND_SCHEDULED = 'นัดหมายแล้ว';

/**
 * ปีนี้ล้างกี่รอบ (1–3) — เลือกตอนสร้างแผน เพราะบางปีล้างไม่ครบ 3 รอบ (เจ้าของงานขอ)
 *
 * เก็บไว้ในทุกแถวของแผนปีนั้น (คอลัมน์ Rounds) แทนตารางตั้งค่าแยก ได้มากับแถวที่ทุกส่วนอ่านอยู่แล้ว
 * ว่างหรือค่าแปลก = แผนเก่าก่อนมีตัวเลือกนี้ = 3 รอบตามเดิม
 * รอบที่เกินจำนวนนี้ "ไม่มีอยู่" — ไม่นับในคืบหน้า/งบ ไม่ขึ้นปฏิทิน และตั้งวัน/ปิดงานไม่ได้
 */
export function planRounds(row) {
  const n = Number(row && row.Rounds);
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : 3;
}

/** รอบที่มีอยู่จริงของแถวนี้ เช่น [1, 2] */
const roundsOf = row => [1, 2, 3].slice(0, planRounds(row));

/**
 * จำนวนรอบของแถวที่อ่านเป็นช่องๆ (ตอนเขียนแบบรายคอลัมน์ ไม่มี object ในมือ)
 * @param {Function} cellAt (ตำแหน่งคอลัมน์เริ่มที่ 0) → ค่าในช่อง
 */
function roundsInRow(headers, cellAt) {
  const col = headers.indexOf('Rounds');
  return planRounds({ Rounds: col > -1 ? cellAt(col) : '' });
}

/** จำนวนรอบของแผนทั้งปี — ทุกแถวถูกสร้างพร้อมกันจึงเท่ากันหมด เอาค่ามากสุดกันไว้ */
export function planYearRounds(rows) {
  return (rows || []).length ? Math.max(...rows.map(planRounds)) : 3;
}

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
  const roundCount = planYearRounds(planRows);
  const rounds = [1, 2, 3].slice(0, roundCount).map(r => ({ round: r, ...blank() }));
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

    for (const r of roundsOf(row)) {
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
    roundCount,
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
    for (const r of roundsOf(row)) {
      // บัญชีผู้รับเหมา: รอบของเจ้าอื่นไม่ใช่นัดของตัวเอง ไม่ต้องขึ้นในปฏิทิน
      // (ธงนี้มีเฉพาะแถวที่ getCleaningPlan ส่งให้ผู้รับเหมา)
      if (row['R' + r + '_Mine'] === false) continue;

      const raw = String(row['R' + r + '_PlanDate'] || '').trim();
      if (!raw.startsWith(prefix)) continue;

      // เครื่องที่รื้อถอน/Write off หรือถูกลบออกจากทะเบียน — นัดที่ยังไม่ได้ล้างไม่ขึ้น (16/10/2569)
      // กติกาเดียวกับการ์ดนัด 30 วัน (upcomingFromPlan) เดิมปฏิทินโชว์ แต่การ์ดไม่โชว์ สองที่บอกไม่ตรงกัน
      // รอบที่ล้างไปแล้วยังขึ้นตามเดิม เพราะเป็นงานที่ทำไปจริง
      if ((row.Retired || row.Removed) && roundState(row, r) !== 'done') continue;

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

  // ประกาศบนปฏิทิน: นับจากทุกแผน ไม่ใช่แค่เดือนที่เปิดดู (ผู้ใช้ขอ 19/10/2569)
  return { ...planCalendar(rows, year, month), due: planDueCounts(rows, todayStart()) };
}

/** เตือนล่วงหน้ากี่วัน — ชุดเดียวกับป้าย "ใกล้ถึงกำหนด" ในหน้าแผนล้าง (PLAN_WARN_DAYS ฝั่งหน้าเว็บ) */
export const DUE_WARN_DAYS = 30;

/**
 * นับรอบที่ยังไม่ล้าง: เลยวันนัดแล้ว (late) · อีกไม่เกิน 30 วันถึงวันนัด (soon)
 * กติกาเดียวกับนัด 30 วันในแดชบอร์ด (upcomingFromPlan): ข้ามเครื่องที่เลิกใช้ · ข้ามรอบของผู้รับเหมาเจ้าอื่น
 * · ข้ามรอบที่ล้างแล้วหรือยกเลิก · ข้ามรอบที่ยังไม่ลงวันนัด
 * @param {Array} rows แถวแผน (กรองตามสิทธิ์มาแล้ว)
 * @param {Date} today เที่ยงคืนของวันนี้ตามเวลาไทย
 * @returns {{late: number, soon: number}}
 */
export function planDueCounts(rows, today) {
  const limit = new Date(today.getTime() + DUE_WARN_DAYS * 86400000 + 86399999);
  let late = 0, soon = 0;
  for (const p of rows || []) {
    if (p.Retired || p.Removed) continue;
    for (const r of roundsOf(p)) {
      if (p['R' + r + '_Mine'] === false) continue;
      const status = p['R' + r + '_Status'];
      if (status === 'ล้างเสร็จสิ้น' || status === 'ยกเลิก') continue;
      const d = safeParseDate(p['R' + r + '_PlanDate']);
      if (!d) continue;
      if (d < today) late++;
      else if (d <= limit) soon++;
    }
  }
  return { late, soon };
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

    for (const r of roundsOf(p)) {
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

/**
 * @param {number} [rounds] ปีนี้ล้างกี่รอบ 1–3 (ไม่ส่ง = 3 แบบเดิม) — ดู planRounds
 */
export async function createCleaningPlan(ctx, year, rounds = 3) {
  return ctx.withLock(async () => {
    await ctx.ensureBase();
    // การสร้างแผนประจำปีกระทบเครื่องทุกภูมิภาคทั่วบริษัทในครั้งเดียว
    // จึงจำกัดให้เฉพาะ Admin เท่านั้นที่ทำได้
    await ctx.assertAdmin();

    const n = Number(rounds);
    if (![1, 2, 3].includes(n)) throw new Error('จำนวนรอบต้องเป็น 1, 2 หรือ 3');

    const name = planSheet(year);
    if (await ctx.ss.hasSheet(name)) {
      throw new Error('มีแผนล้างแอร์ปี ' + year + ' อยู่แล้ว');
    }

    // เช็คข้อมูลแอร์ก่อนสร้างชีต เพื่อป้องกันการสร้างตารางเปล่าค้างไว้
    //
    // เครื่องที่รื้อถอนหรือขายออกไปแล้วต้องไม่ถูกดึงเข้าแผน ไม่งั้นช่างจะได้ใบสั่ง
    // ไปล้างแอร์ที่ไม่มีอยู่ที่หน้างานแล้ว และตัวเลขคืบหน้าจะไม่มีวันเต็ม 100%
    // เครื่องที่รอใบติดตั้งอนุมัติยังไม่เข้าแผน — อนุมัติครบแล้วกด "อัปเดตจากรายการเครื่อง"
    const airList = ctx.ss.objects(SHEETS.AIRLIST).filter(a => !isRetiredStatus(a.Status) && !isAwaitingInstall(a.Status));
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
      const rec = { AirCode: a.AirCode, NodeName: a.NodeName, SiteCode: a.SiteCode, BTU: a.BTU, UpdatedBy: me, Rounds: n };
      // รอบที่ไม่มีในปีนี้ปล่อยว่างทั้งบล็อก — ไม่มีราคา/สถานะให้ถูกนับ
      for (const r of [1, 2, 3].slice(0, n)) {
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
 * อัปเดตแผนที่สร้างไปแล้วตามรายการเครื่องตอนนี้ (ปุ่ม "อัปเดตจากรายการเครื่อง" — เจ้าของงานขอ)
 *
 * แผนเก็บชื่อ Node / SiteCode / BTU / ราคารายรอบไว้ตั้งแต่ตอนสร้าง (createCleaningPlan)
 * นำเข้าหรือแก้รายการเครื่องทีหลังแผนจึงไม่เปลี่ยนตาม และเครื่องที่เพิ่มทีหลังไม่มีในแผน
 *
 *   เพิ่ม  เครื่องที่ใช้งานอยู่แต่ยังไม่มีในแผน — จำนวนรอบเท่าแผนปีนั้น ราคาตามรายการเครื่อง
 *   แก้    ชื่อ Node / SiteCode / BTU ที่ไม่ตรง และราคาของ "รอบที่ยังไม่ล้าง"
 *          รอบที่ล้างแล้วไม่แตะ — เป็นเงินที่จ่ายไปจริง (เหตุผลเดียวกับที่ลบแผนที่มีรอบล้างแล้วไม่ได้)
 *   ไม่ลบ  เครื่องที่ไม่มีในรายการแล้ว — ตารางแผนขึ้นป้าย "ถูกลบแล้ว / รื้อถอนแล้ว" ให้อยู่แล้ว
 *
 * ดูผลก่อน (apply = false ไม่เขียนอะไร) แล้วค่อยยืนยัน ราคาที่ตั้งเองรายรอบในแผนจะถูกทับด้วย
 * คนกดจึงต้องเห็นก่อนว่าอะไรจะเปลี่ยนจากอะไรเป็นอะไร
 *
 * @param {boolean} [apply]  true = เขียนจริง
 * @param {Object}  [expect] { adds, updates } ที่เห็นตอนดูผล — ไม่ตรง = มีคนแก้คั่น ต้องดูใหม่
 */
export async function syncCleaningPlan(ctx, year, apply = false, expect = null) {
  return ctx.withLock(async () => {
    await ctx.ensureBase();
    // แตะแผนทั้งปีทุกภูมิภาค — สิทธิ์เดียวกับสร้าง/ลบแผน
    await ctx.assertAdmin();

    const name = planSheet(year);
    if (!(await ctx.ss.hasSheet(name))) throw new Error('ไม่พบแผนล้างแอร์ปี ' + year);
    await ctx.ss.load(name);
    await ctx.ss.ensureColumns(name, PLAN_HEADERS);

    const rows = ctx.ss.objects(name);
    const n = planYearRounds(rows);
    const text = v => (v === null || v === undefined ? '' : String(v).trim());
    const priceOf = u => (text(u.CleaningPricePerRound) !== '' && !isNaN(Number(u.CleaningPricePerRound)))
      ? Number(u.CleaningPricePerRound) : null;

    const inPlan = new Map(rows.map(p => [normalizeCode(p.AirCode), p]));
    const units = ctx.ss.objects(SHEETS.AIRLIST)
      .filter(a => a.AirCode && !isRetiredStatus(a.Status) && !isAwaitingInstall(a.Status));

    const adds = [];
    const updates = [];
    for (const u of units) {
      const p = inPlan.get(normalizeCode(u.AirCode));
      if (!p) { adds.push(u); continue; }

      const patch = {};
      const changes = [];
      for (const f of ['NodeName', 'SiteCode', 'BTU']) {
        // รายการเครื่องว่าง (เช่นตำแหน่งที่ย้ายเครื่องออกไปแล้ว ล้าง BTU ทิ้ง) ไม่ล้างค่าในแผนตาม
        if (text(u[f]) !== '' && text(u[f]) !== text(p[f])) {
          patch[f] = u[f];
          changes.push({ column: f, from: text(p[f]), to: text(u[f]) });
        }
      }
      const price = priceOf(u);
      if (price !== null) {
        for (const r of roundsOf(p)) {
          if (roundState(p, r, false) === 'done') continue;
          if (text(p['R' + r + '_Price']) === '' || Number(p['R' + r + '_Price']) !== price) {
            patch['R' + r + '_Price'] = price;
            changes.push({ column: 'ราคารอบ ' + r, from: text(p['R' + r + '_Price']), to: String(price) });
          }
        }
      }
      if (changes.length) updates.push({ row: p._row, airCode: p.AirCode, patch, changes });
    }

    const summary = {
      rounds: n,
      counts: { adds: adds.length, updates: updates.length },
      adds: adds.slice(0, 200).map(u => ({ airCode: u.AirCode, nodeName: u.NodeName || '' })),
      updates: updates.slice(0, 200).map(x => ({ airCode: x.airCode, changes: x.changes }))
    };
    if (!apply) return summary;

    if (!adds.length && !updates.length) throw new Error('แผนปี ' + year + ' ตรงกับรายการเครื่องอยู่แล้ว ไม่มีอะไรต้องอัปเดต');
    if (expect && (Number(expect.adds) !== adds.length || Number(expect.updates) !== updates.length)) {
      throw new Error('ข้อมูลเปลี่ยนไประหว่างที่ดูผลอยู่ (ตอนนี้จะเพิ่ม ' + adds.length +
                      ' แก้ ' + updates.length + ' เครื่อง) กรุณากดดูผลใหม่อีกครั้ง');
    }

    // สำรองก่อนเขียน เหมือนนำเข้ารายการเครื่อง — แตะแผนทีเดียวได้หลายร้อยแถว
    let backupName = '';
    if (ctx.backup) backupName = ctx.backup('ก่อนอัปเดตแผนปี-' + year + '-จากรายการเครื่อง');

    const me = await ctx.currentUser();
    for (const x of updates) ctx.ss.writeByHeaders(name, x.row, { ...x.patch, UpdatedBy: me });

    const headers = ctx.ss.headers(name);
    for (const u of adds) {
      // แถวใหม่หน้าตาเดียวกับที่ createCleaningPlan สร้าง
      const rec = { AirCode: u.AirCode, NodeName: u.NodeName, SiteCode: u.SiteCode, BTU: u.BTU, UpdatedBy: me, Rounds: n };
      for (const r of [1, 2, 3].slice(0, n)) {
        rec['R' + r + '_Price'] = u.CleaningPricePerRound || '';
        rec['R' + r + '_Status'] = 'รอดำเนินการ';
      }
      ctx.ss.appendRow(name, headers.map(h => (rec[h] !== undefined ? rec[h] : '')));
    }

    await ctx.ss.flush();
    return { added: adds.length, updated: updates.length, backupName, plan: await getCleaningPlan(ctx, year) };
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
export function cleaningDocOf(ctx, airCode, year, round) {
  const want = normalizeCode(airCode);
  const y = String(year == null ? '' : year).trim();
  const r = String(round == null ? '' : round).trim();

  return ctx.ss.objects(SHEETS.CLEANFORM).find(f =>
    String(f.PlanYear == null ? '' : f.PlanYear).trim() === y &&
    String(f.PlanRound == null ? '' : f.PlanRound).trim() === r &&
    [f.AirCode1, f.AirCode2].some(c => c && normalizeCode(c) === want)
  ) || null;
}

const hasCleaningDoc = (ctx, airCode, year, round) => !!cleaningDocOf(ctx, airCode, year, round);

/** เลขเอกสารของเครื่องนั้นในใบ — ช่อง 1 = DocNo · ช่อง 2 = DocNo2 (ใบเก่าที่ยังไม่มี DocNo2 ใช้เลขของใบ) */
export function docNoOfUnit(form, airCode) {
  const want = normalizeCode(airCode);
  const own = normalizeCode(form.AirCode2) === want ? form.DocNo2 : form.DocNo;
  return String(own || form.DocNo || form.DocNo2 || form.ID || '').trim();
}

/**
 * รอบนั้นของเครื่องต้องยังไม่ได้ล้าง — ล้างรอบเดิมซ้ำไม่ได้ (เจ้าของงานกำหนด 16/10/2569)
 *
 * เดิมกรอกใบล้าง/แนบเอกสารของรอบที่ปิดไปแล้วได้อีก ถ้าคนละวันก็ได้ใบใหม่ ปิดรอบทับวันเดิม
 * และลงประวัติค่าล้างอีกแถว — งบนับค่าล้างครั้งเดียวกันซ้ำสองเท่าโดยไม่มีอะไรฟ้อง
 *
 *   มีใบล้างของเครื่อง-ปี-รอบนี้อยู่แล้ว  ปฏิเสธพร้อมบอกเลขใบเดิม (ต้องการแก้ = ลบใบเดิมก่อน)
 *   ไม่มีใบแต่รอบปิดแล้ว                 รอบที่ปิดมาจากระบบเดิม (นำเข้า) ล้างไปแล้วเหมือนกัน
 *
 * ตรวจก่อนเขียนอะไรทั้งสิ้น · ไม่ส่งปี/รอบ = ไม่ผูกกับแผน ไม่มีอะไรต้องตรวจ
 * @param {Object} opts { year, round, airCodes: [รหัสเครื่อง] }
 */
export async function assertRoundNotCleaned(ctx, opts) {
  const year = String((opts && opts.year) ?? '').trim();
  const round = String((opts && opts.round) ?? '').trim();
  if (!year || !round) return;

  for (const code of opts.airCodes || []) {
    const form = cleaningDocOf(ctx, code, year, round);
    if (form) {
      throw new Error('เครื่อง ' + code + ' รอบที่ ' + round + '/' + year + ' มีใบล้างเลขที่ ' +
        docNoOfUnit(form, code) + ' อยู่แล้ว — ล้างรอบเดิมซ้ำไม่ได้ ถ้าต้องการแก้ ให้ Infrastructure ลบใบเดิมก่อน');
    }
  }

  const name = planSheet(year);
  if (!(await ctx.ss.hasSheet(name))) return;
  await ctx.ss.load(name);
  for (const code of opts.airCodes || []) {
    const row = ctx.ss.objects(name).find(p => normalizeCode(p.AirCode) === normalizeCode(code));
    if (row && roundState(row, round, false) === 'done') {
      const at = formatDate(row['R' + round + '_ActualDate']);
      throw new Error('เครื่อง ' + code + ' รอบที่ ' + round + '/' + year + ' ปิดงานไปแล้ว' +
        (at ? ' (ล้างเมื่อ ' + at + ')' : '') + ' — ล้างรอบเดิมซ้ำไม่ได้');
    }
  }
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
    const n = roundsInRow(headers, r => ctx.ss.cell(name, row, r + 1));
    if (Number(round) > n) throw new Error('แผนปี ' + year + ' ล้าง ' + n + ' รอบ ไม่มีรอบที่ ' + round);

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

    // ลงวันตามแผนแล้ว = นัดหมายแล้ว ทุกแผน (เจ้าของงานกำหนด 15/10/2569) — ล้างแล้ว/ยกเลิก คงตามที่เลือก
    // ไม่มีวันตามแผน = รอดำเนินการ (กติกาเดียวกับตั้งวันทั้ง Node และลบใบล้าง — 16/10/2569)
    // เดิมลบวันออกแล้วสถานะค้าง "นัดหมายแล้ว" ทั้งที่ไม่มีวันนัด
    const asked = data.status || 'รอดำเนินการ';
    const status = data.planDate && asked === 'รอดำเนินการ' ? ROUND_SCHEDULED
      : !data.planDate && asked === ROUND_SCHEDULED ? 'รอดำเนินการ'
      : asked;

    // ============================================================================
    // รอบที่ปิดแล้ว เปลี่ยนสถานะกลับไม่ได้ (เจ้าของงานกำหนด 16/10/2569)
    // ============================================================================
    // เดิมเลือกสถานะอื่นได้ แต่วันที่ล้างจริงยังค้าง — สรุปแผนนับเสร็จ การ์ดนัดโชว์เป็นนัด
    // รอบถัดไปบันทึกไม่ได้ เลือก "ยกเลิก" ค่าล้างหายจากสรุปแผนแต่ยังอยู่ในงบ ปิดใหม่ประวัติซ้อน
    //
    //   มีใบล้าง      ห้ามเปลี่ยน — เปิดรอบกลับได้ทางเดียวคือลบใบล้าง (ซึ่งย้อนประวัติให้ด้วย)
    //   ไม่มีใบ        (ปิดมาจากระบบเดิม) Infrastructure แก้ได้ ไว้แก้ข้อมูลผิด — ล้างวันล้างจริงทิ้งด้วย
    //   ยังปิดอยู่    วันล้างจริงคงค่าเดิมเสมอ ไม่รับจากหน้าเว็บ (มาจากใบล้างเท่านั้น)
    let actualDate = data.actualDate || '';
    if (wasDone) {
      const stored = dateOut(ctx.ss.cell(name, row, startCol + 1));
      if (status === ROUND_DONE) {
        actualDate = stored;
      } else {
        const doc = cleaningDocOf(ctx, airCode, year, round);
        if (doc) {
          throw new Error('รอบที่ ' + round + '/' + year + ' ของเครื่อง ' + airCode + ' ปิดงานด้วยใบล้างเลขที่ ' +
            docNoOfUnit(doc, airCode) + ' แล้ว เปลี่ยนสถานะไม่ได้ — ถ้าต้องการเปิดรอบกลับ ให้ Infrastructure ลบใบล้างนั้น');
        }
        if ((await ctx.userInfo()).role !== 'Admin') {
          throw new Error('รอบที่ ' + round + '/' + year + ' ของเครื่อง ' + airCode + ' ปิดงานแล้ว (จากระบบเดิม ไม่มีใบล้างในระบบ) ' +
            '— เปลี่ยนสถานะได้เฉพาะ Infrastructure');
        }
        actualDate = '';
      }
    }

    ctx.ss.setValues(name, row, startCol, [[
      data.planDate || '', actualDate, data.price || '',
      data.technician || '', status, data.note || ''
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
 *   เครื่องที่ไม่ได้เลือก = รอบนั้นเป็น "รอดำเนินการ" และวันนัดเดิมถูกล้างออก (ยังไม่ล้าง ไม่ได้ผู้รับเหมาจากหน้าต่างนี้)
 *   ยกเว้นรอบที่ล้างไปแล้ว หรือยกเลิกไว้ ไม่ถูกแตะ
 *
 * รอบที่ลงวันให้ สถานะเป็น "นัดหมายแล้ว" (ยกเว้นรอบที่ล้างไปแล้วหรือยกเลิกไว้)
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
      const n = roundsInRow(headers, c => row[c]);
      for (const r of [1, 2, 3]) {
        if (r > n) continue;   // รอบที่ปีนี้ไม่มี — ไม่ลงวัน/ผู้รับเหมา/สถานะ
        const status = String(row[idx['s' + r]] || '').trim();
        // รอบที่ล้างแล้วไม่แตะเลย — วันนัด ผู้รับเหมา สถานะ คือข้อเท็จจริงของงานที่ทำไปแล้ว
        // (เดิมเครื่องที่ติ๊กไว้ถูกเปลี่ยนวันนัดและผู้รับเหมาของรอบที่ล้างเสร็จแล้วด้วย)
        if (status === ROUND_DONE || String(row[idx['a' + r]] || '').trim()) continue;
        if (picked[r] && !picked[r].has(code)) {
          // ไม่ล้างรอบนี้ = รอดำเนินการ (เจ้าของงานไม่ให้เป็นยกเลิก) — รอบที่ล้างไปแล้วหรือยกเลิกไว้คงไว้ตามจริง
          // วันนัดเดิมล้างออกด้วย (เจ้าของงานกำหนด 15/10/2569) ไม่งั้นยังขึ้นเป็นนัดในแดชบอร์ด
          // ภายหลังได้ล้างจริง กรอกเอกสารก็ปิดงานได้เลย ไม่ต้องมีวันนัด
          const done = status === ROUND_DONE || String(row[idx['a' + r]] || '').trim();
          if (!done && status !== ROUND_CANCELLED) {
            row[idx['s' + r]] = 'รอดำเนินการ';
            row[idx['r' + r]] = '';
          }
          continue;
        }
        // เลือกล้างรอบนี้ แต่เคยยกเลิกไว้ = กลับมาเป็นงานที่ต้องทำ
        if (picked[r] && status === ROUND_CANCELLED) row[idx['s' + r]] = 'รอดำเนินการ';
        if (dates['r' + r]) {
          row[idx['r' + r]] = dates['r' + r];
          const now = String(row[idx['s' + r]] || '').trim();
          const done = now === ROUND_DONE || String(row[idx['a' + r]] || '').trim();
          if (!done && now !== ROUND_CANCELLED) row[idx['s' + r]] = 'นัดหมายแล้ว';
        }
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

/**
 * นำเข้าแผนแบบกลุ่มจากไฟล์ Excel/CSV — วันตามแผน และผู้รับเหมาของแต่ละรอบ
 *
 * คอลัมน์ผู้รับเหมา (R1_Contractor / R2_Contractor / R3_Contractor) ใส่ "ชื่อ" ไม่ใช่รหัส
 * เพราะคนกรอกไฟล์รู้จักแค่ชื่อ — เทียบแบบไม่สนตัวพิมพ์/ช่องว่าง แต่ตัวสะกดต้องตรง
 * ช่องว่าง = ไม่แตะผู้รับเหมาเดิมของรอบนั้น
 *
 * ชื่อต้องเป็นผู้รับเหมาที่มีบัญชีผู้ใช้ (User) ที่เปิดใช้งานอยู่แล้วเท่านั้น (เจ้าของงานกำหนด)
 * เพราะผู้รับเหมาเห็นงานผ่านบัญชีของตัวเอง — มอบงานให้ชื่อที่ไม่มีบัญชี = งานที่ไม่มีใครเห็น
 * มีชื่อไหนไม่ตรงแม้แต่ชื่อเดียว ไม่นำเข้าทั้งไฟล์ แล้วบอกรายชื่อ ให้ไปสร้าง User หรือแก้ชื่อแล้วดรอปใหม่
 * (ไม่นำเข้าครึ่งๆ กลางๆ — ไม่งั้นต้องมาไล่ว่าแถวไหนเข้าแถวไหนไม่เข้า)
 *
 * รอบที่ล้างเสร็จแล้วไม่เปลี่ยนผู้รับเหมา — คนที่ล้างไปแล้วคือข้อเท็จจริง ไฟล์ทับไม่ได้
 */
export async function updatePlanBulk(ctx, year, importedData) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('plan');
    // นำเข้า Excel/CSV เป็นของ Infrastructure เท่านั้น — เจ้าของงานปิดไม่ให้ Regional / Staff / Supervisor ใช้
    await ctx.assertAdmin();

    const name = planSheet(year);
    await ctx.connect();
    await ctx.ensureBase();   // ต้องมีรายชื่อผู้รับเหมาและผู้ใช้ไว้จับคู่ชื่อ/ตรวจบัญชี
    if (!(await ctx.ss.hasSheet(name))) throw new Error('ไม่พบแผนปี ' + year);
    await ctx.ss.load(name);
    await ctx.ss.ensureColumns(name, PLAN_HEADERS);

    // ตรวจว่าไฟล์นำเข้ามีคอลัมน์วันที่หรือผู้รับเหมาอย่างน้อย 1 คอลัมน์
    // ป้องกันการนำเข้าไฟล์ผิด template แบบเงียบๆ
    const hasAnyColumn = (importedData || []).some(item => [1, 2, 3].some(r =>
      item['R' + r + '_PlanDate'] !== undefined || item['R' + r + '_Contractor'] !== undefined
    ));
    if (!hasAnyColumn) {
      throw new Error('ไฟล์นำเข้าไม่มีคอลัมน์ R1_PlanDate / R2_PlanDate / R3_PlanDate หรือ R1_Contractor / R2_Contractor / R3_Contractor กรุณาใช้ Template ที่ระบบสร้างให้');
    }
    // แผนมีได้สูงสุด 3 รอบ — คอลัมน์ R4 ขึ้นไปที่เติมเองในไฟล์ไม่ถูกนำเข้า
    // ส่งชื่อกลับไปให้หน้าเว็บเตือน ไม่งั้นคนกรอกจะเข้าใจว่าบันทึกแล้ว (ส่วนอื่นของไฟล์ยังนำเข้าตามปกติ)
    const ignoredColumns = [...new Set((importedData || []).flatMap(item => Object.keys(item)))]
      .filter(k => { const m = /^R(\d+)_/i.exec(k); return m && Number(m[1]) > 3; })
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    const info = await ctx.userInfo();
    const allowed = info.role === 'Admin' ? null : await ctx.allowedAirCodes();

    const headers = ctx.ss.headers(name);
    const values = ctx.ss.values(name);
    const idx = {
      code: headers.indexOf('AirCode'),
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
    const me = await ctx.currentUser();

    const mapImport = {};
    importedData.forEach(item => {
      if (item.AirCode) mapImport[normalizeCode(item.AirCode)] = item;
    });

    // ชื่อผู้รับเหมาที่ใช้ได้ = เปิดใช้งาน และมีบัญชีผู้ใช้ที่เปิดใช้งานผูกอยู่อย่างน้อย 1 บัญชี
    const nameKey = v => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, '');
    const isOn = v => v !== false && String(v).toUpperCase() !== 'FALSE';
    const withUser = new Set(ctx.ss.objects(SHEETS.USERS).filter(u => isOn(u.Active))
      .map(u => String(u.ContractorID || '').trim().toUpperCase()).filter(Boolean));
    const idByName = new Map();
    for (const c of ctx.ss.objects(SHEETS.CONTRACTOR)) {
      const id = String(c.ID || '').trim();
      if (id && isOn(c.Active) && withUser.has(id.toUpperCase())) idByName.set(nameKey(c.Name), id);
    }
    // ตรวจทุกชื่อในไฟล์ก่อนแตะแถวไหน — ไม่ตรงชื่อเดียวก็ไม่นำเข้าทั้งไฟล์
    const unknown = [...new Set((importedData || []).flatMap(item => [1, 2, 3]
      .map(r => String(item['R' + r + '_Contractor'] || '').trim().replace(/\s+/g, ' '))
      .filter(v => v && !idByName.has(nameKey(v)))))];
    // คืนรายชื่อแทนการโยน error — หน้าเว็บแสดงเป็นรายการให้อ่านง่าย (ข้อความ error ยาวๆ อ่านในป้ายแจ้งเตือนไม่ทัน)
    // ยังไม่ได้เขียนอะไรลงแผนเลย ณ จุดนี้
    // วันที่ในไฟล์ใช้ วว/ดด/ปปปป ค.ศ. (เจ้าของงานกำหนด 15/10/2569) — แปลงเป็น ปปปป-ดด-วว แบบที่หน้าเว็บบันทึก
    // เดิมเก็บข้อความตามที่พิมพ์มา ช่องวันที่ในหน้าต่างแก้แผนจึงอ่านไม่ออก (ว่าง)
    // อ่านไม่ได้แม้ช่องเดียวก็ไม่นำเข้าทั้งไฟล์ เหมือนชื่อผู้รับเหมา — ยังไม่ได้เขียนอะไร ณ จุดนี้
    const badDates = [];
    for (const item of importedData || []) {
      for (const r of [1, 2, 3]) {
        const v = String(item['R' + r + '_PlanDate'] ?? '').trim();
        if (v && toIsoDate(v) === null) badDates.push({ airCode: String(item.AirCode || '?'), round: r, value: v });
      }
    }
    // คืนเป็นรายการทั้งสองอย่าง ไม่โยน error — หน้าเว็บแสดงเป็นรายการให้อ่านครบ (16/10/2569)
    // เดิมวันที่ผิดโยนข้อความยาวที่ตัดเหลือ 5 ช่องแรก ขณะที่ชื่อผู้รับเหมาผิดคืนเป็นรายการ — สองแบบในไฟล์เดียว
    if (unknown.length || badDates.length) {
      return { rejected: true, unknownContractors: unknown, badDates, matchedCount: 0 };
    }
    const isoOf = v => toIsoDate(String(v ?? '').trim());
    // รอบที่ล้างเสร็จแล้วที่ไฟล์พยายามเปลี่ยน (วันนัดหรือผู้รับเหมา) — นับรอบละครั้ง
    const skippedDone = new Set();

    const matchedCodes = new Set();
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const code = normalizeCode(row[idx.code]);
      const imp = mapImport[code];
      if (!imp) continue;
      if (allowed && !allowed.has(code)) continue; // ข้ามเครื่องนอกภูมิภาคที่ตนดูแล

      // รอบที่ปีนี้ไม่มี ไม่รับวัน/ผู้รับเหมาจากไฟล์
      const n = roundsInRow(headers, c => row[c]);
      // รอบที่ล้างเสร็จแล้วไม่รับอะไรจากไฟล์ — คนที่ล้างไปแล้วและวันที่ล้างคือข้อเท็จจริง ไฟล์ทับไม่ได้
      const doneRound = r => String(row[idx['s' + r]] || '').trim() === ROUND_DONE || String(row[idx['a' + r]] || '').trim();
      for (const r of [1, 2, 3]) {
        const iso = isoOf(imp['R' + r + '_PlanDate']);
        if (!iso || r > n) continue;
        if (doneRound(r)) { skippedDone.add(code + '|' + r); continue; }
        row[idx['r' + r]] = iso;
        // ลงวันแล้ว = นัดหมายแล้ว (เจ้าของงานกำหนด) — ล้างแล้ว/ยกเลิก ไม่แตะ
        const st = String(row[idx['s' + r]] || '').trim();
        if (idx['s' + r] > -1 && (!st || st === 'รอดำเนินการ')) row[idx['s' + r]] = ROUND_SCHEDULED;
      }
      for (const r of [1, 2, 3]) {
        const cname = String(imp['R' + r + '_Contractor'] || '').trim();
        if (!cname || r > n || idx['c' + r] < 0) continue;
        if (doneRound(r)) { skippedDone.add(code + '|' + r); continue; }
        row[idx['c' + r]] = idByName.get(nameKey(cname));
      }
      if (idx.by > -1) row[idx.by] = me;
      values[i] = row;
      matchedCodes.add(code);
    }

    // รวบรวมรหัสในไฟล์ที่หาไม่เจอ (หรือไม่มีสิทธิ์) เพื่อแจ้งผู้ใช้แทนการนิ่งเงียบ
    const notFound = Object.keys(mapImport).filter(code => !matchedCodes.has(code));

    writeBackColumns(ctx, name, values, [
      [idx.r1, dateOut], [idx.r2, dateOut], [idx.r3, dateOut], [idx.by, String],
      [idx.c1, String], [idx.c2, String], [idx.c3, String],
      [idx.s1, String], [idx.s2, String], [idx.s3, String]
    ]);

    await ctx.ss.flush();
    return {
      plan: await getCleaningPlan(ctx, year),
      matchedCount: matchedCodes.size,
      notFoundCodes: notFound,
      skippedDoneRounds: skippedDone.size,
      ignoredColumns
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
/**
 * ล้างต้องทำทีละรอบ — รอบก่อนหน้าของเครื่องนั้นต้องปิดเรียบร้อยก่อน (เจ้าของงานกำหนด 15/10/2569)
 *
 * ไม่งั้นกรอกผิดรอบได้เงียบๆ: ผู้รับเหมากรอกรอบ 3 ทั้งที่รอบ 1 ยังไม่ปิด รอบ 3 ถูกปิดแล้วรอบ 1 ยังค้าง
 * ตรวจก่อนเขียนอะไรทั้งสิ้น (ผู้เรียกเรียกก่อนบันทึกเอกสาร) · รอบที่ "ยกเลิก" ถือว่าผ่านไปแล้ว
 * ไม่ส่งปี/รอบ = ไม่ผูกกับแผน ไม่มีอะไรต้องตรวจ · เครื่องที่ไม่อยู่ในแผนปีนั้นก็ไม่ตรวจ
 *
 * ตรวจเป็นรายเครื่อง ไม่ได้บังคับให้ปิดครบทั้ง Node ก่อน
 *
 * @param {Object} opts { year, round, airCodes: [รหัสเครื่อง] }
 */
export async function assertRoundsInOrder(ctx, opts) {
  const year = opts && opts.year, round = Number(opts && opts.round);
  if (!year || !Number.isInteger(round) || round <= 1) return;

  const name = planSheet(year);
  if (!(await ctx.ss.hasSheet(name))) return;
  await ctx.ss.load(name);
  await ctx.ss.ensureColumns(name, PLAN_HEADERS);

  const headers = ctx.ss.headers(name);
  const values = ctx.ss.values(name);
  const codeIdx = headers.indexOf('AirCode');

  for (const code of opts.airCodes || []) {
    const want = normalizeCode(code);
    const i = values.findIndex((v, n) => n > 0 && normalizeCode((v || [])[codeIdx]) === want);
    if (i < 0) continue;

    for (let r = 1; r < round; r++) {
      const col = headers.indexOf('R' + r + '_Status');
      if (col < 0) continue;
      const status = String((values[i] || [])[col] || '').trim();
      if (status === 'ล้างเสร็จสิ้น' || status === ROUND_CANCELLED) continue;
      throw new Error('เครื่อง ' + code + ' ยังไม่ได้ปิดรอบที่ ' + r + ' ของปี ' + year +
                      ' — ล้างต้องทำทีละรอบ ปิดรอบที่ ' + r + ' ให้เรียบร้อยก่อนจึงบันทึกรอบที่ ' + round + ' ได้');
    }
  }
}

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
  // รอบที่ปีนี้ไม่มี ไม่มีอะไรให้ปิด (หน้าเว็บไม่ให้เลือกอยู่แล้ว)
  if (Number(round) > roundsInRow(headers, c => (values[row - 1] || [])[c])) return 0;

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

/**
 * เปิดรอบที่ปิดไปแล้วกลับเป็น "รอดำเนินการ" — คู่กลับของ closePlanRound
 *
 * ใช้ตอน Infrastructure ลบใบล้าง (เจ้าของงานกำหนด: ลบแล้วต้องย้อน เพราะต้องกรอกเอกสารใหม่)
 * เปิดเฉพาะรอบที่ปิดด้วยวันที่เดียวกับใบที่ลบ — รอบที่ถูกปิดด้วยใบอื่นทีหลังไม่แตะ
 * ราคาและชื่อช่างคงไว้ (เป็นราคาตามแผน/ราคาผู้รับเหมาอยู่แล้ว) ล้างแค่วันที่ล้างจริงกับสถานะ
 *
 * ไม่ล็อก ไม่ flush — ผู้เรียกถือล็อกแล้ว
 * @returns {Promise<number>} 1 = เปิดรอบกลับแล้ว · 0 = ไม่มีอะไรต้องทำ
 */
export async function reopenPlanRoundRaw(ctx, opts) {
  const round = String(opts.round);
  if (['1', '2', '3'].indexOf(round) === -1) return 0;

  const name = planSheet(opts.year);
  if (!(await ctx.ss.hasSheet(name))) return 0;
  await ctx.ss.load(name);

  const headers = ctx.ss.headers(name);
  const codeIdx = headers.indexOf('AirCode');
  const values = ctx.ss.values(name);
  const want = normalizeCode(opts.airCode);
  const i = values.findIndex((r, n) => n > 0 && normalizeCode((r || [])[codeIdx]) === want);
  if (i === -1) return 0;
  const row = i + 1;

  const col = f => headers.indexOf('R' + round + '_' + f) + 1;
  if (col('Status') <= 0 || col('ActualDate') <= 0) return 0;
  if (String(ctx.ss.cell(name, row, col('Status')) || '').trim() !== 'ล้างเสร็จสิ้น') return 0;
  if (dateOut(ctx.ss.cell(name, row, col('ActualDate'))) !== dateOut(opts.actualDate)) return 0;

  // ยังมีวันตามแผน = กลับเป็นนัดหมายแล้ว (กติกาเดียวกับทุกช่องทาง — เจ้าของงานกำหนด 15/10/2569) · ไม่มีวัน = รอดำเนินการ
  const planDate = col('PlanDate') > 0 ? String(ctx.ss.cell(name, row, col('PlanDate')) || '').trim() : '';
  ctx.ss.setValue(name, row, col('Status'), planDate ? ROUND_SCHEDULED : 'รอดำเนินการ');
  ctx.ss.setValue(name, row, col('ActualDate'), '');
  const byCol = headers.indexOf('UpdatedBy') + 1;
  if (byCol > 0) ctx.ss.setValue(name, row, byCol, await ctx.currentUser());
  return 1;
}
