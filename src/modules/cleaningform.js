import { SHEETS, cleanFormColKind } from '../schema.js';

/**
 * ชนิดเอกสารของโมดูลนี้ — ใช้บอกที่เก็บว่าไฟล์ของใบล้างไปอยู่โฟลเดอร์ไหน
 *
 * ไฟล์ PDF ไปที่ data/docs/cleaning/<ปี>/<เดือน>/ และรูปไปที่ data/photos/cleaning/
 * แยกจากงานซ่อมซึ่งใช้ 'repair' เพราะเป็นคนละแบบฟอร์มควบคุม และคนที่ไปหยิบไฟล์
 * ไปเก็บมักหยิบทีละประเภท ไม่ได้หยิบทั้งกอง
 */
const KIND = 'cleaning';
import { assertMoney, cleanFormValue, isAwaitingInstall, isRetiredStatus, normalizeCode, normalizeSiteCode, plainText, ymdhms, ymd } from '../values.js';
import { addHistoryRaw, deleteHistoryWhereRaw, getHistory, makeHistoryId, newestFirst, usedDocNumbers } from './history.js';
import { unitsInScope } from './airlist.js';
import { jobKey } from '../context.js';
import { assertRoundsInOrder, closePlanRound, reopenPlanRoundRaw } from './plan.js';
import { scheduleDocPdf, cancelDocPdf, settleDocPdfQueue } from './doc-pdf-queue.js';
import {
  startApproval, resetApproval, removeApproval, signOptsOf, attachApprovals, approvalRowOf, isPending, freshFormId
} from './approval.js';

/**
 * ฟอร์มบันทึกผลการล้างเครื่องปรับอากาศ
 *
 * มี 2 ทางที่บันทึกผลล้างได้ และทั้งสองทางปิดงานในแผนได้เหมือนกัน:
 *
 *   1. กรอกฟอร์มในระบบ (saveCleaningForm)
 *      ระบบประกอบเอกสารให้ดูและปริ้นได้ทุกเมื่อ ไม่ต้องสร้างไฟล์ค้างไว้
 *
 *   2. แนบเอกสารที่เขียนด้วยมือ (uploadNodeDocuments)
 *      ปริ้นฟอร์มเปล่าไปเขียนหน้างาน ถ่ายรูปแล้วแนบกลับ
 *      เหมาะกับช่างที่สะดวกเขียนมากกว่าพิมพ์
 *
 * ทั้งสองทางรองรับการล้าง 1 หรือ 2 เครื่องในครั้งเดียว โดยกรอกราคาแยกรายเครื่อง
 */

/**
 * ที่อยู่ของฟอนต์และโลโก้ที่ใช้ในเอกสาร
 *
 * ทั้งสองไฟล์เสิร์ฟจากเครื่องเราเอง เอกสารจึงไม่ดึงอะไรจากอินเทอร์เน็ตเลย
 * โลโก้เป็นไฟล์เดียวกับที่อยู่ในแบบฟอร์ม Excel ตัวจริง
 */
const DOC_ASSETS = { fontHref: '/vendor/fonts.css', logoHref: '/assets/form-logo.png' };

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
function nextDocNo(ctx, eventType, date, alsoUsed = []) {
  return makeHistoryId(eventType, date, [...usedDocNumbers(ctx), ...alsoUsed]);
}

/**
 * ออกเลขให้เครื่องที่ยังไม่มีเลข ในใบที่กำลังจะเขียน
 *
 * ============================================================================
 * ทำไมเครื่องละเลข ทั้งที่เป็นเอกสารใบเดียวกัน
 * ============================================================================
 * ตัวเอกสารที่ปริ้นรวมสองเครื่องไว้ในใบเดียวตามแบบฟอร์มกระดาษ แต่หน่วยที่คน
 * ตามงานจริงคือ "การล้างของเครื่องแต่ละตัว" ซึ่งควรมีเลขของตัวเองไว้อ้างอิง
 *
 * เลขของเครื่องตัวแรกอยู่คอลัมน์ DocNo เดิม ตัวที่สองอยู่ DocNo2
 * (ชื่อไม่สมมาตรเพราะแก้ฐานข้อมูลได้แค่เพิ่มคอลัมน์ เปลี่ยนชื่อของเดิมไม่ได้)
 *
 * ⚠️ ตัวออกเลขนับจากแถวที่มีอยู่จริงเท่านั้น ยังไม่เห็นเลขที่ยังไม่ได้เขียนลงแถว
 * จึงต้องส่งเลขที่เพิ่งออกในรอบเดียวกันกลับเข้าไปเอง ไม่งั้นเครื่องทั้งสองตัว
 * จะได้เลขเดียวกัน
 *
 * @param {Object} view   หน้าตาของแถวหลังเขียนแล้ว (ใช้ดูว่าช่องไหนมีเครื่อง/มีเลขแล้ว)
 * @param {Object} target ที่ให้เขียนเลขใหม่ลงไป — ตอนรวมใบคือ payload ไม่ใช่แถวเดิม
 */
function assignDocNumbers(ctx, view, date, target = view) {
  const issued = [];

  for (const slot of [1, 2]) {
    const col = slot === 2 ? 'DocNo2' : 'DocNo';
    if (!plainText(view['AirCode' + slot]).trim()) continue;   // ไม่มีเครื่องในช่องนี้

    const have = plainText(view[col]).trim();
    if (have) { issued.push(have); continue; }                 // มีเลขอยู่แล้ว

    const next = nextDocNo(ctx, 'ล้างแอร์', date, issued);
    target[col] = next;
    issued.push(next);
  }

  return issued;
}

/* ==================== Node / Serial สำหรับ dropdown ==================== */

/**
 * จัดกลุ่มเครื่องตาม Node เพื่อให้เลือก Node แล้วดึง Serial/Asset/Brand/BTU มาเติมอัตโนมัติ
 *
 * ใช้ทั้งฟอร์มล้างและฟอร์มติดตั้ง จึงเปิดให้คนที่มีสิทธิ์ดูเอกสารแบบใดแบบหนึ่ง
 * ไม่ได้ผูกกับสิทธิ์เมนูรายการเครื่อง (ดูเหตุผลที่ unitsInScope ใน airlist.js)
 */
export async function getCleaningFormNodes(ctx) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform')) && !(await ctx.canView('installform'))) return [];

  const list = await unitsInScope(ctx); // กรองตามภูมิภาคแล้ว
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
      CleaningPrice: plainText(a.CleaningPricePerRound),
      // รอใบติดตั้งอนุมัติ — ยังอยู่ในรายการนี้เพราะฟอร์มติดตั้งต้องใช้ (ลำดับเครื่องใน Node)
      // แต่ฝั่งใบล้างซ่อนไว้ (หน้าเว็บ cleanUnitsOf) และบันทึกใบล้างไม่ได้ (assertCleanable)
      Awaiting: isAwaitingInstall(a.Status),
      // ตำแหน่งที่ไม่มีเครื่อง (ย้ายออก/รอเปลี่ยนเครื่อง/Write off) — ฝั่งใบล้างซ่อนไว้เหมือนกัน
      Retired: isRetiredStatus(a.Status)
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
 *
 * แถวประวัติของแต่ละเครื่องใช้เลขเอกสารของเครื่องนั้น (opts.form = แถวใบล้างที่มี DocNo/DocNo2)
 * เดิมออกเลขใหม่ให้แถวประวัติ การล้างครั้งเดียวเลยมีสองเลข (ใบ PM2609-01 แต่ประวัติ PM2609-02)
 */
async function writeCleaningHistory(ctx, units, opts) {
  const roundTxt = (opts.planYear && opts.planRound)
    ? ` รอบที่ ${opts.planRound}/${opts.planYear}` : '';
  const via = opts.source === 'attach' ? '(เอกสารแนบ)' : '(ฟอร์ม)';

  for (const u of units) {
    // ผลประเมินเป็นของรายเครื่อง ประวัติของแต่ละเครื่องจึงต้องได้ผลของตัวเอง
    const cond = plainText(u.cond);
    const f = opts.form || {};
    // หาเลขจากรหัสเครื่อง ไม่ใช่ช่องของ record — ตอนรวมเข้าใบเดิม เครื่องอาจลงคนละช่องกับที่กรอกมา
    const same = c => plainText(c).trim() === u.airCode;
    const docNo = same(f.AirCode1) ? f.DocNo
      : same(f.AirCode2) ? f.DocNo2 : '';
    await addHistoryRaw(ctx, {
      AirCode: u.airCode,
      Date: opts.date,
      EventType: 'ล้างแอร์',
      Detail: `ล้างเครื่องปรับอากาศ ${via}${roundTxt} Node "${opts.nodeName}"` +
              (cond ? ` ผลประเมิน: ${cond}` : '') +
              (opts.docUrl ? ` — เอกสาร: ${opts.docUrl}` : ''),
      Cost: hasPrice(u.price) ? Number(u.price) : '',
      Technician: opts.technician || ''
    }, { docNo: plainText(docNo).trim() });
  }
}

/**
 * รวมรายการเครื่องที่เลือก พร้อมราคาและผลประเมินของเครื่องนั้น
 * รองรับข้อมูลเก่าที่ส่งมาแค่ยอดรวม (Price) โดยไม่มีราคารายเครื่อง
 */
function unitsFromRecord(record) {
  const out = [];

  for (const slot of [1, 2]) {
    const c = slotCols(slot);
    const code = plainText(record[c.code]).trim();
    if (!code) continue;
    out.push({ slot, airCode: code, price: record[c.price], cond: plainText(record[c.cond]) });
  }

  // ข้อมูลรุ่นเก่าส่งมาแค่ยอดรวม — ให้ถือว่าเป็นราคาของเครื่องแรกที่มีในใบ
  // เครื่องที่เหลือปล่อยว่างไว้ (แผนจะคงราคาที่ตั้งไว้เดิมของเครื่องนั้น)
  if (out.length && !hasPrice(out[0].price) && hasPrice(record.Price)) out[0].price = record.Price;

  for (const u of out) u.price = hasPrice(u.price) ? Number(u.price) : '';
  return out;
}

/* ==================== ช่องเครื่องที่ 1 / 2 ==================== */

