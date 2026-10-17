import { REPAIR_CHECKLIST_ITEMS, REPAIR_PART_ROWS } from '../schema.js';
import { plainText } from '../values.js';
import {
  colgroup, REF_LINE_2, esc, thaiDate, val, sectionRow, pageHeader,
  sectionSign, photoPage, docShell, noteRows
} from './doc-common.js';

/**
 * สร้างเอกสารบันทึกผลการซ่อมแอร์เป็นหน้า HTML
 *
 * ============================================================================
 * วางตามแบบฟอร์มควบคุมของบริษัท
 * ============================================================================
 * ยึดตามไฟล์ ITEL-FM-NE-005 บันทึกผลการซ่อมเครื่องปรับอากาศ (ฉบับ Rev2026)
 * ทั้งถ้อยคำ เส้นตาราง สีพื้น และการจัดวาง
 *
 * 2 หน้า — ใบแจ้งซ่อม 1 หน้า + หน้ารูปอีก 1 หน้า
 *
 * ============================================================================
 * ต่างจากใบล้างตรงไหน
 * ============================================================================
 * ใบซ่อมมี "เครื่องเดียวทั้งใบ" ไม่ใช่สองคอลัมน์เหมือนใบล้าง เพราะการซ่อมเกิดกับ
 * เครื่องที่เสียตัวใดตัวหนึ่ง ไม่ใช่งานที่ทำรวดเดียวทั้งไซต์แบบการล้าง
 *
 * จึงไม่มีเรื่องรวมใบ ไม่มี DocNo2 และไม่ต้องยึดตำแหน่งคอลัมน์ของเครื่อง
 *
 * ส่วนที่เหมือนกันทั้งหมด (หัวกระดาษ ส่วนลงนาม หน้ารูป รูปแบบหน้ากระดาษ)
 * อยู่ที่ doc-common.js แก้ที่เดียวแล้วเปลี่ยนทุกแบบฟอร์มพร้อมกัน
 *
 * ไฟล์นี้อยู่ใน src/ จึงห้ามแตะระบบไฟล์หรือสั่งโปรแกรมอื่น — คืนค่าเป็นข้อความล้วน
 */

/** รหัสแบบฟอร์มควบคุม พิมพ์มุมขวาล่างของทุกหน้า */
const FORM_CODE = 'ITEL-FM-NE-005';

/** คำบรรยายใต้กรอบรูปทั้ง 9 ช่อง ตามแบบฟอร์ม NE-005 */
const PHOTO_CAPTIONS = [
  'รูปก่อนดำเนินซ่อม', 'รูปดำเนินการซ่อม', 'รูปดำเนินการซ่อม',
  'รูปดำเนินการซ่อม', 'รูปดำเนินการซ่อม', 'รูปหลังดำเนินการซ่อม',
  'รูปวัดค่ากระแสคอมเพรสเซอร์ขณะทำงาน', 'รูปวัดแรงดันไฟฟ้า', 'รูปวัดแรงดันน้ำยาด้านต่ำ (LOW)'
];

/* ==================== อ่านข้อมูลจากใบ ==================== */

/** ผลตรวจที่บันทึกไว้ จับคู่กับรายการมาตรฐาน 5 ข้อ */
function checklistOf(form) {
  let saved = [];
  try { saved = JSON.parse(form.ChecklistJSON || '[]'); } catch { saved = []; }
  if (!Array.isArray(saved)) saved = [];

  const byNo = new Map(saved.map(i => [String(i && i.no), i]));
  return REPAIR_CHECKLIST_ITEMS.map(item => {
    const got = byNo.get(String(item.no)) || {};
    return { no: item.no, label: item.label, unit: item.unit || '-', value: got.value, note: got.note };
  });
}

/**
 * อะไหล่ที่ใช้ — เติมแถวว่างให้ครบเท่าที่กระดาษมีเสมอ
 * ใช้อะไหล่ชิ้นเดียวก็ยังต้องเห็น 4 แถวเหมือนแบบฟอร์มที่ปริ้นไปเขียนมือ
 */
