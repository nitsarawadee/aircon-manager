import { SHEETS, cleanFormColKind } from '../schema.js';
import { cleanFormValue, normalizeCode, normalizeRegion, plainText, ymdhms, ymd } from '../values.js';
import { addHistoryRaw, getHistory, makeHistoryId, usedDocNumbers } from './history.js';
import { getAirList } from './airlist.js';
import { closePlanRound } from './plan.js';
import { buildCleaningPdf, uploadNodeDocs } from '../pdf-bridge.js';

/**
 * ฟอร์มบันทึกผลการล้างเครื่องปรับอากาศ
 *
 * มี 2 ทางที่บันทึกผลล้างได้ และทั้งสองทางปิดงานในแผนได้เหมือนกัน:
 *
 *   1. กรอกฟอร์มในระบบ (saveCleaningForm)
 *      ระบบสร้าง PDF ให้เอง เหมาะกับคนที่กรอกหน้าจอสะดวก
 *
 *   2. แนบเอกสารที่เขียนด้วยมือ (uploadNodeDocuments)
 *      ปริ้นฟอร์มเปล่าไปเขียนหน้างาน ถ่ายรูปแล้วแนบกลับ
 *      เหมาะกับช่างที่สะดวกเขียนมากกว่าพิมพ์
 *
 * ทั้งสองทางรองรับการล้าง 1 หรือ 2 เครื่องในครั้งเดียว โดยกรอกราคาแยกรายเครื่อง
 */

/* ==================== เลขที่เอกสาร ==================== */

/**
 * ออกเลขที่เอกสาร โดยใช้รูปแบบเดียวกับเลขที่ในหน้าประวัติ
 *
 * ระบบมีกติกาอยู่แล้วว่า PM = งานล้างตามแผน, CM = งานซ่อมและอื่นๆ
 * (ดูหัวข้อ makeHistoryId ใน history.js) จึงไม่ต้องคิดรูปแบบใหม่ขึ้นมาอีกชุด
 * คนที่ถือกระดาษอยู่ในมือเห็นเลขแล้วรู้ทันทีว่าเป็นงานประเภทไหน
 *
 * นับรวมทั้งเลขในประวัติและเลขเอกสารที่ออกไปแล้ว เพราะสองอย่างนี้ใช้ชุดเลข
 * เดียวกัน ถ้านับแยกกันจะมีวันที่เอกสารกับใบประวัติได้เลขเดียวกันคนละเรื่อง
 * แล้วการตามหาเอกสารจากเลขที่เห็นในประวัติจะเจอผิดใบ
 *
 * ต้องเรียกภายใน withLock หลัง ensureBase แล้วเท่านั้น ไม่งั้นสองคนที่กด
 * บันทึกพร้อมกันจะได้เลขเดียวกัน
 */
function nextDocNo(ctx, eventType, date) {
  return makeHistoryId(eventType, date, usedDocNumbers(ctx));
}

/* ==================== Node / Serial สำหรับ dropdown ==================== */

/** จัดกลุ่มเครื่องตาม Node เพื่อให้เลือก Node แล้วดึง Serial/Asset/Brand/BTU มาเติมอัตโนมัติ */
export async function getCleaningFormNodes(ctx) {
  const list = await getAirList(ctx); // กรองสิทธิ์ตามภูมิภาคมาแล้ว
  const map = {};
  const order = [];

  list.forEach(a => {
    const key = a.NodeName || '(ไม่ระบุชื่อ Node)';
    if (!map[key]) {
      map[key] = {
        NodeName: plainText(a.NodeName), SiteCode: plainText(a.SiteCode),
        Region: plainText(a.Region), Province: plainText(a.Province),
        LocationType: plainText(a.LocationType), units: []
      };
      order.push(key);
    }
    // แปลงเป็นข้อความทั้งหมด กัน Serial number ยาวๆ กลายเป็น 5.230054E7 และ BTU กลายเป็น 18000.0
    map[key].units.push({
      AirCode: plainText(a.AirCode), Brand: plainText(a.Brand), BTU: plainText(a.BTU),
      IndoorSerial: plainText(a.IndoorSN), IndoorAsset: plainText(a.IndoorAsset),
      OutdoorSerial: plainText(a.OutdoorSN), OutdoorAsset: plainText(a.OutdoorAsset),
      // ราคาต่อรอบที่ตั้งไว้ในรายการเครื่อง ใช้เติมช่องราคาให้อัตโนมัติ
      CleaningPrice: plainText(a.CleaningPricePerRound)
    });
  });

  return order.map(k => map[k]);
}