/**
 * เครื่องนี้เป็นเครื่องที่เท่าไหร่ของไซต์ — อ่านจากเลขท้ายรหัส
 *
 * ยึดเลขในรหัส ไม่ใช่ลำดับที่เครื่องปรากฏในรายการ เพราะลำดับในรายการมาจาก
 * ลำดับที่เพิ่มเข้าระบบ ซึ่งไม่รับประกันว่าเรียงตามเลขเครื่อง
 * (ในข้อมูลจริงมีไซต์หนึ่งคือ BKK-MBI ที่ AIR-2 มาก่อน AIR-1 — ถ้ายึดลำดับ
 *  ข้อมูลของสองเครื่องนี้จะลงสลับคอลัมน์กันบนเอกสารที่ปริ้นออกมา)
 *
 * รหัสที่ไม่ได้ลงท้ายด้วยตัวเลข ให้ถือเป็นเครื่องที่ 1
 *
 * ใบหนึ่งมีช่องเครื่อง 2 ช่อง — เครื่องที่ 3 ขึ้นไปออกใบแยก หน้าตาเดิม (ดู SlotBase)
 * AIR-3 = ช่อง 1 ของใบคู่ 3–4 · AIR-4 = ช่อง 2 ของใบเดียวกัน
 */
function unitNoOf(airCode) {
  const n = Number(String(airCode == null ? '' : airCode).trim().split('-').pop());
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function unitSlotOf(airCode) {
  return ((unitNoOf(airCode) - 1) % 2) + 1;
}

/** ใบของเครื่องตัวนี้เป็นคู่ไหน — 0 = เครื่องที่ 1–2, 2 = 3–4 ... */
export function unitBaseOf(airCode) {
  return unitNoOf(airCode) - unitSlotOf(airCode);
}

/**
 * ชื่อคอลัมน์ข้อมูลเครื่องของช่องที่ระบุ
 *
 * ผลประเมินของช่องที่ 1 ใช้ชื่อคอลัมน์เดิม (EquipmentCondition) ไม่ใช่ EquipmentCondition1
 * เพราะแก้ฐานข้อมูลได้แค่ "เพิ่มคอลัมน์" เปลี่ยนชื่อของเดิมไม่ได้
 */
const slotCols = slot => ({
  code: 'AirCode' + slot,
  price: 'Price' + slot,
  cond: slot === 2 ? 'EquipmentCondition2' : 'EquipmentCondition',
  brand: 'Unit' + slot + '_Brand',
  btu: 'Unit' + slot + '_BTU',
  inSn: 'Unit' + slot + '_IndoorSerial',
  inAsset: 'Unit' + slot + '_IndoorAsset',
  outSn: 'Unit' + slot + '_OutdoorSerial',
  outAsset: 'Unit' + slot + '_OutdoorAsset'
});

/**
 * ย้ายข้อมูลเครื่องในใบที่ส่งมา ให้ไปอยู่ช่องที่ตรงกับเลขเครื่องจริง
 *
 * หน้าเว็บวางเครื่องลงช่องตามลำดับที่มันเห็น ซึ่งส่วนใหญ่ตรงอยู่แล้ว
 * แต่ฝั่งเซิร์ฟเวอร์ต้องเป็นคนตัดสินอีกชั้น เพื่อให้มีที่ตัดสินใจเรื่องนี้ที่เดียว
 * ไม่ว่าคำสั่งจะมาจากหน้าไหนก็ได้ผลเหมือนกัน
 *
 * คืนค่าเป็น { 1: {...}, 2: {...} } เฉพาะช่องที่มีเครื่องจริง
 */
function unitsBySlot(record) {
  const out = {};

  // เครื่องในใบเดียวกันต้องอยู่คู่เดียวกัน (1–2 หรือ 3–4 ...) — ข้ามคู่ต้องแยกใบ
  const bases = new Set([1, 2]
    .map(s => plainText(record[slotCols(s).code]).trim())
    .filter(Boolean)
    .map(unitBaseOf));
  if (bases.size > 1) {
    throw new Error('เอกสารล้าง 1 ใบมีเครื่องได้ 2 ตัวตามลำดับ (1–2, 3–4, …) — เครื่องที่เลือกอยู่คนละใบ กรุณาบันทึกทีละใบ');
  }

  for (const from of [1, 2]) {
    const src = slotCols(from);
    const code = plainText(record[src.code]).trim();
    if (!code) continue;

    const to = unitSlotOf(code);
    if (out[to]) {
      throw new Error('เครื่อง ' + code + ' กับ ' + out[to].code + ' เป็นเครื่องลำดับเดียวกันของไซต์ ' +
                      'บันทึกในใบเดียวกันไม่ได้');
    }

    out[to] = {
      code,
      price: record[src.price],
      // ผลประเมินติดไปกับเครื่อง ไม่ใช่ติดกับช่อง — ย้ายช่องแล้วผลต้องตามไปด้วย
      cond: record[src.cond],
      brand: record[src.brand], btu: record[src.btu],
      inSn: record[src.inSn], inAsset: record[src.inAsset],
      outSn: record[src.outSn], outAsset: record[src.outAsset]
    };
  }

  return out;
}

/**
 * ผู้รับเหมากรอกได้เฉพาะงานที่มอบหมายให้ตัวเองในแผน
 *
 * ต้องรู้ปีกับรอบเสมอ ใบที่ไม่ผูกกับรอบไหนเลย ผู้รับเหมาบันทึกไม่ได้
 * เพราะไม่มีอะไรบอกว่าเป็นงานของใคร (เจ้าหน้าที่ยังบันทึกแบบไม่ผูกรอบได้เหมือนเดิม)
 */
async function assertOwnJob(ctx, year, round, airCode) {
  if (!plainText(year).trim() || !plainText(round).trim()) {
    throw new Error('บัญชี Subcontract (ผู้รับเหมา) ต้องปิดงานจากหน้าแผนล้างแอร์ (กดที่ช่องรอบที่ได้รับมอบหมาย)');
  }
  if (!(await ctx.ownsJob(year, round, airCode))) {
    throw new Error('งานล้างรอบที่ ' + round + '/' + year + ' ของเครื่อง ' + airCode + ' ไม่ได้มอบหมายให้คุณ');
  }
}

/**
 * ราคาที่ผู้รับเหมาได้ของงานรอบนั้น — ราคาของรอบในแผนก่อน ไม่มีค่อยใช้ราคาต่อรอบในทะเบียน
 * (ราคาในแผนคือราคาที่เจ้าหน้าที่ตั้งตอนเปิดงาน อาจต่างจากราคามาตรฐานของเครื่อง)
 */
async function contractorPrice(ctx, year, round, unit) {
  const name = 'Plan_' + plainText(year).trim();
  if (await ctx.ss.hasSheet(name)) {
    await ctx.ss.load(name);
    const row = ctx.ss.objects(name).find(p => normalizeCode(p.AirCode) === normalizeCode(unit.AirCode));
    const planned = row && row['R' + plainText(round).trim() + '_Price'];
    if (hasPrice(planned)) return Number(planned);
  }
  return hasPrice(unit.CleaningPricePerRound) ? Number(unit.CleaningPricePerRound) : '';
}

/**
 * เอกสารล้างใบนี้ ผู้ใช้คนนี้เห็นได้ไหม
 *
 * เจ้าหน้าที่: ตามขอบเขตปกติ (ภูมิภาค)
 * ผู้รับเหมา: ใบของงานที่มอบหมายให้ตัวเอง (ปี + รอบ + เครื่องตรงกับงานในแผน)
 *   หรือใบที่บัญชีของผู้รับเหมาเจ้าเดียวกันเป็นคนบันทึก
 *   ไม่ใช้ขอบเขตเครื่องเฉยๆ เพราะเครื่องเดียวกันมีรอบของเจ้าอื่นปนอยู่ (ราคาของคู่แข่ง)
 */
async function cleaningFormFilter(ctx) {
  const info = await ctx.userInfo();
  if (info.role !== 'Contractor') return ctx.scopeFilter();

  const jobs = new Set(info.jobs || []);
  const want = String(info.contractorId).toUpperCase();
  const ours = new Set(ctx.ss.objects(SHEETS.USERS)
    .filter(u => String(u.ContractorID || '').trim().toUpperCase() === want)
    .map(u => String(u.Username || '').trim().toLowerCase()));

  return f => {
    if (ours.has(plainText(f.RecordedBy).trim().toLowerCase())) return true;
    const y = plainText(f.PlanYear).trim();
    const r = plainText(f.PlanRound).trim();
    if (!y || !r) return false;
    return [f.AirCode1, f.AirCode2].some(c => c && jobs.has(jobKey(y, r, normalizeCode(c))));
  };
}

async function assertCanSeeForm(ctx, form) {
  if (!(await cleaningFormFilter(ctx))(form)) throw new Error('คุณไม่มีสิทธิ์เข้าถึงเอกสารใบนี้');
}

/**
 * ผูกใบที่ส่งมากับทะเบียนเครื่อง ก่อนบันทึก
 *
 * เดิมตรวจสิทธิ์ด้วย Region ที่หน้าเว็บส่งมาเอง ซึ่งคนส่งแก้ได้ — ส่ง Region
 * ของภาคตัวเองมาคู่กับรหัสเครื่องของภาคอื่นก็ผ่าน ตอนนี้หาเครื่องทุกตัวจากทะเบียน
 * ภายในขอบเขตของผู้ใช้ แล้วเขียนข้อมูล Node (ชื่อ รหัสไซต์ ภูมิภาค จังหวัด)
 * จากทะเบียนทับของที่ส่งมา
 *
 * ต้องทับ SiteCode ด้วย เพราะด่านรวมใบ (findOpenForm) ใช้ SiteCode หาใบเดิม
 * ถ้าเชื่อค่าที่ส่งมา ผู้รับเหมาจะเขียนเครื่องของตัวเองลงไปในใบของ Node อื่นได้
 *
 * ผู้รับเหมา:
 * - ต้องเป็นงานที่มอบหมายให้เจ้านี้ในแผน (ระบุปีกับรอบมาด้วยเสมอ) ทุกเครื่องในใบ
 * - ราคาใช้ราคาของรอบนั้นในแผน (ถ้าไม่ได้ตั้ง ใช้ราคาต่อรอบในทะเบียน) ราคานี้ไปลงแผน
 *   กับงบประมาณ และคือค่าจ้างของผู้รับเหมาเอง คนรับเงินจึงเป็นคนกรอกตัวเลขเองไม่ได้
 *
 * Admin ยังบันทึกเครื่องที่ไม่มีในทะเบียนได้เหมือนเดิม (เอกสารย้อนหลังของเครื่องที่ลบไปแล้ว)
 */
/**
 * เครื่องที่ออกใบล้างได้ — ใช้ทั้งกรอกในระบบ (bindToRegistry) และแนบไฟล์ (uploadNodeDocuments)
 *
 *   รอใบติดตั้งอนุมัติ        ยังไม่นับว่ามีเครื่องอยู่จริง
 *   รื้อถอน/ปลดระวาง/Write off  ตำแหน่งที่ไม่มีเครื่องอยู่ (ย้ายออก รอเปลี่ยนเครื่อง)
 *                               เดิมกรอกได้ ได้ใบที่ไม่มีข้อมูลเครื่อง แต่ค่าล้างเข้างบ (เจอตอนตรวจทุกบทบาท 14/10)
 */
function assertCleanable(unit) {
  const status = plainText(unit.Status).trim();
  if (isAwaitingInstall(status)) {
    throw new Error('เครื่อง ' + unit.AirCode + ' รอใบติดตั้งอนุมัติครบ ยังออกใบล้างไม่ได้');
  }
  if (isRetiredStatus(status)) {
    throw new Error('ตำแหน่ง ' + unit.AirCode + ' สถานะ "' + status + '" ไม่มีเครื่องใช้งานอยู่ จึงออกใบล้างไม่ได้');
  }
}

async function bindToRegistry(ctx, record, bySlot) {
  const info = await ctx.userInfo();
  const scope = await unitsInScope(ctx);

  const found = [];
  for (const slot of Object.keys(bySlot)) {
    const code = bySlot[slot].code;
    const unit = scope.find(u => normalizeCode(u.AirCode) === normalizeCode(code));
    if (!unit) {
      if (info.role === 'Admin') continue;
      throw new Error('ไม่พบเครื่องรหัส ' + code + ' ในทะเบียนเครื่อง หรือไม่มีสิทธิ์เข้าถึง');
    }
    assertCleanable(unit);
    found.push({ slot, unit });
  }
  if (!found.length) return;

  const site = normalizeSiteCode(found[0].unit.SiteCode);
  if (found.some(f => normalizeSiteCode(f.unit.SiteCode) !== site)) {
    throw new Error('เครื่องที่เลือกอยู่คนละ Node บันทึกในใบเดียวกันไม่ได้');
  }

  const node = found[0].unit;
  record.NodeName = plainText(node.NodeName);
  record.SiteCode = plainText(node.SiteCode);
  record.Region = plainText(node.Region);
  record.Province = plainText(node.Province);
  record.LocationType = plainText(node.LocationType);

  if (info.role === 'Contractor') {
    for (const { slot, unit } of found) {
      await assertOwnJob(ctx, record.PlanYear, record.PlanRound, unit.AirCode);
      bySlot[slot].price = await contractorPrice(ctx, record.PlanYear, record.PlanRound, unit);
    }
    // ยอดรวมทั้งใบแบบรุ่นเก่าก็ห้ามรับ ไม่งั้นจะถูกใช้แทนราคาของเครื่องที่ทะเบียนไม่ได้ตั้งไว้
    record.Price = '';
    // ชื่อบริษัทใช้ชื่อที่ Admin ตั้งไว้ ข้อมูลเก่ามีชื่อเดียวกันถึง 7 แบบเพราะให้พิมพ์เอง
    record.CompanyName = info.contractorName;
  }
}

/** ค่าที่จะเขียนลงคอลัมน์ของช่องนั้น */
function slotPayload(slot, unit) {
  const c = slotCols(slot);
  return {
    [c.code]: unit.code,
    [c.price]: hasPrice(unit.price) ? Number(unit.price) : '',
    [c.cond]: plainText(unit.cond),
    [c.brand]: plainText(unit.brand), [c.btu]: plainText(unit.btu),
    [c.inSn]: plainText(unit.inSn), [c.inAsset]: plainText(unit.inAsset),
    [c.outSn]: plainText(unit.outSn), [c.outAsset]: plainText(unit.outAsset)
  };
}

/* ==================== รวมเครื่องที่กรอกทีหลัง เข้าใบเดิม ==================== */

const sameText = (a, b) =>
  plainText(a).trim().toLowerCase() === plainText(b).trim().toLowerCase();

/**
 * หาใบของ "การไปล้างครั้งเดียวกัน" ที่บันทึกไว้แล้ว
 *
 * ครั้งเดียวกัน = ไซต์เดียวกัน รอบเดียวกัน วันเดียวกัน
 * ต้องครบทั้งสามอย่าง — ไปล้างคนละวันคือไปคนละครั้ง ซึ่งตามแบบฟอร์มกระดาษ
 * คือคนละใบ (ใบหนึ่งมีช่องวันที่กับเวลาเข้า-ออกชุดเดียว)
 *
 * ไม่รวมกับใบที่มาจากการแนบเอกสาร เพราะใบพวกนั้นไม่มีข้อมูลเช็คลิสต์ให้รวม
 */
function findOpenForm(ctx, record) {
  const year = plainText(record.PlanYear).trim();
  const round = plainText(record.PlanRound).trim();
  const base = Number(record.SlotBase) || 0;

  // ใบที่ไม่ได้ผูกกับรอบไหน รวมกันไม่ได้ เพราะไม่มีอะไรบอกว่าเป็นครั้งเดียวกัน
  if (!year || !round) return null;

  return ctx.ss.objects(SHEETS.CLEANFORM).find(f =>
    plainText(f.Source) !== 'attach' &&
    sameText(f.SiteCode, record.SiteCode) &&
    sameText(f.PlanYear, year) &&
    sameText(f.PlanRound, round) &&
    sameText(f.Date, record.Date) &&
    // คนละคู่เครื่อง = คนละใบ (AIR-1 กับ AIR-3 วันเดียวกันก็ยังเป็นสองใบ)
    (Number(f.SlotBase) || 0) === base
  ) || null;
}

/**
 * เติมเครื่องที่เพิ่งกรอก ลงในใบที่มีอยู่แล้ว
 *
 * เขียนเฉพาะช่องที่ยังว่าง ไม่เขียนทับข้อมูลที่กรอกไว้ก่อนหน้า
 * ถ้าช่องของเครื่องนั้นมีข้อมูลอยู่แล้ว แปลว่ากำลังบันทึกซ้ำ ให้หยุดและบอกเลขใบ
 * (ในข้อมูลจริงมีใบซ้ำแบบนี้อยู่แล้วหนึ่งคู่ ซึ่งเกิดจากไม่มีด่านนี้)
 */
function mergeIntoForm(ctx, existing, record, bySlot) {
  const row = existing._row;
  const docNo = plainText(existing.DocNo) || plainText(existing.ID);
  const payload = {};

  for (const slot of [1, 2]) {
    const unit = bySlot[slot];
    if (!unit) continue;

    const taken = plainText(existing[slotCols(slot).code]).trim();
    if (taken) {
      throw new Error(
        'เครื่อง ' + taken + ' ถูกบันทึกไว้ในเอกสาร ' + docNo + ' แล้ว ' +
        '(ไซต์เดียวกัน รอบเดียวกัน วันเดียวกัน) — ถ้าต้องการแก้ไข ให้ลบใบเดิมก่อน'
      );
    }
    Object.assign(payload, slotPayload(slot, unit));
  }

  if (!Object.keys(payload).length) return;   // ไม่มีเครื่องใหม่ให้เติม

  // เครื่องที่เพิ่งเติมเข้ามาต้องได้เลขของตัวเอง เหมือนตอนกรอกทั้งสองเครื่องพร้อมกัน
  // ส่งเลขที่ใบนี้ถืออยู่แล้วเข้าไปด้วย ตัวออกเลขจะได้ไม่ออกเลขซ้ำกับของเดิม
  assignDocNumbers(ctx, { ...existing, ...payload }, existing.Date, payload);

  // เช็คลิสต์: เอาของเดิมเป็นหลัก แล้วเติมเฉพาะคอลัมน์ของเครื่องที่เพิ่งกรอก
  payload.ChecklistJSON = JSON.stringify(
    mergeChecklists(existing.ChecklistJSON, record.Checklist || [], Object.keys(bySlot).map(Number))
  );

  // ยอดรวมทั้งใบ คิดใหม่จากราคาของทั้งสองช่องหลังรวมแล้ว
  const p1 = payload.Price1 !== undefined ? payload.Price1 : existing.Price1;
  const p2 = payload.Price2 !== undefined ? payload.Price2 : existing.Price2;
  payload.Price = (Number(p1) || 0) + (Number(p2) || 0) || '';

  // เวลาต้องรวมกัน ไม่ใช่เอาของใบแรกแล้วทิ้งของใบหลัง (ดู mergeWorkTime)
  Object.assign(payload, mergeWorkTime(existing, record));

  // ช่องส่วนกลางของใบ เติมให้เฉพาะที่ยังว่างอยู่ ไม่ทับของเดิม
  // ผลประเมินไม่อยู่ในรายการนี้ เพราะเป็นของรายเครื่อง — slotPayload เขียนให้ตามช่องของมันเอง
  for (const col of ['AdditionalNote', 'CompanyName', 'TechnicianName', 'SupervisorName']) {
    if (!plainText(existing[col]).trim() && plainText(record[col]).trim()) {
      payload[col] = record[col];
    }
  }

  // ไฟล์เดิมมีข้อมูลแค่เครื่องเดียว พอรวมแล้วจึงไม่ตรงกับใบอีกต่อไป
  // ล้างทิ้งแล้วให้กดสร้างใหม่ ดีกว่าเก็บไฟล์ที่ข้อมูลไม่ครบไว้โดยไม่มีใครรู้
  payload.PdfUrl = '';
  payload.PdfFileId = '';

  ctx.ss.writeByHeaders(SHEETS.CLEANFORM, row, payload);
}

/* ==================== เวลาทำงานของใบที่รวมกัน ==================== */

/** "09:30" -> 570 นาที · ค่าที่อ่านไม่ออกคืน null ไม่ใช่ 0 (0 คือเที่ยงคืนจริงๆ) */
function minutesOf(hhmm) {
  const m = plainText(hhmm).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 570 -> "09:30" */
const hhmmOf = mins => String(Math.floor(mins / 60) % 24).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');

/** 190 -> "3 ชม. 10 นาที" — รูปแบบเดียวกับที่หน้าเว็บคำนวณให้ตอนกรอกใบเดียว */
const durationText = mins => Math.floor(mins / 60) + ' ชม. ' + (mins % 60) + ' นาที';

/**
 * ช่วงเวลาทำงานของใบหนึ่ง คืน null ถ้ากรอกไม่ครบ
 * เลิกงานเป็นตัวเลขน้อยกว่าเริ่มงาน = ข้ามเที่ยงคืน (กติกาเดียวกับ computeDuration_ ในหน้าเว็บ)
 */
function spanOf(row) {
  const from = minutesOf(row.TimeStart);
  const to = minutesOf(row.TimeEnd);
  if (from === null || to === null) return null;
  return { from, to: to < from ? to + 24 * 60 : to };
}

/**
 * รวมเวลาทำงานของสองใบที่กำลังถูกรวมเป็นใบเดียว
 *
 * ============================================================================
 * ปัญหาที่ตัวนี้แก้
 * ============================================================================
 * ของเดิมเวลาถูกนับเป็น "ช่องส่วนกลาง" ที่เติมให้เฉพาะตอนยังว่าง แปลว่าถ้าเครื่อง
 * แรกกรอก 09:00-10:30 ไว้แล้ว เครื่องที่สองกรอก 14:00-15:30 ตามมา เวลาของ
 * เครื่องที่สองจะถูกทิ้งเงียบๆ เอกสารขึ้นแค่ 09:00-10:30 ทั้งที่อยู่หน้างานถึงบ่าย
 *
 * ============================================================================
 * ทำไมไม่บวกเวลาตรงๆ
 * ============================================================================
 * เพราะหน้างานล้างสองตัวพร้อมกันเป็นเรื่องปกติ ซึ่งจะกรอกเวลามาทับกัน
 * เช่น 09:00-10:30 ทั้งสองเครื่อง ถ้าบวกกันจะได้ 3 ชม. ทั้งที่ทำงานจริง 1.5 ชม.
 *
 * จึงคิดจาก "ช่วงเวลาที่ถูกครอบคลุมจริง" ซึ่งถูกทั้งสามแบบ
 *   ล้างคนละช่วง  09:00-10:30 + 14:00-15:30  ->  เริ่ม 09:00 จบ 15:30 รวม 3 ชม.
 *   ล้างพร้อมกัน   09:00-10:30 + 09:00-10:30  ->  เริ่ม 09:00 จบ 10:30 รวม 1 ชม. 30 นาที
 *   คาบเกี่ยวกัน   09:00-10:30 + 10:00-11:00  ->  เริ่ม 09:00 จบ 11:00 รวม 2 ชม.
 *
 * ช่องบนแบบฟอร์มจึงอ่านได้ตรงตัว — "เวลาเริ่ม–สิ้นสุด" คือช่วงที่อยู่หน้างาน
 * ส่วน "รวมเวลา" คือเวลาที่ลงมือจริง
 *
 * @returns {Object} ช่องที่ต้องเขียนทับ — ว่างเปล่าถ้าไม่มีอะไรต้องเปลี่ยน
 */
function mergeWorkTime(existing, record) {
  const spans = [spanOf(existing), spanOf(record)].filter(Boolean);

  // ใบใดใบหนึ่งกรอกเวลาไม่ครบ ยึดของที่กรอกครบไว้ ดีกว่าลบทิ้งทั้งคู่
  if (!spans.length) return {};
  if (spans.length === 1) {
    const only = spans[0];
    return { TimeStart: hhmmOf(only.from), TimeEnd: hhmmOf(only.to), TotalTime: durationText(only.to - only.from) };
  }

  spans.sort((a, b) => a.from - b.from);

  // รวมช่วงที่ทับกันเข้าด้วยกันก่อน แล้วค่อยบวกความยาวของช่วงที่เหลือ
  const merged = [spans[0]];
  for (const s of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (s.from <= last.to) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  }

  const worked = merged.reduce((sum, s) => sum + (s.to - s.from), 0);
  return {
    TimeStart: hhmmOf(merged[0].from),
    TimeEnd: hhmmOf(merged[merged.length - 1].to),
    TotalTime: durationText(worked)
  };
}

/** รวมเช็คลิสต์สองชุด โดยหยิบเฉพาะคอลัมน์ของช่องที่ระบุมาจากชุดใหม่ */
function mergeChecklists(existingJson, incoming, slots) {
  let base = [];
  try { base = JSON.parse(existingJson || '[]'); } catch { base = []; }
  if (!Array.isArray(base)) base = [];

  const byNo = new Map(base.map(item => [String(item && item.no), { ...item }]));

  for (const item of incoming) {
    const key = String(item && item.no);
    const target = byNo.get(key) || { no: item.no, label: item.label, val1: '', val2: '', note: '' };

    for (const slot of slots) {
      const col = 'val' + slot;
      if (item[col] !== undefined && item[col] !== '') target[col] = item[col];
    }
    // หมายเหตุเป็นของทั้งแถว เติมให้เฉพาะตอนที่ยังว่าง
    if (!plainText(target.note).trim() && plainText(item.note).trim()) target.note = item.note;

    byNo.set(key, target);
  }

  return [...byNo.values()];
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

  list = list.filter(await cleaningFormFilter(ctx));

  // เรียงใหม่ก่อนเก่า — ใบที่บันทึกวินาทีเดียวกันตัดสินด้วยลำดับที่เข้ามา
  // (เกิดขึ้นจริงตอนรวมใบ ซึ่งเขียนสองแถวติดกันในคำสั่งเดียว)
  return attachApprovals(ctx, KIND, list.sort(newestFirst('CreatedAt')));
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
  assertMoney('ค่าล้างเครื่องที่ 1', record.Price1);
  assertMoney('ค่าล้างเครื่องที่ 2', record.Price2);
  assertMoney('ค่าล้าง', record.Price);

  // จัดเครื่องลงช่องตามเลขเครื่องจริง ก่อนทำอย่างอื่นทั้งหมด
  const bySlot = unitsBySlot(record);
  await bindToRegistry(ctx, record, bySlot);
  for (const slot of [1, 2]) {
    Object.assign(record, bySlot[slot]
      ? slotPayload(slot, bySlot[slot])
      : slotPayload(slot, { code: '', price: '' }));
  }

  const units = unitsFromRecord(record);
  // คู่เครื่องของใบนี้ ตัดสินจากรหัสเครื่องที่เซิร์ฟเวอร์จัดช่องให้แล้ว ไม่เชื่อค่าที่หน้าเว็บส่งมา
  record.SlotBase = units.length ? unitBaseOf(units[0].airCode) : 0;

  record.ID = 'CF' + Date.now();
  record.ChecklistJSON = JSON.stringify(record.Checklist || []);
  record.CreatedAt = ymdhms(new Date());
  record.RecordedBy = await ctx.currentUser();
  record.Source = 'form';
  // คอลัมน์ Price เก็บยอดรวมทั้งใบไว้เพื่อให้ตารางสรุปอ่านง่าย
  // ส่วนการคิดงบจริงใช้ราคารายเครื่องที่ลงในประวัติ
  record.Price = units.reduce((sum, u) => sum + (hasPrice(u.price) ? Number(u.price) : 0), 0) || '';

  // ---------- ไม่สร้างไฟล์ตอนบันทึกอีกแล้ว ----------
  //
  // เดิมตรงนี้ส่งข้อมูลไป Apps Script ให้ Google สร้าง PDF ซึ่งต้องออกเน็ต
  // ใช้เวลา 7-8 วินาทีต่อใบ และคิวตันเมื่อมีคนกดบันทึกพร้อมกัน
  //
  // ตอนนี้ระบบประกอบเอกสารจากข้อมูลที่บันทึกไว้ได้ทุกเมื่อ (getCleaningDocHtml)
  // จึงไม่มีเหตุผลต้องสร้างไฟล์ค้างไว้ตั้งแต่ตอนบันทึก การบันทึกเลยเหลือแค่
  // งานฐานข้อมูล ซึ่งเสร็จในหลักมิลลิวินาที และทำงานได้แม้เน็ตล่ม
  //
  // ใบเก่าที่มีลิงก์ Google อยู่แล้ว ไม่ถูกแตะ ยังเปิดได้ตามเดิม
  record.PdfUrl = '';
  record.PdfFileId = '';

  // ---------- เขียนฐานข้อมูล (ต้องถือล็อก แต่ใช้เวลาสั้นมาก) ----------
  const saved = await ctx.withLock(async () => {
    await ctx.ensureBase();
    await assertRoundsInOrder(ctx, { year: record.PlanYear, round: record.PlanRound, airCodes: units.map(u => u.airCode) });

    // ---------- ใบเดิมของไซต์นี้ รอบนี้ วันเดียวกัน มีอยู่แล้วหรือยัง ----------
    //
    // เอกสารหนึ่งใบ = การไปล้างหนึ่งครั้ง ซึ่งครอบคลุมเครื่องในไซต์ได้ถึงสองตัว
    // ช่างกรอกทีละเครื่องได้ แต่ต้องรวมลงใบเดียวกัน ไม่ใช่งอกใบใหม่ทุกครั้งที่กรอก
    // (ในข้อมูลจริงมีอยู่แล้วหลายคู่ที่ควรเป็นใบเดียวแต่กลายเป็นสองใบ)
    //
    // ยึด "วันเดียวกัน" เป็นเงื่อนไขด้วย เพราะถ้าไปล้างคนละวันคือไปคนละครั้ง
    // ซึ่งตามแบบฟอร์มกระดาษคือคนละใบ (ใบหนึ่งมีช่องวันที่และเวลาเข้า-ออกชุดเดียว)
    const existing = findOpenForm(ctx, record);
    let savedForm = record;
    let movedFrom = '';

    if (existing) {
      mergeIntoForm(ctx, existing, record, bySlot);
      // เพิ่มเครื่องเข้าใบเดิม = เนื้อเอกสารเปลี่ยน ต้องอนุมัติใหม่ตั้งแต่ขั้น 2
      // ใบที่ยังไม่มีขั้นอนุมัติ (บันทึกก่อนเปิดใช้) เริ่มให้ตอนนี้ เพราะถูกแก้หลังจากนั้นแล้ว
      if (approvalRowOf(ctx, KIND, existing.ID)) resetApproval(ctx, KIND, existing.ID);
      else await startApproval(ctx, KIND, existing.ID);
      // อ่านแถวใหม่หลังรวม — การรวมอาจออกเลขช่องที่ 1 ให้ใบที่เดิมมีแค่เครื่องที่ 2
      // ซึ่งทำให้ชื่อที่เก็บรูปของใบนี้เปลี่ยน (ดู fileKeyOf) รูปเดิมต้องย้ายตามไป
      savedForm = ctx.ss.objects(SHEETS.CLEANFORM).find(f => f._row === existing._row) || existing;
      if (fileKeyOf(existing) !== fileKeyOf(savedForm)) movedFrom = fileKeyOf(existing);
    } else {
      // ออกเลขในล็อกเสมอ เพื่อไม่ให้สองคนที่บันทึกพร้อมกันได้เลขเดียวกัน
      record.DocType = 'cleaning';
      record.ID = freshFormId(ctx, SHEETS.CLEANFORM, 'CF');
      assignDocNumbers(ctx, record, record.Date);

      const headers = ctx.ss.headers(SHEETS.CLEANFORM);
      ctx.ss.appendRow(SHEETS.CLEANFORM, headers.map(h => (record[h] !== undefined ? record[h] : '')));
      await startApproval(ctx, KIND, record.ID);
    }

    // ---------- ปิดงานในแผนล้างแอร์ (เฉพาะกรณีที่รู้ว่าเป็นรอบไหน) ----------
    // กรอกจากหน้าแผน = รู้ปีและรอบ จึงปิดงานให้ได้เลย ทั้ง 1 และ 2 เครื่อง
    // กรอกจากแท็บฟอร์มโดยตรงโดยไม่ระบุรอบ = บันทึกเป็นเอกสารอย่างเดียว ไม่ไปแตะแผน
    const planClosed = await closeRoundsForUnits(ctx, units, {
      planYear: record.PlanYear,
      planRound: record.PlanRound,
      date: record.Date,
      technician: record.TechnicianName,
      // ไม่มีไฟล์ค้างไว้แล้ว เอกสารเปิดดูได้จากหน้าแบบฟอร์มเอกสารทุกเมื่อ
      docUrl: ''
    });

    await writeCleaningHistory(ctx, units, {
      date: record.Date,
      technician: record.TechnicianName,
      nodeName: record.NodeName,
      docUrl: '',
      planYear: record.PlanYear,
      planRound: record.PlanRound,
      source: 'form',
      form: savedForm
    });

    await ctx.ss.flush();
    if (movedFrom) moveDocFiles(ctx, movedFrom, fileKeyOf(savedForm));

    const shown = docNoShown(savedForm);
    return {
      planClosed,
      mergedInto: existing ? shown : '',
      // เลขที่ไว้โชว์ — ใบที่มีแค่เครื่องที่ 2 ไม่มีเลขช่องที่ 1 ต้องใช้เลขช่องที่ 2
      docNo: shown,
      // หน้าเว็บใช้หาแถวของใบที่เพิ่งบันทึก เพื่อส่งรูปตามขึ้นไป
      // เดิมหาด้วย docNo ซึ่งว่างเมื่อใบมีแค่เครื่องที่ 2 รูปจึงไม่ถูกส่งเลยสักใบ
      id: plainText(savedForm.ID),
      fileKey: fileKeyOf(savedForm),
      forms: await getCleaningForms(ctx),
      history: await getHistory(ctx)
    };
  });

  // ---------- เก็บสำเนา PDF ไว้บนเซิร์ฟเวอร์ (นอกล็อก) ----------
  //
  // อยู่นอกล็อกเพราะต้องรอเบราว์เซอร์แปลงไฟล์ ซึ่งนานกว่างานฐานข้อมูลมาก
  // ถ้าทำในล็อก ล็อกจะถูกถือไว้จนถูกยกให้คนถัดไป แล้วเกิดการเขียนชนกัน
  // (เหตุผลเดียวกับที่ย้ายการสร้าง PDF ออกมานอกล็อกตั้งแต่แรก)
  //
  // ตอนนี้ยังไม่มีรูปถ่าย เพราะรูปแนบทีหลังจากปุ่ม "รูปถ่าย"
  // ไฟล์จะถูกสร้างทับใหม่ทุกครั้งที่แนบหรือลบรูป จึงตามทันเสมอ
  await storeDocPdf(ctx, saved.fileKey);

  // ส่ง id กลับไปด้วย หน้าเว็บใช้หาแถวของใบที่เพิ่งบันทึก
  // เพื่อส่งรูปถ่ายที่แนบมากับฟอร์มตามขึ้นไปทันที (รูปผูกกับเอกสาร ไม่ใช่กับการกรอก)
  return saved;
}

/**
 * ชื่อที่ใช้เก็บรูปและไฟล์ PDF ของใบ — เลขช่องที่ 1 ถ้ามี ไม่มีใช้ ID ของแถว
 *
 * ต้องตรงกับที่ formForPhotos / getCleaningDocHtml / storeDocPdf ใช้ทุกที่
 * (ไม่เปลี่ยนกติกานี้ เพราะรูปที่เก็บไว้แล้วผูกกับชื่อนี้อยู่)
 */
const fileKeyOf = form => plainText(form.DocNo) || plainText(form.ID);

/** เลขที่เอกสารที่ใช้โชว์ — ใบที่มีแค่เครื่องที่ 2 ใช้เลขของเครื่องนั้น */
const docNoShown = form => plainText(form.DocNo) || plainText(form.DocNo2) || plainText(form.ID);

/**
 * ย้ายรูปของใบไปไว้ใต้ชื่อใหม่ เมื่อชื่อที่เก็บเปลี่ยน
 *
 * เกิดตอนกรอกเครื่องที่ 2 ก่อน (ใบมีแค่เลขช่องที่ 2 รูปจึงเก็บด้วย ID ของแถว)
 * แล้วกรอกเครื่องที่ 1 ของการไปล้างครั้งเดียวกันตามมา — ระบบรวมเป็นใบเดียวและออกเลข
 * ช่องที่ 1 ให้ ใบนี้จึงไปหารูปด้วยเลขนั้นแทน ถ้าไม่ย้าย รูปของเครื่องที่ 2 จะหายจากเอกสาร
 *
 * ห้ามพัง — ข้อมูลบันทึกไปแล้ว ถ้าย้ายไม่สำเร็จ รูปยังอยู่ที่เดิมครบ (ลบที่เดิมเมื่อคัดลอกครบแล้วเท่านั้น)
 */
function moveDocFiles(ctx, from, to) {
  if (!from || !to || from === to) return;
  if (ctx.photos) {
    try {
      for (const [key, dataUrl] of Object.entries(ctx.photos.readAll(KIND, from))) {
        const [slot, index] = key.split('-').map(Number);
        ctx.photos.save(KIND, to, slot, index, dataUrl);
      }
      ctx.photos.removeAll(KIND, from);
    } catch (err) {
      console.error('[ย้ายรูปใบล้าง ' + from + ' → ' + to + ']', err && err.message ? err.message : err);
    }
  }
  // ไฟล์ PDF ใต้ชื่อเดิมล้าสมัยแล้ว ตัวใหม่จะถูกสร้างใต้ชื่อใหม่หลังบันทึก
  if (ctx.docs) {
    cancelDocPdf(from);
    try { ctx.docs.remove(KIND, from); } catch { /* ไฟล์ค้างดีกว่าบันทึกพัง */ }
  }
}

/**
 * หน้าฟอร์มเปล่าของ Node ที่เลือก สำหรับปริ้นไปเขียนด้วยมือหน้างาน
 *
 * เติมข้อมูลเครื่องให้อัตโนมัติ (ชื่อ Node, Serial, Asset, BTU, ยี่ห้อ)
 * ส่วนช่องที่ต้องวัดหน้างานเว้นว่างไว้ให้เขียนเอง
 *
 * ไม่บันทึกอะไรลงฐานข้อมูลทั้งสิ้น และไม่สร้างไฟล์ค้างไว้ที่ไหน
 */
export async function getCleaningBlankDocHtml(ctx, record) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) throw new Error('ไม่มีสิทธิ์เข้าถึงเมนูนี้');

  const payload = { ...(record || {}) };
  payload.DocNo = '(ฟอร์มเปล่า — ยังไม่ได้บันทึก)';
  payload.ChecklistJSON = JSON.stringify(payload.Checklist || []);

  const { buildCleaningDocHtml } = await import('./cleaning-doc.js');
  return buildCleaningDocHtml(payload, DOC_ASSETS);
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

/**
 * ฟอร์มล้างเปล่าแบบ Excel ที่เติมข้อมูล Node กับเครื่องให้แล้ว
 *
 * มีไว้คู่กับฟอร์มเปล่าแบบปริ้น ต่างกันตรงที่ไฟล์นี้ "วางรูปลงไปได้"
 * เพราะกระดาษกับไฟล์ PDF แนบรูปไม่ได้ ช่างที่กรอกบนคอมพิวเตอร์จึงใช้ไฟล์นี้
 * แล้ววางรูปลงกรอบในชีตของเครื่องแต่ละตัวได้เลย
 */
export async function getCleaningBlankXlsx(ctx, record) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) throw new Error('ไม่มีสิทธิ์เข้าถึงเมนูนี้');
  if (!ctx.forms) throw new Error('เครื่องที่รันระบบอยู่ไม่มีไฟล์แบบฟอร์มแม่แบบ');

  const { buildCleaningXlsx, cleaningXlsxFileName } = await import('./cleaning-xlsx.js');
  const bytes = await buildCleaningXlsx(ctx.forms.read('cleaning'), record || {});

  return {
    base64: toBase64(bytes),
    fileName: cleaningXlsxFileName(record),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
}

