import { SHEETS, cleanFormColKind } from '../schema.js';
import { cleanFormValue, normalizeCode, plainText, ymdhms } from '../values.js';
import { addHistoryRaw, makeHistoryId, newestFirst, usedDocNumbers } from './history.js';
import { unitsInScope } from './airlist.js';
import { ensureCaseId } from './repair-case.js';
import { assertOwnAssigned, isOwnDoc } from './assign.js';
import { scheduleDocPdf, cancelDocPdf, settleDocPdfQueue } from './doc-pdf-queue.js';
import {
  startApproval, resetApproval, removeApproval, signOptsOf, attachApprovals, approvalRowOf, isPending, freshFormId
} from './approval.js';

/**
 * เอกสารบันทึกผลการซ่อม ตามแบบฟอร์มควบคุม ITEL-FM-NE-005
 *
 * ============================================================================
 * ต่างจากใบล้างตรงไหน
 * ============================================================================
 * ใบซ่อมมีเครื่องเดียวทั้งใบ จึงไม่มีเรื่องรวมใบ ไม่มีเลขที่ใบละสองเลข
 * และไม่ต้องยึดตำแหน่งคอลัมน์ของเครื่อง — ง่ายกว่าใบล้างมาก
 *
 * ============================================================================
 * ผูกกับเคสงานซ่อมที่มีอยู่แล้ว
 * ============================================================================
 * ระบบมีเคสงานซ่อมอยู่ก่อนแล้ว (กลุ่มใบประวัติที่ใช้ CaseID เดียวกัน ดู repair-case.js)
 * เอกสารใบนี้จึงไม่ได้ลอยอยู่เดี่ยวๆ แต่เกาะกับเคสที่เปิดค้างอยู่ของเครื่องนั้น
 * บันทึกเอกสารแล้วจะลงประวัติ "ซ่อมแล้ว" ให้เอง ซึ่งเป็นตัวปิดเคสตามกติกาเดิม
 *
 * ถ้าเครื่องนั้นไม่มีเคสเปิดอยู่ ก็ยังบันทึกได้ แล้วเปิดเคสใหม่ให้ — เพราะช่างที่
 * ซ่อมหน้างานเลยโดยไม่ได้แจ้งล่วงหน้าเป็นเรื่องที่เกิดจริง
 */

const DOC_ASSETS = { fontHref: '/vendor/fonts.css', logoHref: '/assets/form-logo.png' };

/**
 * ชนิดเอกสารของโมดูลนี้ — ใช้บอกที่เก็บว่าไฟล์ของใบซ่อมไปอยู่โฟลเดอร์ไหน
 * ไฟล์ PDF ไปที่ data/docs/repair/ และรูปไปที่ data/photos/repair/
 */
const KIND = 'repair';
export { KIND as REPAIR_KIND };

/** ประเภทเหตุการณ์ที่ใบนี้ลงในประวัติ — ตัวเดียวกับที่ปุ่มปิดงานซ่อมเดิมใช้ */
const CLOSE_EVENT = 'ซ่อมแล้ว';

export { settleDocPdfQueue };

/* ==================== อ่านรายการ ==================== */

/** แปลงแถวให้ส่งกลับหน้าเว็บได้ ตัดก้อน JSON ที่ตารางไม่ได้ใช้ออกเพื่อให้ response เบา */
const toSafe = (o, keepJson) => {
  const safe = { _row: o._row };
  for (const k of Object.keys(o)) {
    if (k === '_row') continue;
    if (!keepJson && (k === 'ChecklistJSON' || k === 'PartsJSON')) continue;
    safe[k] = cleanFormValue(o[k], cleanFormColKind(k));
  }
  return safe;
};

export async function getRepairForms(ctx, airCode) {
  await ctx.requireAccess();
  if (!(await ctx.canView('repairform'))) return [];
  await ctx.ensureBase();

  let list = ctx.ss.objects(SHEETS.REPAIRFORM).map(o => toSafe(o, false));

  if (airCode) {
    const nc = normalizeCode(airCode);
    list = list.filter(o => normalizeCode(o.AirCode) === nc);
  }

  // กรองตามขอบเขตของผู้ใช้เหมือนทุกหน้า
  list = list.filter(await ctx.scopeFilter());
  // ผู้รับเหมา: เฉพาะใบที่ตัวเองกรอก (ดู isOwnDoc)
  const info = await ctx.userInfo();
  if (info.role === 'Contractor') list = list.filter(f => isOwnDoc(info, f));

  // เรียงที่หน้าเว็บไม่ได้ เพราะ _row ต้องติดไปกับข้อมูล — เรียงตรงนี้หลังแปลงแล้ว
  return attachApprovals(ctx, KIND, list.sort(newestFirst('CreatedAt')));
}

