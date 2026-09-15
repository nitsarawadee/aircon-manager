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
 * หน้า HTML ทำให้:
 *   - เปิดดูและสั่งปริ้นได้ทันที ไม่ต้องออกเน็ต ไม่ต้องรอคิว
 *   - เบราว์เซอร์จัดฟอนต์ไทยให้เอง ซึ่งเป็นส่วนที่เขียนเองยากที่สุด
 *   - ชั้น platform เอาหน้านี้ไปสั่งเบราว์เซอร์แปลงเป็นไฟล์ PDF ต่อได้
 *     โดยไฟล์นี้ไม่ต้องรู้เลยว่าปลายทางจะเป็นกระดาษ จอ หรือไฟล์
 *
 * ไฟล์นี้อยู่ใน src/ จึงห้ามแตะระบบไฟล์หรือสั่งโปรแกรมอื่น — คืนค่าเป็นข้อความล้วน
 *
 * ============================================================================
 * หนึ่งหรือสองคอลัมน์
 * ============================================================================
 * ใบที่ล้างสองเครื่องออกมาเป็นสองคอลัมน์ ใบที่ล้างเครื่องเดียวออกมาคอลัมน์เดียว
 * และหัวคอลัมน์บอกเลขเครื่องจริงเสมอ — ล้างเฉพาะเครื่องที่ 2 หัวคอลัมน์ต้องขึ้นว่า
 * "เครื่องที่ 2" ไม่ใช่เลื่อนมาเป็นคอลัมน์แรกแล้วขึ้นว่าเครื่องที่ 1
 */

/**
 * หน่วยและเกณฑ์ของแต่ละข้อ ตามคอลัมน์ "หน่วย/เกณฑ์" ในแบบฟอร์ม Rev2026
 *
 * แยกไว้ที่นี่ ไม่ปนกับ CLEANING_CHECKLIST_ITEMS เพราะเป็นเรื่องของการแสดงผล
 * บนกระดาษ ส่วนตัวรายการเป็นเรื่องของข้อมูล ข้อไหนไม่ได้ระบุไว้ถือว่าไม่มีเกณฑ์
 */
const CRITERIA = {
  10: '°C (24–26)', 11: '°C (24–28)', 12: 'Type', 13: 'PSI',
  14: 'A', 15: 'A', 16: 'V (220–240)', 18: '°C (33–35)', 19: 'ชม. (4–6)'
};