/**
 * หน้าเอกสารของใบที่บันทึกไว้ สำหรับเปิดดูและสั่งปริ้น
 *
 * คืนค่าเป็นข้อความ HTML ไม่ใช่ไฟล์ — ชั้น platform เป็นคนตัดสินว่าจะส่งให้
 * เบราว์เซอร์แสดงเลย หรือเอาไปแปลงเป็นไฟล์ PDF ต่อ
 *
 * ไม่ต้องถือล็อกเพราะเป็นการอ่านอย่างเดียว
 */
export async function getCleaningDocHtml(ctx, row) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) {
    throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');
  }
  await ctx.ensureBase();

  const form = ctx.ss.objects(SHEETS.CLEANFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');

  await assertCanSeeForm(ctx, form);

  if (plainText(form.Source) === 'attach') {
    throw new Error('ใบนี้เป็นเอกสารที่แนบเข้ามา ไม่ใช่ฟอร์มที่กรอกในระบบ — เปิดดูไฟล์ที่แนบไว้ได้จากลิงก์ในตาราง');
  }

  const { buildCleaningDocHtml } = await import('./cleaning-doc.js');
  // ฟอนต์และโลโก้เสิร์ฟจากเครื่องเราเอง ไม่ได้ดึงจากอินเทอร์เน็ต
  // รูปถ่ายฝังลงไปในหน้าเลย จึงไม่มีที่อยู่ให้ใครเปิดดูโดยไม่ผ่านการตรวจสิทธิ์
  const docNo = plainText(form.DocNo) || plainText(form.ID);
  const photos = ctx.photos ? ctx.photos.readAll(KIND, docNo) : {};
  // toolbar ใส่เฉพาะตอนเปิดดูบนจอ ตอนแปลงเป็นไฟล์ PDF ไม่ใส่ (ดู renderDocPdf)
  return buildCleaningDocHtml(form, { ...DOC_ASSETS, photos, toolbar: true, ...signOptsOf(ctx, KIND, form) });
}

