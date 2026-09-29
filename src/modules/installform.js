import { SHEETS, cleanFormColKind, INSTALL_PENDING_NOTE } from '../schema.js';
import { cleanFormValue, normalizeCode, normalizeSiteCode, plainText, ymdhms } from '../values.js';
import { addHistoryRaw, getHistory, makeHistoryId, newestFirst, usedDocNumbers } from './history.js';
import { unitsInScope, addNewAirUnitRaw, getAirList } from './airlist.js';
import { scheduleDocPdf, cancelDocPdf, settleDocPdfQueue } from './doc-pdf-queue.js';
import {
  startApproval, resetApproval, removeApproval, signOptsOf, attachApprovals, approvalRowOf, isPending, freshFormId
} from './approval.js';

/**
 * เอกสารบันทึกผลการติดตั้ง ตามแบบฟอร์มควบคุม ITEL-FM-NE-006
 *
 * ============================================================================
 * ต่างจากใบล้างและใบซ่อมตรงไหน
 * ============================================================================
 * โครงเหมือนใบล้าง — สองเครื่องต่อใบ เลขที่เอกสารใบละสองเลข หน้ารูปเครื่องละหน้า
 *
 * ============================================================================
 * ⚠️ ใบนี้ "อ่าน" ทะเบียนอย่างเดียว ไม่เขียนกลับ
 * ============================================================================
 * เคยทำให้ใบนี้เขียนข้อมูลเครื่องกลับเข้าทะเบียน ด้วยเหตุผลว่าติดตั้งคือจุดที่
 * ตัวเครื่องจริงเปลี่ยน — ซึ่งผิด เพราะระบบมี `replaceAirUnit` (ปุ่มเปลี่ยนเครื่อง
 * ในหน้ารายการเครื่อง) ทำหน้าที่นั้นอยู่แล้ว และทำได้ครบกว่ามาก:
 *
 *   - แยกช่องของ "ตัวเครื่อง" ออกจากช่องของ "ตำแหน่ง" ไม่ให้แตะผิดช่อง
 *   - เก็บสเปกของเครื่องเก่าไว้ในประวัติ ซึ่งเป็นที่เดียวที่ข้อมูลนั้นเหลืออยู่
 *   - ผูกกับเคสงานซ่อมที่ค้างอยู่ เพื่อให้เคสปิดถูกต้อง
 *
 * การเขียนทะเบียนจากสองที่คือการมีความจริงสองชุด และของที่นี่ทำได้แย่กว่า
 * (ทับสเปกเครื่องเก่าทิ้งโดยไม่เก็บไว้ที่ไหนเลย)
 *
 * ลำดับงานที่ถูกต้องคือ **เปลี่ยนเครื่องในหน้ารายการเครื่องก่อน แล้วค่อยออกเอกสาร**
 * เอกสารจะดึงรหัสเครื่องกับ Serial ที่อัปเดตแล้วมาให้เอง เหมือนใบล้างและใบซ่อม
 *
 * ============================================================================
 * ไม่มีเคสงานเหมือนใบซ่อม
 * ============================================================================
 * งานติดตั้งไม่มีขั้นตอนแจ้ง-อนุมัติ-ปิดเคสแบบงานซ่อม จึงไม่มี CaseID
 * ใบนี้แค่ลงประวัติ "ติดตั้ง" ไว้เป็นหลักฐาน
 */

const DOC_ASSETS = { fontHref: '/vendor/fonts.css', logoHref: '/assets/form-logo.png' };

/**
 * ชนิดเอกสารของโมดูลนี้ — ใช้บอกที่เก็บว่าไฟล์ของใบติดตั้งไปอยู่โฟลเดอร์ไหน
 * ไฟล์ PDF ไปที่ data/docs/install/ และรูปไปที่ data/photos/install/
 */
const KIND = 'install';

/** ประเภทเหตุการณ์ที่ใบนี้ลงในประวัติ */
const EVENT = 'ติดตั้ง';

export { settleDocPdfQueue };

/* ==================== อ่านรายการ ==================== */

