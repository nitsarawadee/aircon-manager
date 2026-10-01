import { SHEETS, INSTALL_PENDING_NOTE } from '../schema.js';
import { normalizeCode, plainText, ymdhms } from '../values.js';
import { unitsInScope, getAirList } from './airlist.js';
import { closeRepairCaseRaw, getHistory } from './history.js';
import { openCaseOf } from './repair-case.js';
import { checkContractorId } from './plan.js';
import { approvalRowOf, isPending } from './approval.js';

/**
 * มอบหมายงานซ่อม/ติดตั้งให้ผู้รับเหมาประจำ พร้อมวันนัด (เจ้าของงานขอ ตามที่คุยกับพี่เลี้ยง)
 *
 * ============================================================================
 * การทำงาน
 * ============================================================================
 * - Infrastructure / Regional / Supervisor / Staff เลือกผู้รับเหมา (ที่มีบัญชี) ให้งานหนึ่ง + วันนัด
 * - ผู้รับเหมาเห็นงานนั้นในหน้าตารางงานของตัวเอง แล้วกรอกเอกสารในบัญชีตัวเองได้
 * - ผู้รับเหมาที่ไม่ได้จ้างประจำ (ไม่มีบัญชี) ใช้ลิงก์แทน (repairlink.js · ใช้ได้ทั้งซ่อมและติดตั้ง)
 *
 * "งาน" คืองานครั้งเดียว ไม่ใช่เครื่อง:
 *   ซ่อม     เครื่องสถานะ "รอซ่อม" (อนุมัติซ่อมแล้ว — จุดเดียวกับที่สร้างลิงก์ได้) · RefID = เลขเคส
 *   ติดตั้ง   แถวประวัติที่รอเอกสารติดตั้ง (INSTALL_PENDING_NOTE) · RefID = เลขที่แถวนั้น
 * กรอกเอกสารแล้วงานปิด การมอบหมายหมดผลไปเอง งานครั้งหน้าของเครื่องเดียวกันต้องมอบหมายใหม่
 *
 * ⚠️ ผู้รับเหมากรอกได้เฉพาะงานที่มอบหมายให้ตัวเองและยังเปิดอยู่ (assertOwnAssigned)
 * ขอบเขตเครื่องของผู้รับเหมา (ctx.scopeFilter) กว้างกว่านั้น เพราะต้องเปิดดูเอกสารที่ทำไปแล้วได้
 */

export const ASSIGN_KINDS = {
  repair: { module: 'repairform', label: 'งานซ่อม' },
  install: { module: 'installform', label: 'งานติดตั้ง' }
};

/** งานซ่อมที่มอบหมาย/สร้างลิงก์ได้ = อนุมัติซ่อมแล้ว */
export const REPAIR_OPEN_STATUS = 'รอซ่อม';

/** เคสเก่าก่อนมีระบบเลขเคส (เครื่องค้าง "รอซ่อม" แต่ประวัติไม่มีเลขเคส) — ยังมอบหมายได้ */
const NO_CASE = 'ไม่มีเลขเคส';

/**
 * งานที่เปิดอยู่ตอนนี้ของเครื่องหนึ่ง → RefID · ไม่มีงานเปิด = null
 * ต้องเรียกหลัง ensureBase
 */
export function openRef(ctx, kind, airCode) {
  const nc = normalizeCode(airCode);
  if (!nc) return null;
  if (kind === 'repair') {
    const unit = ctx.ss.objects(SHEETS.AIRLIST).find(u => normalizeCode(u.AirCode) === nc);
    if (!unit || plainText(unit.Status).trim() !== REPAIR_OPEN_STATUS) return null;
    const c = openCaseOf(ctx.ss.objects(SHEETS.HISTORY), unit.AirCode);
    return c ? c.caseId : NO_CASE;
  }
  if (kind === 'install') {
    // แถวที่รอเอกสารล่าสุดของเครื่อง (ตารางงานติดตั้งที่รอเอกสารก็โชว์แถวล่าสุด)
    const pending = ctx.ss.objects(SHEETS.HISTORY).filter(h =>
      normalizeCode(h.AirCode) === nc && plainText(h.Note).trim() === INSTALL_PENDING_NOTE);
    return pending.length ? plainText(pending[pending.length - 1].ID) : null;
  }
  return null;
}