/** เปิด/แก้รูปใบนี้ได้ไหม — เจ้าหน้าที่ตามภูมิภาค · ผู้รับเหมาเฉพาะใบที่ตัวเองกรอก */
async function assertDocAccess(ctx, form) {
  const info = await ctx.userInfo();
  if (info.role === 'Contractor') {
    if (!isOwnDoc(info, form)) throw new Error('คุณไม่มีสิทธิ์เข้าถึงเอกสารใบนี้');
    return;
  }
  await ctx.assertRegionAccess(form.Region);
}

/* ==================== บันทึก ==================== */

/** ออกเลขที่เอกสารของใบซ่อม ใช้ชุดเลขเดียวกับทั้งระบบ (ขึ้นต้น CM) */
function nextDocNo(ctx, date) {
  return makeHistoryId(CLOSE_EVENT, date, usedDocNumbers(ctx));
}

/** ข้อมูลเครื่องจากทะเบียน เอาไว้เติมช่องที่หน้าเว็บไม่ได้ส่งมา */
async function unitOf(ctx, airCode) {
  const nc = normalizeCode(airCode);
  const found = (await unitsInScope(ctx)).find(u => normalizeCode(u.AirCode) === nc);
  if (!found) throw new Error('ไม่พบเครื่องรหัส ' + plainText(airCode) + ' ในทะเบียนเครื่อง');
  return found;
}

/**
 * บันทึกเอกสารซ่อมหนึ่งใบ
 *
 * ต่างจากใบล้างตรงที่ไม่มีการรวมใบ — ซ่อมสองครั้งคือสองใบเสมอ แม้เครื่องเดียวกัน
 * วันเดียวกัน เพราะเป็นคนละเหตุการณ์ ไม่ใช่งานเดียวที่ทำต่อเนื่องกัน
 */
export async function saveRepairForm(ctx, record) {
  await ctx.assertModuleEdit('repairform');

  if (!plainText(record.AirCode).trim()) throw new Error('กรุณาเลือกเครื่องปรับอากาศ');
  if (!plainText(record.Date).trim()) throw new Error('กรุณาระบุวันที่ดำเนินการ');

  const unit = await unitOf(ctx, record.AirCode);
  const info = await ctx.userInfo();
  // ผู้รับเหมาไม่มีภูมิภาค — ตรวจว่างานนี้มอบหมายให้เจ้านี้แทน (ในล็อก ด้านล่าง)
  if (info.role !== 'Contractor') await ctx.assertRegionAccess(unit.Region);

  const saved = await ctx.withLock(async () => {
    await ctx.ensureBase();
    assertOwnAssigned(ctx, info, 'repair', unit.AirCode);
    // ผู้รับเหมา: ชื่อบริษัทใช้ชื่อที่ Admin ตั้งไว้ ไม่ให้พิมพ์เอง (กติกาเดียวกับใบล้าง/ใบติดตั้ง)
    if (info.role === 'Contractor') record = { ...record, CompanyName: info.contractorName };
    const row = await writeRepairForm(ctx, unit, record, await ctx.currentUser());
    await ctx.ss.flush();
    return { docNo: row.DocNo, caseId: row.CaseID, forms: await getRepairForms(ctx) };
  });

  // เก็บสำเนา PDF ไว้บนเซิร์ฟเวอร์ (นอกล็อก เพราะต้องรอเบราว์เซอร์แปลงไฟล์)
  await storeRepairPdf(ctx, saved.docNo);
  return saved;
}

