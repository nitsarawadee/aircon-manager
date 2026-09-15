import { CLEANING_CHECKLIST_ITEMS } from '../schema.js';
import { formatDate, formatTime, plainText } from '../values.js';

/**
 * สร้างเอกสารบันทึกผลการล้างแอร์เป็นหน้า HTML
 *
 * ============================================================================
 * ทำไมเป็น HTML ไม่ใช่สร้าง PDF ตรงๆ
 * ============================================================================
 * ของเดิมสร้าง PDF ด้วยการส่งข้อมูลไป Apps Script ให้วาดลงชีตแม่แบบแล้วสั่ง
 * Google export ซึ่งต้องออกเน็ต ใช้เวลา 7-8 วินาทีต่อใบ และคิวตันถ้ามีคนใช้พร้อมกัน
 *
 * หน้า HTML ทำให้เปิดดูและสั่งปริ้นได้ทันทีโดยไม่ต้องออกเน็ต และเบราว์เซอร์
 * จัดฟอนต์ไทยให้เอง ซึ่งเป็นส่วนที่เขียนเองยากที่สุด
 *
 * ไฟล์นี้อยู่ใน src/ จึงห้ามแตะระบบไฟล์หรือสั่งโปรแกรมอื่น — คืนค่าเป็นข้อความล้วน
 * ชั้น platform จะเอาไปแสดงบนจอ สั่งปริ้น หรือแปลงเป็นไฟล์ต่อก็ได้
 *
 * ============================================================================
 * วางตามกริดของแบบฟอร์มจริง
 * ============================================================================
 * ดึงโครงมาจากไฟล์ ฟอร์มบันทึกผลการล้างเครื่องปรับอากาศ_Rev2026.xlsx โดยตรง
 * คือตาราง 8 คอลัมน์ (A–H) ความกว้างตามที่ตั้งไว้ในไฟล์ และการผสานช่องตรงกัน
 * ทุกแถว เอกสารที่ออกมาจึงหน้าตาเหมือนกระดาษที่ใช้กันอยู่
 *
 * ============================================================================
 * หนึ่งหรือสองคอลัมน์
 * ============================================================================
 * ล้างสองเครื่องออกมาสองคอลัมน์ (F และ G ตามแบบฟอร์ม)
 * ล้างเครื่องเดียวรวม F กับ G เป็นช่องเดียว และหัวคอลัมน์บอกเลขเครื่องจริงเสมอ —
 * ล้างเฉพาะเครื่องที่ 2 ต้องขึ้นว่า "เครื่องที่ 2" ไม่ใช่เลื่อนมาเป็นคอลัมน์แรก
 * ความกว้างรวมของตารางจึงเท่าเดิม ไม่ว่าจะล้างกี่เครื่อง
 */

/** ความกว้างคอลัมน์ A–H ตามที่ตั้งไว้ในไฟล์ Excel (หน่วยของ Excel) */
const COL_WIDTHS = [4.6, 16.6, 17.6, 10.0, 11.0, 16.6, 16.6, 28.1];

/**
 * หน่วยและเกณฑ์ของแต่ละข้อ ตามคอลัมน์ E "หน่วย/เกณฑ์" ในแบบฟอร์ม
 * ข้อที่เป็นการตรวจเช็คเฉยๆ ไม่มีหน่วย ในแบบฟอร์มใส่ขีดไว้
 */
const CRITERIA = {
  10: '°C (24–26)', 11: '°C (24–28)', 12: 'Type', 13: 'PSI',
  14: 'A', 15: 'A', 16: 'V (220–240)', 18: '°C (33–35)', 19: 'ชม. (4–6)'
};

