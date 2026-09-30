import { SHEETS } from '../schema.js';
import { normalizeCode, plainText, ymdhms } from '../values.js';
import { unitsInScope } from './airlist.js';
import { writeRepairForm, storeRepairPdf, renderRepairPdf, REPAIR_KIND } from './repairform.js';
import {
  prepareInstall, writeInstallForm, storeInstallPdf, renderInstallPdf, INSTALL_KIND
} from './installform.js';
import { scheduleDocPdf } from './doc-pdf-queue.js';
import { resetApproval } from './approval.js';
import { ASSIGN_KINDS, openRef } from './assign.js';

/**
 * ลิงก์กรอกเอกสารซ่อม / เอกสารติดตั้ง — ส่งให้ใครก็ได้ กรอกได้โดยไม่ต้องมีบัญชี
 *
 * ใช้กับผู้รับเหมาที่ไม่ได้จ้างประจำ (ไม่มีบัญชี) · ผู้รับเหมาประจำใช้การมอบหมายงานแทน (assign.js)
 * ลิงก์ติดตั้งเพิ่มทีหลัง (เจ้าของงานขอ) — ใช้ตารางเดียวกัน แยกด้วยคอลัมน์ Kind
 * ลิงก์เก่าก่อนมีคอลัมน์นี้ Kind ว่าง = ลิงก์ใบซ่อม
 *
 * ============================================================================
 * การทำงานตามที่เจ้าของงานกำหนด
 * ============================================================================
 * 1. เจ้าหน้าที่อนุมัติซ่อมแล้ว (เครื่องสถานะ "รอซ่อม") กดสร้างลิงก์ของงานนั้น
 * 2. ส่งลิงก์ให้ผู้รับเหมาทางไลน์ — คนที่ถือลิงก์เปิดกรอกได้เลย ไม่ต้องล็อกอิน
 * 3. กรอกครบกดส่ง = ปิดงานซ่อมทันที (ลงประวัติ คืนสถานะเครื่อง) ไม่ต้องรอใครอนุมัติ
 *    เพราะเจ้าของงานคุยกันในไลน์อยู่แล้ว
 * 4. หลังส่ง ลิงก์เดิมยังใช้แนบรูปที่ค้างกับโหลด PDF ได้อีกระยะหนึ่ง แล้วปิดตัวเอง
 *
 * ============================================================================
 * ความปลอดภัย — ลิงก์นี้เปิดได้จากทุกที่บนอินเทอร์เน็ต
 * ============================================================================
 * - รหัสในลิงก์สุ่ม 32 ไบต์ (256 บิต) เดาไม่ได้ในทางปฏิบัติ
 * - ฐานข้อมูลเก็บแค่แฮช ไฟล์สำรองหลุดไปก็เอาไปเปิดลิงก์ไม่ได้
 * - ลิงก์หนึ่งผูกกับงานซ่อมงานเดียว เห็นข้อมูลแค่เครื่องนั้น ไม่เห็นอะไรอื่นในระบบ
 * - ส่งได้ครั้งเดียว มีวันหมดอายุ และเจ้าหน้าที่ยกเลิกได้ทุกเมื่อ
 * - ลิงก์ที่ใช้ไม่ได้แล้ว บอกแค่ว่าใช้ไม่ได้ ไม่ส่งข้อมูลเครื่องออกไป
 * - รหัสอยู่หลังเครื่องหมาย # ของที่อยู่ เบราว์เซอร์ไม่ส่งส่วนนี้ไปกับคำขอ
 *   จึงไม่ไปค้างใน log ของเซิร์ฟเวอร์หรือของ proxy ระหว่างทาง
 */

const DAY = 86400000;
const HOUR = 3600000;

/** อายุลิงก์ที่เลือกได้ (วัน) — ค่าเริ่มต้นตัวกลาง */
export const LINK_DAYS = [3, 7, 14];
const DEFAULT_DAYS = 7;

/**
 * หลังส่งแล้ว ลิงก์ยังใช้แนบรูป/โหลด PDF ได้อีกกี่ชั่วโมง อย่างน้อย
 * ถ้าส่งตอนลิงก์ใกล้หมดอายุ จะได้ไม่เหลือเวลาแค่ไม่กี่นาทีให้ส่งรูปที่ค้าง
 */
