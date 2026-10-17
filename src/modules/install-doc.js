import { INSTALL_CHECKLIST_ITEMS } from '../schema.js';
import { formatTime, plainText } from '../values.js';
import {
  colgroup, REF_LINE, esc, thaiDate, val, sectionRow, pageHeader,
  sectionSign, photoPage, docShell
} from './doc-common.js';

/**
 * สร้างเอกสารบันทึกผลการติดตั้งเป็นหน้า HTML
 *
 * ============================================================================
 * เหมือนใบล้างเกือบทั้งหมด ต่างกันสี่จุด
 * ============================================================================
 * ใบติดตั้งมีสองเครื่องต่อใบและวางกริดเดียวกับใบล้างทุกประการ จึงใช้ชิ้นส่วน
 * ร่วมกันจาก doc-common.js ได้ทั้งหมด ที่ต่างมีแค่
 *
 *   1. รายการตรวจสอบ 18 ข้อ (ใบล้าง 21 ข้อ คนละชุดกันคนละเรื่อง)
 *   2. ส่วนที่ 4 เป็น "ผลการตรวจรับงานติดตั้ง" ผ่าน/ไม่ผ่าน
 *      ไม่ใช่ "สภาพเครื่องสมบูรณ์/ควรปรับปรุง" แบบใบล้าง
 *   3. ช่องลงนามซ้ายล่างเขียนว่า "ผู้ตรวจรับ" ไม่ใช่ "ผู้ตรวจสอบ"
 *   4. คำบรรยายใต้รูปเป็นเรื่องติดตั้ง ไม่ใช่เรื่องล้าง
 *
 * ============================================================================
 * หนึ่งหรือสองเครื่อง
 * ============================================================================
 * กติกาเดียวกับใบล้าง — เครื่องอยู่คอลัมน์ตามตำแหน่งจริงเสมอ ติดตั้งตัวเดียว
 * อีกคอลัมน์เว้นว่างไว้ ไม่ยุบรวม เพราะคนอ่านดูจากตำแหน่งคอลัมน์ว่าเป็นแอร์
 * ตัวไหนของ Node
 */

/** รหัสแบบฟอร์มควบคุม พิมพ์มุมขวาล่างของทุกหน้า */
const FORM_CODE = 'ITEL-FM-NE-006';

/** ผลตรวจรับสองตัวเลือกในส่วนที่ 4 ตามช่องติ๊กที่พิมพ์ไว้บนแบบฟอร์ม */
const ACCEPT_RESULTS = ['ผ่าน', 'ไม่ผ่าน'];

/** คำบรรยายใต้กรอบรูปทั้ง 9 ช่อง เรียงซ้ายไปขวา บนลงล่าง (ยึดตามแบบฟอร์มจริง) */
const PHOTO_CAPTIONS = [
  'รูปก่อนดำเนินการติดตั้ง', 'รูปดำเนินการติดตั้ง', 'รูปดำเนินการติดตั้ง',
  'รูปดำเนินการติดตั้ง', 'รูปดำเนินการติดตั้ง', 'รูปหลังดำเนินการติดตั้ง',
  'รูปวัดค่ากระแสคอมเพรสเซอร์ขณะทำงาน', 'รูปวัดแรงดันไฟฟ้า', 'รูปวัดแรงดันน้ำยาด้านต่ำ (LOW)'
];

/* ==================== อ่านข้อมูลจากใบ ==================== */

/** เครื่องที่มีข้อมูลอยู่ในใบนี้ เรียงตามเลขเครื่อง */
function unitsOf(form) {
  const out = [];
  // ใบของเครื่องที่ 3 ขึ้นไป ใช้แบบฟอร์มเดิม ช่องที่ 1/2 คือเครื่องที่ base+1 / base+2 (ดู SlotBase)
  const base = Number(form.SlotBase) || 0;
  for (const slot of [1, 2]) {
    const code = plainText(form['AirCode' + slot]).trim();
    if (!code) continue;
    out.push({
      slot, no: slot + base, code,
      brand: form['Unit' + slot + '_Brand'],
      btu: form['Unit' + slot + '_BTU'],
      inSn: form['Unit' + slot + '_IndoorSerial'],
      inAsset: form['Unit' + slot + '_IndoorAsset'],
      outSn: form['Unit' + slot + '_OutdoorSerial'],
      outAsset: form['Unit' + slot + '_OutdoorAsset'],
      accept: plainText(form['AcceptResult' + slot])
    });
  }
  return out;
}