function partsOf(form) {
  let saved = [];
  try { saved = JSON.parse(form.PartsJSON || '[]'); } catch { saved = []; }
  if (!Array.isArray(saved)) saved = [];

  return Array.from({ length: REPAIR_PART_ROWS }, (_, i) => {
    const got = saved[i] || {};
    return { no: i + 1, name: got.name, qty: got.qty, note: got.note };
  });
}

/* ==================== หน้าที่ 1 — ใบแจ้งซ่อม ==================== */

/** ส่วนที่ 1 : ข้อมูล Node และเครื่อง — [1-2 ป้าย] [3-5 ค่า] [6 ป้าย] [7-8 ค่า] */
function sectionNode(form) {
  return [
    ['Node Nane', plainText(form.NodeName), 'ประเภท Node', form.LocationType],
    ['จังหวัด', form.Province, 'Brand / ยี่ห้อ', form.Brand],
    ['วันที่', thaiDate(form.Date), 'BTU / ขนาด', form.BTU],
    ['Indoor Serial', form.IndoorSerial, 'Outdoor Serial', form.OutdoorSerial],
    ['Indoor Asset', form.IndoorAsset, 'Outdoor Asset', form.OutdoorAsset]
  ].map(([l1, v1, l2, v2]) =>
    '<tr>' +
    `<th colspan="2">${esc(l1)}</th><td>${val(v1)}</td>` +
    `<th colspan="2">${esc(l2)}</th><td colspan="3">${val(v2)}</td>` +
    '</tr>'
  ).join('');
}

/**
 * ส่วนที่ 2 : รายละเอียดสาเหตุและการแก้ไข
 *
 * สามช่องข้อความยาว ป้ายอยู่บรรทัดเดียวกับเนื้อ เหมือนบนกระดาษ
 * เว้นความสูงไว้เท่าเดิมแม้ไม่ได้กรอก เพื่อให้ปริ้นไปเขียนมือได้
 */
function sectionDetail(form) {
  return [
    ['อาการเสีย :', form.Symptom],
    ['สาเหตุ :', form.Cause],
    ['การแก้ไข :', form.Fix]
  ].map(([label, value]) => noteRows(value, 2, label)).join('');
}

/** ส่วนที่ 3 : รายการบันทึกผล — [1 ข้อ] [2-4 รายการ] [5 หน่วย] [6-7 บันทึกผล] [8 หมายเหตุ] */
function sectionChecklist(form) {
  const head = '<tr>' +
    '<th class="ctr">ข้อ</th><th colspan="2" class="ctr">รายการตรวจสอบ</th>' +
    '<th class="ctr">หน่วย/เกณฑ์</th><th class="ctr">บันทึกผล</th>' +
    '<th colspan="3" class="ctr">หมายเหตุ</th></tr>';

  const body = checklistOf(form).map(item =>
    '<tr>' +
    `<td class="ctr">${item.no}</td>` +
    `<td colspan="2" class="lbl">${esc(item.label)}</td>` +
    `<td class="ctr unit">${esc(item.unit)}</td>` +
    `<td class="ctr">${val(item.value)}</td>` +
    `<td colspan="3">${val(item.note)}</td>` +
    '</tr>'
  ).join('');

  return head + body;
}

/** ส่วนที่ 4 : อะไหล่ที่ใช้ — [1 ลำดับ] [2-4 รายการ] [5 จำนวน] [6-8 หมายเหตุ] */
function sectionParts(form) {
  // คอลัมน์แรกแคบมาก (ตามกริดของแบบฟอร์ม) คำว่า "ลำดับ" จึงตกบรรทัดถ้าไม่ย่อ
  const head = '<tr>' +
    '<th class="ctr tight">ลำดับ</th><th colspan="2" class="ctr">รายการอะไหล่</th>' +
    '<th class="ctr">จำนวน</th><th colspan="4" class="ctr">หมายเหตุ</th></tr>';

  const body = partsOf(form).map(p =>
    '<tr>' +
    `<td class="ctr">${p.no}</td>` +
    `<td colspan="2" class="lbl">${val(p.name)}</td>` +
    `<td class="ctr">${val(p.qty)}</td>` +
    `<td colspan="4">${val(p.note)}</td>` +
    '</tr>'
  ).join('');

  return head + body;
}