/**
 * เขียนเอกสารซ่อมหนึ่งใบ + ลงประวัติ "ซ่อมแล้ว" + คืนสถานะเครื่อง (ยังไม่ flush)
 *
 * แยกออกมาให้ทั้งการกรอกในระบบ (saveRepairForm) และการกรอกผ่านลิงก์ (repairlink.js)
 * ใช้ตัวเดียวกัน ถ้าลิงก์เขียนเอง วันหนึ่งสองทางจะปิดงานไม่เหมือนกัน
 * เช่นทางหนึ่งลืมคืนสถานะเครื่อง แล้วเครื่องค้างเป็น "รอซ่อม" ตลอดไป
 *
 * ⚠️ ไม่ตรวจสิทธิ์เอง ผู้เรียกต้องตรวจก่อน และต้องเรียกในล็อก หลัง ensureBase
 *
 * @param {Object} unit        แถวเครื่องจากทะเบียน
 * @param {string} recordedBy  ผู้บันทึก (ชื่อผู้ใช้ หรือคำอธิบายลิงก์)
 * @returns {Promise<Object>}  แถวที่เขียนลงไป (มี DocNo, CaseID)
 */
export async function writeRepairForm(ctx, unit, record, recordedBy) {
  // อาการที่แจ้งไว้ตอนเปิดเคส — เก็บไว้ก่อน เพราะจะถูกล้างออกจากข้อมูลเครื่องตอนปิดงาน
  // ไม่พึ่งข้อความที่หน้าเว็บส่งมา เพราะคนกรอกลบทิ้งได้ ถ้าไม่ดักตรงนี้
  // อาการเสียที่แจ้งไว้จะหายไปจากระบบทั้งหมดโดยไม่มีใครรู้
  const reported = plainText(unit.Note).trim();

  const row = {
    ID: freshFormId(ctx, SHEETS.REPAIRFORM, 'RF'),
    Date: plainText(record.Date),
    NodeName: unit.NodeName,
    SiteCode: unit.SiteCode,
    Region: unit.Region,
    Province: unit.Province,
    LocationType: unit.LocationType,
    AirCode: unit.AirCode,
    Brand: unit.Brand,
    BTU: unit.BTU,
    // ⚠️ ทะเบียนเครื่องเก็บชื่อคอลัมน์ว่า IndoorSN/OutdoorSN แต่แบบฟอร์มเขียนว่า Serial
    // ต้องแปลงชื่อตรงนี้ ไม่งั้นช่อง Serial บนเอกสารจะว่างทั้งที่ทะเบียนมีข้อมูลอยู่
    IndoorSerial: plainText(unit.IndoorSN),
    IndoorAsset: plainText(unit.IndoorAsset),
    OutdoorSerial: plainText(unit.OutdoorSN),
    OutdoorAsset: plainText(unit.OutdoorAsset),
    Symptom: plainText(record.Symptom),
    Cause: plainText(record.Cause),
    Fix: plainText(record.Fix),
    ChecklistJSON: JSON.stringify(record.Checklist || []),
    PartsJSON: JSON.stringify(record.Parts || []),
    Suggestion: plainText(record.Suggestion),
    CompanyName: plainText(record.CompanyName),
    TechnicianName: plainText(record.TechnicianName),
    SupervisorName: plainText(record.SupervisorName),
    Cost: record.Cost === '' || record.Cost === undefined ? '' : Number(record.Cost) || '',
    CreatedAt: ymdhms(new Date()),
    RecordedBy: recordedBy,
    // ออกเลขในล็อกเสมอ เพื่อไม่ให้สองคนที่บันทึกพร้อมกันได้เลขเดียวกัน
    DocNo: nextDocNo(ctx, record.Date),
    // เกาะเคสที่เปิดค้างอยู่ของเครื่องนี้ ไม่มีก็เปิดเคสใหม่ให้
    CaseID: ensureCaseId(ctx.ss.objects(SHEETS.HISTORY), unit.AirCode)
  };

  const headers = ctx.ss.headers(SHEETS.REPAIRFORM);
  ctx.ss.appendRow(SHEETS.REPAIRFORM, headers.map(h => (row[h] !== undefined ? row[h] : '')));
  // ทั้งกรอกในระบบและกรอกผ่านลิงก์ต้องผ่านขั้นอนุมัติเหมือนกัน (ดู approval.js)
  await startApproval(ctx, KIND, row.ID);

  // ลงประวัติ "ซ่อมแล้ว" ซึ่งเป็นตัวปิดเคสตามกติกาเดิมของระบบ
  //
  // อาการที่แจ้งไว้ตอนเปิดเคสต้องติดไปในประวัติด้วย เพราะกำลังจะถูกล้าง
  // ออกจากข้อมูลเครื่อง ถ้าไม่เก็บไว้ที่นี่ก็หายไปจากระบบทั้งหมด
  const symptom = plainText(row.Symptom).trim();
  const detail = [reported && !symptom.includes(reported) ? 'อาการที่แจ้งไว้: ' + reported : '',
                  [symptom, plainText(row.Fix).trim()].filter(Boolean).join(' → ')]
    .filter(Boolean).join(' — ') || 'ซ่อมตามเอกสาร ' + row.DocNo;

  await addHistoryRaw(ctx, {
    AirCode: row.AirCode,
    Date: row.Date,
    EventType: CLOSE_EVENT,
    Detail: detail,
    Cost: row.Cost,
    Technician: row.TechnicianName,
    Note: 'เอกสาร ' + row.DocNo,
    CaseID: row.CaseID,
    RecordedBy: recordedBy
  });

  // ============================================================================
  // ปิดงานจริง — คืนสถานะเครื่องและล้างอาการเสียที่ค้างอยู่
  // ============================================================================
  // ขาดขั้นตอนนี้ไปไม่ได้ เพราะตอนนี้การออกเอกสารเป็นทางเดียวที่ปิดงานซ่อมได้
  // (เจ้าของงานให้เอาปุ่ม "ปิดงานอย่างเดียว" ออก) ถ้าไม่คืนสถานะ เครื่องจะค้าง
  // เป็น "รอซ่อม" ตลอดไป และขึ้นอยู่ในหน้างานซ่อมทั้งที่ซ่อมเสร็จแล้ว
  //
  // ล้าง Note ด้วย ไม่งั้นเครื่องที่ซ่อมเสร็จจะยังโชว์อาการเดิมค้างอยู่
  // ตัวอาการไม่หายไปไหน ย้ายไปอยู่ในประวัติของงานซ่อมใบนี้แทน
  //
  // เครื่องที่ไม่ได้อยู่ในสถานะงานซ่อม (เช่นช่างซ่อมหน้างานเลยโดยไม่ได้แจ้ง)
  // ไม่ต้องแตะสถานะ เพราะมันใช้งานปกติอยู่แล้ว
  const airRow = ctx.ss.objects(SHEETS.AIRLIST).find(a => normalizeCode(a.AirCode) === normalizeCode(unit.AirCode));
  if (airRow && ['รอซ่อม', 'ชำรุด'].includes(plainText(airRow.Status).trim())) {
    ctx.ss.writeByHeaders(SHEETS.AIRLIST, airRow._row, {
      Status: 'ใช้งานปกติ',
      Note: '',
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: row.RecordedBy
    });
  }

  return row;
}