/* ==================== รูปถ่ายประกอบเอกสาร ==================== */

/** หาใบเอกสารจากเลขแถว พร้อมตรวจสิทธิ์ภูมิภาค */
async function formForPhotos(ctx, row) {
  await ctx.ensureBase();
  const form = ctx.ss.objects(SHEETS.CLEANFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await assertCanSeeForm(ctx, form);

  if (plainText(form.Source) === 'attach') {
    throw new Error('ใบนี้เป็นเอกสารที่แนบเข้ามา ไม่ใช่ฟอร์มที่กรอกในระบบ จึงแนบรูปเพิ่มไม่ได้');
  }

  const docNo = plainText(form.DocNo) || plainText(form.ID);
  if (!docNo) throw new Error('เอกสารใบนี้ยังไม่มีเลขที่ จึงเก็บรูปไม่ได้');

  // ต้องมีเครื่องอยู่ในช่องนั้นจริง ไม่งั้นรูปจะไปอยู่กับเครื่องที่ไม่ได้ล้าง
  return { form, docNo };
}

/** ที่เก็บรูปพร้อมใช้งานหรือไม่ — ฝั่งที่ไม่มีดิสก์ (Cloudflare) จะไม่มี */
function requirePhotoStore(ctx) {
  if (!ctx.photos) {
    throw new Error('ระบบที่รันอยู่ตอนนี้ไม่รองรับการเก็บรูป (ไม่มีที่เก็บไฟล์)');
  }
  return ctx.photos;
}

/**
 * แนบรูปหนึ่งช่องของเครื่องหนึ่งตัว
 *
 * หน้าเว็บย่อรูปให้เล็กลงก่อนส่งมาแล้ว ที่นี่เพียงตรวจว่าช่องที่ระบุมีเครื่องอยู่จริง
 * แล้วส่งต่อให้ชั้น platform เขียนลงดิสก์
 *
 * @param {Object} payload { row, unitSlot, index, dataUrl }
 */
export async function saveCleaningPhoto(ctx, payload) {
  return withFreshDocPdf(ctx, ctx.withLock(async () => {
    await ctx.assertModuleEdit('cleaningform');
    const store = requirePhotoStore(ctx);

    const { form, docNo } = await formForPhotos(ctx, payload && payload.row);
    const slot = Number(payload.unitSlot);

    if (!plainText(form['AirCode' + slot]).trim()) {
      throw new Error('ใบนี้ยังไม่มีข้อมูลเครื่องที่ ' + slot + ' จึงแนบรูปให้เครื่องนั้นไม่ได้');
    }

    const saved = store.save(KIND, docNo, slot, payload.index, payload.dataUrl);
    // รูปเปลี่ยน = เอกสารไม่ใช่ใบที่ผู้อนุมัติเห็นแล้ว ต้องอนุมัติใหม่ (ดู approval.js)
    if (resetApproval(ctx, KIND, form.ID)) await ctx.ss.flush();
    return { ok: true, docNo, bytes: saved.bytes, photos: photoIndexOf(store, docNo) };
  }));
}

/** ลบรูปของช่องที่ระบุ */
export async function deleteCleaningPhoto(ctx, payload) {
  return withFreshDocPdf(ctx, ctx.withLock(async () => {
    await ctx.assertModuleEdit('cleaningform');
    const store = requirePhotoStore(ctx);

    const { form, docNo } = await formForPhotos(ctx, payload && payload.row);
    store.remove(KIND, docNo, Number(payload.unitSlot), Number(payload.index));
    if (resetApproval(ctx, KIND, form.ID)) await ctx.ss.flush();
    return { ok: true, docNo, photos: photoIndexOf(store, docNo) };
  }));
}

/**
 * คิวสร้างไฟล์ PDF ใหม่ — รอให้คนหยุดแก้รูปก่อน แล้วค่อยทำครั้งเดียว
 *
 * ============================================================================
 * ทำไมต้องรอ ไม่ทำทันที
 * ============================================================================
 * เอกสารหนึ่งใบมีรูปได้ 9 ช่องต่อเครื่อง สองเครื่องคือ 18 รูป และช่างแนบรวดเดียว
 * การแปลงเอกสารเป็นไฟล์ PDF ใช้เวลาราว 2 วินาทีต่อครั้ง (จับเวลาจริงด้วย
 * Chrome ในเครื่อง 3 รอบ ได้ 2.1 / 2.0 / 2.1 วินาที)
 *
 * รุ่นแรกสร้างไฟล์ใหม่ทุกครั้งที่แนบหรือลบรูป ซึ่งแปลว่าช่างต้องรอรวมกัน
 * เกิน 40 วินาทีต่อเอกสารหนึ่งใบ ทั้งที่ไฟล์ 17 รอบแรกถูกทับทิ้งทั้งหมดอยู่ดี
 *
 * ตอนนี้เลื่อนออกไป DOC_PDF_DELAY_MS หลังการแก้รูปครั้งล่าสุด นับใหม่ทุกครั้ง
 * ที่มีการแก้เพิ่ม แนบรูปติดๆ กันจึงแปลงแค่รอบเดียว และคนแนบไม่ต้องรอเลย
 *
 * ============================================================================
 * ข้อมูลเก่าใน ctx ที่ค้างไว้ ใช้ได้หรือไม่
 * ============================================================================
 * ใช้ได้ เพราะงานที่เลื่อนออกไปอ่านแค่ข้อมูลของ "ใบ" ซึ่งไม่ได้เปลี่ยนระหว่าง
 * ที่คนแก้รูป ส่วนตัวรูปถูกอ่านสดจากดิสก์ทุกครั้งที่สร้างไฟล์
 */
/**
 * รอผลของงานที่แก้รูป แล้วนัดสร้างไฟล์ PDF ใหม่ให้ตรงกับรูปล่าสุด
 *
 * ไม่ส่ง docNo กลับไปให้หน้าเว็บ เพราะเป็นเรื่องภายในของฝั่งเซิร์ฟเวอร์
 */
async function withFreshDocPdf(ctx, work) {
  const { docNo, ...out } = await work;
  scheduleDocPdf(ctx, docNo, () => storeDocPdf(ctx, docNo));
  return out;
}

export { settleDocPdfQueue };

/** approval.js เรียกเก็บฉบับจริงเมื่ออนุมัติครบ */
export { storeDocPdf as storeCleaningPdf };

/** ช่องไหนมีรูปแล้วบ้าง — ส่งแค่รายชื่อช่อง ไม่ส่งตัวรูป เพื่อให้ response เบา */
function photoIndexOf(store, docNo) {
  return Object.keys(store.readAll(KIND, docNo));
}

/**
 * รูปทั้งหมดของเอกสารใบหนึ่ง พร้อมตัวรูปจริง
 *
 * ============================================================================
 * ทำไมต้องมีตัวนี้ ทั้งที่มี getCleaningPhotoIndex อยู่แล้ว
 * ============================================================================
 * ตัวเดิมบอกได้แค่ว่าช่องไหนมีรูปแล้ว ซึ่งพอสำหรับการแสดงความคืบหน้า
 * แต่ไม่พอสำหรับหน้าแก้รูป เพราะคนที่จะแก้ต้องเห็นก่อนว่ารูปเดิมเป็นยังไง
 * ถึงจะรู้ว่าใบไหนเบลอ ใบไหนถ่ายผิดเครื่อง
 *
 * รูปถูกย่อตั้งแต่ฝั่งเบราว์เซอร์ก่อนส่งขึ้นมาแล้ว (ด้านยาวสุด 1600 คุณภาพ 0.82)
 * ทั้งใบจึงอยู่ราว 3-6 MB ซึ่งหนักเกินกว่าจะโหลดตอนเปิดตาราง
 * แต่รับได้สำหรับหน้าที่ผู้ใช้ตั้งใจกดเข้าไปแก้
 */
export async function getCleaningPhotos(ctx, row) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) return {};
  if (!ctx.photos) return {};

  const { docNo } = await formForPhotos(ctx, row);
  return { docNo, photos: ctx.photos.readAll(KIND, docNo) };
}