const esc = v => plainText(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** ค่าที่ว่างให้เป็นขีด เพื่อให้เห็นว่าเป็นช่องที่ตั้งใจเว้น ไม่ใช่ลืมพิมพ์ */
const dash = v => esc(v) || '–';

/**
 * เครื่องที่มีข้อมูลอยู่ในใบนี้ เรียงตามเลขเครื่อง
 * @returns {Array<{slot: number, code: string, brand: string, btu: string, ...}>}
 */
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
      outAsset: form['Unit' + slot + '_OutdoorAsset'],
      price: form['Price' + slot]
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

/* ==================== ส่วนต่างๆ ของเอกสาร ==================== */

function sectionNode(form, units) {
  const first = units[0] || {};
  const timeRange = [formatTime(form.TimeStart), formatTime(form.TimeEnd)].filter(Boolean).join(' – ');

  const pairs = [
    ['Node / รหัส Node', [plainText(form.NodeName), plainText(form.SiteCode)].filter(Boolean).join(' / ')],
    ['ประเภท Node', form.LocationType],
    ['จังหวัด / Province', form.Province],
    ['Brand / ยี่ห้อแอร์', first.brand],
    ['วันที่ (DD/MM/YYYY)', formatDate(form.Date)],
    ['BTU / ขนาดทำความเย็น', first.btu],
    ['เวลาเริ่ม–สิ้นสุด', timeRange],
    ['รวมเวลา (ชม.)', formatTime(form.TotalTime)]
  ];

  const rows = [];
  for (let i = 0; i < pairs.length; i += 2) {
    rows.push(
      '<tr>' +
      `<th>${esc(pairs[i][0])}</th><td>${dash(pairs[i][1])}</td>` +
      `<th>${esc(pairs[i + 1][0])}</th><td>${dash(pairs[i + 1][1])}</td>` +
      '</tr>'
    );
  }
  return '<table class="grid">' + rows.join('') + '</table>';
}

function sectionUnits(units) {
  const head = '<tr><th class="item">รายการ / Item</th>' +
    units.map(u => `<th>เครื่องที่ ${u.slot} (Unit ${u.slot})<div class="code">${esc(u.code)}</div></th>`).join('') +
    '</tr>';

  const lines = [
    ['Indoor Serial No.', u => u.inSn],
    ['Indoor Asset No.', u => u.inAsset],
    ['Outdoor Serial No.', u => u.outSn],
    ['Outdoor Asset No.', u => u.outAsset]
  ];

  const body = lines.map(([label, pick]) =>
    `<tr><th class="item">${esc(label)}</th>` +
    units.map(u => `<td>${dash(pick(u))}</td>`).join('') +
    '</tr>'
  ).join('');

  return '<table class="grid units">' + head + body + '</table>';
}

function sectionChecklist(form, units) {
  const head = '<tr><th class="no">ข้อ</th><th class="label">รายการตรวจสอบ</th><th class="unit">หน่วย/เกณฑ์</th>' +
    units.map(u => `<th class="val">เครื่องที่ ${u.slot}</th>`).join('') +
    '<th class="note">หมายเหตุ</th></tr>';

  const body = checklistOf(form).map(item =>
    '<tr>' +
    `<td class="no">${item.no}</td>` +
    `<td class="label">${esc(item.label)}</td>` +
    `<td class="unit">${esc(item.criteria)}</td>` +
    units.map(u => `<td class="val">${dash(item['val' + u.slot])}</td>`).join('') +
    `<td class="note">${esc(item.note)}</td>` +
    '</tr>'
  ).join('');

  return '<table class="grid check">' + head + body + '</table>';
}

function sectionSummary(form, units) {
  const rows = units.map(u =>
    '<tr>' +
    `<th class="item">เครื่องที่ ${u.slot} — ${esc(u.code)}</th>` +
    `<td>${dash(form.EquipmentCondition)}</td>` +
    `<td class="price">${u.price ? esc(Number(u.price).toLocaleString()) + ' บาท' : '–'}</td>` +
    '</tr>'
  ).join('');

  return '<table class="grid">' + rows + '</table>';
}

function sectionSign(form) {
  // สี่ช่องตามแบบฟอร์ม Rev2026 — ช่องที่ระบบยังไม่ได้เก็บชื่อไว้ เว้นให้เซ็นด้วยมือ
  const blocks = [
    ['ผู้ดำเนินการล้างแอร์ (บ./หจก.)', form.CompanyName],
    ['ผู้ควบคุมงาน (Interlink)', ''],
    ['ผู้ตรวจสอบ (Supervisor / Area / Region Manager)', form.SupervisorName],
    ['Approve (Infra)', '']
  ];

  return '<table class="grid sign">' +
    '<tr>' + blocks.slice(0, 2).map(b => `<th>${esc(b[0])}</th>`).join('') + '</tr>' +
    '<tr>' + blocks.slice(0, 2).map(b => `<td>${signCell(b[1])}</td>`).join('') + '</tr>' +
    '<tr>' + blocks.slice(2).map(b => `<th>${esc(b[0])}</th>`).join('') + '</tr>' +
    '<tr>' + blocks.slice(2).map(b => `<td>${signCell(b[1])}</td>`).join('') + '</tr>' +
    '</table>';
}

const signCell = name =>
  `<div class="name">${dash(name)}</div>` +
  '<div class="line">ลงชื่อ ……………………………… วันที่ …../…../……..</div>';

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
  const fontLink = opts.fontHref
    ? `<link rel="stylesheet" href="${esc(opts.fontHref)}">`
    : '';

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>${esc(docNo)} — บันทึกผลการล้างเครื่องปรับอากาศ</title>
${fontLink}
<style>${STYLE}</style>
</head><body>
<div class="sheet">
  <header>
    <h1>บันทึกผลการล้างและตรวจสอบเครื่องปรับอากาศ (Node)</h1>
    <div class="docno">เลขที่เอกสาร <strong>${esc(docNo)}</strong></div>
  </header>

  <h2>ส่วนที่ 1 : ข้อมูล Node</h2>
  ${sectionNode(form, units)}

  <h2>ส่วนที่ 2 : ข้อมูลเครื่อง</h2>
  ${sectionUnits(units)}

  <h2>ส่วนที่ 3 : รายการบำรุงรักษาและตรวจสอบ</h2>
  ${sectionChecklist(form, units)}

  <h2>ส่วนที่ 4 : สรุปผล</h2>
  ${sectionSummary(form, units)}

  <h2>ส่วนที่ 5 : บันทึกเพิ่มเติม</h2>
  <div class="note-box">${esc(form.AdditionalNote)}</div>

  <h2>ส่วนที่ 6 : การลงนาม</h2>
  ${sectionSign(form)}

  <footer>อ้างอิงแรงดันน้ำยา (Reference): R22 ≈ 60–70 PSI (Low) / R32 ≈ 110–130 PSI /
  R410A ≈ 120–140 PSI | ค่าจริงขึ้นกับปริมาณน้ำยา ประสิทธิภาพคอมเพรสเซอร์ ความยาวท่อ และอุณหภูมิห้อง</footer>
</div>
</body></html>`;
}

/**
 * รูปแบบหน้ากระดาษ
 *
 * คุมให้จบใน 1 หน้า A4 ด้วยขนาดตัวอักษรและระยะขอบที่วัดจากของจริง
 * ใช้ @page ตั้งขอบกระดาษ แทนการพึ่งค่าเริ่มต้นของเบราว์เซอร์ซึ่งต่างกันไป
 */
const STYLE = `
@page { size: A4 portrait; margin: 8mm 8mm 6mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Sarabun', 'Tahoma', sans-serif; color: #000; }
.sheet { padding: 4mm; }
header { text-align: center; margin-bottom: 3mm; }
h1 { font-size: 13pt; margin: 0 0 1mm; }
.docno { font-size: 9pt; }
h2 { font-size: 9.5pt; margin: 2.5mm 0 1mm; padding: 0.8mm 2mm;
     background: #e8eef6; border-left: 3px solid #1153a1; }
table.grid { width: 100%; border-collapse: collapse; }
table.grid th, table.grid td { border: 0.4pt solid #444; padding: 0.8mm 1.5mm;
     font-size: 8pt; vertical-align: middle; }
table.grid th { background: #f4f6f9; font-weight: 600; text-align: left; }
table.units th, table.units td { text-align: center; }
table.units th.item, table.units td.item { text-align: left; width: 38%; }
table.units .code { font-size: 7pt; font-weight: 400; color: #333; }
table.check td.no, table.check th.no { width: 6%; text-align: center; }
table.check th.label { width: 42%; }
table.check th.unit, table.check td.unit { width: 13%; text-align: center; }
table.check th.val, table.check td.val { text-align: center; }
table.check th.note, table.check td.note { width: 14%; }
table.grid td.price { text-align: right; white-space: nowrap; }
.note-box { border: 0.4pt solid #444; min-height: 11mm; padding: 1.5mm; font-size: 8pt;
     white-space: pre-wrap; }
table.sign td { height: 13mm; vertical-align: bottom; }
table.sign .name { font-size: 8pt; margin-bottom: 4mm; }
table.sign .line { font-size: 8pt; }
footer { margin-top: 2mm; font-size: 6.5pt; color: #333; }
@media screen {
  body { background: #e9edf2; padding: 6mm 0; }
  .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff;
           box-shadow: 0 1px 6px rgba(0,0,0,.2); padding: 8mm; }
}
`;
