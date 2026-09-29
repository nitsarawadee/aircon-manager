import { SHEETS, ROLE_TITLES } from '../schema.js';
import { plainText, ymdhms } from '../values.js';

/**
 * ขั้นอนุมัติเอกสาร (ใบล้าง PM / ใบซ่อม / ใบติดตั้ง)
 *
 * ============================================================================
 * ลำดับขั้น
 * ============================================================================
 *   ขั้น 1  Subcontract    ไม่ต้องกด — ตอนบันทึก ระบบใส่ชื่อบัญชีผู้รับเหมาที่กรอกลงช่อง
 *                          "ผู้ดำเนินการ (บ./หจก.)" ให้เลย (ส่วนใหญ่ผู้รับเหมาเป็นคนกรอกเอง)
 *   ขั้น 2  Staff          → ช่อง "ผู้ควบคุมงาน (Interlink)"
 *   ขั้น 3  Supervisor หรือ Regional (ใครก็ได้ในสองบทบาทนี้) → ช่อง "ผู้ตรวจสอบ"
 *   ขั้น 4  Infrastructure → ช่อง "Approve (Infra)" — ขั้นสุดท้าย
 *
 * อนุมัติทีละขั้นตามลำดับ ข้ามขั้นไม่ได้ ชื่อที่ลงบนเอกสารคือชื่อบัญชีของคนที่กด
 * พร้อมวันที่กด ช่องลงนามทั้งสี่ช่องบนแบบฟอร์มจึงตรงกับสี่ขั้นนี้พอดี
 *
 * ============================================================================
 * PDF ระหว่างรออนุมัติ
 * ============================================================================
 * ยังเปิดดู/โหลดได้ แต่เป็นฉบับร่างที่มีลายน้ำ "รออนุมัติ" และมีชื่อเฉพาะขั้นที่อนุมัติแล้ว
 * (คนอนุมัติต้องเห็นเอกสารก่อนกด) ไฟล์สำเนาบนเซิร์ฟเวอร์เก็บเฉพาะใบที่อนุมัติครบแล้ว
 *
 * ============================================================================
 * เอกสารเปลี่ยน = ต้องอนุมัติใหม่
 * ============================================================================
 * แก้รูป หรือรวมเครื่องที่ 2 เข้าใบเดิม คือเนื้อเอกสารเปลี่ยนไปจากที่คนอนุมัติเห็น
 * ชื่อผู้อนุมัติขั้น 2-4 จึงถูกล้าง แล้วเริ่มใหม่ที่ขั้น 2 (ขั้น 1 คงไว้)
 * ถ้าไม่ล้าง ใบที่ขึ้นชื่อหัวหน้าว่าอนุมัติแล้ว อาจมีรูปที่หัวหน้าไม่เคยเห็น
 *
 * ============================================================================
 * ใบเก่า
 * ============================================================================
 * ใบที่ออกก่อนมีขั้นอนุมัติ และใบที่เขียนมือแล้วแนบรูปกลับมา ไม่มีแถวในตาราง
 * DocApproval = ไม่ต้องอนุมัติ ใช้งานได้เหมือนเดิมทุกอย่าง (เซ็นด้วยมือไปแล้ว)
 */

/** เอกสารแต่ละแบบอยู่ตารางไหน ใช้สิทธิ์ของเมนูไหน */
export const APPROVAL_KINDS = {
  cleaning: { sheet: SHEETS.CLEANFORM, module: 'cleaningform' },
  repair: { sheet: SHEETS.REPAIRFORM, module: 'repairform' },
  install: { sheet: SHEETS.INSTALLFORM, module: 'installform' }
};

/**
 * ขั้นที่ต้องกดอนุมัติ และบทบาท (ค่า roleKey) ที่กดได้
 * ขั้น 1 ไม่อยู่ในนี้ เพราะไม่ต้องกด
 */
export const APPROVAL_STAGES = [
  { stage: 2, roles: ['Staff'] },
  { stage: 3, roles: ['Supervisor', 'RegionAdmin'] },
  { stage: 4, roles: ['Admin'] }
];

export const FINAL_STAGE = 4;

const stageOf = n => APPROVAL_STAGES.find(s => s.stage === n);
const rolesText = n => stageOf(n).roles.map(r => ROLE_TITLES[r]).join(' หรือ ');

/** แถวขั้นอนุมัติของเอกสารใบหนึ่ง — ไม่มี = ใบเก่า ไม่ต้องอนุมัติ */
export function approvalRowOf(ctx, kind, formId) {
  const id = plainText(formId).trim();
  if (!id) return null;
  return ctx.ss.objects(SHEETS.APPROVAL)
    .find(a => plainText(a.DocKind) === kind && plainText(a.FormID) === id) || null;
}