/** รายชื่อช่องที่มีรูปแล้วของเอกสารใบหนึ่ง (หน้าเว็บใช้แสดงว่าช่องไหนกรอกแล้ว) */
export async function getCleaningPhotoIndex(ctx, row) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) return [];
  if (!ctx.photos) return [];

  const { docNo } = await formForPhotos(ctx, row);
  return photoIndexOf(ctx.photos, docNo);
}

/**
 * แปลงเอกสารใบหนึ่งเป็นไฟล์ PDF (ยังไม่เก็บ ยังไม่ส่งให้ใคร)
 *
 * ประกอบหน้าเอกสารตัวเดียวกับที่ใช้เปิดดู แล้วให้ชั้น platform สั่งเบราว์เซอร์
 * ในเครื่องแปลงเป็นไฟล์ ระบบจึงไม่ต้องมีตัวสร้าง PDF ของตัวเอง
 */
async function renderDocPdf(ctx, form) {
  const docNo = plainText(form.DocNo) || plainText(form.ID);
  // ชื่อผู้อนุมัติในช่องลงนาม + ลายน้ำ "รออนุมัติ" ถ้ายังไม่ครบ
  const sign = signOptsOf(ctx, KIND, form);
  const base = ctx.pdf.baseUrl || '';

  const { buildCleaningDocHtml } = await import('./cleaning-doc.js');
  const html = buildCleaningDocHtml(form, {
    // ที่อยู่เต็ม เพราะเบราว์เซอร์เปิดหน้านี้จากไฟล์ชั่วคราว ไม่ได้เปิดผ่านเซิร์ฟเวอร์
    fontHref: base + DOC_ASSETS.fontHref,
    logoHref: base + DOC_ASSETS.logoHref,
    photos: ctx.photos ? ctx.photos.readAll(KIND, docNo) : {},
    ...sign
  });

  return { docNo, draft: sign.draft, base64: await ctx.pdf.render(html) };
}