const esc = v => plainText(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * ค่าที่กรอกลงในแบบฟอร์ม — แสดงเป็นสีน้ำเงินตามที่ไฟล์ Excel ตั้งไว้
 * เพื่อให้แยกออกจากข้อความที่พิมพ์มากับฟอร์มตั้งแต่แรก
 * ช่องที่ยังไม่ได้กรอก ปล่อยว่างไว้จริงๆ เหมือนแบบฟอร์มเปล่า
 */
const val = v => {
  const t = esc(v);
  return t ? `<span class="v">${t}</span>` : '';
};

/* ==================== ตัวช่วยอ่านข้อมูลจากใบ ==================== */

/** เครื่องที่มีข้อมูลอยู่ในใบนี้ เรียงตามเลขเครื่อง */
function unitsOf(form) {
  const out = [];
  for (const slot of [1, 2]) {
    const code = plainText(form['AirCode' + slot]).trim();
    if (!code) continue;
    out.push({
      slot, code,
      brand: form['Unit' + slot + '_Brand'],
      btu: form['Unit' + slot + '_BTU'],
      inSn: form['Unit' + slot + '_IndoorSerial'],
      inAsset: form['Unit' + slot + '_IndoorAsset'],
      outSn: form['Unit' + slot + '_OutdoorSerial'],
      outAsset: form['Unit' + slot + '_OutdoorAsset']
    });
  }
  return out;
}

/** ผลตรวจที่บันทึกไว้ จับคู่กับรายการมาตรฐาน 21 ข้อ */
function checklistOf(form) {
  let saved = [];
  try { saved = JSON.parse(form.ChecklistJSON || '[]'); } catch { saved = []; }
  if (!Array.isArray(saved)) saved = [];

  const byNo = new Map(saved.map(i => [String(i && i.no), i]));
  return CLEANING_CHECKLIST_ITEMS.map(item => {
    const got = byNo.get(String(item.no)) || {};
    return {
      no: item.no,
      label: item.label,
      criteria: CRITERIA[item.no] || '-',
      val1: got.val1, val2: got.val2, note: got.note
    };
  });
}

/* ==================== แถวต่างๆ ตามกริดของแบบฟอร์ม ==================== */

/** แถวหัวข้อส่วน กินทั้งแถว A:H */
const sectionRow = title => `<tr class="sec"><td colspan="8">${esc(title)}</td></tr>`;

/**
 * ส่วนที่ 1 — ข้อมูล Node
 * กริด: [A:B ป้าย] [C:E ค่า] [F ป้าย] [G:H ค่า]
 */
function sectionNode(form, units) {
  const first = units[0] || {};
  const timeRange = [formatTime(form.TimeStart), formatTime(form.TimeEnd)].filter(Boolean).join(' – ');

  const pairs = [
    ['Node / รหัส Node', [plainText(form.NodeName), plainText(form.SiteCode)].filter(Boolean).join(' / '),
     'ประเภท Node', form.LocationType],
    ['จังหวัด / Province', form.Province, 'Brand / ยี่ห้อแอร์', first.brand],
    ['วันที่ (DD/MM/YYYY)', formatDate(form.Date), 'BTU / ขนาดทำความเย็น', first.btu],
    ['เวลาเริ่ม–สิ้นสุด', timeRange, 'รวมเวลา (ชม.)', formatTime(form.TotalTime)]
  ];

  return pairs.map(([l1, v1, l2, v2]) =>
    '<tr>' +
    `<th colspan="2">${esc(l1)}</th><td colspan="3">${val(v1)}</td>` +
    `<th>${esc(l2)}</th><td colspan="2">${val(v2)}</td>` +
    '</tr>'
  ).join('');
}

/**
 * ส่วนที่ 2 — ข้อมูลเครื่อง
 * กริด: [A:E ป้าย] [F เครื่องที่ 1] [G เครื่องที่ 2] [H ว่าง]
 */
function sectionUnits(units) {
  const unitCells = (pick, cls) => units.length === 2
    ? units.map(u => `<td class="${cls}">${pick(u)}</td>`).join('')
    : `<td class="${cls}" colspan="2">${pick(units[0])}</td>`;

  const head = '<tr>' +
    '<th colspan="5">รายการ / Item</th>' +
    unitCells(u => `เครื่องที่ ${u.slot} (Unit ${u.slot})<div class="code">${val(u.code)}</div>`, 'ctr hd') +
    '<td></td></tr>';

  const lines = [
    ['Indoor Serial No.', u => val(u.inSn)],
    ['Indoor Asset No.', u => val(u.inAsset)],
    ['Outdoor Serial No.', u => val(u.outSn)],
    ['Outdoor Asset No.', u => val(u.outAsset)]
  ];

  return head + lines.map(([label, pick]) =>
    `<tr><th colspan="5">${esc(label)}</th>` + unitCells(pick, 'ctr') + '<td></td></tr>'
  ).join('');
}

/**
 * ส่วนที่ 3 — รายการบำรุงรักษาและตรวจสอบ
 * กริด: [A ข้อ] [B:D รายการ] [E หน่วย/เกณฑ์] [F เครื่อง 1] [G เครื่อง 2] [H หมายเหตุ]
 */
function sectionChecklist(form, units) {
  const unitCells = pick => units.length === 2
    ? units.map(u => `<td class="ctr">${pick(u)}</td>`).join('')
    : `<td class="ctr" colspan="2">${pick(units[0])}</td>`;

  const head = '<tr>' +
    '<th class="ctr">ข้อ</th><th colspan="3">รายการตรวจสอบ</th><th class="ctr">หน่วย/เกณฑ์</th>' +
    (units.length === 2
      ? units.map(u => `<th class="ctr">เครื่องที่ ${u.slot}</th>`).join('')
      : `<th class="ctr" colspan="2">เครื่องที่ ${units[0].slot}</th>`) +
    '<th>หมายเหตุ</th></tr>';

  const body = checklistOf(form).map(item =>
    '<tr>' +
    `<td class="ctr">${item.no}</td>` +
    `<td colspan="3">${esc(item.label)}</td>` +
    `<td class="ctr unit">${esc(item.criteria)}</td>` +
    unitCells(u => val(item['val' + u.slot])) +
    `<td>${val(item.note)}</td>` +
    '</tr>'
  ).join('');

  return head + body;
}

/**
 * ส่วนที่ 4 — สรุปผล
 * กริด: [A:C ป้าย] [D เครื่องที่ N] [E:F ผลประเมิน] [G:H ว่างไว้ให้เขียน]
 *
 * แบบฟอร์มไม่มีช่องค่าใช้จ่าย จึงไม่ใส่ลงกระดาษ — ราคายังเก็บอยู่ในระบบตามเดิม
 */
function sectionSummary(form, units) {
  return units.map(u =>
    '<tr>' +
    '<th colspan="3">บันทึกผลการล้างและตรวจสอบเครื่องปรับอากาศ</th>' +
    `<td class="ctr">เครื่องที่ ${u.slot}</td>` +
    `<td colspan="2">${val(form.EquipmentCondition)}</td>` +
    '<td colspan="2"></td>' +
    '</tr>'
  ).join('');
}

/**
 * ส่วนที่ 6 — การลงนาม
 * กริด: [A:E ช่องซ้าย] [F:H ช่องขวา] สองแถวต่อหนึ่งคู่ (ชื่อตำแหน่ง แล้วบรรทัดเซ็น)
 */
function sectionSign(form) {
  const pairs = [
    [['ผู้ดำเนินการล้างแอร์ (บ./หจก.)', form.CompanyName],
     ['ผู้ควบคุมงาน (Interlink)', '']],
    [['ผู้ตรวจสอบ (Supervisor / Area / Region Manager)', form.SupervisorName],
     ['Approve (Infra)', '']]
  ];

  const LINE = 'ลงชื่อ ……………………………… วันที่ …../…../……..';

  return pairs.map(([left, right]) =>
    '<tr>' +
    `<th colspan="5">${esc(left[0])}</th><th colspan="3">${esc(right[0])}</th>` +
    '</tr><tr class="sign">' +
    `<td colspan="5"><div class="who">${val(left[1])}</div><div>${LINE}</div></td>` +
    `<td colspan="3"><div class="who">${val(right[1])}</div><div>${LINE}</div></td>` +
    '</tr>'
  ).join('');
}

/* ==================== ตัวเอกสาร ==================== */

/**
 * สร้างหน้า HTML ของเอกสารหนึ่งใบ
 *
 * @param {Object} form แถวจากตารางเอกสาร (รวม ChecklistJSON)
 * @param {Object} [opts]
 * @param {string} [opts.fontHref] ที่อยู่ไฟล์ฟอนต์ ถ้าเว้นไว้จะใช้ฟอนต์ของเครื่อง
 * @returns {string} หน้า HTML เต็มใบ พร้อมเปิดดูหรือสั่งปริ้น
 */
export function buildCleaningDocHtml(form, opts = {}) {
  const units = unitsOf(form);
  if (!units.length) throw new Error('เอกสารใบนี้ยังไม่มีข้อมูลเครื่องปรับอากาศ');

  const docNo = plainText(form.DocNo) || plainText(form.ID);
  const total = COL_WIDTHS.reduce((a, b) => a + b, 0);
  const cols = COL_WIDTHS.map(w => `<col style="width:${(w / total * 100).toFixed(2)}%">`).join('');

  const logo = opts.logoHref
    ? `<img class="logo" src="${esc(opts.logoHref)}" alt="INTERLINK Telecom">`
    : '';

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>${esc(docNo)} — บันทึกผลการล้างเครื่องปรับอากาศ</title>
${opts.fontHref ? `<link rel="stylesheet" href="${esc(opts.fontHref)}">` : ''}
<style>${STYLE}</style>
</head><body>
<div class="sheet"><table><colgroup>${cols}</colgroup><tbody>
  <tr class="title"><td colspan="8">${logo}บันทึกผลการล้างและตรวจสอบเครื่องปรับอากาศ (Node)
    <span class="docno">เลขที่ ${esc(docNo)}</span></td></tr>

  ${sectionRow('ส่วนที่ 1 : ข้อมูล Node')}
  ${sectionNode(form, units)}

  ${sectionRow('ส่วนที่ 2 : ข้อมูลเครื่อง')}
  ${sectionUnits(units)}

  ${sectionRow('ส่วนที่ 3 : รายการบำรุงรักษาและตรวจสอบ')}
  ${sectionChecklist(form, units)}

  ${sectionRow('ส่วนที่ 4 : สรุปผล')}
  ${sectionSummary(form, units)}

  ${sectionRow('ส่วนที่ 5 : บันทึกเพิ่มเติม')}
  <tr class="note"><td colspan="8">${val(form.AdditionalNote)}</td></tr>

  ${sectionRow('ส่วนที่ 6 : การลงนาม')}
  ${sectionSign(form)}

  <tr class="ref"><td colspan="8">อ้างอิงแรงดันน้ำยา (Reference): R22 ≈ 60–70 PSI (Low) /
    R32 ≈ 110–130 PSI / R410A ≈ 120–140 PSI | ค่าจริงขึ้นกับปริมาณน้ำยา
    ประสิทธิภาพคอมเพรสเซอร์ ความยาวท่อ และอุณหภูมิห้อง</td></tr>
</tbody></table></div>
</body></html>`;
}

/**
 * รูปแบบหน้ากระดาษ
 *
 * สีทั้งหมดดึงมาจากไฟล์ Excel ตัวจริง ไม่ได้เลือกเอง:
 *   แถบหัวข้อส่วน    #D9D9D9   (ขาว เข้มขึ้น 15% ตามที่ตั้งไว้ในไฟล์)
 *   คอลัมน์หน่วย/เกณฑ์ #F2F2F2 ตัวอักษร #808080
 *   ป้ายลงนามและแถวอ้างอิง #F2F2F2
 *   ค่าที่กรอกลงไป    ตัวอักษรสีน้ำเงิน #0000FF ← จุดเด่นของแบบฟอร์มนี้
 *   ที่เหลือพื้นขาว เส้นตารางดำ
 *
 * คุมให้จบใน 1 หน้า A4 เหมือนแบบฟอร์มกระดาษ ซึ่งเป็นข้อกำหนดของเอกสารชุดนี้
 * ใช้ @page ตั้งขอบกระดาษเอง แทนการพึ่งค่าเริ่มต้นของเบราว์เซอร์ซึ่งต่างกันไป
 */
const STYLE = `
@page { size: A4 portrait; margin: 7mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Sarabun', 'Tahoma', sans-serif; color: #000; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
td, th { border: 0.5pt solid #000; padding: 0.7mm 1.5mm; font-size: 8pt;
         vertical-align: middle; text-align: left; word-wrap: break-word; }
th { font-weight: 700; background: #fff; }
.ctr, td.ctr, th.ctr { text-align: center; }

/* ค่าที่กรอกลงในแบบฟอร์มเป็นสีน้ำเงิน แยกจากข้อความที่พิมพ์มากับฟอร์ม */
.v { color: #0000FF; }

/* โลโก้อยู่บรรทัดบนชิดซ้าย ชื่อเอกสารอยู่บรรทัดถัดมากึ่งกลาง
   ไม่ซ้อนกันเหมือนในไฟล์ Excel ที่รูปลอยทับช่องชื่อเรื่อง */
tr.title td { border: none; text-align: center; font-size: 14pt; font-weight: 700;
              padding: 0 0 2mm; }
/* ขนาดและการครอบตัดเท่ากับที่วางไว้ในไฟล์ Excel (กว้าง 54 มม. สูง 15.2 มม.
   โดยตัดขอบบนล่างของรูปออก เหลือเฉพาะตัวโลโก้) */
tr.title .logo { display: block; width: 54mm; height: 15.2mm;
                 object-fit: cover; object-position: center; margin-bottom: 1mm; }
tr.title .docno { display: block; font-size: 9pt; font-weight: 400; margin-top: 1mm; }

tr.sec td { background: #D9D9D9; font-weight: 700; font-size: 8.5pt; padding: 1mm 1.5mm; }
td.unit, th.unit { background: #F2F2F2; color: #808080; }
.code { font-size: 6.8pt; font-weight: 400; color: #000; }
tr.note td { height: 13mm; vertical-align: top; white-space: pre-wrap; }
tr.sign th { background: #F2F2F2; }
tr.sign td { height: 12mm; vertical-align: bottom; }
tr.sign .who { margin-bottom: 3.5mm; }
tr.ref td { background: #F2F2F2; font-size: 6.5pt; }

@media screen {
  body { background: #e9edf2; padding: 6mm 0; }
  .sheet { width: 210mm; margin: 0 auto; background: #fff; padding: 7mm;
           box-shadow: 0 1px 6px rgba(0,0,0,.2); }
}
`;