/** แปลงแถวให้ส่งกลับหน้าเว็บได้ ตัดก้อน JSON ที่ตารางไม่ได้ใช้ออกเพื่อให้ response เบา */
const toSafe = (o, keepJson) => {
  const safe = { _row: o._row };
  for (const k of Object.keys(o)) {
    if (k === '_row') continue;
    if (!keepJson && k === 'ChecklistJSON') continue;
    safe[k] = cleanFormValue(o[k], cleanFormColKind(k));
  }
  return safe;
};

export async function getInstallForms(ctx, airCode) {
  await ctx.requireAccess();
  if (!(await ctx.canView('installform'))) return [];
  await ctx.ensureBase();

  let list = ctx.ss.objects(SHEETS.INSTALLFORM).map(o => toSafe(o, false));

  if (airCode) {
    const nc = normalizeCode(airCode);
    list = list.filter(o =>
      normalizeCode(o.AirCode1) === nc || normalizeCode(o.AirCode2) === nc);
  }

  list = list.filter(await ctx.scopeFilter());

  // เรียงที่หน้าเว็บไม่ได้ เพราะ _row ต้องติดไปกับข้อมูล — เรียงตรงนี้หลังแปลงแล้ว
  return attachApprovals(ctx, KIND, list.sort(newestFirst('CreatedAt')));
}

/* ==================== บันทึก ==================== */

/**
 * ออกเลขที่เอกสารของเครื่องแต่ละตัว
 *
 * เครื่องหนึ่งตัวได้หนึ่งเลข แม้อยู่ในใบเดียวกัน เพราะการติดตั้งของแต่ละเครื่อง
 * เป็นคนละงานในสายตาของทะเบียนและประวัติ (กติกาเดียวกับใบล้าง)
 *
 * ต้องส่งเลขที่เพิ่งออกกลับเข้าไปด้วย เพราะตัวออกเลขนับจากแถวที่เขียนลงไปแล้ว
 * เท่านั้น ถ้าไม่ส่ง เครื่องสองตัวในใบเดียวกันจะได้เลขซ้ำกัน
 */
function assignDocNumbers(ctx, view, date, target = view) {
  const issued = [];

  for (const slot of [1, 2]) {
    const col = slot === 2 ? 'DocNo2' : 'DocNo';
    if (!plainText(view['AirCode' + slot]).trim()) continue;

    const have = plainText(view[col]).trim();
    if (have) { issued.push(have); continue; }

    const next = makeHistoryId(EVENT, date, [...usedDocNumbers(ctx), ...issued]);
    target[col] = next;
    issued.push(next);
  }

  return issued;
}

/**
 * เลขที่ที่ใช้เป็นชื่อโฟลเดอร์รูปและชื่อไฟล์ PDF ของใบนี้
 *
 * เลขของเครื่องแต่ละตัวอยู่คนละคอลัมน์ตามช่อง (ช่อง 1 = DocNo · ช่อง 2 = DocNo2)
 * ติดตั้งเพิ่มเฉพาะเครื่องที่ 2 ตัวเดียว ใบนั้นจึงมีแต่ DocNo2 ส่วน DocNo ว่าง
 * ถ้าดูแค่ DocNo ไฟล์จะไปตกที่ชื่อ ID ภายในแทน แล้วรูปกับ PDF ของใบเดียวกัน
 * จะไปอยู่คนละชื่อ หาไม่เจอทั้งคู่
 */
const docNoOf = form =>
  plainText(form.DocNo) || plainText(form.DocNo2) || plainText(form.ID);

/** ข้อมูลเครื่องจากทะเบียน เอาไว้เติมช่องที่หน้าเว็บไม่ได้ส่งมา */
async function unitOf(ctx, airCode) {
  const nc = normalizeCode(airCode);
  const found = (await unitsInScope(ctx)).find(u => normalizeCode(u.AirCode) === nc);
  if (!found) throw new Error('ไม่พบเครื่องรหัส ' + plainText(airCode) + ' ในทะเบียนเครื่อง');
  return found;
}


/**
 * บันทึกเอกสารติดตั้งหนึ่งใบ
 *
 * ติดตั้งได้ทีละ 1–2 เครื่องต่อใบ ตามช่องที่แบบฟอร์มกระดาษมีให้
 */