/**
 * เก็บสำเนา PDF ของเอกสารใบหนึ่งไว้บนเซิร์ฟเวอร์
 *
 * ============================================================================
 * ทำไมต้อง "ห้ามพัง"
 * ============================================================================
 * ตัวจริงของข้อมูลอยู่ในฐานข้อมูล ไฟล์นี้เป็นสำเนาที่สร้างใหม่ได้เสมอ
 * ถ้าเครื่องไม่มีเบราว์เซอร์ หรือดิสก์เต็ม หรือแปลงไฟล์ไม่ผ่าน ต้องไม่ทำให้
 * การบันทึกที่ลงฐานข้อมูลไปแล้วกลายเป็น "ล้มเหลว" ในสายตาผู้ใช้
 * แล้วเขากดบันทึกซ้ำจนข้อมูลซ้ำ
 *
 * เรียกซ้ำได้เสมอ — รอบหลังทับไฟล์เดิม เช่นตอนแนบรูปเพิ่มทีหลัง
 *
 * @returns {Promise<boolean>} เก็บสำเร็จหรือไม่
 */
async function storeDocPdf(ctx, docNo) {
  const name = plainText(docNo).trim();
  if (!ctx.pdf || !ctx.docs || !name) return false;

  try {
    const form = ctx.ss.objects(SHEETS.CLEANFORM)
      .find(f => (plainText(f.DocNo) || plainText(f.ID)) === name);
    if (!form || plainText(form.Source) === 'attach') return false;

    // ยังรออนุมัติ = ไม่เก็บสำเนา (สำเนาบนเซิร์ฟเวอร์มีเฉพาะฉบับที่อนุมัติครบ ดู approval.js)
    // ลบฉบับเดิมทิ้งด้วย — ใบที่เคยอนุมัติครบแล้วถูกแก้รูป ต้องไม่เหลือไฟล์เก่าที่ขึ้นชื่อผู้อนุมัติ
    if (isPending(approvalRowOf(ctx, KIND, form.ID))) {
      try { ctx.docs.remove(KIND, name); } catch { /* ไม่มีไฟล์เดิมก็ไม่เป็นไร */ }
      return false;
    }

    const { base64 } = await renderDocPdf(ctx, form);
    ctx.docs.save(KIND, name, plainText(form.Date), base64);
    return true;
  } catch (err) {
    // บอกไว้ใน log ของเซิร์ฟเวอร์พอ ไม่ต้องรบกวนคนที่กำลังกรอกฟอร์ม
    console.error('[เก็บไฟล์ PDF ' + name + ']', err && err.message ? err.message : err);
    return false;
  }
}