/* ==================== ตัวช่วยที่ใช้ร่วมกันทั้ง 2 ทาง ==================== */

/** ราคาที่กรอกมาใช้ได้จริงหรือไม่ (ว่างไว้ = ไม่ระบุ ไม่ใช่ศูนย์) */
function hasPrice(v) {
  return v !== '' && v !== null && v !== undefined && !isNaN(Number(v));
}

/**
 * ปิดงานในแผนให้ทุกเครื่องที่เลือก
 *
 * ⚠️ ต้องส่งราคา "รายเครื่อง" เข้ามาใน units ห้ามส่งยอดรวมทั้งใบ
 * เพราะฟังก์ชันนี้เขียนราคาลงแถวของแต่ละเครื่องแยกกัน
 * ถ้าส่งยอดรวมมา งบประมาณจะถูกนับซ้ำเป็นสองเท่าทันทีเมื่อล้าง 2 ตัว
 *
 * @param {Array<{airCode: string, price: *}>} units
 * @returns {Promise<number>} จำนวนแถวที่ปิดงานสำเร็จ
 */
async function closeRoundsForUnits(ctx, units, opts) {
  if (!opts.planYear || !opts.planRound) return 0;

  let closed = 0;
  for (const u of units) {
    closed += await closePlanRound(ctx, {
      year: opts.planYear,
      round: opts.planRound,
      airCode: u.airCode,
      actualDate: opts.date,
      price: u.price,
      technician: opts.technician,
      docUrl: opts.docUrl
    });
  }
  return closed;
}

/**
 * บันทึกประวัติการล้างแยกรายเครื่อง โดยใช้ราคาของเครื่องนั้นๆ
 *
 * ต่างจากเวอร์ชันเดิมที่ลงค่าใช้จ่ายทั้งก้อนไว้ที่เครื่องแรกเครื่องเดียว
 * (วิธีเดิมกันงบนับซ้ำได้ก็จริง แต่พอดูประวัติรายเครื่องแล้วเห็นราคาเป็นศูนย์
 *  ทั้งที่ล้างจริง ซึ่งอ่านแล้วสับสน) ตอนนี้แต่ละเครื่องลงราคาของตัวเอง
 * ยอดรวมจึงยังเท่าเดิม แต่ดูรายเครื่องแล้วตรงความจริง
 */
async function writeCleaningHistory(ctx, units, opts) {
  const roundTxt = (opts.planYear && opts.planRound)
    ? ` รอบที่ ${opts.planRound}/${opts.planYear}` : '';
  const via = opts.source === 'attach' ? '(เอกสารแนบ)' : '(ฟอร์ม)';

  for (const u of units) {
    await addHistoryRaw(ctx, {
      AirCode: u.airCode,
      Date: opts.date,
      EventType: 'ล้างแอร์',
      Detail: `ล้างเครื่องปรับอากาศ ${via}${roundTxt} Node "${opts.nodeName}"` +
              (opts.condition ? ` ผลประเมิน: ${opts.condition}` : '') +
              (opts.docUrl ? ` — เอกสาร: ${opts.docUrl}` : ''),
      Cost: hasPrice(u.price) ? Number(u.price) : '',
      Technician: opts.technician || ''
    });
  }
}