/**
 * ตรวจข้อมูลและดึงเครื่องจากทะเบียน ก่อนเขียนเอกสารติดตั้ง (ยังไม่แตะฐานข้อมูล)
 * @returns {{units, first, slotBase, companyName}}
 */
async function prepareInstall(ctx, record) {
  const codes = [1, 2]
    .map(slot => plainText(record['AirCode' + slot]).trim())
    .filter(Boolean);

  if (!codes.length) throw new Error('กรุณาเลือกเครื่องปรับอากาศอย่างน้อย 1 เครื่อง');
  if (codes.length === 2 && normalizeCode(codes[0]) === normalizeCode(codes[1])) {
    throw new Error('เครื่องที่ 1 กับเครื่องที่ 2 ซ้ำกัน');
  }
  if (!plainText(record.Date).trim()) throw new Error('กรุณาระบุวันที่ติดตั้ง');

  // ดึงข้อมูลทะเบียนของทุกเครื่องก่อน เพื่อให้สิทธิ์ภูมิภาคถูกตรวจครบทุกตัว
  // ก่อนที่จะเริ่มเขียนอะไรลงไป ไม่ใช่เขียนตัวแรกเสร็จแล้วค่อยพบว่าตัวที่สองไม่มีสิทธิ์
  const units = {};
  for (const slot of [1, 2]) {
    const code = plainText(record['AirCode' + slot]).trim();
    if (!code) continue;
    // unitOf หาเฉพาะเครื่องในขอบเขตของผู้ใช้อยู่แล้ว (ภูมิภาค หรือ Node ของผู้รับเหมา)
    const unit = await unitOf(ctx, code);
    units[slot] = unit;
  }

  // ใบหนึ่งคือการไปติดตั้งที่ Node เดียว ข้อมูล Node บนหัวใบเอามาจากเครื่องตัวแรก
  // ถ้าปล่อยให้สองเครื่องมาจากคนละ Node เครื่องตัวที่สองจะไปโผล่ในใบของ Node อื่น
  if (units[1] && units[2] &&
      normalizeSiteCode(units[1].SiteCode) !== normalizeSiteCode(units[2].SiteCode)) {
    throw new Error('เครื่องที่ 1 กับเครื่องที่ 2 อยู่คนละ Node บันทึกในใบเดียวกันไม่ได้');
  }

  const first = units[1] || units[2];

  // เครื่องคู่ไหนของ Node (0 = เครื่องที่ 1–2, 2 = 3–4 ...) — ไม่ส่งมา = ใบแรกแบบเดิม
  const slotBase = record.SlotBase === undefined || record.SlotBase === '' ? 0 : Number(record.SlotBase);
  if (!Number.isInteger(slotBase) || slotBase < 0 || slotBase % 2) {
    throw new Error('ลำดับเครื่องในเอกสารไม่ถูกต้อง');
  }

  // ผู้รับเหมา: ชื่อบริษัทใช้ชื่อที่ Admin ตั้งไว้ ไม่ให้พิมพ์เอง (ข้อมูลเก่ามีชื่อเดียวกันถึง 7 แบบ)
  const info = await ctx.userInfo();
  const companyName = info.role === 'Contractor' ? info.contractorName : plainText(record.CompanyName);

  return { units, first, slotBase, companyName };
}

/**
 * เขียนเอกสารติดตั้ง + ขั้นอนุมัติ + ประวัติ (ยังไม่ flush) — ต้องเรียกในล็อก หลัง ensureBase
 * @returns {Promise<Object>} แถวที่เขียนลงไป
 */
