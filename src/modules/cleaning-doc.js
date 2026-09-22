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
 * หน้า HTML เปิดดูและสั่งปริ้นได้ทันทีโดยไม่ต้องออกเน็ต และเบราว์เซอร์จัดฟอนต์ไทย
 * ให้เอง ซึ่งเป็นส่วนที่เขียนเองยากที่สุด ชั้น platform เอาหน้านี้ไปสั่งเบราว์เซอร์
 * แปลงเป็นไฟล์ PDF ต่อได้ โดยไฟล์นี้ไม่ต้องรู้ว่าปลายทางเป็นจอ กระดาษ หรือไฟล์
 *
 * ไฟล์นี้อยู่ใน src/ จึงห้ามแตะระบบไฟล์หรือสั่งโปรแกรมอื่น — คืนค่าเป็นข้อความล้วน
 *
 * ============================================================================
 * วางตามแบบฟอร์มควบคุมของบริษัท
 * ============================================================================
 * ยึดตามไฟล์ ITEL-FM-NE-004 บันทึกผลการล้างเครื่องปรับอากาศ (ฉบับ PDF)
 * ทั้งถ้อยคำ เส้นตาราง สีพื้น และการจัดวาง เอกสารที่ระบบออกให้จึงหน้าตาเหมือน
 * กระดาษที่ใช้เซ็นกันอยู่ ไม่ใช่แค่มีข้อมูลครบ
 *
 * ทั้งสามหน้าใช้ตารางกริดเดียวกัน 8 คอลัมน์ ความกว้างวัดจากเอกสารตัวจริง
 *
 * ============================================================================
 * หนึ่งหรือสองเครื่อง
 * ============================================================================
 * ตารางมีสองคอลัมน์เสมอ และเครื่องอยู่คอลัมน์ตามตำแหน่งจริงของมันเสมอ
 * เครื่องที่ 1 อยู่คอลัมน์ซ้าย เครื่องที่ 2 อยู่คอลัมน์ขวา ไม่ว่าจะล้างกี่ตัว
 *
 * ล้างตัวเดียวจะเห็นข้อมูลแค่ตัวเดียว อีกคอลัมน์เว้นว่างไว้เหมือนแบบฟอร์ม
 * กระดาษที่กรอกแค่ฝั่งเดียว — ไม่ยุบรวมสองคอลัมน์เป็นช่องเดียว เพราะคนอ่าน
 * ดูจากตำแหน่งคอลัมน์ว่าเป็นแอร์ตัวไหนของ Node ยุบแล้วจะแยกไม่ออก
 *
 * หน้ารูปมีเฉพาะเครื่องที่ล้างจริง ล้างตัวเดียวก็มีหน้าเดียว
 */

/** รหัสแบบฟอร์มควบคุม พิมพ์มุมขวาล่างของทุกหน้า */
const FORM_CODE = 'ITEL-FM-NE-004';

/**
 * ความกว้าง 8 คอลัมน์ วัดจากเอกสารตัวจริง
 * ทุกส่วนของเอกสารใช้ขอบคอลัมน์ชุดนี้ร่วมกัน จึงรวมเป็นตารางเดียวได้
 */
const COL_WIDTHS = [50, 180, 190, 95, 130, 176, 176, 301];

/** ผลประเมินสองตัวเลือกในส่วนที่ 4 ตามที่พิมพ์ไว้บนแบบฟอร์ม */
const CONDITIONS = ['สภาพเครื่องสมบูรณ์', 'สภาพเครื่องควรปรับปรุง'];

/** คำบรรยายใต้กรอบรูปทั้ง 9 ช่อง เรียงซ้ายไปขวา บนลงล่าง */
const PHOTO_CAPTIONS = [
  'รูปก่อนดำเนินล้าง', 'รูปดำเนินการล้าง', 'รูปดำเนินการล้าง',
  'รูปดำเนินการล้าง', 'รูปดำเนินการล้าง', 'รูปหลังดำเนินการล้าง',
  'รูปวัดค่ากระแสคอมเพรสเซอร์ขณะทำงาน', 'รูปวัดแรงดันไฟฟ้า', 'รูปวัดแรงดันน้ำยาด้านต่ำ (LOW)'
];

const esc = v => plainText(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * ค่าที่กรอกลงในแบบฟอร์ม
 * ช่องที่ยังไม่ได้กรอกปล่อยว่างจริงๆ เหมือนแบบฟอร์มเปล่าที่ปริ้นไปเขียนมือ
 */
const val = v => {
  const t = esc(v);
  return t ? `<span class="v">${t}</span>` : '';
};

/* ==================== อ่านข้อมูลจากใบ ==================== */

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
      outAsset: form['Unit' + slot + '_OutdoorAsset'],
      // ผลประเมินของเครื่องที่ 1 อยู่ในคอลัมน์ชื่อเดิม (เปลี่ยนชื่อคอลัมน์ไม่ได้)
      cond: plainText(form[slot === 2 ? 'EquipmentCondition2' : 'EquipmentCondition'])
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
      unit: item.unit || '-',
      val1: got.val1, val2: got.val2, note: got.note
    };
  });
}