/**
 * รวมรายการเครื่องที่เลือก พร้อมราคารายเครื่อง
 * รองรับข้อมูลเก่าที่ส่งมาแค่ยอดรวม (Price) โดยไม่มีราคารายเครื่อง
 */
function unitsFromRecord(record) {
  const codes = [record.AirCode1, record.AirCode2].filter(Boolean);
  const prices = [record.Price1, record.Price2];

  return codes.map((code, i) => {
    let price = prices[i];
    // ข้อมูลรุ่นเก่าส่งมาแค่ยอดรวม — ให้ถือว่าเป็นราคาของเครื่องแรก
    // เครื่องที่สองปล่อยว่างไว้ (แผนจะคงราคาที่ตั้งไว้เดิมของเครื่องนั้น)
    if (!hasPrice(price) && i === 0 && hasPrice(record.Price)) price = record.Price;
    return { airCode: code, price: hasPrice(price) ? Number(price) : '' };
  });
}

/* ==================== อ่าน / บันทึกฟอร์ม ==================== */

export async function getCleaningForms(ctx, airCode) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) return [];
  await ctx.ensureBase();

  let list = ctx.ss.objects(SHEETS.CLEANFORM).map(o => {
    const safe = { _row: o._row };
    Object.keys(o).forEach(k => {
      if (k === '_row') return;
      // ไม่ต้องส่ง ChecklistJSON กลับไปหน้าเว็บ (ก้อนใหญ่ และตารางไม่ได้ใช้) ช่วยให้ response เบาลงมาก
      if (k === 'ChecklistJSON') return;
      safe[k] = cleanFormValue(o[k], cleanFormColKind(k));
    });
    return safe;
  });

  if (airCode) {
    const nc = normalizeCode(airCode);
    list = list.filter(o => normalizeCode(o.AirCode1) === nc || normalizeCode(o.AirCode2) === nc);
  }

  const info = await ctx.userInfo();
  if (info.role !== 'Admin') {
    list = list.filter(o => (info.regions || []).includes(normalizeRegion(o.Region)));
  }

  return list.sort((a, b) => (a.CreatedAt < b.CreatedAt ? 1 : -1));
}

/**
 * บันทึกฟอร์มล้างแอร์: เขียนลงชีต + สร้าง PDF + ปิดงานในแผน + บันทึกประวัติ
 *
 * ============================================================================
 * ทำไมสร้าง PDF "นอก" ล็อก
 * ============================================================================
 * การสร้าง PDF เรียกบริการภายนอกผ่านเน็ต ซึ่งรอได้นานถึง 2 นาที (TIMEOUT_MS)
 * แต่ล็อกเขียนข้อมูลถือว่า "ค้าง" แล้วยกให้คนถัดไปเมื่อเกิน LOCK_HOLD_MS
 *
 * เดิมเรียก PDF อยู่ในล็อก พอบริการตอบช้ากว่าเวลานั้น ล็อกจะถูกยกให้คนถัดไป
 * ทั้งที่คนแรกยังเขียนไม่เสร็จ กลายเป็นมีคนเขียนพร้อมกันสองคน ต่างคนต่างถือ
 * สำเนาข้อมูลที่โหลดมาคนละเวลา ใครบันทึกทีหลังทับของคนแรกโดยไม่มีอะไรฟ้อง
 *
 * ตอนนี้ในล็อกเหลือเฉพาะงานฐานข้อมูลซึ่งเสร็จในหลักมิลลิวินาที
 * การรอเน็ตย้ายมาอยู่นอกล็อกทั้งหมด คนอื่นจึงไม่ต้องรอตามไปด้วย
 *
 * ผลข้างเคียงที่ยอมรับ: ถ้าสร้าง PDF สำเร็จแล้วการเขียนฐานข้อมูลล้มทีหลัง
 * จะเหลือไฟล์ PDF ที่ไม่มีใครอ้างถึง ซึ่งดีกว่าข้อมูลการล้างแอร์หายไปเงียบๆ
 */