/** การมอบหมายที่ยังมีผลของเครื่องหนึ่ง (งานยังเปิด และเป็นงานครั้งเดียวกับที่มอบหมาย) */
export function activeAssignment(ctx, kind, airCode) {
  const ref = openRef(ctx, kind, airCode);
  if (!ref) return null;
  const nc = normalizeCode(airCode);
  return ctx.ss.objects(SHEETS.ASSIGN).find(a =>
    plainText(a.Kind) === kind && normalizeCode(a.AirCode) === nc &&
    plainText(a.RefID) === ref && plainText(a.ContractorID)) || null;
}

/**
 * บัญชีผู้รับเหมากรอกเอกสารของงานนี้ได้ไหม — เจ้าหน้าที่ผ่านเสมอ (ขอบเขตตรวจที่อื่น)
 * ต้องเรียกหลัง ensureBase
 */
export function assertOwnAssigned(ctx, info, kind, airCode) {
  if (info.role !== 'Contractor') return;
  const a = activeAssignment(ctx, kind, airCode);
  if (!a || plainText(a.ContractorID).toUpperCase() !== plainText(info.contractorId).toUpperCase()) {
    throw new Error(ASSIGN_KINDS[kind].label + 'ของเครื่อง ' + plainText(airCode) +
      ' ไม่ได้มอบหมายให้คุณ หรือปิดไปแล้ว — ติดต่อเจ้าหน้าที่');
  }
}

/**
 * ผู้รับเหมาเห็น/แก้รูปใบซ่อม-ใบติดตั้งได้เฉพาะใบที่ตัวเองกรอก
 *
 * ขอบเขตเครื่องของผู้รับเหมา (งานล้างในแผน + งานที่มอบหมาย) กว้างกว่างานซ่อม/ติดตั้งของตัวเอง
 * ถ้ากรองแค่ตามเครื่อง ผู้รับเหมาที่ล้างเครื่องหนึ่งจะเห็นใบซ่อมของเจ้าอื่นบนเครื่องเดียวกัน (มีราคา)
 */
export function isOwnDoc(info, form) {
  return info.role === 'Contractor' && !!plainText(info.username) &&
    plainText(form && form.RecordedBy) === plainText(info.username);
}

const contractorNameMap = ctx => new Map(ctx.ss.objects(SHEETS.CONTRACTOR)
  .map(c => [plainText(c.ID).toUpperCase(), plainText(c.Name)]));

/* ==================== ฝั่งเจ้าหน้าที่ ==================== */

/**
 * มอบหมายงาน / เปลี่ยนผู้รับเหมา / เปลี่ยนวันนัด / ยกเลิก (contractorId ว่าง)
 * งานหนึ่งมีการมอบหมายแถวเดียว — มอบหมายซ้ำ = แก้แถวเดิม
 */
export async function assignJob(ctx, kind, airCode, contractorId, apptDate, note) {
  return ctx.withLock(async () => {
    const spec = ASSIGN_KINDS[kind];
    if (!spec) throw new Error('ไม่รู้จักประเภทงาน ' + plainText(kind));
    await ctx.assertStaff('มอบหมายงาน');
    await ctx.assertModuleEdit(spec.module);
    await ctx.ensureBase();

    const nc = normalizeCode(airCode);
    const unit = (await unitsInScope(ctx)).find(u => normalizeCode(u.AirCode) === nc);
    if (!unit) throw new Error('ไม่พบเครื่องรหัส ' + plainText(airCode) + ' หรือไม่มีสิทธิ์เข้าถึง');

    const ref = openRef(ctx, kind, unit.AirCode);
    if (!ref) {
      throw new Error(kind === 'repair'
        ? 'มอบหมายได้เฉพาะงานซ่อมที่อนุมัติแล้ว (สถานะ "' + REPAIR_OPEN_STATUS + '")'
        : 'เครื่อง ' + unit.AirCode + ' ไม่มีงานติดตั้งที่รอเอกสาร');
    }

    const cid = checkContractorId(ctx, contractorId);   // ว่าง = ยกเลิกการมอบหมาย
    const date = plainText(apptDate).trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('วันนัดไม่ถูกต้อง');

    const patch = {
      ContractorID: cid,
      ApptDate: cid ? date : '',
      Note: cid ? plainText(note).trim() : '',
      AssignedBy: await ctx.currentUser(),
      AssignedAt: ymdhms(new Date())
    };
    const existing = ctx.ss.objects(SHEETS.ASSIGN).find(a =>
      plainText(a.Kind) === kind && normalizeCode(a.AirCode) === nc && plainText(a.RefID) === ref);
    if (existing) {
      ctx.ss.writeByHeaders(SHEETS.ASSIGN, existing._row, patch);
    } else if (cid) {
      const row = { ID: 'JA' + Date.now(), Kind: kind, AirCode: plainText(unit.AirCode), RefID: ref, ...patch };
      const headers = ctx.ss.headers(SHEETS.ASSIGN);
      ctx.ss.appendRow(SHEETS.ASSIGN, headers.map(h => (row[h] !== undefined ? row[h] : '')));
    }
    await ctx.ss.flush();
    return getJobAssignments(ctx);
  });
}