const AFTER_SUBMIT_HOURS = 72;

/** งานที่สร้างลิงก์ได้ = อนุมัติซ่อมแล้ว (เหมือนปุ่ม "ปิดงาน + ออกเอกสาร") */
const OPEN_STATUS = 'รอซ่อม';

/** ลิงก์นี้ของงานอะไร — ว่าง = ใบซ่อม (ลิงก์ก่อนมีคอลัมน์ Kind) */
const kindOf = link => (plainText(link.Kind).trim() === 'install' ? 'install' : 'repair');

/** งานของลิงก์ยังเปิดอยู่ไหม — ปิดไปทางอื่นแล้ว (เจ้าหน้าที่กรอกเอง) ลิงก์ก็ใช้ไม่ได้ */
function jobStillOpen(ctx, kind, unit) {
  return kind === 'install'
    ? !!openRef(ctx, 'install', unit.AirCode)
    : plainText(unit.Status).trim() === OPEN_STATUS;
}

/**
 * ช่องและคู่เครื่องของเครื่องนี้ในใบติดตั้ง — จากเลขท้ายรหัส (AIR-3 = คู่ 3–4 ช่องที่ 1)
 * กติกาเดียวกับใบล้าง (unitSlotOf) · คนถือลิงก์ไม่มีรายการเครื่องทั้ง Node ให้นับตำแหน่ง
 */
function installSlotOfCode(airCode) {
  const n = Number((/-AIR-(\d+)$/i.exec(plainText(airCode)) || [])[1]) || 1;
  return { slot: ((n - 1) % 2) + 1, base: Math.floor((n - 1) / 2) * 2 };
}

const JOB_CLOSED_MESSAGE = {
  repair: 'งานซ่อมนี้ถูกปิดไปแล้ว — ติดต่อเจ้าหน้าที่ถ้ายังมีงานค้าง',
  install: 'งานติดตั้งนี้กรอกเอกสารไปแล้ว — ติดต่อเจ้าหน้าที่ถ้ายังมีงานค้าง'
};

/* ==================== รหัสในลิงก์ ==================== */