/**
 * แปลงเอกสารเป็นไฟล์ PDF ให้ดาวน์โหลด และเก็บสำเนาไว้บนเซิร์ฟเวอร์ไปด้วย
 *
 * @returns {Object} { fileName, mime, base64 }
 */
export async function getCleaningDocPdf(ctx, row, expectId) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) {
    throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');
  }
  if (!ctx.pdf) {
    throw new Error(
      'เครื่องที่รันระบบอยู่ไม่มีเบราว์เซอร์สำหรับแปลงเป็นไฟล์ PDF — ' +
      'กด "เปิดเอกสาร" แล้วสั่งปริ้นเองได้ผลเหมือนกัน'
    );
  }

  await ctx.ensureBase();

  // ตรวจว่าแถวนั้นยังเป็นใบเดิมอยู่จริง ก่อนสร้างไฟล์
  // ลำดับแถวเลื่อนได้ ถ้าไม่ตรวจ คนกดจะได้ไฟล์ของเอกสารใบอื่นไปโดยไม่รู้ตัว
  ctx.assertRowIs(SHEETS.CLEANFORM, row, 'ID', expectId, 'เอกสารเลขที่');

  const form = ctx.ss.objects(SHEETS.CLEANFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await assertCanSeeForm(ctx, form);

  if (plainText(form.Source) === 'attach') {
    throw new Error('ใบนี้เป็นเอกสารที่แนบเข้ามา ไม่ใช่ฟอร์มที่กรอกในระบบ');
  }

  const { docNo, base64, draft } = await renderDocPdf(ctx, form);

  // เก็บสำเนาไว้ด้วย แต่เก็บไม่ได้ก็ยังต้องได้ไฟล์ดาวน์โหลดตามที่กดมา
  // ฉบับร่าง (ยังรออนุมัติ) ไม่เก็บ — สำเนาบนเซิร์ฟเวอร์มีเฉพาะฉบับจริง
  if (ctx.docs && !draft) {
    try { ctx.docs.save(KIND, docNo, plainText(form.Date), base64); }
    catch (err) { console.error('[เก็บไฟล์ PDF ' + docNo + ']', err && err.message ? err.message : err); }
  }

  return { fileName: docNo + (draft ? '-รออนุมัติ' : '') + '.pdf', mime: 'application/pdf', base64 };
}

/**
 * ย้อนสิ่งที่ใบล้างทำไว้ตอนบันทึก — เปิดรอบในแผนกลับเป็น "รอดำเนินการ" และลบประวัติ "ล้างแอร์" ของใบนี้
 *
 * เจ้าของงานกำหนด: ลบเอกสารแล้วต้องย้อน เพราะต้องกรอกเอกสารใหม่
 * (เดิมลบใบแล้วรอบยังขึ้นล้างเสร็จ และค่าล้างยังนับในงบ ทั้งที่ไม่มีเอกสารรองรับ)
 * ประวัติของใบนี้ใช้เลขเดียวกับเลขที่เอกสารของเครื่องนั้น (ดู writeCleaningHistory) จึงหาได้ตรงตัว
 */
async function revertCleaningEffects(ctx, form) {
  if (!form) return;
  const slots = [[form.AirCode1, form.DocNo], [form.AirCode2, form.DocNo2]]
    .map(([c, d]) => [plainText(c).trim(), plainText(d).trim()])
    .filter(([c]) => c);

  const year = plainText(form.PlanYear).trim();
  const round = plainText(form.PlanRound).trim();
  if (year && round) {
    for (const [code] of slots) {
      await reopenPlanRoundRaw(ctx, { year, round, airCode: code, actualDate: form.Date });
    }
  }

  const ids = new Set(slots.map(([, d]) => d).filter(Boolean));
  await deleteHistoryWhereRaw(ctx, h =>
    ids.has(plainText(h.ID).trim()) && plainText(h.EventType).trim() === 'ล้างแอร์');
}

export async function deleteCleaningForm(ctx, row, expectId) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('cleaningform');
    // ลบแล้วรูปถ่าย ไฟล์ PDF และไฟล์ที่ช่างแนบมาหายตามไปด้วย กู้คืนไม่ได้
    // เจ้าของงานกำหนด: ลบเอกสารได้เฉพาะ Infrastructure
    await ctx.assertAdmin();
    await ctx.ensureBase();

    // เลขแถวคือ "ลำดับที่เท่าไหร่ในตาราง" ไม่ใช่ id ถาวร มีคนลบใบข้างบนไป
    // ระหว่างที่อีกคนเปิดหน้าค้างไว้ คำสั่งนี้จะไปโดนเอกสารใบถัดไปแทน
    //
    // ยิ่งสำคัญตั้งแต่ตอนที่การลบเอกสารตามไปลบรูปถ่าย ไฟล์ PDF และไฟล์ที่ช่าง
    // ถ่ายส่งมาด้วย เพราะไฟล์แนบไม่มีสำเนาที่อื่นอีกแล้ว ลบผิดใบคือหายจริง
    //
    // เทียบด้วย ID ไม่ใช่ DocNo เพราะใบเก่าบางใบยังไม่มีเลขที่เอกสาร
    ctx.assertRowIs(SHEETS.CLEANFORM, row, 'ID', expectId, 'เอกสารเลขที่');

    const headers = ctx.ss.headers(SHEETS.CLEANFORM);
    const region = ctx.ss.cell(SHEETS.CLEANFORM, row, headers.indexOf('Region') + 1);
    await ctx.assertRegionAccess(region);

    // จำเลขที่ไว้ก่อนลบแถว เพื่อตามไปลบรูปของใบนี้ด้วย
    // ไม่งั้นรูปจะค้างอยู่ในดิสก์ตลอดไปโดยไม่มีอะไรอ้างถึง
    const docNo = plainText(ctx.ss.cell(SHEETS.CLEANFORM, row, headers.indexOf('DocNo') + 1)) ||
                  plainText(ctx.ss.cell(SHEETS.CLEANFORM, row, headers.indexOf('ID') + 1));
    const formId = plainText(ctx.ss.cell(SHEETS.CLEANFORM, row, headers.indexOf('ID') + 1));

    // ย้อนงานที่ใบนี้ปิดไว้ ต้องทำก่อนลบแถว เพราะต้องอ่านเครื่อง รอบ และเลขที่จากใบ
    await revertCleaningEffects(ctx, ctx.ss.objects(SHEETS.CLEANFORM).find(f => f._row === Number(row)));

    await ctx.ss.deleteRow(SHEETS.CLEANFORM, row);
    await removeApproval(ctx, KIND, formId);
    await ctx.ss.flush();

    // ลบรูปหลังลบแถวสำเร็จแล้วเท่านั้น และห้ามให้การลบรูปล้มแล้วทำให้ทั้งคำสั่งพัง
    // เพราะแถวถูกลบไปแล้ว ถ้าโยน error ออกไป ผู้ใช้จะเข้าใจว่าลบไม่สำเร็จ
    if (ctx.photos && docNo) {
      try { ctx.photos.removeAll(KIND, docNo); } catch { /* รูปค้างดีกว่าผู้ใช้สับสน */ }
    }
    if (ctx.docs && docNo) {
      // ยกเลิกงานสร้างไฟล์ที่ค้างอยู่ก่อน ไม่งั้นไฟล์จะถูกสร้างกลับมาหลังลบไปแล้ว
      cancelDocPdf(docNo);
      try { ctx.docs.remove(KIND, docNo); } catch { /* ไฟล์ค้างดีกว่าผู้ใช้สับสน */ }
    }
    if (ctx.attachments && docNo) {
      try { ctx.attachments.removeAll(docNo); } catch { /* ไฟล์ค้างดีกว่าผู้ใช้สับสน */ }
    }

    return getCleaningForms(ctx);
  });
}

/* ==================== แนบเอกสารที่เขียนด้วยมือ ==================== */

const NODE_DOC_MAX_FILES = 10;