/** ขั้นถัดไปที่รออยู่ — 0 = ไม่ต้องอนุมัติ หรืออนุมัติครบแล้ว */
export function nextStage(row) {
  if (!row) return 0;
  for (const { stage } of APPROVAL_STAGES) {
    if (!plainText(row['S' + stage + 'At'])) return stage;
  }
  return 0;
}

/** ใบนี้ยังรออนุมัติอยู่หรือไม่ (ใบเก่าที่ไม่มีแถว = ไม่รอ) */
export function isPending(row) {
  return nextStage(row) > 0;
}

/** บัญชีนี้กดอนุมัติขั้นนั้นได้หรือไม่ (ไม่รวมเรื่องภูมิภาค — ผู้เรียกตรวจเอง) */
export function canApproveStage(info, stage) {
  const s = stageOf(stage);
  return !!(s && info && s.roles.includes(info.roleKey));
}

/**
 * เริ่มขั้นอนุมัติให้เอกสารที่เพิ่งออก — เรียกในล็อก หลังเขียนแถวเอกสารแล้ว
 *
 * ขั้น 1: ถ้าคนกรอกเป็นบัญชี Subcontract ใส่ชื่อบัญชีนั้นเลย ไม่ต้องกด
 * คนกรอกเป็นเจ้าหน้าที่ หรือกรอกผ่านลิงก์ซ่อม (ไม่มีบัญชี) ปล่อยว่าง
 * แล้วเอกสารจะใช้ชื่อช่างที่กรอกในฟอร์มแทน (เหมือนเดิม)
 */
export async function startApproval(ctx, kind, formId) {
  const info = await ctx.userInfo();
  const isSub = info.role === 'Contractor';
  const row = {
    ID: kind + '|' + plainText(formId),
    DocKind: kind,
    FormID: plainText(formId),
    CreatedAt: ymdhms(new Date()),
    S1Name: isSub ? plainText(info.name || info.username) : '',
    S1By: plainText(info.username)
  };
  const headers = ctx.ss.headers(SHEETS.APPROVAL);
  ctx.ss.appendRow(SHEETS.APPROVAL, headers.map(h => (row[h] !== undefined ? row[h] : '')));
}

/**
 * ล้างชื่อผู้อนุมัติขั้น 2-4 เพราะเนื้อเอกสารเปลี่ยน (ดูหัวไฟล์) — เรียกในล็อก
 * @returns {boolean} มีอะไรถูกล้างหรือไม่ (ผู้เรียกใช้ตัดสินว่าต้อง flush หรือไม่)
 */
export function resetApproval(ctx, kind, formId) {
  const row = approvalRowOf(ctx, kind, formId);
  if (!row || !APPROVAL_STAGES.some(s => plainText(row['S' + s.stage + 'At']))) return false;
  const clear = {};
  for (const { stage } of APPROVAL_STAGES) {
    clear['S' + stage + 'Name'] = '';
    clear['S' + stage + 'By'] = '';
    clear['S' + stage + 'At'] = '';
  }
  clear.S3Role = '';
  ctx.ss.writeByHeaders(SHEETS.APPROVAL, row._row, clear);
  return true;
}

/** ลบแถวขั้นอนุมัติตามเอกสารที่ถูกลบ — เรียกในล็อก ห้ามพัง (เอกสารลบไปแล้ว) */
export async function removeApproval(ctx, kind, formId) {
  try {
    const row = approvalRowOf(ctx, kind, formId);
    if (row) await ctx.ss.deleteRow(SHEETS.APPROVAL, row._row);
  } catch { /* แถวค้างไม่มีผลกับใคร ดีกว่าผู้ใช้เห็นว่าลบไม่สำเร็จ */ }
}

const dateOf = v => plainText(v).slice(0, 10);

/**
 * ชื่อและวันที่ของแต่ละช่องลงนาม สำหรับประกอบเอกสาร
 * @returns {{signers: Object|null, draft: boolean}} ใบเก่า signers = null (เอกสารแสดงแบบเดิม)
 */
export function signOptsOf(ctx, kind, form) {
  const row = approvalRowOf(ctx, kind, form && form.ID);
  if (!row) return { signers: null, draft: false };
  const at = n => ({ name: plainText(row['S' + n + 'Name']), date: dateOf(row['S' + n + 'At']) });
  return {
    signers: { s1: plainText(row.S1Name), s2: at(2), s3: at(3), s4: at(4) },
    draft: isPending(row)
  };
}

/** สถานะขั้นอนุมัติที่ส่งไปหน้าเว็บ ติดไปกับแถวเอกสาร */
function viewOf(row, info) {
  if (!row) return null;
  const next = nextStage(row);
  const at = n => ({ name: plainText(row['S' + n + 'Name']), at: dateOf(row['S' + n + 'At']) });
  return {
    next,
    done: next === 0,
    s1: plainText(row.S1Name),
    s2: at(2), s3: { ...at(3), role: plainText(row.S3Role) }, s4: at(4),
    canApprove: next > 0 && canApproveStage(info, next)
  };
}