/**
 * การมอบหมายที่ยังมีผล ของเครื่องในขอบเขต — ใช้โชว์ในหน้างานซ่อมและติดตั้ง
 * @returns {Array<{kind, airCode, contractorId, contractorName, apptDate, note, assignedBy, assignedAt}>}
 */
export async function getJobAssignments(ctx) {
  const info = await ctx.userInfo();
  if (info.role !== 'Admin' && info.role !== 'RegionAdmin') return [];
  await ctx.ensureBase();
  const scope = new Set((await unitsInScope(ctx)).map(u => normalizeCode(u.AirCode)));
  const names = contractorNameMap(ctx);
  const out = [];
  for (const kind of Object.keys(ASSIGN_KINDS)) {
    if (!(await ctx.canView(ASSIGN_KINDS[kind].module))) continue;
    for (const code of scope) {
      const a = activeAssignment(ctx, kind, code);
      if (!a) continue;
      out.push({
        kind, airCode: plainText(a.AirCode),
        contractorId: plainText(a.ContractorID),
        contractorName: names.get(plainText(a.ContractorID).toUpperCase()) || plainText(a.ContractorID),
        apptDate: plainText(a.ApptDate).slice(0, 10), note: plainText(a.Note),
        assignedBy: plainText(a.AssignedBy), assignedAt: plainText(a.AssignedAt)
      });
    }
  }
  return out;
}

/* ==================== ฝั่งผู้รับเหมา ==================== */

/** เอกสารที่ปิดงานครั้งนั้น (ถ้ามี) — ใช้โชว์ว่าทำเสร็จแล้วและเปิดดูได้ */
function docOfJob(ctx, kind, a) {
  const ref = plainText(a.RefID);
  if (kind === 'repair') {
    const forms = ctx.ss.objects(SHEETS.REPAIRFORM).filter(f =>
      plainText(f.CaseID) === ref && normalizeCode(f.AirCode) === normalizeCode(a.AirCode));
    return forms.length ? forms[forms.length - 1] : null;
  }
  // ติดตั้ง: แถวประวัติที่เคยรอเอกสาร ถูกเปลี่ยนเป็น "เอกสาร <เลขที่>" ตอนบันทึกใบติดตั้ง
  const h = ctx.ss.objects(SHEETS.HISTORY).find(x => plainText(x.ID) === ref);
  const docNo = h && (/^เอกสาร\s+(\S+)/.exec(plainText(h.Note).trim()) || [])[1];
  if (!docNo) return null;
  return ctx.ss.objects(SHEETS.INSTALLFORM).find(f =>
    plainText(f.DocNo) === docNo || plainText(f.DocNo2) === docNo) || null;
}

/**
 * งานซ่อม/ติดตั้งของผู้รับเหมาคนนี้ — ทั้งที่ยังเปิด (open) และที่กรอกเอกสารแล้ว (done)
 * งานที่ถูกปิดไปทางอื่นโดยไม่มีเอกสาร หรือถูกย้ายไปให้เจ้าอื่น ไม่ส่งไป
 */