export async function saveCleaningForm(ctx, record) {
  // ---------- ตรวจและเตรียมข้อมูล (ยังไม่แตะฐานข้อมูล จึงไม่ต้องถือล็อก) ----------
  await ctx.assertModuleEdit('cleaningform');

  if (!record.NodeName) throw new Error('กรุณาเลือก Node');
  // โหมดแยกใบต่อเครื่องอาจส่งเครื่องมาลงช่อง AirCode2 แทน (กรณีเป็นเครื่องตัวที่ 2 ของ Node)
  // จึงเช็คว่ามีเครื่องอย่างน้อย 1 ใน 2 ช่อง ไม่ใช่บังคับช่องแรกเสมอ
  if (!record.AirCode1 && !record.AirCode2) throw new Error('กรุณาเลือกเครื่องปรับอากาศอย่างน้อย 1 เครื่อง');
  if (!record.Date) throw new Error('กรุณาระบุวันที่ดำเนินการ');
  await ctx.assertRegionAccess(record.Region);

  const units = unitsFromRecord(record);

  record.ID = 'CF' + Date.now();
  record.ChecklistJSON = JSON.stringify(record.Checklist || []);
  record.CreatedAt = ymdhms(new Date());
  record.RecordedBy = await ctx.currentUser();
  record.Source = 'form';
  // คอลัมน์ Price เก็บยอดรวมทั้งใบไว้เพื่อให้ตารางสรุปอ่านง่าย
  // ส่วนการคิดงบจริงใช้ราคารายเครื่องที่ลงในประวัติ
  record.Price = units.reduce((sum, u) => sum + (hasPrice(u.price) ? Number(u.price) : 0), 0) || '';

  // ---------- สร้าง PDF (รอเน็ตได้นาน จึงต้องอยู่นอกล็อก) ----------
  // พลาดก็ยังบันทึกข้อมูลต่อ ไม่ให้งานทั้งหมดล้มเพราะบริการ PDF ล่ม
  // แต่ต้องส่งข้อความ error กลับไปบอกผู้ใช้ด้วย ไม่ใช่เงียบหายไป
  let pdfUrl = '';
  let pdfFileId = '';
  let pdfError = '';
  try {
    const pdf = await buildCleaningPdf(ctx.env, record);
    pdfUrl = pdf.url || '';
    pdfFileId = pdf.fileId || '';
  } catch (e) {
    pdfError = String((e && e.message) || e);
  }
  record.PdfUrl = pdfUrl;
  record.PdfFileId = pdfFileId;

  // ---------- เขียนฐานข้อมูล (ต้องถือล็อก แต่ใช้เวลาสั้นมาก) ----------
  return ctx.withLock(async () => {
    await ctx.ensureBase();

    // ออกเลขในล็อกเสมอ เพื่อไม่ให้สองคนที่บันทึกพร้อมกันได้เลขเดียวกัน
    record.DocType = 'cleaning';
    record.DocNo = nextDocNo(ctx, 'ล้างแอร์', record.Date);

    const headers = ctx.ss.headers(SHEETS.CLEANFORM);
    ctx.ss.appendRow(SHEETS.CLEANFORM, headers.map(h => (record[h] !== undefined ? record[h] : '')));

    // ---------- ปิดงานในแผนล้างแอร์ (เฉพาะกรณีที่รู้ว่าเป็นรอบไหน) ----------
    // กรอกจากหน้าแผน = รู้ปีและรอบ จึงปิดงานให้ได้เลย ทั้ง 1 และ 2 เครื่อง
    // กรอกจากแท็บฟอร์มโดยตรงโดยไม่ระบุรอบ = บันทึกเป็นเอกสารอย่างเดียว ไม่ไปแตะแผน
    const planClosed = await closeRoundsForUnits(ctx, units, {
      planYear: record.PlanYear,
      planRound: record.PlanRound,
      date: record.Date,
      technician: record.TechnicianName,
      docUrl: pdfUrl
    });

    await writeCleaningHistory(ctx, units, {
      date: record.Date,
      technician: record.TechnicianName,
      nodeName: record.NodeName,
      condition: record.EquipmentCondition,
      docUrl: pdfUrl,
      planYear: record.PlanYear,
      planRound: record.PlanRound,
      source: 'form'
    });

    await ctx.ss.flush();

    return {
      pdfUrl, pdfError, planClosed,
      forms: await getCleaningForms(ctx),
      history: await getHistory(ctx)
    };
  });
}