/** ผลตรวจที่บันทึกไว้ จับคู่กับรายการมาตรฐาน 18 ข้อ */
function checklistOf(form) {
  let saved = [];
  try { saved = JSON.parse(form.ChecklistJSON || '[]'); } catch { saved = []; }
  if (!Array.isArray(saved)) saved = [];

  const byNo = new Map(saved.map(i => [String(i && i.no), i]));
  return INSTALL_CHECKLIST_ITEMS.map(item => {
    const got = byNo.get(String(item.no)) || {};
    return {
      no: item.no,
      label: item.label,
      unit: item.unit || '-',
      val1: got.val1, val2: got.val2, note: got.note
    };
  });
}

/* ==================== ชิ้นส่วนที่ใช้ซ้ำ ==================== */

/** เครื่องของแต่ละช่องเรียงตามตำแหน่งบนแบบฟอร์ม ช่องที่ไม่ได้ติดตั้งเป็น null */
const bySlot = units => [1, 2].map(s => units.find(u => u.slot === s) || null);

/** ช่องของเครื่องสองช่อง เรียงตามตำแหน่งจริงเสมอ ไม่ยุบรวม */
function unitCells(units, render, cls = 'ctr') {
  return bySlot(units)
    .map(u => `<td class="${cls}">${u ? render(u) : ''}</td>`)
    .join('');
}

/* ==================== หน้าที่ 1 — ใบบันทึกผล ==================== */

/** ส่วนที่ 1 : ข้อมูล Node — [1-2 ป้าย] [3-5 ค่า] [6 ป้าย] [7-8 ค่า] */
function sectionNode(form, units) {
  const first = units[0] || {};
  const timeRange = [formatTime(form.TimeStart), formatTime(form.TimeEnd)].filter(Boolean).join(' – ');

  return [
    ['Node Name', plainText(form.NodeName), 'ประเภท Node', form.LocationType],
    ['จังหวัด / Province', form.Province, 'Brand / ยี่ห้อแอร์', first.brand],
    ['วันที่', thaiDate(form.Date), 'BTU / ขนาดทำความเย็น', first.btu],
    ['เวลาเริ่ม–สิ้นสุด', timeRange, 'รวมเวลา (ชม.)', formatTime(form.TotalTime)]
  ].map(([l1, v1, l2, v2]) =>
    '<tr>' +
    `<th colspan="2">${esc(l1)}</th><td colspan="3">${val(v1)}</td>` +
    `<th class="tight">${esc(l2)}</th><td colspan="2">${val(v2)}</td>` +
    '</tr>'
  ).join('');
}

/** ส่วนที่ 2 : ข้อมูลเครื่อง — [1-5 ป้าย] [6 เครื่อง 1] [7 เครื่อง 2] [8 ว่าง] */
function sectionUnits(units) {
  const head = '<tr><th colspan="5">รายการ / Item</th>' +
    unitCells(units, u => `เครื่องที่ ${u.no} (AIR ${u.no})`, 'ctr hd') +
    '<td></td></tr>';

  const lines = [
    ['Indoor Serial No.', u => val(u.inSn)],
    ['Indoor Asset No.', u => val(u.inAsset)],
    ['Outdoor Serial No.', u => val(u.outSn)],
    ['Outdoor Asset No.', u => val(u.outAsset)]
  ];

  return head + lines.map(([label, pick]) =>
    `<tr><th colspan="5" class="lbl">${esc(label)}</th>` + unitCells(units, pick) + '<td></td></tr>'
  ).join('');
}

/** ส่วนที่ 3 : รายการตรวจสอบ — [1 ข้อ] [2-4 รายการ] [5 หน่วย] [6-7 เครื่อง] [8 หมายเหตุ] */
function sectionChecklist(form, units) {
  const head = '<tr>' +
    '<th class="ctr">ข้อ</th><th colspan="3" class="ctr">รายการตรวจสอบ</th><th class="ctr">หน่วย/เกณฑ์</th>' +
    bySlot(units).map(u => `<th class="ctr">${u ? 'เครื่องที่ ' + u.no : ''}</th>`).join('') +
    '<th class="ctr">หมายเหตุ</th></tr>';

  const body = checklistOf(form).map(item =>
    '<tr>' +
    `<td class="ctr">${item.no}</td>` +
    `<td colspan="3" class="lbl">${esc(item.label)}</td>` +
    `<td class="ctr unit">${esc(item.unit)}</td>` +
    unitCells(units, u => val(item['val' + u.slot])) +
    `<td>${val(item.note)}</td>` +
    '</tr>'
  ).join('');

  return head + body;
}