const toB64Url = bytes =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function newToken() {
  return toB64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** รหัสที่ถูกรูปแบบ — กรองของแปลกทิ้งก่อนไปแฮชหรือค้นฐานข้อมูล */
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

/* ==================== สถานะของลิงก์ ==================== */

/** ใช้แนบรูป/โหลด PDF ได้ถึงเมื่อไหร่ หลังส่งแล้ว */
function readableUntil(link) {
  const used = new Date(String(link.UsedAt).replace(' ', 'T') + '+07:00').getTime();
  const after = ymdhms(new Date(used + AFTER_SUBMIT_HOURS * HOUR));
  return String(link.ExpiresAt) > after ? String(link.ExpiresAt) : after;
}

/**
 * สถานะของลิงก์ ณ ตอนนี้
 *   open     ยังไม่ส่ง กรอกได้
 *   done     ส่งแล้ว ยังแนบรูป/โหลด PDF ได้
 *   closed   ส่งแล้ว และพ้นช่วงแนบรูป/โหลด PDF แล้ว
 *   expired  หมดอายุก่อนมีคนส่ง
 *   revoked  เจ้าหน้าที่ยกเลิก (หรือสร้างลิงก์ใหม่แทน)
 */
function stateOf(link, now = ymdhms(new Date())) {
  if (plainText(link.RevokedAt)) return 'revoked';
  if (plainText(link.UsedAt)) return now <= readableUntil(link) ? 'done' : 'closed';
  if (now > String(link.ExpiresAt)) return 'expired';
  return 'open';
}

const STATE_MESSAGE = {
  revoked: 'ลิงก์นี้ถูกยกเลิกแล้ว — ติดต่อเจ้าหน้าที่เพื่อขอลิงก์ใหม่',
  expired: 'ลิงก์นี้หมดอายุแล้ว — ติดต่อเจ้าหน้าที่เพื่อขอลิงก์ใหม่',
  closed: 'งานนี้ส่งเอกสารไปแล้ว และลิงก์ปิดแล้ว — ขอไฟล์เอกสารได้จากเจ้าหน้าที่',
  invalid: 'ลิงก์ไม่ถูกต้อง — ตรวจว่าคัดลอกมาครบ หรือติดต่อเจ้าหน้าที่'
};

/** หาลิงก์จากรหัส — ไม่พบกับรหัสผิดรูปแบบ ตอบเหมือนกัน ไม่บอกว่าผิดตรงไหน */
async function findLink(ctx, token) {
  await ctx.ensureBase();
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const hash = await hashToken(token);
  return ctx.ss.objects(SHEETS.REPAIRLINK).find(l => plainText(l.TokenHash) === hash) || null;
}

/** ลิงก์ที่ต้องอยู่ในสถานะที่กำหนด ไม่งั้นหยุดพร้อมข้อความที่คนถือลิงก์อ่านเข้าใจ */
async function requireLink(ctx, token, wanted) {
  const link = await findLink(ctx, token);
  if (!link) throw new Error(STATE_MESSAGE.invalid);
  const state = stateOf(link);
  if (state !== wanted) {
    throw new Error(STATE_MESSAGE[state] ||
      (state === 'done' ? 'ลิงก์นี้ส่งเอกสารไปแล้ว (เลขที่ ' + plainText(link.DocNo) + ')' : 'ลิงก์นี้ใช้ทำรายการนี้ไม่ได้'));
  }
  return link;
}

function unitByCode(ctx, airCode) {
  const nc = normalizeCode(airCode);
  return ctx.ss.objects(SHEETS.AIRLIST).find(u => normalizeCode(u.AirCode) === nc) || null;
}

/** ผู้บันทึกของใบที่มาจากลิงก์ — ให้ย้อนดูได้ว่ามาจากลิงก์ไหน ใครเป็นคนสร้าง */
const linkRecorder = link => 'ลิงก์ ' + plainText(link.ID) + ' (สร้างโดย ' + plainText(link.CreatedBy) + ')';

/* ==================== สำหรับคนถือลิงก์ (ไม่ต้องล็อกอิน) ==================== */

/**
 * ข้อมูลของงานตามลิงก์ — ใช้วาดหน้ากรอก
 *
 * ลิงก์ที่ใช้ไม่ได้แล้ว คืนแค่สถานะกับข้อความ ไม่คืนข้อมูลเครื่อง
 * ลิงก์ที่ยังไม่ส่งแต่งานถูกปิดไปทางอื่นแล้ว (เจ้าหน้าที่ปิดเอง) ก็ถือว่าใช้ไม่ได้
 */
export async function getRepairLink(ctx, token) {
  const link = await findLink(ctx, token);
  if (!link) return { state: 'invalid', message: STATE_MESSAGE.invalid };

  const state = stateOf(link);
  if (state === 'revoked' || state === 'expired' || state === 'closed') {
    return { state, message: STATE_MESSAGE[state] };
  }

  const unit = unitByCode(ctx, link.AirCode);
  if (!unit) return { state: 'invalid', message: 'ไม่พบเครื่องของงานนี้ในระบบแล้ว — ติดต่อเจ้าหน้าที่' };

  const kind = kindOf(link);
  if (state === 'open' && !jobStillOpen(ctx, kind, unit)) {
    return { state: 'closed', message: JOB_CLOSED_MESSAGE[kind] };
  }

  const out = {
    state,
    kind,
    expiresAt: plainText(link.ExpiresAt),
    unit: {
      AirCode: plainText(unit.AirCode), NodeName: plainText(unit.NodeName),
      SiteCode: plainText(unit.SiteCode), Province: plainText(unit.Province),
      LocationType: plainText(unit.LocationType),
      Brand: plainText(unit.Brand), BTU: plainText(unit.BTU),
      IndoorSN: plainText(unit.IndoorSN), OutdoorSN: plainText(unit.OutdoorSN),
      IndoorAsset: plainText(unit.IndoorAsset), OutdoorAsset: plainText(unit.OutdoorAsset),
      // อาการที่แจ้งไว้ตอนเปิดงาน ใช้เติมช่องอาการเสียให้ (ใบซ่อม)
      Note: state === 'open' && kind === 'repair' ? plainText(unit.Note) : ''
    }
  };
  // ใบติดตั้ง: เครื่องนี้ลงช่องไหนของใบ (หน้าเว็บใช้วางช่องกรอกให้ตรงกับที่เซิร์ฟเวอร์จะเขียน)
  if (kind === 'install') Object.assign(out, installSlotOfCode(unit.AirCode));
  if (state === 'done') {
    out.docNo = plainText(link.DocNo);
    out.photos = ctx.photos ? Object.keys(ctx.photos.readAll(kind === 'install' ? INSTALL_KIND : REPAIR_KIND, out.docNo)) : [];
    out.readableUntil = readableUntil(link);
  }
  return out;
}

/**
 * ส่งเอกสารซ่อมผ่านลิงก์ = ปิดงานซ่อม
 *
 * ตรวจสถานะลิงก์ในล็อก ไม่ใช่ก่อนล็อก — ถ้ากดส่งซ้ำสองครั้งติดกัน
 * (เน็ตช้าแล้วกดอีกที) ครั้งที่สองต้องเห็นว่าลิงก์ถูกใช้ไปแล้ว ไม่ใช่ได้ใบซ้ำ
 */
export async function submitRepairLink(ctx, token, record) {
  record = record || {};
  if (!plainText(record.Date).trim()) throw new Error('กรุณาระบุวันที่ซ่อมเสร็จ');
  if (!plainText(record.Symptom).trim()) throw new Error('กรุณากรอกอาการเสีย');
  if (!plainText(record.Fix).trim()) throw new Error('กรุณากรอกการแก้ไข');

  const saved = await ctx.withLockNoAuth(async () => {
    const link = await requireLink(ctx, token, 'open');
    if (kindOf(link) !== 'repair') throw new Error(STATE_MESSAGE.invalid);

    const unit = unitByCode(ctx, link.AirCode);
    if (!unit) throw new Error('ไม่พบเครื่องของงานนี้ในระบบแล้ว — ติดต่อเจ้าหน้าที่');
    if (plainText(unit.Status).trim() !== OPEN_STATUS) {
      throw new Error('งานซ่อมนี้ถูกปิดไปแล้ว — ติดต่อเจ้าหน้าที่ถ้ายังมีงานค้าง');
    }

    // เครื่องมาจากลิงก์เสมอ ไม่ใช่จากที่ส่งมา — คนถือลิงก์ปิดงานของเครื่องอื่นไม่ได้
    const row = await writeRepairForm(ctx, unit, { ...record, AirCode: unit.AirCode }, linkRecorder(link));

    ctx.ss.writeByHeaders(SHEETS.REPAIRLINK, link._row, { UsedAt: ymdhms(new Date()), DocNo: row.DocNo });
    await ctx.ss.flush();
    return { docNo: row.DocNo };
  });

  await storeRepairPdf(ctx, saved.docNo);
  return saved;
}

/**
 * ส่งเอกสารติดตั้งผ่านลิงก์ = ปิดงานติดตั้งที่รอเอกสาร (ลงเลขเอกสารในแถวประวัติที่รออยู่)
 *
 * ใบหนึ่งมีแค่เครื่องของลิงก์ — เครื่องมาจากลิงก์เสมอ ไม่ใช่จากที่ส่งมา
 * ตรวจสถานะลิงก์ในล็อก (เหตุผลเดียวกับ submitRepairLink)
 */
export async function submitInstallLink(ctx, token, record) {
  record = record || {};
  if (!plainText(record.Date).trim()) throw new Error('กรุณาระบุวันที่ติดตั้ง');

  const saved = await ctx.withLockNoAuth(async () => {
    const link = await requireLink(ctx, token, 'open');
    if (kindOf(link) !== 'install') throw new Error(STATE_MESSAGE.invalid);

    const unit = unitByCode(ctx, link.AirCode);
    if (!unit) throw new Error('ไม่พบเครื่องของงานนี้ในระบบแล้ว — ติดต่อเจ้าหน้าที่');
    if (!jobStillOpen(ctx, 'install', unit)) throw new Error(JOB_CLOSED_MESSAGE.install);

    const { slot, base } = installSlotOfCode(unit.AirCode);
    const rec = {
      ...record,
      AirCode1: slot === 1 ? unit.AirCode : '',
      AirCode2: slot === 2 ? unit.AirCode : '',
      AcceptResult1: slot === 1 ? plainText(record.AcceptResult) : '',
      AcceptResult2: slot === 2 ? plainText(record.AcceptResult) : '',
      SlotBase: base
    };
    // ตัวหาเครื่องรู้แค่เครื่องของลิงก์ — คนถือลิงก์ส่งเครื่องอื่นเข้ามาไม่ได้
    const prep = await prepareInstall(ctx, rec, code => {
      if (normalizeCode(code) !== normalizeCode(unit.AirCode)) throw new Error(STATE_MESSAGE.invalid);
      return unit;
    });
    const row = await writeInstallForm(ctx, rec, prep, linkRecorder(link));
    const docNo = plainText(row.DocNo) || plainText(row.DocNo2) || plainText(row.ID);

    ctx.ss.writeByHeaders(SHEETS.REPAIRLINK, link._row, { UsedAt: ymdhms(new Date()), DocNo: docNo });
    await ctx.ss.flush();
    return { docNo, slot };
  });

  await storeInstallPdf(ctx, saved.docNo);
  return saved;
}

/**
 * แนบรูปหนึ่งช่องของใบที่ส่งผ่านลิงก์แล้ว
 *
 * รูปส่งทีละใบหลังบันทึก (เหมือนในระบบ) เพราะเลขที่เอกสารซึ่งใช้เป็นที่เก็บรูป
 * เพิ่งมีตอนส่ง และถ้าส่งทั้ง 9 รูปก้อนเดียว สัญญาณมือถือหน้างานมักไม่ไหว
 * ใบซ่อมมีเครื่องเดียว (ช่อง 1 เสมอ) · ใบติดตั้งใช้ช่องของเครื่องในลิงก์ (ไม่รับจากที่ส่งมา)
 */
export async function saveRepairLinkPhoto(ctx, token, index, dataUrl) {
  if (!ctx.photos) throw new Error('ระบบที่รันอยู่ตอนนี้ไม่รองรับการเก็บรูป');
  let kind = 'repair';
  const docNo = await ctx.withLockNoAuth(async () => {
    const link = await requireLink(ctx, token, 'done');
    kind = kindOf(link);
    const doc = plainText(link.DocNo);
    const docKind = kind === 'install' ? INSTALL_KIND : REPAIR_KIND;
    const slot = kind === 'install' ? installSlotOfCode(link.AirCode).slot : 1;
    // ตัวเก็บรูปตรวจเลขช่อง 1-9 เอง
    ctx.photos.save(docKind, doc, slot, Number(index), dataUrl);
    // รูปเปลี่ยน = ต้องอนุมัติใหม่ (ดู approval.js)
    const form = kind === 'install'
      ? ctx.ss.objects(SHEETS.INSTALLFORM).find(f => plainText(f.DocNo) === doc || plainText(f.DocNo2) === doc)
      : ctx.ss.objects(SHEETS.REPAIRFORM).find(f => plainText(f.DocNo) === doc);
    if (form && resetApproval(ctx, docKind, form.ID)) await ctx.ss.flush();
    return doc;
  });
  // สร้างไฟล์ PDF ใหม่ให้ตรงกับรูปล่าสุด (หน่วงไว้ รวบรูปหลายใบเป็นรอบเดียว)
  scheduleDocPdf(ctx, docNo, () => (kind === 'install' ? storeInstallPdf(ctx, docNo) : storeRepairPdf(ctx, docNo)));
  return { ok: true, photos: Object.keys(ctx.photos.readAll(kind === 'install' ? INSTALL_KIND : REPAIR_KIND, docNo)) };
}

/** ไฟล์ PDF ของใบที่ส่งผ่านลิงก์แล้ว — สร้างสดทุกครั้ง จะได้มีรูปล่าสุดเสมอ */
export async function getRepairLinkPdf(ctx, token) {
  const link = await requireLink(ctx, token, 'done');
  if (!ctx.pdf) {
    throw new Error('เครื่องที่รันระบบอยู่สร้างไฟล์ PDF ไม่ได้ — เอกสารบันทึกเรียบร้อยแล้ว ขอไฟล์ได้จากเจ้าหน้าที่');
  }
  const docNo = plainText(link.DocNo);
  const install = kindOf(link) === 'install';
  const form = install
    ? ctx.ss.objects(SHEETS.INSTALLFORM).find(f => plainText(f.DocNo) === docNo || plainText(f.DocNo2) === docNo)
    : ctx.ss.objects(SHEETS.REPAIRFORM).find(f => plainText(f.DocNo) === docNo);
  if (!form) throw new Error('ไม่พบเอกสารเลขที่ ' + docNo + ' — อาจถูกลบไปแล้ว ติดต่อเจ้าหน้าที่');

  const { base64, draft } = install ? await renderInstallPdf(ctx, form) : await renderRepairPdf(ctx, form);
  return { fileName: docNo + (draft ? '-รออนุมัติ' : '') + '.pdf', mime: 'application/pdf', base64 };
}

/* ==================== สำหรับเจ้าหน้าที่ ==================== */

/** สิทธิ์จัดการลิงก์ = เจ้าหน้าที่ที่แก้เอกสารแบบนั้นได้ ในขอบเขตของเครื่องนั้น */
async function assertCanManage(ctx, airCode, kind = 'repair') {
  await ctx.assertStaff('จัดการลิงก์' + ASSIGN_KINDS[kind].label);
  await ctx.assertModuleEdit(ASSIGN_KINDS[kind].module);
  const nc = normalizeCode(airCode);
  const unit = (await unitsInScope(ctx)).find(u => normalizeCode(u.AirCode) === nc);
  if (!unit) throw new Error('ไม่พบเครื่องรหัส ' + plainText(airCode) + ' หรือไม่มีสิทธิ์เข้าถึง');
  return unit;
}

/**
 * สร้างลิงก์ของงานซ่อมหนึ่งงาน — คืนรหัสให้ครั้งเดียว (ระบบเก็บแค่แฮช)
 *
 * ลิงก์เก่าของเครื่องเดียวกันที่ยังไม่ได้ใช้ ถูกยกเลิกให้อัตโนมัติ
 * งานหนึ่งจึงมีลิงก์ที่ใช้ได้แค่อันเดียวเสมอ ไม่มีลิงก์เก่าลอยอยู่ในไลน์กลุ่มไหน
 */
export async function createRepairLink(ctx, airCode, days, kind = 'repair') {
  return ctx.withLock(async () => {
    if (!ASSIGN_KINDS[kind]) throw new Error('ไม่รู้จักประเภทงาน ' + plainText(kind));
    await ctx.ensureBase();
    const unit = await assertCanManage(ctx, airCode, kind);
    if (!jobStillOpen(ctx, kind, unit)) {
      throw new Error(kind === 'install'
        ? 'เครื่อง ' + unit.AirCode + ' ไม่มีงานติดตั้งที่รอเอกสาร'
        : 'สร้างลิงก์ได้เฉพาะงานที่อนุมัติซ่อมแล้ว (สถานะ "' + OPEN_STATUS + '")');
    }

    const now = new Date();
    const by = await ctx.currentUser();
    const nc = normalizeCode(unit.AirCode);
    for (const old of ctx.ss.objects(SHEETS.REPAIRLINK)) {
      // งานหนึ่งมีลิงก์ที่ใช้ได้อันเดียว — ยกเลิกเฉพาะลิงก์งานแบบเดียวกันของเครื่องนี้
      if (normalizeCode(old.AirCode) !== nc || kindOf(old) !== kind || stateOf(old) !== 'open') continue;
      ctx.ss.writeByHeaders(SHEETS.REPAIRLINK, old._row, {
        RevokedAt: ymdhms(now), RevokedBy: by + ' (สร้างลิงก์ใหม่แทน)'
      });
    }

    const d = LINK_DAYS.includes(Number(days)) ? Number(days) : DEFAULT_DAYS;
    const token = newToken();
    const link = {
      ID: 'RL' + Date.now(),
      TokenHash: await hashToken(token),
      AirCode: plainText(unit.AirCode),
      CreatedAt: ymdhms(now),
      CreatedBy: by,
      ExpiresAt: ymdhms(new Date(now.getTime() + d * DAY)),
      Kind: kind
    };
    const headers = ctx.ss.headers(SHEETS.REPAIRLINK);
    ctx.ss.appendRow(SHEETS.REPAIRLINK, headers.map(h => (link[h] !== undefined ? link[h] : '')));
    await ctx.ss.flush();

    return {
      id: link.ID, token, airCode: link.AirCode, expiresAt: link.ExpiresAt, kind,
      // ที่อยู่ที่คนอื่นเปิดได้ — หน้าเว็บใช้แทนที่อยู่ของตัวเองเมื่อเปิดระบบด้วย localhost
      // (ดู lanUrl ใน platform/node.js) PUBLIC_URL คือที่อยู่จริงตอนขึ้นคลาวด์ ชนะเสมอ
      publicUrl: String((ctx.env && ctx.env.PUBLIC_URL) || '').replace(/\/+$/, ''),
      lanUrl: String((ctx.env && ctx.env.LAN_URL) || '')
    };
  });
}

/** ลิงก์ทั้งหมดของเครื่องที่อยู่ในขอบเขตของผู้ใช้ (ไม่มีรหัส ไม่มีแฮช) — ใหม่ก่อน */
export async function getRepairLinks(ctx) {
  await ctx.assertStaff('ดูลิงก์งานซ่อม');
  // เห็นลิงก์ของงานแบบที่ตัวเองดูเอกสารได้เท่านั้น
  const kinds = new Set();
  for (const k of Object.keys(ASSIGN_KINDS)) if (await ctx.canView(ASSIGN_KINDS[k].module)) kinds.add(k);
  if (!kinds.size) return [];
  await ctx.ensureBase();

  const scope = new Set((await unitsInScope(ctx)).map(u => normalizeCode(u.AirCode)));
  const now = ymdhms(new Date());
  return ctx.ss.objects(SHEETS.REPAIRLINK)
    .filter(l => scope.has(normalizeCode(l.AirCode)) && kinds.has(kindOf(l)))
    .map(l => ({
      ID: plainText(l.ID), AirCode: plainText(l.AirCode), Kind: kindOf(l),
      CreatedAt: plainText(l.CreatedAt), CreatedBy: plainText(l.CreatedBy),
      ExpiresAt: plainText(l.ExpiresAt), UsedAt: plainText(l.UsedAt), DocNo: plainText(l.DocNo),
      RevokedAt: plainText(l.RevokedAt), RevokedBy: plainText(l.RevokedBy),
      state: stateOf(l, now)
    }))
    .sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt));
}

/** ยกเลิกลิงก์ที่ยังไม่ได้ใช้ — ลิงก์ที่ส่งไปแล้วยกเลิกไม่ได้ (งานปิดไปแล้ว) */
export async function revokeRepairLink(ctx, id) {
  return ctx.withLock(async () => {
    await ctx.ensureBase();
    const link = ctx.ss.objects(SHEETS.REPAIRLINK).find(l => plainText(l.ID) === plainText(id));
    if (!link) throw new Error('ไม่พบลิงก์นี้ กรุณารีเฟรชหน้าจอ');
    await assertCanManage(ctx, link.AirCode, kindOf(link));

    const state = stateOf(link);
    if (state === 'done' || state === 'closed') throw new Error('ลิงก์นี้ส่งเอกสารไปแล้ว ยกเลิกไม่ได้');
    if (state !== 'open') return getRepairLinks(ctx);

    ctx.ss.writeByHeaders(SHEETS.REPAIRLINK, link._row, {
      RevokedAt: ymdhms(new Date()), RevokedBy: await ctx.currentUser()
    });
    await ctx.ss.flush();
    return getRepairLinks(ctx);
  });
}