async function writeInstallForm(ctx, record, { units, first, slotBase, companyName }) {
  const row = {
    ID: freshFormId(ctx, SHEETS.INSTALLFORM, 'IF'),
    Date: plainText(record.Date),
    NodeName: first.NodeName,
    SiteCode: first.SiteCode,
    Region: first.Region,
    Province: first.Province,
    LocationType: first.LocationType,
    AirCode1: units[1] ? units[1].AirCode : '',
    AirCode2: units[2] ? units[2].AirCode : '',
    TimeStart: plainText(record.TimeStart),
    TimeEnd: plainText(record.TimeEnd),
    TotalTime: plainText(record.TotalTime),
    ChecklistJSON: JSON.stringify(record.Checklist || []),
    AcceptResult1: plainText(record.AcceptResult1),
    AcceptResult2: plainText(record.AcceptResult2),
    AdditionalNote: plainText(record.AdditionalNote),
    CompanyName: companyName,
    TechnicianName: plainText(record.TechnicianName),
    SupervisorName: plainText(record.SupervisorName),
    Cost: record.Cost === '' || record.Cost === undefined ? '' : Number(record.Cost) || '',
    CreatedAt: ymdhms(new Date()),
    RecordedBy: await ctx.currentUser(),
    SlotBase: slotBase
  };

  // ข้อมูลเครื่องมาจากทะเบียนล้วนๆ ไม่รับจากหน้าเว็บ เพื่อไม่ให้มีความจริงสองชุด
  // เครื่องตัวใหม่ต้องถูกเปลี่ยนในหน้ารายการเครื่องก่อนออกเอกสาร (ดูหัวไฟล์)
  //
  // ⚠️ ทะเบียนเก็บชื่อคอลัมน์ว่า IndoorSN/OutdoorSN แต่แบบฟอร์มเขียนว่า Serial
  // ต้องแปลงชื่อตรงนี้ ไม่งั้นช่อง Serial บนเอกสารจะว่างทั้งที่ทะเบียนมีข้อมูลอยู่
  for (const slot of [1, 2]) {
    const unit = units[slot];
    const p = 'Unit' + slot + '_';
    row[p + 'Brand'] = unit ? plainText(unit.Brand) : '';
    row[p + 'BTU'] = unit ? plainText(unit.BTU) : '';
    row[p + 'IndoorSerial'] = unit ? plainText(unit.IndoorSN) : '';
    row[p + 'IndoorAsset'] = unit ? plainText(unit.IndoorAsset) : '';
    row[p + 'OutdoorSerial'] = unit ? plainText(unit.OutdoorSN) : '';
    row[p + 'OutdoorAsset'] = unit ? plainText(unit.OutdoorAsset) : '';
  }

  // ออกเลขในล็อกเสมอ เพื่อไม่ให้สองคนที่บันทึกพร้อมกันได้เลขเดียวกัน
  assignDocNumbers(ctx, row, row.Date);

  const headers = ctx.ss.headers(SHEETS.INSTALLFORM);
  ctx.ss.appendRow(SHEETS.INSTALLFORM, headers.map(h => (row[h] !== undefined ? row[h] : '')));
  await startApproval(ctx, KIND, row.ID);

  // ลงประวัติ "ติดตั้ง" ของเครื่องแต่ละตัว
  for (const slot of [1, 2]) {
    const unit = units[slot];
    if (!unit) continue;

    const docNo = plainText(row[slot === 2 ? 'DocNo2' : 'DocNo']);
    const accept = plainText(row['AcceptResult' + slot]).trim();

    // เครื่องที่เพิ่ม / เปลี่ยน / ย้ายมา มีประวัติที่รอเอกสารอยู่แล้ว — ใส่เลขเอกสารลงแถวนั้น
    // ไม่ลงประวัติ "ติดตั้ง" ซ้ำอีกแถว (เดิมเครื่องเดียวมีประวัติติดตั้งสองแถว)
    const pending = ctx.ss.objects(SHEETS.HISTORY).filter(h =>
      normalizeCode(h.AirCode) === normalizeCode(unit.AirCode) &&
      plainText(h.Note).trim() === INSTALL_PENDING_NOTE);
    if (pending.length) {
      const last = pending[pending.length - 1];
      for (const h of pending) {
        const patch = { Note: 'เอกสาร ' + docNo };
        if (h === last) {
          if (accept) patch.Detail = plainText(h.Detail) + ' — ผลตรวจรับ: ' + accept;
          if (!plainText(h.Technician).trim()) patch.Technician = row.TechnicianName;
        }
        ctx.ss.writeByHeaders(SHEETS.HISTORY, h._row, patch);
      }
      continue;
    }

    await addHistoryRaw(ctx, {
      AirCode: unit.AirCode,
      Date: row.Date,
      EventType: EVENT,
      Detail: ['ติดตั้งเครื่องใหม่', accept && 'ผลตรวจรับ: ' + accept].filter(Boolean).join(' — '),
      Cost: '',
      Technician: row.TechnicianName,
      Note: 'เอกสาร ' + docNo
    });
  }

  return row;
}