/* ==================== ชิ้นส่วนที่ใช้ซ้ำ ==================== */

/** แถบหัวข้อส่วน กินทั้งแถว */
const sectionRow = title => `<tr class="sec"><td colspan="8">${esc(title)}</td></tr>`;

/** เครื่องของแต่ละช่องเรียงตามตำแหน่งบนแบบฟอร์ม ช่องที่ไม่ได้ล้างเป็น null */
const bySlot = units => [1, 2].map(s => units.find(u => u.slot === s) || null);

/**
 * ช่องของเครื่องสองช่อง เรียงตามตำแหน่งจริงเสมอ
 * ช่องของเครื่องที่ไม่ได้ล้าง เว้นว่างไว้ ไม่ยุบรวมกับอีกช่อง
 */
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
    ['วันที่', formatDate(form.Date), 'BTU / ขนาดทำความเย็น', first.btu],
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
    unitCells(units, u => `เครื่องที่ ${u.slot} (AIR ${u.slot})`, 'ctr hd') +
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

/** ส่วนที่ 3 : รายการบำรุงรักษา — [1 ข้อ] [2-4 รายการ] [5 หน่วย] [6-7 เครื่อง] [8 หมายเหตุ] */
function sectionChecklist(form, units) {
  const head = '<tr>' +
    '<th class="ctr">ข้อ</th><th colspan="3" class="ctr">รายการตรวจสอบ</th><th class="ctr">หน่วย/เกณฑ์</th>' +
    bySlot(units).map(u => `<th class="ctr">${u ? 'เครื่องที่ ' + u.slot : ''}</th>`).join('') +
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
 * ส่วนที่ 4 : สรุปผล — [1-3 ป้าย] [4 เครื่องที่ N] [5-8 ช่องติ๊ก]
 *
 * แบบฟอร์มให้ติ๊กเลือกสองตัวเลือกต่อเครื่อง และแต่ละเครื่องติ๊กคนละอย่างได้จริง
 * เช่นไปล้างสองตัว ตัวหนึ่งสมบูรณ์ อีกตัวควรปรับปรุง
 * ห้ามเอาผลของเครื่องหนึ่งไปติ๊กแทนอีกเครื่อง — เอกสารนี้เอาไปเซ็นกัน
 */
function sectionSummary(form, units) {
  return units.map(u =>
    '<tr>' +
    '<th colspan="3" class="lbl">ผลการล้างและตรวจสอบเครื่องปรับอากาศ</th>' +
    `<td class="ctr tight">เครื่องที่ ${u.slot}</td>` +
    '<td colspan="4" class="choices">' +
    CONDITIONS.map(c =>
      `<span class="box">${plainText(u.cond).trim() === c ? '☑' : '☐'}</span> ${esc(c)}`
    ).join('<span class="gap"></span>') +
    '</td></tr>'
  ).join('');
}

/** ส่วนที่ 6 : การลงนาม — สองช่องต่อแถว ป้ายอยู่กึ่งกลาง บรรทัดเซ็นอยู่กึ่งกลาง */
function sectionSign(form) {
  const LINE = 'ลงชื่อ ……………………………… วันที่ …../…../……..';

  return [
    [['ผู้ดำเนินการล้างแอร์ (บ./หจก.)', form.CompanyName],
     ['ผู้ควบคุมงาน (Interlink)', '']],
    [['ผู้ตรวจสอบ (Supervisor / Area / Region Manager)', form.SupervisorName],
     ['Approve (Infra)', '']]
  ].map(([left, right]) =>
    '<tr>' +
    `<th colspan="5" class="ctr">${esc(left[0])}</th><th colspan="3" class="ctr">${esc(right[0])}</th>` +
    '</tr><tr class="sign">' +
    `<td colspan="5" class="ctr">${signCell(left[1], LINE)}</td>` +
    `<td colspan="3" class="ctr">${signCell(right[1], LINE)}</td>` +
    '</tr>'
  ).join('');
}

const signCell = (name, line) =>
  (name ? `<div class="who">${val(name)}</div>` : '') + `<div>${line}</div>`;

/* ==================== หน้ารูปภาพ ==================== */

/**
 * หน้ารูปของเครื่องหนึ่งตัว — ตาราง 3x3 คำบรรยายอยู่ในกรอบใต้รูป
 *
 * ช่องที่ยังไม่มีรูปพิมพ์เป็นกรอบเปล่าพร้อมข้อความ "วางรูปในกรอบด้านล่าง (Picture)"
 * เหมือนแบบฟอร์มกระดาษ เพื่อให้ปริ้นไปติดรูปด้วยมือได้
 */
function photoPage(unit, form, photos, opts) {
  const cell = i => {
    const src = photos[unit.slot + '-' + i];
    return '<td class="pic"><div class="box">' +
      (src
        ? `<img src="${src}" alt="">`
        : '<div class="ph">วางรูปในกรอบด้านล่าง&nbsp;<i>(Picture)</i></div>') +
      `<div class="cap">${esc(PHOTO_CAPTIONS[i - 1])}</div></div></td>`;
  };

  const rows = [];
  for (let r = 0; r < 3; r++) {
    rows.push('<tr>' + [1, 2, 3].map(c => cell(r * 3 + c)).join('') + '</tr>');
  }

  // เหตุผลที่รูปวัดค่าไม่ครบ ต้องอยู่บนหน้าเดียวกับกรอบที่ว่าง
  // ไม่งั้นคนที่เปิดเอกสารมาดูจะเห็นแค่กรอบว่างลอยๆ โดยไม่รู้ว่าเพราะอะไร
  const why = plainText(form.MissingPhotoNote).trim();
  const note = why
    ? `<table class="info"><tbody><tr>
    <th>เหตุที่รูปวัดค่าไม่ครบ</th><td colspan="3">${val(why)}</td>
  </tr></tbody></table>`
    : '';

  return `<div class="sheet"><div class="frame">
  ${pageHeader('ภาพถ่ายประกอบการล้างเครื่องปรับอากาศ — เครื่องที่ ' + unit.slot +
               ' (AIR ' + unit.slot + ')', opts)}
  <table class="info"><tbody><tr>
    <th>Node Name</th><td>${val(plainText(form.NodeName))}</td>
    <th>วันที่</th><td>${val(formatDate(form.Date))}</td>
  </tr></tbody></table>
  <table class="pics"><tbody>${rows.join('')}</tbody></table>
  ${note}
</div><div class="code">${FORM_CODE}</div></div>`;
}

/* ==================== ตัวเอกสาร ==================== */

/** แถบหัวกระดาษ — โลโก้ซ้าย ชื่อเอกสารกึ่งกลาง อยู่ในกรอบเดียวกัน */
const pageHeader = (title, opts) =>
  '<table class="hdr"><tbody><tr>' +
  '<td class="logo">' +
  (opts.logoHref ? `<img src="${esc(opts.logoHref)}" alt="INTERLINK Telecom">` : '') +
  `</td><td class="name">${esc(title)}</td>` +
  '</tr></tbody></table>';

/**
 * สร้างหน้า HTML ของเอกสารหนึ่งใบ (ใบบันทึกผล + หน้ารูปเครื่องละหนึ่งหน้า)
 *
 * @param {Object} form แถวจากตารางเอกสาร (รวม ChecklistJSON)
 * @param {Object} [opts]
 * @param {string} [opts.fontHref] ที่อยู่ไฟล์ฟอนต์ เว้นไว้จะใช้ฟอนต์ของเครื่อง
 * @param {string} [opts.logoHref] ที่อยู่ไฟล์โลโก้ เว้นไว้จะไม่มีโลโก้
 * @param {Object} [opts.photos]   รูปที่แนบไว้ คีย์ "<เครื่อง>-<ช่อง>" ค่าเป็น data URL
 * @returns {string} หน้า HTML เต็มใบ พร้อมเปิดดูหรือสั่งปริ้น
 */
export function buildCleaningDocHtml(form, opts = {}) {
  const units = unitsOf(form);
  if (!units.length) throw new Error('เอกสารใบนี้ยังไม่มีข้อมูลเครื่องปรับอากาศ');

  const photos = opts.photos || {};
  const total = COL_WIDTHS.reduce((a, b) => a + b, 0);
  const cols = COL_WIDTHS.map(w => `<col style="width:${(w / total * 100).toFixed(2)}%">`).join('');

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>${esc(plainText(form.DocNo) || plainText(form.ID))} — บันทึกผลการล้างเครื่องปรับอากาศ</title>
${opts.fontHref ? `<link rel="stylesheet" href="${esc(opts.fontHref)}">` : ''}
<style>${STYLE}</style>
</head><body>

<div class="sheet"><div class="frame">
  ${pageHeader('บันทึกผลการล้างเครื่องปรับอากาศ', opts)}

  <table class="main"><colgroup>${cols}</colgroup><tbody>
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
  </tbody></table>

  <div class="ref">อ้างอิงแรงดันน้ำยา <i>(Reference): R22 ≈ 60–70 PSI (Low) / R32 ≈ 110–130 PSI /
    R410A ≈ 120–140 PSI</i> | ค่าจริงขึ้นกับปริมาณน้ำยา ประสิทธิภาพคอมเพรสเซอร์
    ความยาวท่อ และอุณหภูมิห้อง</div>
</div><div class="code">${FORM_CODE}</div></div>

${units.map(u => photoPage(u, form, photos, opts)).join('\n')}
</body></html>`;
}

/**
 * รูปแบบหน้ากระดาษ
 *
 * สีและเส้นทั้งหมดยึดตามเอกสารควบคุมตัวจริง:
 *   แถบหัวข้อส่วน / ป้ายในหน้ารูป / คำบรรยายใต้รูป  พื้นเทา #ECECEC
 *   คอลัมน์หน่วย/เกณฑ์  ตัวอักษรเทา #7F7F7F
 *   ที่เหลือพื้นขาว เส้นดำบาง ตัวหนังสือดำ
 *
 * ทุกหน้าอยู่ในกรอบนอก และมีรหัสแบบฟอร์มที่มุมขวาล่าง
 */
const STYLE = `
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Sarabun', 'Tahoma', sans-serif; color: #000; }

.sheet { page-break-after: always; }
.sheet:last-child { page-break-after: auto; }
.frame { border: 1pt solid #000; }
.code { text-align: right; font-size: 7.5pt; margin-top: 1.5mm; }

/* ---------- หัวกระดาษ ---------- */
table.hdr { width: 100%; border-collapse: collapse; }
table.hdr td { border: none; border-bottom: 1pt solid #000; padding: 1.5mm 3mm; vertical-align: middle; }
table.hdr td.logo { width: 52mm; }
table.hdr td.logo img { display: block; width: 44mm; height: 11.5mm;
                        object-fit: cover; object-position: center; }
table.hdr td.name { text-align: center; font-size: 12.5pt; font-weight: 700;
                    padding-right: 14mm; white-space: nowrap; }

/* ---------- ตารางหลัก ---------- */
table.main { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.main td, table.main th { border: 0.5pt solid #000; padding: 0.5mm 1.2mm;
                               font-size: 7.3pt; line-height: 1.25; vertical-align: middle;
                               text-align: left; word-wrap: break-word; font-weight: 400; }
table.main th { font-weight: 400; }
table.main th.hd { font-weight: 700; }
.ctr { text-align: center !important; }
.lbl { padding-left: 2.5mm !important; }
.v { color: #000; }
td.unit { color: #7F7F7F; }
.tight { font-size: 6.6pt !important; white-space: nowrap; }

tr.sec td { background: #ECECEC; font-weight: 700; font-size: 8pt;
            padding: 0.9mm 2mm !important; border-left: none; border-right: none; }

td.choices .box { font-size: 10pt; line-height: 1; }
td.choices .gap { display: inline-block; width: 14mm; }

tr.note td { height: 15mm; vertical-align: top; white-space: pre-wrap; }
tr.sign td { height: 11mm; vertical-align: bottom; padding-bottom: 2mm !important; }
tr.sign .who { margin-bottom: 2mm; }

.ref { text-align: center; font-size: 6.6pt; padding: 1.5mm 4mm; }

/* ---------- หน้ารูปภาพ ---------- */
table.info { width: 100%; border-collapse: collapse; }
table.info th, table.info td { border: 0.5pt solid #000; padding: 1.5mm 3mm; font-size: 9pt; }
table.info th { background: #ECECEC; font-weight: 700; text-align: center; width: 18%; }
table.info td { width: 32%; text-align: center; }

table.pics { width: 100%; border-collapse: separate; border-spacing: 3mm; table-layout: fixed; }
table.pics td.pic { width: 33.33%; border: none; padding: 0; vertical-align: top; }
table.pics .box { border: 0.75pt solid #000; }
table.pics img { display: block; width: 100%; height: 62mm; object-fit: cover; }
table.pics .ph { height: 62mm; display: flex; align-items: center; justify-content: center;
                 color: #7F7F7F; font-size: 8pt; text-align: center; padding: 2mm; }
table.pics .cap { border-top: 0.75pt solid #000; background: #ECECEC; text-align: center;
                  font-size: 8pt; padding: 1mm 1mm; min-height: 7mm; }

@media screen {
  body { background: #e9edf2; padding: 6mm 0; }
  .sheet { width: 210mm; margin: 0 auto 8mm; background: #fff; padding: 8mm;
           box-shadow: 0 1px 6px rgba(0,0,0,.2); }
}
`;