export async function getMyJobs(ctx) {
  const info = await ctx.userInfo();
  if (info.role !== 'Contractor') return [];
  await ctx.ensureBase();
  const me = plainText(info.contractorId).toUpperCase();
  const units = new Map(ctx.ss.objects(SHEETS.AIRLIST).map(u => [normalizeCode(u.AirCode), u]));
  const out = [];
  for (const a of ctx.ss.objects(SHEETS.ASSIGN)) {
    if (plainText(a.ContractorID).toUpperCase() !== me) continue;
    const kind = plainText(a.Kind);
    if (!ASSIGN_KINDS[kind]) continue;
    const unit = units.get(normalizeCode(a.AirCode));
    if (!unit) continue;

    const active = activeAssignment(ctx, kind, a.AirCode);
    const open = !!active && plainText(active.ID) === plainText(a.ID);
    const doc = open ? null : docOfJob(ctx, kind, a);
    if (!open && !doc) continue;

    const approval = doc ? approvalRowOf(ctx, kind, doc.ID) : null;
    out.push({
      kind, ref: plainText(a.RefID), state: open ? 'open' : 'done',
      apptDate: plainText(a.ApptDate).slice(0, 10), note: plainText(a.Note),
      unit: {
        AirCode: plainText(unit.AirCode), NodeName: plainText(unit.NodeName), SiteCode: plainText(unit.SiteCode),
        Province: plainText(unit.Province), Brand: plainText(unit.Brand), BTU: plainText(unit.BTU),
        IndoorSN: plainText(unit.IndoorSN), OutdoorSN: plainText(unit.OutdoorSN),
        // อาการที่แจ้งไว้ (ใช้เติมช่องอาการเสียในใบซ่อม) — เฉพาะงานที่ยังเปิด
        Note: open && kind === 'repair' ? plainText(unit.Note) : ''
      },
      doc: doc ? {
        row: doc._row, id: plainText(doc.ID),
        docNo: plainText(doc.DocNo) || plainText(doc.DocNo2) || plainText(doc.ID),
        date: plainText(doc.Date).slice(0, 10),
        waiting: !!(approval && isPending(approval))
      } : null
    });
  }
  return out;
}

/**
 * ซ่อมเอง — Infrastructure ซ่อมเอง หรือใช้ช่างพื้นที่ ไม่ได้ให้ผู้รับเหมา และไม่ต้องออกใบซ่อม (เจ้าของงานขอ)
 *
 * เลือกจากหน้าต่างมอบหมาย → กรอกที่หน้าต่างบันทึกประวัติ → ปิดเคสเหมือนออกใบซ่อมทุกอย่าง
 * (ประวัติ "ซ่อมแล้ว" ผูกเลขเคส · เครื่องกลับเป็นใช้งานปกติ) แต่ไม่มีเอกสาร จึงติดป้ายไว้ในรายละเอียด
 * ให้คนอ่านประวัติรู้ว่างานนี้ไม่มีใบซ่อม · เฉพาะ Infrastructure — เป็นการปิดงานโดยไม่มีหลักฐาน
 * การมอบหมายผู้รับเหมาของเคสนี้ (ถ้ามี) ถูกยกเลิก ผู้รับเหมาจะได้ไม่เห็นเป็นงานที่ตัวเองทำเสร็จ
 */
export async function closeRepairSelf(ctx, record) {
  return ctx.withLock(async () => {
    await ctx.assertAdmin();
    await ctx.ensureBase();
    record = record || {};
    const detail = plainText(record.Detail).trim();
    if (!detail) throw new Error('กรุณากรอกว่าซ่อมอะไรไป');
    if (!plainText(record.Date).trim()) throw new Error('กรุณาระบุวันที่');

    const code = plainText(record.AirCode);
    const ref = openRef(ctx, 'repair', code);   // อ่านก่อนปิดเคส (ปิดแล้วเคสไม่เปิดอยู่)
    // ตรวจสถานะและลงประวัติ — ไม่ผ่านจะ throw ก่อนแตะการมอบหมาย
    await closeRepairCaseRaw(ctx, { ...record, AirCode: code, Detail: SELF_REPAIR_TAG + ' — ' + detail });

    if (ref) {
      const nc = normalizeCode(code);
      const me = await ctx.currentUser();
      for (const a of ctx.ss.objects(SHEETS.ASSIGN)) {
        if (plainText(a.Kind) !== 'repair' || normalizeCode(a.AirCode) !== nc || plainText(a.RefID) !== ref) continue;
        if (!plainText(a.ContractorID)) continue;
        ctx.ss.writeByHeaders(SHEETS.ASSIGN, a._row, {
          ContractorID: '', ApptDate: '', Note: '', AssignedBy: me + ' (ซ่อมเอง)', AssignedAt: ymdhms(new Date())
        });
      }
    }
    await ctx.ss.flush();
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}

/** ป้ายในรายละเอียดประวัติของงานที่ปิดแบบซ่อมเอง (ไม่มีใบซ่อม) */
export const SELF_REPAIR_TAG = 'ซ่อมเอง (ไม่มีเอกสาร)';