/** ผลที่ส่งกลับหน้าเว็บหลังบันทึกเอกสารติดตั้ง */
async function installSavedOf(ctx, row) {
  return {
    // เลขที่คืนกลับไปคือเลขที่ใช้เป็นชื่อไฟล์จริง ไม่ใช่เลขของช่องที่ 1 เสมอไป
    // (ติดตั้งเฉพาะเครื่องที่ 2 ใบนั้นมีแต่ DocNo2)
    docNo: docNoOf(row),
    // เลขรายช่อง เผื่อหน้าเว็บอยากบอกผู้ใช้ว่าเครื่องไหนได้เลขอะไร
    docNo1: plainText(row.DocNo),
    docNo2: plainText(row.DocNo2),
    // หาแถวที่เพิ่งบันทึกด้วย ID เสมอ ห้ามใช้เลขที่เอกสาร เพราะช่อง DocNo
    // ว่างได้จริงเมื่อติดตั้งเฉพาะเครื่องที่ 2
    id: row.ID,
    forms: await getInstallForms(ctx)
  };
}

/**
 * บันทึกเอกสารติดตั้งหนึ่งใบ
 *
 * ติดตั้งได้ทีละ 1–2 เครื่องต่อใบ ตามช่องที่แบบฟอร์มกระดาษมีให้
 */
export async function saveInstallForm(ctx, record) {
  await ctx.assertModuleEdit('installform');
  const prep = await prepareInstall(ctx, record);

  const saved = await ctx.withLock(async () => {
    await ctx.ensureBase();
    const row = await writeInstallForm(ctx, record, prep);
    await ctx.ss.flush();
    return installSavedOf(ctx, row);
  });

  // เก็บสำเนา PDF ไว้บนเซิร์ฟเวอร์ (นอกล็อก เพราะต้องรอเบราว์เซอร์แปลงไฟล์)
  await storeInstallPdf(ctx, saved.docNo);
  return saved;
}

/**
 * เพิ่มเครื่องใหม่เข้าทะเบียน + ออกเอกสารติดตั้ง "ทีเดียว" (เจ้าของงานสั่ง)
 *
 * กด "เพิ่มเครื่องใหม่" / "ติดตั้งเครื่องใหม่" แล้วกรอกฟอร์มติดตั้งต่อ — เครื่องเข้าทะเบียนก็ต่อเมื่อ
 * บันทึกเอกสารติดตั้งสำเร็จ เขียนทั้งสองอย่างใน flush เดียว พลาดตรงไหนไม่มีอะไรถูกบันทึกเลย
 * (ไม่มีเครื่องที่เข้าทะเบียนแล้วแต่ไม่มีเอกสารติดตั้งค้างอยู่)
 *
 * @param {Object} unit   ข้อมูลเครื่องจากฟอร์มเพิ่มเครื่องใหม่ (เหมือนที่ส่งให้ saveAirUnit)
 * @param {Object} record ข้อมูลฟอร์มติดตั้ง (เหมือนที่ส่งให้ saveInstallForm)
 */
export async function installNewAirUnit(ctx, unit, record) {
  await ctx.assertModuleEdit('airlist');
  await ctx.assertModuleEdit('installform');

  const saved = await ctx.withLock(async () => {
    await ctx.ensureBase();
    await addNewAirUnitRaw(ctx, unit);
    // เครื่องอยู่ในทะเบียนของคำสั่งนี้แล้ว (ยังไม่ flush) หาเจอด้วยตัวตรวจเดียวกับเครื่องเดิม
    const prep = await prepareInstall(ctx, record);
    const row = await writeInstallForm(ctx, record, prep);
    await ctx.ss.flush();
    return {
      ...(await installSavedOf(ctx, row)),
      air: await getAirList(ctx),
      history: await getHistory(ctx)
    };
  });

  await storeInstallPdf(ctx, saved.docNo);
  return saved;
}