/* ==================== ลบ ==================== */

export async function deleteRepairForm(ctx, row, expectId) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('repairform');
    await ctx.ensureBase();

    // เลขแถวคือ "ลำดับที่เท่าไหร่ในตาราง" ไม่ใช่ id ถาวร มีคนลบใบข้างบนไป
    // ระหว่างที่อีกคนเปิดหน้าค้างไว้ คำสั่งนี้จะไปโดนเอกสารใบถัดไปแทน
    ctx.assertRowIs(SHEETS.REPAIRFORM, row, 'ID', expectId, 'เอกสารเลขที่');

    const headers = ctx.ss.headers(SHEETS.REPAIRFORM);
    const region = ctx.ss.cell(SHEETS.REPAIRFORM, row, headers.indexOf('Region') + 1);
    await ctx.assertRegionAccess(region);

    // จำเลขที่ไว้ก่อนลบแถว เพื่อตามไปลบรูปและไฟล์ของใบนี้ด้วย
    const docNo = plainText(ctx.ss.cell(SHEETS.REPAIRFORM, row, headers.indexOf('DocNo') + 1)) ||
                  plainText(ctx.ss.cell(SHEETS.REPAIRFORM, row, headers.indexOf('ID') + 1));
    const formId = plainText(ctx.ss.cell(SHEETS.REPAIRFORM, row, headers.indexOf('ID') + 1));

    await ctx.ss.deleteRow(SHEETS.REPAIRFORM, row);
    await removeApproval(ctx, KIND, formId);
    await ctx.ss.flush();

    // ลบไฟล์หลังลบแถวสำเร็จแล้วเท่านั้น และห้ามให้การลบไฟล์ล้มแล้วทำให้ทั้งคำสั่งพัง
    if (ctx.photos && docNo) {
      try { ctx.photos.removeAll(KIND, docNo); } catch { /* รูปค้างดีกว่าผู้ใช้สับสน */ }
    }
    if (ctx.docs && docNo) {
      // ยกเลิกงานสร้างไฟล์ที่ค้างอยู่ก่อน ไม่งั้นไฟล์จะถูกสร้างกลับมาหลังลบไปแล้ว
      cancelDocPdf(docNo);
      try { ctx.docs.remove(KIND, docNo); } catch { /* ไฟล์ค้างดีกว่าผู้ใช้สับสน */ }
    }

    return getRepairForms(ctx);
  });
}