/**
 * สร้าง PDF "ตัวอย่าง/ฟอร์มเปล่า" จากข้อมูลที่กรอกอยู่ตอนนี้ (กรอกครบหรือไม่ครบก็ได้)
 * ใช้สำหรับปริ้นฟอร์มไปเขียนด้วยมือหน้างานก่อน แล้วค่อยถ่ายรูปแนบกลับเข้าระบบภายหลัง
 * ไม่บันทึกอะไรลงชีตทั้งสิ้น — สร้างไฟล์แล้วส่ง URL กลับไปเปิด/ปริ้นเท่านั้น
 */
export async function previewCleaningFormPdf(ctx, record) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) throw new Error('ไม่มีสิทธิ์เข้าถึงเมนูนี้');

  const payload = { ...(record || {}) };
  payload.ID = 'ตัวอย่าง' + Date.now();
  payload.__preview = true; // ให้ไปเก็บในโฟลเดอร์ตัวอย่าง ไม่ปนกับเอกสารจริง
  payload.ChecklistJSON = JSON.stringify(payload.Checklist || []);

  const pdf = await buildCleaningPdf(ctx.env, payload);
  return { pdfUrl: pdf.url };
}

/**
 * สร้าง PDF ย้อนหลังให้รายการที่บันทึกไว้แล้วแต่ยังไม่มีไฟล์ PDF
 * (เช่นรายการที่บันทึกตอนบริการ PDF ล่ม) — ไม่ต้องกรอกฟอร์มใหม่
 */
export async function regenerateCleaningFormPdf(ctx, row) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('cleaningform');
    await ctx.ensureBase();

    const headers = ctx.ss.headers(SHEETS.CLEANFORM);
    const record = {};
    headers.forEach((h, i) => {
      if (!h) return;
      record[h] = cleanFormValue(ctx.ss.cell(SHEETS.CLEANFORM, row, i + 1), cleanFormColKind(h));
    });
    if (!record.ID) throw new Error('ไม่พบข้อมูลของแถวนี้');

    // รายการที่มาจากการแนบเอกสารไม่มีข้อมูลเช็คลิสต์ให้วาด สร้าง PDF ย้อนหลังไม่ได้
    if (record.Source === 'attach') {
      throw new Error('รายการนี้เป็นเอกสารที่แนบเข้ามา ไม่ใช่ฟอร์มที่กรอกในระบบ จึงสร้าง PDF ใหม่ไม่ได้ — เปิดดูไฟล์ที่แนบไว้ได้จากลิงก์ในตาราง');
    }

    await ctx.assertRegionAccess(record.Region);

    const pdf = await buildCleaningPdf(ctx.env, record);

    ctx.ss.writeByHeaders(SHEETS.CLEANFORM, row, {
      PdfUrl: pdf.url || '',
      PdfFileId: pdf.fileId || ''
    });
    await ctx.ss.flush();

    return { pdfUrl: pdf.url, forms: await getCleaningForms(ctx) };
  });
}

export async function deleteCleaningForm(ctx, row) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('cleaningform');
    await ctx.ensureBase();

    const headers = ctx.ss.headers(SHEETS.CLEANFORM);
    const region = ctx.ss.cell(SHEETS.CLEANFORM, row, headers.indexOf('Region') + 1);
    await ctx.assertRegionAccess(region);

    await ctx.ss.deleteRow(SHEETS.CLEANFORM, row);
    await ctx.ss.flush();
    return getCleaningForms(ctx);
  });
}