/* ==================== ลบ ==================== */

export async function deleteInstallForm(ctx, row, expectId) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('installform');
    // ลบแล้วรูปถ่ายกับไฟล์ PDF หายตามไปด้วย กู้คืนไม่ได้ จึงให้เฉพาะเจ้าหน้าที่
    await ctx.assertStaff('ลบเอกสาร');
    await ctx.ensureBase();

    // เลขแถวคือ "ลำดับที่เท่าไหร่ในตาราง" ไม่ใช่ id ถาวร มีคนลบใบข้างบนไป
    // ระหว่างที่อีกคนเปิดหน้าค้างไว้ คำสั่งนี้จะไปโดนเอกสารใบถัดไปแทน
    ctx.assertRowIs(SHEETS.INSTALLFORM, row, 'ID', expectId, 'เอกสารเลขที่');

    const headers = ctx.ss.headers(SHEETS.INSTALLFORM);
    const region = ctx.ss.cell(SHEETS.INSTALLFORM, row, headers.indexOf('Region') + 1);
    await ctx.assertRegionAccess(region);

    // จำเลขที่ไว้ก่อนลบแถว เพื่อตามไปลบรูปและไฟล์ของใบนี้ด้วย
    const cell = name => ctx.ss.cell(SHEETS.INSTALLFORM, row, headers.indexOf(name) + 1);
    const docNo = docNoOf({ DocNo: cell('DocNo'), DocNo2: cell('DocNo2'), ID: cell('ID') });
    const formId = plainText(cell('ID'));

    await ctx.ss.deleteRow(SHEETS.INSTALLFORM, row);
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

    return getInstallForms(ctx);
  });
}

/* ==================== รูปถ่าย ==================== */