/**
 * แนบไฟล์เอกสารเข้ากับ Node และปิดงานล้างในแผนให้ด้วย (ถ้าระบุรอบมา)
 *
 * ใช้กับกรณีที่ช่างปริ้นฟอร์มเปล่าไปเขียนด้วยมือหน้างาน แล้วถ่ายรูปส่งกลับมา
 * ไฟล์ถูกเก็บลงดิสก์ของเครื่องที่รันระบบ ที่ data/attachments/<ปี>/<เดือน>/<เลขที่เอกสาร>/
 *
 * ============================================================================
 * ทุกครั้งที่แนบ ต้องได้แถวในตารางเอกสารเสมอ
 * ============================================================================
 * เดิมถ้าไม่ได้ติ๊ก "ปิดงานในแผน" ระบบจะเก็บไฟล์อย่างเดียวโดยไม่สร้างแถว
 * ซึ่งใช้ได้ตอนไฟล์อยู่บน Drive เพราะยังเปิดโฟลเดอร์ไปหาเองได้
 *
 * พอย้ายมาเก็บในเครื่อง ไม่มีหน้าจอให้เดินดูโฟลเดอร์แล้ว ไฟล์ที่ไม่มีแถวอ้างถึง
 * จะกลายเป็นไฟล์ที่ไม่มีใครเปิดได้อีกเลย จึงต้องออกเลขที่เอกสารและสร้างแถวเสมอ
 * ส่วน "ปิดงานในแผน" เหลือหน้าที่เดียวคือไปปิดรอบกับลงประวัติ
 *
 * @param {Object} payload
 * @param {string} payload.nodeName
 * @param {Array}  payload.files    [{name, mimeType, data(base64)}]
 * @param {Object} [payload.closeout]  ไม่ส่งมา = เก็บเป็นเอกสารอย่างเดียว ไม่แตะแผนหรือประวัติ
 * @param {Array}  payload.closeout.units  [{airCode, price, condition}] เครื่องที่ล้าง
 *   พร้อมราคาและผลประเมินของเครื่องตัวนั้น
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

    // หาเครื่องของ Node นี้เฉพาะในขอบเขตของผู้ใช้ กันการแนบไฟล์ให้ Node ที่ไม่ได้ดูแล
    // (ภูมิภาคอื่น หรือ Node ที่ไม่ได้มอบหมายให้ผู้รับเหมาคนนี้)
    const air = await unitsInScope(ctx);
    const nodeUnits = air.filter(a => plainText(a.NodeName).trim() === nodeName);
    if (!nodeUnits.length) throw new Error('ไม่พบ Node "' + nodeName + '" หรือไม่มีสิทธิ์เข้าถึง');
    const isContractor = (await ctx.userInfo()).role === 'Contractor';

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
        if (!found) {
          // ผู้รับเหมาเห็นเฉพาะเครื่องที่มอบหมายให้ — เครื่องอยู่ใน Node นี้จริงแต่ไม่ใช่งานของบริษัทนี้
          // ต้องบอกให้ตรง ไม่งั้นคนอ่านจะงงว่าเครื่องก็อยู่ใน Node นี้ชัดๆ
          if (isContractor && ctx.ss.objects(SHEETS.AIRLIST).some(a =>
            normalizeCode(a.AirCode) === normalizeCode(code) && plainText(a.NodeName).trim() === nodeName)) {
            throw new Error('เครื่อง "' + code + '" ไม่ได้มอบหมายให้บริษัทของคุณ — แนบได้เฉพาะเครื่องที่ได้รับมอบหมายในแผนล้าง');
          }
          throw new Error('เครื่อง "' + code + '" ไม่ได้อยู่ใน Node "' + nodeName + '"');
        }
        assertCleanable(found);
        // ผลประเมินเป็นของรายเครื่อง หน้าเว็บจึงส่งมาให้ทีละเครื่อง
        // แนบไฟล์เดียวแต่ล้างสองตัว ก็ยังบอกได้ว่าตัวไหนสมบูรณ์ ตัวไหนควรปรับปรุง
        //
        // ยังรับค่าเดียวทั้งใบ (closeout.condition) ไว้ด้วย เผื่อหน้าจออื่นที่ยัง
        // ไม่มีช่องรายเครื่อง เช่นหน้าปิดงานจากหน้าแผน
        const own = plainText(w.condition);
        assertMoney('ค่าล้าง ' + plainText(w.airCode), w.price);
        return {
          airCode: plainText(found.AirCode),
          price: hasPrice(w.price) ? Number(w.price) : '',
          unit: found,
          cond: own || plainText(closeout.condition)
        };
      });

      // ผู้รับเหมา: ต้องเป็นงานของตัวเองทุกเครื่อง และราคามาจากแผน/ทะเบียน (เหตุผลเดียวกับ bindToRegistry)
      if (isContractor) {
        for (const u of units) {
          await assertOwnJob(ctx, closeout.year, closeout.round, u.airCode);
          u.price = await contractorPrice(ctx, closeout.year, closeout.round, u.unit);
        }
      }
      await assertRoundsInOrder(ctx, { year: closeout.year, round: closeout.round, airCodes: units.map(u => u.airCode) });
    } else if (isContractor) {
      // แนบเก็บไว้เฉยๆ โดยไม่ผูกกับงานไหน = ไม่มีอะไรบอกว่าเป็นงานของใคร
      throw new Error('บัญชี Subcontract (ผู้รับเหมา) ต้องแนบเอกสารจากหน้าแผนล้างแอร์ (กดที่ช่องรอบที่ได้รับมอบหมาย)');
    }

    if (!ctx.attachments) {
      throw new Error('เครื่องที่รันระบบอยู่เก็บไฟล์แนบไม่ได้ (ไม่มีที่เก็บไฟล์)');
    }

    // ---------- ออกเลขที่เอกสารก่อน เพราะใช้เป็นชื่อโฟลเดอร์ของไฟล์ ----------
    // ออกเลขในล็อกเสมอ เหมือนตอนบันทึกฟอร์ม เพื่อไม่ให้สองคนได้เลขเดียวกัน
    const docDate = plainText(closeout && closeout.date) || ymd(new Date());

    // เครื่องละเลข เหมือนใบที่กรอกในระบบ — เลขของเครื่องตัวแรกใช้เป็นชื่อโฟลเดอร์ไฟล์ด้วย
    const docNumbers = {
      AirCode1: units[0] ? units[0].airCode : '',
      AirCode2: units[1] ? units[1].airCode : ''
    };
    assignDocNumbers(ctx, docNumbers, docDate);

    // ไม่ได้ติ๊กปิดงานในแผน = ไม่มีรายการเครื่อง แต่ยังต้องมีเลขให้ใบนี้
    // ไม่งั้นไฟล์ที่แนบมาจะไม่มีชื่อโฟลเดอร์ให้เก็บ
    if (!docNumbers.DocNo) docNumbers.DocNo = nextDocNo(ctx, 'ล้างแอร์', docDate);
    const docNo = docNumbers.DocNo;

    // ---------- เก็บไฟล์ลงดิสก์ ----------
    const stored = ctx.attachments.save(docNo, docDate, files);

    // ไม่มีลิงก์ให้ผูกในแผนอีกแล้ว ไฟล์เปิดได้จากหน้าแบบฟอร์มเอกสารทุกเมื่อ
    // (เหมือนกับใบที่กรอกในระบบ ซึ่งเลิกเก็บลิงก์ไปตั้งแต่เลิกใช้ Drive)
    const docUrl = '';

    // ---------- ปิดงานในแผน + บันทึกประวัติ (เฉพาะตอนที่ระบุรอบมา) ----------
    const planClosed = closeout ? await closeRoundsForUnits(ctx, units, {
      planYear: closeout.year,
      planRound: closeout.round,
      date: closeout.date,
      technician: closeout.technician,
      docUrl
    }) : 0;

    if (closeout) {
      await writeCleaningHistory(ctx, units, {
        date: closeout.date,
        technician: closeout.technician,
        nodeName,
        docUrl,
        planYear: closeout.year,
        planRound: closeout.round,
        source: 'attach',
        form: docNumbers
      });
    }

    // ---------- เก็บเป็นรายการหนึ่งในตารางฟอร์มล้างแอร์ ----------
    // เพื่อให้ดูประวัติการล้างทั้งหมดได้จากที่เดียว ไม่ต้องแยกจำว่าใบไหนกรอกในระบบ
    // ใบไหนเขียนมือ — คอลัมน์ Source บอกที่มา และ PdfUrl ชี้ไปที่ไฟล์ที่แนบมา
    // ไม่ได้ติ๊กปิดงาน = ไม่มีรายการเครื่อง ให้ยึดเครื่องตัวแรกของ Node ไว้เป็นข้อมูลอ้างอิง
    const first = (units[0] && nodeUnits.find(a => normalizeCode(a.AirCode) === normalizeCode(units[0].airCode)))
      || nodeUnits[0];
    const second = units[1]
      ? nodeUnits.find(a => normalizeCode(a.AirCode) === normalizeCode(units[1].airCode))
      : null;

    const record = {
      ID: 'CF' + Date.now(),
      DocType: 'cleaning',
      DocNo: docNo,
      DocNo2: docNumbers.DocNo2 || '',
      Date: docDate,
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
      EquipmentCondition: units[0] ? units[0].cond : '',
      EquipmentCondition2: units[1] ? units[1].cond : '',
      AdditionalNote: (closeout && closeout.note) || '',
      CompanyName: isContractor
        ? (await ctx.userInfo()).contractorName
        : ((closeout && closeout.companyName) || ''),
      TechnicianName: (closeout && closeout.technician) || '',
      PdfUrl: docUrl,
      PdfFileId: '',
      CreatedAt: ymdhms(new Date()),
      RecordedBy: await ctx.currentUser(),
      PlanYear: (closeout && closeout.year) || '',
      PlanRound: (closeout && closeout.round) || '',
      Price1: units[0] ? units[0].price : '',
      Price2: units[1] ? units[1].price : '',
      Source: 'attach'
    };
    record.Price = units.reduce((sum, u) => sum + (hasPrice(u.price) ? Number(u.price) : 0), 0) || '';

    const cfHeaders = ctx.ss.headers(SHEETS.CLEANFORM);
    ctx.ss.appendRow(SHEETS.CLEANFORM, cfHeaders.map(h => (record[h] !== undefined ? record[h] : '')));
    // ใบแนบก็ต้องรออนุมัติ 4 ขั้นเหมือนใบที่กรอกในระบบ (เจ้าของงานกำหนด: ทุกเอกสาร)
    // ใบแนบเก่าที่ส่งก่อนมีกติกานี้ไม่มีแถวขั้นอนุมัติ = ถือว่าเซ็นบนกระดาษแล้ว (ดู approval.js)
    await startApproval(ctx, KIND, record.ID);

    await ctx.ss.flush();

    return {
      docNo,
      count: stored.length,
      files: stored,
      planClosed,
      forms: await getCleaningForms(ctx),
      history: await getHistory(ctx)
    };
  });
}

/* ==================== เปิดไฟล์ที่แนบไว้ ==================== */

/** เลขที่เอกสารของแถวที่ระบุ พร้อมตรวจสิทธิ์ภูมิภาคให้แล้ว */
async function docNoOfRow(ctx, row) {
  await ctx.ensureBase();
  const form = ctx.ss.objects(SHEETS.CLEANFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await assertCanSeeForm(ctx, form);
  return plainText(form.DocNo) || plainText(form.ID);
}

/** รายชื่อไฟล์ที่แนบไว้กับเอกสารใบหนึ่ง (ส่งแค่ชื่อกับขนาด ไม่ส่งตัวไฟล์) */
export async function getCleaningAttachments(ctx, row) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');
  if (!ctx.attachments) return [];

  return ctx.attachments.list(await docNoOfRow(ctx, row));
}

/**
 * อ่านไฟล์แนบหนึ่งไฟล์ออกมาให้เปิดหรือดาวน์โหลด
 *
 * ส่งชื่อไฟล์มาเป็นตัวระบุ ไม่ใช่เส้นทางไฟล์ — ชั้น platform เป็นคนเทียบกับ
 * รายการที่มีอยู่จริงก่อนอ่าน ชื่อที่ส่งมาจึงพาไปอ่านไฟล์นอกโฟลเดอร์ไม่ได้
 */
export async function getCleaningAttachment(ctx, payload) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');
  if (!ctx.attachments) throw new Error('เครื่องที่รันระบบอยู่ไม่มีที่เก็บไฟล์แนบ');

  const docNo = await docNoOfRow(ctx, (payload || {}).row);
  const file = ctx.attachments.read(docNo, (payload || {}).name);
  if (!file) throw new Error('ไม่พบไฟล์แนบที่ขอ');
  return file;
}