/* ==================== แนบเอกสารที่เขียนด้วยมือ ==================== */

const NODE_DOC_MAX_FILES = 10;

/**
 * แนบไฟล์เอกสารเข้ากับ Node และปิดงานล้างในแผนให้ด้วย (ถ้าระบุรอบมา)
 *
 * ใช้กับกรณีที่ช่างปริ้นฟอร์มเปล่าไปเขียนด้วยมือหน้างาน แล้วถ่ายรูปส่งกลับมา
 * ไฟล์จะถูกเก็บที่ CleaningReports/<ปี>/<ชื่อ Node>/เอกสารแนบ/
 *
 * @param {Object} payload
 * @param {string} payload.nodeName
 * @param {Array}  payload.files    [{name, mimeType, data(base64)}]
 * @param {Object} [payload.closeout]  ถ้าไม่ส่งมา = แค่เก็บไฟล์ ไม่ไปแตะแผนหรือประวัติ
 * @param {Array}  payload.closeout.units  [{airCode, price}] เครื่องที่ล้าง พร้อมราคารายเครื่อง
 */
export async function uploadNodeDocuments(ctx, payload) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('cleaningform');
    payload = payload || {};

    const nodeName = plainText(payload.nodeName).trim();
    const files = payload.files || [];
    if (!nodeName) throw new Error('กรุณาเลือก Node ก่อนแนบไฟล์');
    if (!files.length) throw new Error('กรุณาเลือกไฟล์อย่างน้อย 1 ไฟล์');
    if (files.length > NODE_DOC_MAX_FILES) {
      throw new Error('แนบได้ครั้งละไม่เกิน ' + NODE_DOC_MAX_FILES + ' ไฟล์');
    }

    await ctx.ensureBase();

    // ตรวจสิทธิ์ภูมิภาคของ Node นี้ กันการแนบไฟล์ข้ามภูมิภาคที่ไม่ได้ดูแล
    const air = await getAirList(ctx);
    const nodeUnits = air.filter(a => plainText(a.NodeName).trim() === nodeName);
    if (!nodeUnits.length) throw new Error('ไม่พบ Node "' + nodeName + '" หรือไม่มีสิทธิ์เข้าถึง');
    await ctx.assertRegionAccess(nodeUnits[0].Region);

    const closeout = payload.closeout || null;
    let units = [];

    if (closeout) {
      if (!closeout.date) throw new Error('กรุณาระบุวันที่ล้างจริง');

      const wanted = Array.isArray(closeout.units) ? closeout.units : [];
      if (!wanted.length) throw new Error('กรุณาเลือกเครื่องที่ล้างอย่างน้อย 1 เครื่อง');
      if (wanted.length > 2) throw new Error('บันทึกได้ครั้งละไม่เกิน 2 เครื่อง');

      // ทุกเครื่องที่เลือกต้องอยู่ใน Node นี้จริง
      // กันกรณีหน้าเว็บส่งรหัสเครื่องของ Node อื่นมาโดยไม่ได้ตั้งใจ
      units = wanted.map(w => {
        const code = plainText(w.airCode).trim();
        const found = nodeUnits.find(a => normalizeCode(a.AirCode) === normalizeCode(code));
        if (!found) throw new Error('เครื่อง "' + code + '" ไม่ได้อยู่ใน Node "' + nodeName + '"');
        return { airCode: plainText(found.AirCode), price: hasPrice(w.price) ? Number(w.price) : '' };
      });
    }

    // ---------- อัปโหลดไฟล์ขึ้น Drive ----------
    const today = ymd(new Date());
    const uploaded = await uploadNodeDocs(ctx.env, { nodeName, date: today, files });

    // ลิงก์ที่จะผูกไว้ในแผน: ใช้ไฟล์แรกถ้ามี ไม่งั้นใช้ลิงก์โฟลเดอร์
    const docUrl = (uploaded.files && uploaded.files[0] && uploaded.files[0].url) || uploaded.folderUrl || '';

    if (!closeout) {
      return { ...uploaded, planClosed: 0 };
    }

    // ---------- ปิดงานในแผน + บันทึกประวัติ ----------
    const planClosed = await closeRoundsForUnits(ctx, units, {
      planYear: closeout.year,
      planRound: closeout.round,
      date: closeout.date,
      technician: closeout.technician,
      docUrl
    });

    await writeCleaningHistory(ctx, units, {
      date: closeout.date,
      technician: closeout.technician,
      nodeName,
      condition: closeout.condition,
      docUrl,
      planYear: closeout.year,
      planRound: closeout.round,
      source: 'attach'
    });

    // ---------- เก็บเป็นรายการหนึ่งในตารางฟอร์มล้างแอร์ ----------
    // เพื่อให้ดูประวัติการล้างทั้งหมดได้จากที่เดียว ไม่ต้องแยกจำว่าใบไหนกรอกในระบบ
    // ใบไหนเขียนมือ — คอลัมน์ Source บอกที่มา และ PdfUrl ชี้ไปที่ไฟล์ที่แนบมา
    const first = nodeUnits.find(a => normalizeCode(a.AirCode) === normalizeCode(units[0].airCode)) || nodeUnits[0];
    const second = units[1]
      ? nodeUnits.find(a => normalizeCode(a.AirCode) === normalizeCode(units[1].airCode))
      : null;

    const record = {
      ID: 'CF' + Date.now(),
      DocType: 'cleaning',
      DocNo: nextDocNo(ctx, 'ล้างแอร์', closeout.date),
      Date: closeout.date,
      NodeName: nodeName,
      SiteCode: plainText(first.SiteCode),
      Region: plainText(first.Region),
      Province: plainText(first.Province),
      LocationType: plainText(first.LocationType),
      AirCode1: units[0] ? units[0].airCode : '',
      AirCode2: units[1] ? units[1].airCode : '',
      Unit1_Brand: plainText(first.Brand),
      Unit1_BTU: plainText(first.BTU),
      Unit1_IndoorSerial: plainText(first.IndoorSN),
      Unit1_IndoorAsset: plainText(first.IndoorAsset),
      Unit1_OutdoorSerial: plainText(first.OutdoorSN),
      Unit1_OutdoorAsset: plainText(first.OutdoorAsset),
      Unit2_Brand: second ? plainText(second.Brand) : '',
      Unit2_BTU: second ? plainText(second.BTU) : '',
      Unit2_IndoorSerial: second ? plainText(second.IndoorSN) : '',
      Unit2_IndoorAsset: second ? plainText(second.IndoorAsset) : '',
      Unit2_OutdoorSerial: second ? plainText(second.OutdoorSN) : '',
      Unit2_OutdoorAsset: second ? plainText(second.OutdoorAsset) : '',
      ChecklistJSON: '[]',
      EquipmentCondition: closeout.condition || '',
      AdditionalNote: closeout.note || '',
      CompanyName: closeout.companyName || '',
      TechnicianName: closeout.technician || '',
      PdfUrl: docUrl,
      PdfFileId: '',
      CreatedAt: ymdhms(new Date()),
      RecordedBy: await ctx.currentUser(),
      PlanYear: closeout.year || '',
      PlanRound: closeout.round || '',
      Price1: units[0] ? units[0].price : '',
      Price2: units[1] ? units[1].price : '',
      Source: 'attach'
    };
    record.Price = units.reduce((sum, u) => sum + (hasPrice(u.price) ? Number(u.price) : 0), 0) || '';

    const cfHeaders = ctx.ss.headers(SHEETS.CLEANFORM);
    ctx.ss.appendRow(SHEETS.CLEANFORM, cfHeaders.map(h => (record[h] !== undefined ? record[h] : '')));

    await ctx.ss.flush();

    return {
      ...uploaded,
      planClosed,
      forms: await getCleaningForms(ctx),
      history: await getHistory(ctx)
    };
  });
}