/**
 * ติดสถานะขั้นอนุมัติให้ทุกแถวในรายการเอกสาร (รายการกรองตามขอบเขตมาแล้ว)
 * ใบเก่าได้ Approval = null
 */
export async function attachApprovals(ctx, kind, list) {
  const info = await ctx.userInfo();
  const byId = new Map();
  for (const a of ctx.ss.objects(SHEETS.APPROVAL)) {
    if (plainText(a.DocKind) === kind) byId.set(plainText(a.FormID), a);
  }
  for (const f of list) f.Approval = viewOf(byId.get(plainText(f.ID)) || null, info);
  return list;
}

/**
 * กดอนุมัติขั้นถัดไปของเอกสารใบหนึ่ง
 *
 * ตรวจที่เซิร์ฟเวอร์ครบ: ดูเมนูนั้นได้ · เอกสารอยู่ในภูมิภาคของตัวเอง
 * (Subcontract ไม่ผ่านเสมอ) · บทบาทตรงกับขั้นที่รออยู่ · อนุมัติทีละขั้นตามลำดับ
 *
 * อนุมัติขั้นสุดท้ายแล้วจึงเก็บไฟล์ PDF ฉบับจริงไว้บนเซิร์ฟเวอร์ (นอกล็อก)
 *
 * @param {string} kind   'cleaning' | 'repair' | 'install'
 * @param {string} formId ID ของแถวเอกสาร (ไม่ใช้เลขแถว เพราะเลื่อนได้เมื่อมีคนลบใบอื่น)
 */
export async function approveDoc(ctx, kind, formId) {
  const spec = APPROVAL_KINDS[kind];
  if (!spec) throw new Error('ไม่รู้จักประเภทเอกสาร "' + plainText(kind) + '"');
  const id = plainText(formId).trim();

  const out = await ctx.withLock(async () => {
    await ctx.ensureBase();
    if (!(await ctx.canView(spec.module))) throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');

    const form = ctx.ss.objects(spec.sheet).find(f => plainText(f.ID) === id);
    if (!form) throw new Error('ไม่พบเอกสารใบนี้ (อาจถูกลบไปแล้ว)');
    await ctx.assertRegionAccess(form.Region);

    const row = approvalRowOf(ctx, kind, id);
    if (!row) throw new Error('เอกสารใบนี้ออกก่อนมีขั้นอนุมัติ ไม่ต้องอนุมัติ');
    const next = nextStage(row);
    if (!next) throw new Error('เอกสารใบนี้อนุมัติครบทุกขั้นแล้ว');

    const info = await ctx.userInfo();
    if (!canApproveStage(info, next)) {
      throw new Error('ใบนี้รออนุมัติขั้น ' + next + ' ซึ่งต้องเป็นบทบาท ' + rolesText(next) +
        ' (บัญชีของคุณเป็น ' + (info.title || info.role) + ')');
    }

    const patch = {
      ['S' + next + 'Name']: plainText(info.name || info.username),
      ['S' + next + 'By']: plainText(info.username),
      ['S' + next + 'At']: ymdhms(new Date())
    };
    if (next === 3) patch.S3Role = info.roleKey;
    ctx.ss.writeByHeaders(SHEETS.APPROVAL, row._row, patch);
    await ctx.ss.flush();

    const fresh = approvalRowOf(ctx, kind, id);
    return { form, approval: viewOf(fresh, info), done: next === FINAL_STAGE };
  });

  // ครบทุกขั้นแล้ว เก็บฉบับจริงไว้บนเซิร์ฟเวอร์ (ห้ามพัง — ตัวเก็บไฟล์จัดการเอง)
  if (out.done) await storeFinalPdf(ctx, kind, out.form);
  return { approval: out.approval };
}

/** เลขที่ที่ใช้เป็นชื่อไฟล์ของเอกสาร — กติกาเดียวกับที่แต่ละโมดูลใช้เก็บไฟล์ */
const fileKeyOf = (kind, form) => kind === 'install'
  ? plainText(form.DocNo) || plainText(form.DocNo2) || plainText(form.ID)
  : plainText(form.DocNo) || plainText(form.ID);

async function storeFinalPdf(ctx, kind, form) {
  const key = fileKeyOf(kind, form);
  if (kind === 'cleaning') return (await import('./cleaningform.js')).storeCleaningPdf(ctx, key);
  if (kind === 'repair') return (await import('./repairform.js')).storeRepairPdf(ctx, key);
  return (await import('./installform.js')).storeInstallPdf(ctx, key);
}