/** หาใบเอกสารจากเลขแถว พร้อมตรวจสิทธิ์ภูมิภาค */
async function formForPhotos(ctx, row) {
  await ctx.ensureBase();
  const form = ctx.ss.objects(SHEETS.INSTALLFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await ctx.assertInScope(form, 'เอกสารใบนี้');

  const docNo = docNoOf(form);
  if (!docNo) throw new Error('เอกสารใบนี้ยังไม่มีเลขที่ จึงเก็บรูปไม่ได้');
  return { form, docNo };
}

function requirePhotoStore(ctx) {
  if (!ctx.photos) throw new Error('ระบบที่รันอยู่ตอนนี้ไม่รองรับการเก็บรูป (ไม่มีที่เก็บไฟล์)');
  return ctx.photos;
}

/**
 * ช่องเครื่องที่รูปจะไปอยู่ — ใบติดตั้งมีสองเครื่อง จึงต้องระบุมาให้ชัด
 *
 * ใช้ชื่อ unitSlot ให้ตรงกับที่ใบล้างใช้อยู่ เพราะหน้าเว็บใช้ตัวแก้รูปตัวเดียวกัน
 * ทั้งสามเอกสาร ถ้าตั้งชื่อไม่ตรง รูปจะไปลงช่องเครื่องที่ 1 เสมอโดยไม่มีอะไรฟ้อง
 */
function slotOf(form, payload) {
  const slot = Number((payload && payload.unitSlot) || 1);
  if (slot !== 1 && slot !== 2) throw new Error('เครื่องที่ ' + slot + ' ไม่มีในเอกสารใบนี้');
  if (!plainText(form['AirCode' + slot]).trim()) {
    throw new Error('เอกสารใบนี้ไม่มีเครื่องที่ ' + slot);
  }
  return slot;
}

/** รอผลของงานที่แก้รูป แล้วนัดสร้างไฟล์ PDF ใหม่ให้ตรงกับรูปล่าสุด */
async function withFreshPdf(ctx, work) {
  const { docNo, ...out } = await work;
  scheduleDocPdf(ctx, docNo, () => storeInstallPdf(ctx, docNo));
  return out;
}

export async function saveInstallPhoto(ctx, payload) {
  return withFreshPdf(ctx, ctx.withLock(async () => {
    await ctx.assertModuleEdit('installform');
    const store = requirePhotoStore(ctx);

    const { form, docNo } = await formForPhotos(ctx, payload && payload.row);
    const saved = store.save(KIND, docNo, slotOf(form, payload), payload.index, payload.dataUrl);
    // รูปเปลี่ยน = ต้องอนุมัติใหม่ (ดู approval.js)
    if (resetApproval(ctx, KIND, form.ID)) await ctx.ss.flush();
    return { ok: true, docNo, bytes: saved.bytes, photos: Object.keys(store.readAll(KIND, docNo)) };
  }));
}

export async function deleteInstallPhoto(ctx, payload) {
  return withFreshPdf(ctx, ctx.withLock(async () => {
    await ctx.assertModuleEdit('installform');
    const store = requirePhotoStore(ctx);

    const { form, docNo } = await formForPhotos(ctx, payload && payload.row);
    store.remove(KIND, docNo, slotOf(form, payload), Number(payload.index));
    if (resetApproval(ctx, KIND, form.ID)) await ctx.ss.flush();
    return { ok: true, docNo, photos: Object.keys(store.readAll(KIND, docNo)) };
  }));
}

/** รูปทั้งหมดของใบหนึ่ง พร้อมตัวรูปจริง สำหรับหน้าแก้รูป */
export async function getInstallPhotos(ctx, row) {
  await ctx.requireAccess();
  if (!(await ctx.canView('installform'))) return {};
  if (!ctx.photos) return {};

  const { docNo } = await formForPhotos(ctx, row);
  return { docNo, photos: ctx.photos.readAll(KIND, docNo) };
}

/* ==================== เอกสาร ==================== */

/** หน้าเอกสารสำหรับเปิดดูและสั่งปริ้น */
export async function getInstallDocHtml(ctx, row) {
  await ctx.requireAccess();
  if (!(await ctx.canView('installform'))) throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');
  await ctx.ensureBase();

  const form = ctx.ss.objects(SHEETS.INSTALLFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await ctx.assertInScope(form, 'เอกสารใบนี้');

  const { buildInstallDocHtml } = await import('./install-doc.js');
  const docNo = docNoOf(form);
  const photos = ctx.photos ? ctx.photos.readAll(KIND, docNo) : {};
  // toolbar ใส่เฉพาะตอนเปิดดูบนจอ ตอนแปลงเป็นไฟล์ PDF ไม่ใส่
  return buildInstallDocHtml(form, { ...DOC_ASSETS, photos, toolbar: true, ...signOptsOf(ctx, KIND, form) });
}

/** ฟอร์มเปล่าสำหรับปริ้นไปเขียนมือหน้างาน */
export async function getInstallBlankDocHtml(ctx, record) {
  await ctx.requireAccess();
  if (!(await ctx.canView('installform'))) throw new Error('ไม่มีสิทธิ์เข้าถึงเมนูนี้');

  const payload = { ...(record || {}) };
  payload.DocNo = '(ฟอร์มเปล่า — ยังไม่ได้บันทึก)';
  payload.ChecklistJSON = JSON.stringify(payload.Checklist || []);

  const { buildInstallDocHtml } = await import('./install-doc.js');
  return buildInstallDocHtml(payload, DOC_ASSETS);
}

/**
 * แปลงก้อนไบต์เป็นข้อความ base64
 *
 * ทำทีละ 8KB ไม่ใช่ส่งทั้งก้อนเข้า String.fromCharCode ทีเดียว เพราะการกระจาย
 * อาร์เรย์เป็นพารามิเตอร์หลักหมื่นตัวทำให้ call stack ล้นบนเครื่องบางเครื่อง
 */
function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(out);
}

/** ฟอร์มเปล่าแบบ Excel ที่เติมข้อมูล Node กับเครื่องให้แล้ว (วางรูปลงไปได้) */
export async function getInstallBlankXlsx(ctx, record) {
  await ctx.requireAccess();
  if (!(await ctx.canView('installform'))) throw new Error('ไม่มีสิทธิ์เข้าถึงเมนูนี้');
  if (!ctx.forms) throw new Error('เครื่องที่รันระบบอยู่ไม่มีไฟล์แบบฟอร์มแม่แบบ');

  const { buildInstallXlsx, installXlsxFileName } = await import('./install-xlsx.js');
  const bytes = await buildInstallXlsx(ctx.forms.read('install'), record || {});

  return {
    base64: toBase64(bytes),
    fileName: installXlsxFileName(record),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
}

/** แปลงใบหนึ่งเป็นไฟล์ PDF (ยังไม่เก็บ ยังไม่ส่งให้ใคร) */
async function renderPdf(ctx, form) {
  const docNo = docNoOf(form);
  // ชื่อผู้อนุมัติในช่องลงนาม + ลายน้ำ "รออนุมัติ" ถ้ายังไม่ครบ
  const sign = signOptsOf(ctx, KIND, form);
  const base = ctx.pdf.baseUrl || '';

  const { buildInstallDocHtml } = await import('./install-doc.js');
  const html = buildInstallDocHtml(form, {
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
export async function storeInstallPdf(ctx, docNo) {
  const name = plainText(docNo).trim();
  if (!ctx.pdf || !ctx.docs || !name) return false;

  try {
    const form = ctx.ss.objects(SHEETS.INSTALLFORM)
      .find(f => docNoOf(f) === name);
    if (!form) return false;

    // ยังรออนุมัติ = ไม่เก็บสำเนา (สำเนาบนเซิร์ฟเวอร์มีเฉพาะฉบับที่อนุมัติครบ ดู approval.js)
    // ลบฉบับเดิมทิ้งด้วย — ใบที่เคยอนุมัติครบแล้วถูกแก้รูป ต้องไม่เหลือไฟล์เก่าที่ขึ้นชื่อผู้อนุมัติ
    if (isPending(approvalRowOf(ctx, KIND, form.ID))) {
      try { ctx.docs.remove(KIND, name); } catch { /* ไม่มีไฟล์เดิมก็ไม่เป็นไร */ }
      return false;
    }

    const { base64 } = await renderPdf(ctx, form);
    ctx.docs.save(KIND, name, plainText(form.Date), base64);
    return true;
  } catch (err) {
    console.error('[เก็บไฟล์ PDF ติดตั้ง ' + name + ']', err && err.message ? err.message : err);
    return false;
  }
}

/** แปลงเป็นไฟล์ PDF ให้ดาวน์โหลด และเก็บสำเนาไว้บนเซิร์ฟเวอร์ไปด้วย */
export async function getInstallDocPdf(ctx, row, expectId) {
  await ctx.requireAccess();
  if (!(await ctx.canView('installform'))) throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');
  if (!ctx.pdf) {
    throw new Error(
      'เครื่องที่รันระบบอยู่ไม่มีเบราว์เซอร์สำหรับแปลงเป็นไฟล์ PDF — ' +
      'กด "เปิดเอกสาร" แล้วสั่งปริ้นเองได้ผลเหมือนกัน'
    );
  }

  await ctx.ensureBase();

  // ตรวจว่าแถวนั้นยังเป็นใบเดิมอยู่จริง ก่อนสร้างไฟล์
  ctx.assertRowIs(SHEETS.INSTALLFORM, row, 'ID', expectId, 'เอกสารเลขที่');

  const form = ctx.ss.objects(SHEETS.INSTALLFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await ctx.assertInScope(form, 'เอกสารใบนี้');

  const { docNo, base64, draft } = await renderPdf(ctx, form);

  // ฉบับร่าง (ยังรออนุมัติ) ไม่เก็บ — สำเนาบนเซิร์ฟเวอร์มีเฉพาะฉบับจริง
  if (ctx.docs && !draft) {
    try { ctx.docs.save(KIND, docNo, plainText(form.Date), base64); }
    catch (err) { console.error('[เก็บไฟล์ PDF ติดตั้ง ' + docNo + ']', err && err.message ? err.message : err); }
  }

  return { fileName: docNo + (draft ? '-รออนุมัติ' : '') + '.pdf', mime: 'application/pdf', base64 };
}