/* ==================== ตัวเอกสาร ==================== */

/**
 * สร้างหน้า HTML ของเอกสารซ่อมหนึ่งใบ (ใบแจ้งซ่อม + หน้ารูป)
 *
 * @param {Object} form แถวจากตาราง repair_forms
 * @param {Object} [opts]
 * @param {string} [opts.fontHref] ที่อยู่ไฟล์ฟอนต์ เว้นไว้จะใช้ฟอนต์ของเครื่อง
 * @param {string} [opts.logoHref] ที่อยู่ไฟล์โลโก้ เว้นไว้จะไม่มีโลโก้
 * @param {Object} [opts.photos]   รูปที่แนบไว้ คีย์ "1-<ช่อง>" ค่าเป็น data URL
 * @param {boolean} [opts.toolbar] ใส่แถบปุ่มสำหรับเปิดดูบนจอ (ห้ามใส่ตอนแปลงเป็นไฟล์)
 * @returns {string} หน้า HTML เต็มใบ พร้อมเปิดดูหรือสั่งปริ้น
 */
export function buildRepairDocHtml(form, opts = {}) {
  if (!plainText(form.AirCode).trim()) {
    throw new Error('เอกสารใบนี้ยังไม่มีข้อมูลเครื่องปรับอากาศ');
  }

  const photos = opts.photos || {};
  // A–E ตามไฟล์ repair-form-template.xlsx · F (28.13) แบ่งเป็น 3 ช่องให้ครบกริด 8 คอลัมน์
  const cols = colgroup([3.75, 11.5, 26.13, 8.5, 8.5, 9.377, 9.377, 9.376]);

  const body = `<div class="sheet"><div class="frame">
  ${pageHeader('บันทึกผลการซ่อมเครื่องปรับอากาศ', opts)}

  <table class="main"><colgroup>${cols}</colgroup><tbody>
    ${sectionRow('ส่วนที่ 1 : ข้อมูล Node และเครื่อง / Node & Unit Information')}
    ${sectionNode(form)}

    ${sectionRow('ส่วนที่ 2 : รายละเอียดสาเหตุและการแก้ไข')}
    ${sectionDetail(form)}

    ${sectionRow('ส่วนที่ 3 : รายการบันทึกผล')}
    ${sectionChecklist(form)}

    ${sectionRow('ส่วนที่ 4 : อะไหล่ที่ใช้')}
    ${sectionParts(form)}

    ${sectionRow('ส่วนที่ 5 : แนวทางป้องกันและข้อเสนอแนะ')}
    ${noteRows(form.Suggestion, 4)}

    ${sectionRow('ส่วนที่ 6 : การลงนาม')}
    ${sectionSign(form, 'ผู้ดำเนินการซ่อม (บ./หจก.)', undefined, opts.signers, [3, 5], true)}
  </tbody></table>

  ${REF_LINE_2}
</div><div class="code">${FORM_CODE}</div></div>

${photoPage(photos, opts, {
  title: 'รูปถ่ายประกอบการซ่อมเครื่องปรับอากาศ',
  nodeLabel: 'Node Nane',
  captions: PHOTO_CAPTIONS,
  slot: 1,
  nodeName: form.NodeName,
  date: thaiDate(form.Date),
  formCode: FORM_CODE
})}`;

  return docShell({
    title: (plainText(form.DocNo) || plainText(form.ID)) + ' — บันทึกผลการซ่อมเครื่องปรับอากาศ',
    body,
    scale: 1       // แบบฟอร์ม Excel พิมพ์ 100%
  }, opts);
}