/**
 * ส่วนที่ 4 : สรุปผลการติดตั้ง — [1-3 ป้าย] [4 เครื่องที่ N] [5-8 ช่องติ๊ก]
 *
 * แบบฟอร์มมีช่องติ๊ก ผ่าน/ไม่ผ่าน แยกกันคนละเครื่อง และติ๊กคนละอย่างได้จริง
 * เช่นติดตั้งสองตัว ตัวหนึ่งผ่าน อีกตัวไม่ผ่านเพราะรอแก้ไขอยู่
 * ห้ามเอาผลของเครื่องหนึ่งไปติ๊กแทนอีกเครื่อง — เอกสารนี้เอาไปเซ็นตรวจรับกัน
 */
function sectionSummary(units) {
  return units.map(u =>
    '<tr>' +
    '<th colspan="3" class="lbl">ผลการตรวจรับงานติดตั้ง</th>' +
    `<td class="ctr tight">เครื่องที่ ${u.no}</td>` +
    '<td colspan="4" class="choices">' +
    ACCEPT_RESULTS.map(c =>
      `<span class="box">${plainText(u.accept).trim() === c ? '☑' : '☐'}</span> ${esc(c)}`
    ).join('<span class="gap"></span>') +
    '</td></tr>'
  ).join('');
}

/* ==================== ตัวเอกสาร ==================== */

/**
 * สร้างหน้า HTML ของเอกสารติดตั้งหนึ่งใบ (ใบบันทึกผล + หน้ารูปเครื่องละหนึ่งหน้า)
 *
 * @param {Object} form แถวจากตาราง InstallForm (รวม ChecklistJSON)
 * @param {Object} [opts]
 * @param {string} [opts.fontHref] ที่อยู่ไฟล์ฟอนต์ เว้นไว้จะใช้ฟอนต์ของเครื่อง
 * @param {string} [opts.logoHref] ที่อยู่ไฟล์โลโก้ เว้นไว้จะไม่มีโลโก้
 * @param {Object} [opts.photos]   รูปที่แนบไว้ คีย์ "<เครื่อง>-<ช่อง>" ค่าเป็น data URL
 * @param {boolean} [opts.toolbar] ใส่แถบปุ่มด้านบน (ใส่เฉพาะตอนเปิดดูบนจอ)
 * @returns {string} หน้า HTML เต็มใบ พร้อมเปิดดูหรือสั่งปริ้น
 */
export function buildInstallDocHtml(form, opts = {}) {
  const units = unitsOf(form);
  if (!units.length) throw new Error('เอกสารใบนี้ยังไม่มีข้อมูลเครื่องปรับอากาศ');

  const photos = opts.photos || {};
  // คอลัมน์ A–H ตามไฟล์ install-form-template.xlsx (ต่างจากใบล้างเล็กน้อย)
  const cols = colgroup([4, 16, 15.25, 9.25, 9.25, 16, 16, 23.13]);

  const body = `<div class="sheet"><div class="frame">
  ${pageHeader('บันทึกผลการติดตั้งเครื่องปรับอากาศ', opts)}

  <table class="main"><colgroup>${cols}</colgroup><tbody>
    ${sectionRow('ส่วนที่ 1 : ข้อมูล Node')}
    ${sectionNode(form, units)}

    ${sectionRow('ส่วนที่ 2 : ข้อมูลเครื่อง')}
    ${sectionUnits(units)}

    ${sectionRow('ส่วนที่ 3 : รายการตรวจสอบการติดตั้ง')}
    ${sectionChecklist(form, units)}

    ${sectionRow('ส่วนที่ 4 : สรุปผลการติดตั้ง')}
    ${sectionSummary(units)}

    ${sectionRow('ส่วนที่ 5 : บันทึกเพิ่มเติม')}
    <tr class="note"><td colspan="8">${val(form.AdditionalNote)}</td></tr>

    ${sectionRow('ส่วนที่ 6 : การลงนาม')}
    ${sectionSign(form, 'ผู้ติดตั้ง (บ./หจก.)', 'ผู้ตรวจรับ (Supervisor / Area / Region Manager)', opts.signers)}
  </tbody></table>

  ${REF_LINE}
</div><div class="code">${FORM_CODE}</div></div>

${units.map(u => photoPage(photos, opts, {
  title: 'ภาพถ่ายประกอบการติดตั้งเครื่องปรับอากาศ — เครื่องที่ ' + u.no + ' (AIR ' + u.no + ')',
  captions: PHOTO_CAPTIONS,
  slot: u.slot,
  nodeName: form.NodeName,
  date: thaiDate(form.Date),
  formCode: FORM_CODE
})).join('\n')}`;

  return docShell({
    title: (plainText(form.DocNo) || plainText(form.ID)) + ' — บันทึกผลการติดตั้งเครื่องปรับอากาศ',
    body,
    scale: 0.85    // แบบฟอร์ม Excel ตั้งพิมพ์ 85%
  }, opts);
}