/* ==================== รูปถ่าย ==================== */

/** หาใบเอกสารจากเลขแถว พร้อมตรวจสิทธิ์ภูมิภาค */
async function formForPhotos(ctx, row) {
  await ctx.ensureBase();
  const form = ctx.ss.objects(SHEETS.REPAIRFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await assertDocAccess(ctx, form);

  const docNo = plainText(form.DocNo) || plainText(form.ID);
  if (!docNo) throw new Error('เอกสารใบนี้ยังไม่มีเลขที่ จึงเก็บรูปไม่ได้');
  return { form, docNo };
}

function requirePhotoStore(ctx) {
  if (!ctx.photos) throw new Error('ระบบที่รันอยู่ตอนนี้ไม่รองรับการเก็บรูป (ไม่มีที่เก็บไฟล์)');
  return ctx.photos;
}

/** รอผลของงานที่แก้รูป แล้วนัดสร้างไฟล์ PDF ใหม่ให้ตรงกับรูปล่าสุด */
async function withFreshPdf(ctx, work) {
  const { docNo, ...out } = await work;
  scheduleDocPdf(ctx, docNo, () => storeRepairPdf(ctx, docNo));
  return out;
}

export async function saveRepairPhoto(ctx, payload) {
  return withFreshPdf(ctx, ctx.withLock(async () => {
    await ctx.assertModuleEdit('repairform');
    const store = requirePhotoStore(ctx);

    const { form, docNo } = await formForPhotos(ctx, payload && payload.row);
    // ใบซ่อมมีเครื่องเดียว รูปจึงอยู่ช่องของเครื่องที่ 1 เสมอ
    const saved = store.save(KIND, docNo, 1, payload.index, payload.dataUrl);
    // รูปเปลี่ยน = ต้องอนุมัติใหม่ (ดู approval.js)
    if (resetApproval(ctx, KIND, form.ID)) await ctx.ss.flush();
    return { ok: true, docNo, bytes: saved.bytes, photos: Object.keys(store.readAll(KIND, docNo)) };
  }));
}

export async function deleteRepairPhoto(ctx, payload) {
  return withFreshPdf(ctx, ctx.withLock(async () => {
    await ctx.assertModuleEdit('repairform');
    const store = requirePhotoStore(ctx);

    const { form, docNo } = await formForPhotos(ctx, payload && payload.row);
    store.remove(KIND, docNo, 1, Number(payload.index));
    if (resetApproval(ctx, KIND, form.ID)) await ctx.ss.flush();
    return { ok: true, docNo, photos: Object.keys(store.readAll(KIND, docNo)) };
  }));
}

/** รูปทั้งหมดของใบหนึ่ง พร้อมตัวรูปจริง สำหรับหน้าแก้รูป */
export async function getRepairPhotos(ctx, row) {
  await ctx.requireAccess();
  if (!(await ctx.canView('repairform'))) return {};
  if (!ctx.photos) return {};

  const { docNo } = await formForPhotos(ctx, row);
  return { docNo, photos: ctx.photos.readAll(KIND, docNo) };
}

/* ==================== เอกสาร ==================== */

/** หน้าเอกสารสำหรับเปิดดูและสั่งปริ้น */
export async function getRepairDocHtml(ctx, row) {
  await ctx.requireAccess();
  if (!(await ctx.canView('repairform'))) throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');
  await ctx.ensureBase();

  const form = ctx.ss.objects(SHEETS.REPAIRFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await assertDocAccess(ctx, form);

  const { buildRepairDocHtml } = await import('./repair-doc.js');
  const docNo = plainText(form.DocNo) || plainText(form.ID);
  const photos = ctx.photos ? ctx.photos.readAll(KIND, docNo) : {};
  // toolbar ใส่เฉพาะตอนเปิดดูบนจอ ตอนแปลงเป็นไฟล์ PDF ไม่ใส่
  return buildRepairDocHtml(form, { ...DOC_ASSETS, photos, toolbar: true, ...signOptsOf(ctx, KIND, form) });
}

/** ฟอร์มเปล่าสำหรับปริ้นไปเขียนมือหน้างาน */
export async function getRepairBlankDocHtml(ctx, record) {
  await ctx.requireAccess();
  if (!(await ctx.canView('repairform'))) throw new Error('ไม่มีสิทธิ์เข้าถึงเมนูนี้');

  const payload = { ...(record || {}) };
  payload.DocNo = '(ฟอร์มเปล่า — ยังไม่ได้บันทึก)';
  payload.ChecklistJSON = JSON.stringify(payload.Checklist || []);
  payload.PartsJSON = JSON.stringify(payload.Parts || []);

  const { buildRepairDocHtml } = await import('./repair-doc.js');
  return buildRepairDocHtml(payload, DOC_ASSETS);
}

/**
 * แปลงก้อนไบต์เป็นข้อความ base64
 *
 * ทำทีละ 8KB ไม่ใช่ส่งทั้งก้อนเข้า String.fromCharCode ทีเดียว เพราะการกระจาย
 * อาร์เรย์เป็นพารามิเตอร์หลักหมื่นตัวทำให้ call stack ล้นบนเครื่องบางเครื่อง
 * ไฟล์ฟอร์มตอนนี้ราว 35KB ยังไม่ถึงขีด แต่ฟอร์มติดตั้งที่จะทำต่อใหญ่กว่านี้
 */
function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(out);
}

/**
 * ฟอร์มเปล่าแบบ Excel ที่เติมข้อมูลเครื่องให้แล้ว
 *
 * มีไว้คู่กับฟอร์มเปล่าแบบปริ้น ต่างกันตรงที่ไฟล์นี้ "วางรูปลงไปได้"
 * เพราะกระดาษกับไฟล์ PDF แนบรูปไม่ได้ ช่างที่กรอกบนคอมพิวเตอร์จึงใช้ไฟล์นี้
 * แล้ววางรูปลงกรอบในชีต "รูปภาพประกอบ" ได้เลย
 */
export async function getRepairBlankXlsx(ctx, record) {
  await ctx.requireAccess();
  if (!(await ctx.canView('repairform'))) throw new Error('ไม่มีสิทธิ์เข้าถึงเมนูนี้');
  if (!ctx.forms) throw new Error('เครื่องที่รันระบบอยู่ไม่มีไฟล์แบบฟอร์มแม่แบบ');

  const { buildRepairXlsx, repairXlsxFileName } = await import('./repair-xlsx.js');
  const bytes = await buildRepairXlsx(ctx.forms.read('repair'), record || {});

  return {
    base64: toBase64(bytes),
    fileName: repairXlsxFileName(record),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
}

/** แปลงใบหนึ่งเป็นไฟล์ PDF (ยังไม่เก็บ ยังไม่ส่งให้ใคร) */
export async function renderRepairPdf(ctx, form) {
  const docNo = plainText(form.DocNo) || plainText(form.ID);
  // ชื่อผู้อนุมัติในช่องลงนาม + ลายน้ำ "รออนุมัติ" ถ้ายังไม่ครบ
  const sign = signOptsOf(ctx, KIND, form);
  const base = ctx.pdf.baseUrl || '';

  const { buildRepairDocHtml } = await import('./repair-doc.js');
  const html = buildRepairDocHtml(form, {
    // ที่อยู่เต็ม เพราะเบราว์เซอร์เปิดหน้านี้จากไฟล์ชั่วคราว ไม่ได้เปิดผ่านเซิร์ฟเวอร์
    fontHref: base + DOC_ASSETS.fontHref,
    logoHref: base + DOC_ASSETS.logoHref,
    photos: ctx.photos ? ctx.photos.readAll(KIND, docNo) : {},
    ...sign
  });

  return { docNo, draft: sign.draft, base64: await ctx.pdf.render(html) };
}

/**
 * เก็บสำเนา PDF ไว้บนเซิร์ฟเวอร์ — ห้ามพัง
 *
 * ตัวจริงของข้อมูลอยู่ในฐานข้อมูล ไฟล์นี้เป็นสำเนาที่สร้างใหม่ได้เสมอ
 * ถ้าเครื่องไม่มีเบราว์เซอร์ หรือดิสก์เต็ม ต้องไม่ทำให้การบันทึกที่ลงไปแล้ว
 * กลายเป็น "ล้มเหลว" ในสายตาผู้ใช้ แล้วเขากดบันทึกซ้ำจนข้อมูลซ้ำ
 */
export async function storeRepairPdf(ctx, docNo) {
  const name = plainText(docNo).trim();
  if (!ctx.pdf || !ctx.docs || !name) return false;

  try {
    const form = ctx.ss.objects(SHEETS.REPAIRFORM)
      .find(f => (plainText(f.DocNo) || plainText(f.ID)) === name);
    if (!form) return false;

    // ยังรออนุมัติ = ไม่เก็บสำเนา (สำเนาบนเซิร์ฟเวอร์มีเฉพาะฉบับที่อนุมัติครบ ดู approval.js)
    // ลบฉบับเดิมทิ้งด้วย — ใบที่เคยอนุมัติครบแล้วถูกแก้รูป ต้องไม่เหลือไฟล์เก่าที่ขึ้นชื่อผู้อนุมัติ
    if (isPending(approvalRowOf(ctx, KIND, form.ID))) {
      try { ctx.docs.remove(KIND, name); } catch { /* ไม่มีไฟล์เดิมก็ไม่เป็นไร */ }
      return false;
    }

    const { base64 } = await renderRepairPdf(ctx, form);
    ctx.docs.save(KIND, name, plainText(form.Date), base64);
    return true;
  } catch (err) {
    console.error('[เก็บไฟล์ PDF ซ่อม ' + name + ']', err && err.message ? err.message : err);
    return false;
  }
}

/** แปลงเป็นไฟล์ PDF ให้ดาวน์โหลด และเก็บสำเนาไว้บนเซิร์ฟเวอร์ไปด้วย */
export async function getRepairDocPdf(ctx, row, expectId) {
  await ctx.requireAccess();
  if (!(await ctx.canView('repairform'))) throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');
  if (!ctx.pdf) {
    throw new Error(
      'เครื่องที่รันระบบอยู่ไม่มีเบราว์เซอร์สำหรับแปลงเป็นไฟล์ PDF — ' +
      'กด "เปิดเอกสาร" แล้วสั่งปริ้นเองได้ผลเหมือนกัน'
    );
  }

  await ctx.ensureBase();

  // ตรวจว่าแถวนั้นยังเป็นใบเดิมอยู่จริง ก่อนสร้างไฟล์
  ctx.assertRowIs(SHEETS.REPAIRFORM, row, 'ID', expectId, 'เอกสารเลขที่');

  const form = ctx.ss.objects(SHEETS.REPAIRFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await assertDocAccess(ctx, form);

  const { docNo, base64, draft } = await renderRepairPdf(ctx, form);

  // ฉบับร่าง (ยังรออนุมัติ) ไม่เก็บ — สำเนาบนเซิร์ฟเวอร์มีเฉพาะฉบับจริง
  if (ctx.docs && !draft) {
    try { ctx.docs.save(KIND, docNo, plainText(form.Date), base64); }
    catch (err) { console.error('[เก็บไฟล์ PDF ซ่อม ' + docNo + ']', err && err.message ? err.message : err); }
  }

  return { fileName: docNo + (draft ? '-รออนุมัติ' : '') + '.pdf', mime: 'application/pdf', base64 };
}
