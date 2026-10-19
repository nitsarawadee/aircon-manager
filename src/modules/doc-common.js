import { formatDate, plainText } from '../values.js';

/**
 * ชิ้นส่วนที่เอกสารทุกแบบของบริษัทใช้ร่วมกัน
 *
 * ============================================================================
 * ทำไมต้องมีไฟล์นี้
 * ============================================================================
 * แบบฟอร์มควบคุมของบริษัททุกใบใช้โครงเดียวกัน — หัวกระดาษมีโลโก้ซ้ายชื่อกลาง
 * ตารางกริด 8 คอลัมน์ แถบหัวข้อส่วนพื้นเทา ส่วนลงนาม 4 ช่อง และหน้ารูป 3x3
 * ต่างกันแค่ถ้อยคำกับรายการตรงกลาง
 *
 * ตอนมีใบเดียว (ใบล้าง) เขียนรวมไว้ที่เดียวได้ แต่ตอนนี้กำลังจะมีใบซ่อม
 * และใบติดตั้งตามมา ถ้าคัดลอกไปทั้งก้อนจะกลายเป็นสามที่ที่ต้องแก้พร้อมกัน
 * ทุกครั้งที่บริษัทปรับแบบฟอร์ม ซึ่งเป็นจุดที่ลืมแก้ไม่ครบได้ง่ายที่สุด
 *
 * ไฟล์นี้อยู่ใน src/ จึงห้ามแตะระบบไฟล์หรือสั่งโปรแกรมอื่น — คืนค่าเป็นข้อความล้วน
 */

/**
 * ความกว้าง 8 คอลัมน์ วัดจากเอกสารตัวจริง
 * ทุกส่วนของเอกสารใช้ขอบคอลัมน์ชุดนี้ร่วมกัน จึงรวมเป็นตารางเดียวได้
 */
export const COL_WIDTHS = [50, 180, 190, 95, 130, 176, 176, 301];

/**
 * <col> ตามความกว้างคอลัมน์ในไฟล์ Excel (หน่วยตัวอักษร ตามที่ Excel แสดง)
 * Excel วาดแต่ละคอลัมน์กว้างกว่าค่าในไฟล์ราว 0.42 ตัวอักษร (วัดจาก PDF ที่ Excel พิมพ์ทั้งใบล้างและใบติดตั้ง)
 * pad = ส่วนเพิ่มต่อคอลัมน์ (ชีตรูปพิมพ์ 107% วัดได้ราว 0.5)
 * splitLast = แบ่งคอลัมน์สุดท้ายเป็นกี่ช่อง (ใบซ่อมมี 6 คอลัมน์ แบ่งคอลัมน์ F ให้ครบกริด 8 ช่อง)
 */
export function xlCols(widths, splitLast = 1, pad = 0.42) {
  const w = widths.map(x => x + pad);
  const last = w.pop();
  return colgroup([...w, ...Array(splitLast).fill(last / splitLast)]);
}

/** <col> ของกริด 8 คอลัมน์ตามความกว้างที่ให้ (หน่วยใดก็ได้ — คิดเป็นสัดส่วน) */
export function colgroup(widths = COL_WIDTHS) {
  const total = widths.reduce((a, b) => a + b, 0);
  return widths.map(w => `<col style="width:${(w / total * 100).toFixed(2)}%">`).join('');
}

/** บรรทัดอ้างอิงท้ายหน้าแรก — ใบซ่อมแบ่ง 2 บรรทัดตามไฟล์ */
export const REF_LINE_2 =
  '<div class="ref">อ้างอิงแรงดันน้ำยา (Reference): R22 ≈ 60–70 PSI (Low) / R32 ≈ 110–130 PSI / R410A ≈ 120–140 PSI' +
  '<br>ค่าจริงขึ้นกับปริมาณน้ำยา ประสิทธิภาพคอมเพรสเซอร์ ความยาวท่อ และอุณหภูมิห้อง</div>';

// ใบล้าง/ใบติดตั้ง: ข้อความตามไฟล์ทุกตัว (เว้น 2 ช่องรอบ "|") — ทั้งช่องตัวเอียง ขนาดตามไฟล์ของแต่ละแบบ (--rs ดู docShell) · สีดำตามที่ Excel พิมพ์จริง
export const REF_LINE =
  '<div class="ref">อ้างอิงแรงดันน้ำยา (Reference): R22 ≈ 60–70 PSI (Low) / R32 ≈ 110–130 PSI / R410A ≈ 120–140 PSI' +
  '&nbsp;&nbsp;|&nbsp;&nbsp;ค่าจริงขึ้นกับปริมาณน้ำยา ประสิทธิภาพคอมเพรสเซอร์ ความยาวท่อ และอุณหภูมิห้อง</div>';

export const esc = v => plainText(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * วันที่ทุกจุดบนเอกสาร — 22/09/2026
 *
 * ระบบเก็บเป็น 2026-09-22 ซึ่งดีสำหรับการเรียงลำดับ แต่ไม่ใช่รูปแบบที่คนอ่าน
 * และไม่ตรงกับช่อง "…../…../…….." บนแบบฟอร์มกระดาษที่แบ่งเป็น วัน/เดือน/ปี
 *
 * ค่าที่แปลงไม่ได้ให้คืนตามเดิม ดีกว่าทำให้ช่องว่างเปล่าโดยไม่มีอะไรฟ้อง
 */
export function thaiDate(v) {
  const m = String(formatDate(v)).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : formatDate(v);
}

/**
 * ค่าที่กรอกลงในแบบฟอร์ม
 * ช่องที่ยังไม่ได้กรอกปล่อยว่างจริงๆ เหมือนแบบฟอร์มเปล่าที่ปริ้นไปเขียนมือ
 */
export const val = v => {
  const t = esc(v);
  return t ? `<span class="v">${t}</span>` : '';
};

/**
 * ส่วนบันทึกที่เว้นบรรทัดไว้ให้เขียน — n แถวจริงของตาราง เส้นเหมือนช่องอื่นตามแบบฟอร์ม
 * (เดิมวาดเส้นด้วยพื้นไล่สี พอแปลงเป็น PDF เส้นจางและห่างไม่เท่ากัน)
 * ข้อความลงทีละแถวตามบรรทัดที่พิมพ์ บรรทัดที่เกินจำนวนแถวต่อท้ายแถวสุดท้าย
 */
export function noteRows(text, n = 4, label = '') {
  const lines = String(text ?? '').replace(/\s+$/, '').split(/\r?\n/);
  const rows = Array.from({ length: n }, (_, i) =>
    i < n - 1 ? (lines[i] ?? '') : lines.slice(n - 1).join('\n'));
  return rows.map((t, i) =>
    `<tr class="note${i === 0 && label ? ' lead' : ''}"><td colspan="8">${i === 0 && label ? esc(label) + ' ' : ''}${val(t)}</td></tr>`
  ).join('');
}

/** แถบหัวข้อส่วน กินทั้งแถว */
export const sectionRow = title => `<tr class="sec"><td colspan="8">${esc(title)}</td></tr>`;

/** แถบหัวกระดาษ — โลโก้ซ้าย ชื่อเอกสารกึ่งกลาง อยู่ในกรอบเดียวกัน */
export const pageHeader = (title, opts) =>
  '<div class="hdr">' +
  (opts.logoHref ? `<div class="logo"><img src="${esc(opts.logoHref)}" alt="INTERLINK Telecom"></div>` : '') +
  `<div class="name">${esc(title)}</div>` +
  '</div>';

/* ==================== ส่วนลงนาม ==================== */

/** ช่องว่างแบบเส้นประ ใส่ค่าลงไปถ้ามี ไม่มีก็เป็นเส้นให้เขียนเองเหมือนแบบฟอร์มกระดาษ */
const blank = (value, dots, cls) => {
  const t = plainText(value).trim();
  return t ? `<span class="fill ${cls}">${esc(t)}</span>` : dots;
};

const signCell = (company, signer, date) =>
  (company ? `<div class="who">${val(company)}</div>` : '') +
  '<div>ลงชื่อ ' + blank(signer, '………………………………', 'nm') +
  ' วันที่ ' + blank(date, '…../…../……..', 'dt') + '</div>';

/**
 * ส่วนการลงนาม — สองช่องต่อแถว สองแถว เหมือนกันทุกแบบฟอร์ม
 *
 * ============================================================================
 * ชื่อกับวันที่ถูกพิมพ์ลงไปให้เลย ไม่ต้องมากรอกด้วยมือทีหลัง
 * ============================================================================
 * ข้อมูลพวกนี้กรอกไว้ในระบบอยู่แล้วตั้งแต่ตอนบันทึกผล การปล่อยให้เป็นเส้นประ
 * แปลว่าคนต้องมาเขียนสิ่งที่ระบบรู้อยู่แล้วซ้ำอีกรอบ เอกสารที่ปริ้นออกมาจึงยัง
 * ไม่พร้อมใช้จนกว่าจะมีคนเขียนเติม
 *
 * ช่องที่ไม่มีข้อมูลยังเป็นเส้นประเหมือนเดิม — ฟอร์มเปล่าที่ปริ้นไปเขียนมือหน้างาน
 * จึงยังใช้ได้เหมือนเดิมทุกประการ
 *
 * ============================================================================
 * สองช่องล่างตั้งใจเว้นว่างไว้
 * ============================================================================
 * "ผู้ตรวจสอบ" กับ "Approve (Infra)" เป็นขั้นอนุมัติที่เกิดขึ้น *หลัง* ช่างส่งงาน
 * ใบเก่า (ก่อนมีขั้นอนุมัติในระบบ) จึงเว้นไว้ให้เซ็นจริง
 *
 * ============================================================================
 * ใบที่มีขั้นอนุมัติ (signers)
 * ============================================================================
 * ช่องลงนามทั้งสี่ตรงกับสี่ขั้นใน approval.js พอดี ชื่อมาจากบัญชีของคนที่กดอนุมัติ
 * วันที่คือวันที่กด ขั้นที่ยังไม่อนุมัติเป็นเส้นประ (ฉบับร่าง)
 *   ซ้ายบน  ผู้ดำเนินการ   ← ขั้น 1 บัญชี Subcontract ที่กรอก (ไม่มี = ชื่อช่างที่กรอกในฟอร์ม)
 *   ขวาบน  ผู้ควบคุมงาน   ← ขั้น 2 Staff (แทนชื่อที่พิมพ์ในช่อง "ผู้ควบคุมงาน Interlink")
 *   ซ้ายล่าง ผู้ตรวจสอบ    ← ขั้น 3 Supervisor / Regional
 *   ขวาล่าง Approve (Infra) ← ขั้น 4 Infrastructure
 *
 * @param {string} operatorLabel ป้ายช่องซ้ายบน เช่น "ผู้ดำเนินการล้างแอร์ (บ./หจก.)"
 * @param {string} [checkerLabel] ป้ายช่องซ้ายล่าง — ใบติดตั้งใช้คำว่า "ผู้ตรวจรับ"
 *   ส่วนใบล้างกับใบซ่อมใช้ "ผู้ตรวจสอบ" ตามที่พิมพ์บนแบบฟอร์มของแต่ละใบ
 * @param {Object|null} [signers] ชื่อผู้อนุมัติจาก signOptsOf (approval.js) — null = ใบเก่า
 */
export function sectionSign(form, operatorLabel,
  checkerLabel = 'ผู้ตรวจสอบ (Supervisor / Area / Region Manager)', signers = null, split = [5, 3], bold = false) {
  const date = thaiDate(form.Date);

  if (signers) {
    const at = s => [s.name, s.name ? thaiDate(s.date) : ''];
    return signRows([
      [[operatorLabel, form.CompanyName, signers.s1 || form.TechnicianName, date],
       ['ผู้ควบคุมงาน (Interlink)', '', ...at(signers.s2)]],
      [[checkerLabel, '', ...at(signers.s3)],
       ['Approve (Infra)', '', ...at(signers.s4)]]
    ], split, bold);
  }

  // ⚠️ ช่องในหน้าเว็บชื่อ "ผู้ควบคุมงาน Interlink" เก็บลงคอลัมน์ SupervisorName
  // ต้องลงช่อง "ผู้ควบคุมงาน (Interlink)" ให้ตรงกับที่คนกรอกเข้าใจ ไม่ใช่ช่อง "ผู้ตรวจสอบ"
  // ตามชื่อคอลัมน์ · ส่วนคนที่ลงชื่อช่องผู้ดำเนินการคือช่าง ไม่ใช่ชื่อบริษัท
  return signRows([
    [[operatorLabel, form.CompanyName, form.TechnicianName, date],
     ['ผู้ควบคุมงาน (Interlink)', '', form.SupervisorName, date]],
    [[checkerLabel, '', '', ''],
     ['Approve (Infra)', '', '', '']]
  ], split, bold);
}

/**
 * สองแถวของช่องลงนาม — แต่ละช่องคือ [ป้าย, บริษัท, ชื่อ, วันที่]
 * [l, r] = ซ้าย/ขวากี่คอลัมน์ของกริด — แบ่งครึ่งหน้าตามแบบฟอร์มแต่ละแบบ (ใบซ่อมใช้ 3 | 5)
 */
function signRows(rows, [l, r] = [5, 3], bold = false) {
  const hc = bold ? 'ctr b' : 'ctr';
  return rows.map(([left, right]) =>
    '<tr>' +
    `<th colspan="${l}" class="${hc} sh">${esc(left[0])}</th><th colspan="${r}" class="${hc} sh">${esc(right[0])}</th>` +
    '</tr><tr class="sign">' +
    `<td colspan="${l}" class="ctr">${signCell(left[1], left[2], left[3])}</td>` +
    `<td colspan="${r}" class="ctr">${signCell(right[1], right[2], right[3])}</td>` +
    '</tr>'
  ).join('');
}

/* ==================== หน้ารูปภาพ ==================== */

/**
 * หน้ารูปของเครื่องหนึ่งตัว — วางตามชีตรูปในไฟล์ Excel ทั้งสามแบบ (โครงเดียวกัน)
 *
 * กริด 10 คอลัมน์ A–J: A D G J เป็นช่องเว้นระยะ · กรอบรูป B–C E–F H–I รวมช่อง 9 แถว + แถวคำบรรยายใต้รูป
 * พิมพ์ 107% ความสูงแถวตามไฟล์คูณ PHOTO_ROW_FIT (Excel ปัดเป็นพิกเซลตอนพิมพ์ — วัดจาก PDF ที่ Excel พิมพ์)
 * ช่องที่ยังไม่มีรูปพิมพ์เป็นกรอบเปล่าพร้อมข้อความ "วางรูปในกรอบด้านล่าง (Picture)" เพื่อปริ้นไปติดรูปด้วยมือได้
 *
 * @param {Object} o
 * @param {string}   o.title    ชื่อหน้า
 * @param {string[]} o.captions คำบรรยายใต้กรอบ 9 ช่อง
 * @param {number}   o.slot     เครื่องตัวที่เท่าไหร่ ใช้เป็นคีย์ของรูป
 * @param {string}   o.nodeName ชื่อ Node ที่หัวหน้า
 * @param {string}   o.date     วันที่ที่หัวหน้า (แปลงรูปแบบมาแล้ว)
 * @param {string}   o.formCode รหัสแบบฟอร์มมุมขวาล่าง
 * @param {boolean}  [o.dateCenter] ป้ายวันที่กึ่งกลาง (ใบซ่อม) — ใบล้าง/ใบติดตั้งชิดซ้ายตามไฟล์
 */
const PHOTO_COLS = [2.18, 12.18, 12.18, 2.18, 12.18, 12.18, 2.18, 12.18, 12.18, 2.18];
// แถวในไฟล์ (pt): กรอบรูป 3 แถวของหน้า = แถว 4–12, 15–23, 26–34 · คำบรรยาย 13, 24, 35 · เว้นระยะ 3, 14, 25, 36
const PHOTO_BOX_PT = [162.5, 160.95, 158.65];
const PHOTO_CAP_PT = [17.5, 18.4, 17.5];
const PHOTO_ROW_FIT = 0.982;

export function photoPage(photos, opts, o) {
  const h = pt => `height:calc(${(pt * PHOTO_ROW_FIT).toFixed(2)}pt * var(--k))`;
  const pic = i => {
    const src = photos[o.slot + '-' + i];
    return '<td colspan="2" class="pic">' +
      (src ? `<img src="${src}" alt="">` : '<span class="ph">วางรูปในกรอบด้านล่าง (Picture)</span>') + '</td>';
  };
  const gap = '<td class="gap"></td>';
  const spacer = `<tr><td colspan="10" class="gap" style="${h(17.5)}"></td></tr>`;

  let grid = '';
  for (let r = 0; r < 3; r++) {
    const n = [1, 2, 3].map(c => r * 3 + c);
    grid += `<tr style="${h(PHOTO_BOX_PT[r])}">${gap}${n.map(pic).join(gap)}${gap}</tr>` +
      `<tr style="${h(PHOTO_CAP_PT[r])}">${gap}${n.map(i => `<td colspan="2" class="cap">${esc(o.captions[i - 1])}</td>`).join(gap)}${gap}</tr>` +
      spacer;
  }

  return `<div class="sheet photo" style="--k:1.07;--hh:${(56.4 * PHOTO_ROW_FIT).toFixed(2)}pt;${logoVars({ x: 2.95, y: 12.14, w: 106.6, h: 29.89 })}"><div class="frame">
  ${pageHeader(o.title, opts)}
  <table class="photo"><colgroup>${xlCols(PHOTO_COLS, 1, 0.5)}</colgroup><tbody>
    <tr class="info" style="${h(21.15)}">
      <th colspan="2">${esc(o.nodeLabel || 'Node Name')}</th><td colspan="3">${val(plainText(o.nodeName))}</td>
      <th colspan="2" class="${o.dateCenter ? 'dt ctr' : 'dt'}">${esc(o.dateLabel || 'วันที่')}</th><td colspan="3">${val(o.date)}</td>
    </tr>
    ${spacer}
    ${grid}
  </tbody></table>
</div><div class="code">${esc(o.formCode)}</div></div>`;
}

/* ==================== แถบปุ่มตอนเปิดดูบนจอ ==================== */

/**
 * แถบปุ่มลอยมุมขวาบน สำหรับตอนเปิดดูบนจอเท่านั้น
 *
 * ============================================================================
 * ทำไมใส่เฉพาะตอน opts.toolbar
 * ============================================================================
 * หน้าเอกสารตัวเดียวกันนี้ถูกส่งให้ Chrome แปลงเป็น PDF ด้วย
 * ถ้าใส่ไว้เสมอแล้วอาศัย @media print ซ่อน ก็ยังเสี่ยงว่าวันหนึ่งจะหลุดไปติดในไฟล์
 * ตัดปัญหาด้วยการไม่สร้างมันขึ้นมาเลยตอนแปลงเป็นไฟล์ (ยังกัน @media print ไว้ด้วย
 * เผื่อคนกดปริ้นจากหน้าที่เปิดดูอยู่)
 *
 * ปุ่มโหลดเรียกกลับไปที่หน้าเว็บหลักผ่าน window.__docDownload ซึ่งหน้าเว็บ
 * เป็นคนติดตั้งให้หลังเปิดหน้าต่างเสร็จ เพราะที่นี่ไม่รู้จัก token หรือเลขแถว
 */
export function toolbar() {
  return `<style>
  .bar { position: fixed; top: 12px; right: 12px; z-index: 99; display: flex; gap: 8px;
         font-family: inherit; }
  .bar button { display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
         border: 1px solid #cbd5e1; background: #fff; color: #334155;
         border-radius: 8px; padding: 9px 14px; font-size: 13px; font-family: inherit;
         box-shadow: 0 2px 8px rgba(0,0,0,.12); }
  .bar button:hover { background: #f1f5f9; }
  .bar button.main { background: #1153a1; border-color: #1153a1; color: #fff; }
  .bar button.main:hover { background: #0e4485; }
  .bar button[disabled] { opacity: .6; cursor: default; }
  @media print { .bar { display: none !important; } }
</style>
<div class="bar">
  <button type="button" onclick="window.print()">ปริ้น</button>
  <button type="button" class="main" id="docDownloadBtn" onclick="
    if (window.__docDownload) { window.__docDownload(this); }
    else { alert('หน้าเว็บหลักถูกปิดไปแล้ว กรุณาเปิดเอกสารใหม่อีกครั้ง'); }
  ">ดาวน์โหลด PDF</button>
</div>`;
}

/* ==================== เปลือกของหน้าเอกสาร ==================== */

/**
 * ประกอบหน้า HTML เต็มใบจากเนื้อที่แต่ละแบบฟอร์มสร้างมา
 *
 * @param {Object} o
 * @param {string} o.title ชื่อที่ขึ้นบนแท็บเบราว์เซอร์
 * @param {string} o.body  เนื้อของทุกหน้าต่อกัน
 */
export function docShell(o, opts) {
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>${esc(o.title)}</title>
${opts.fontHref ? `<link rel="stylesheet" href="${esc(opts.fontHref)}">` : ''}
<style>${STYLE}</style>
${o.page ? formPage(o.page) : ''}
</head><body style="--k:${Number(o.scale) || 1};--hh:${Number(o.headerPt) || 56}pt;${logoVars(o.logo)};--rh:${Number(o.rowPt) || 17.5}pt;--sr:${Number(o.signRowPt) || 25}pt;--sh:${Number(o.signHeadPt) || Number(o.rowPt) || 17.5}pt;--rs:${Number(o.refPt) || 12}pt">
${opts.toolbar ? toolbar() : ''}
${opts.draft ? '<div class="draft-mark">รออนุมัติ</div>' : ''}
${o.body}
</body></html>`;
}

/**
 * หน้าแบบฟอร์ม (หน้าแรก) วางที่ตำแหน่งเดียวกับที่ Excel พิมพ์ — ขอบบน/ซ้ายและความกว้างกรอบ (มม.) วัดจาก PDF ของไฟล์ต้นฉบับ
 * ใช้หน้ากระดาษชื่อ form แยกจากหน้ารูป จึงไม่กระทบระยะขอบหน้ารูป
 */
function logoVars(l = {}) {
  // ค่าเริ่มต้น = โลโก้ของใบล้าง
  const { x = 4.75, y = 7.47, w = 153.5, h = 43.13 } = l;
  return `--lx:${x}pt;--ly:${y}pt;--lw:${w}pt;--lh:${h}pt`;
}

function formPage(p) {
  return `<style>@page form { margin: ${p.top}mm 8mm 8mm 8mm; }
.sheet.form { page: form; }
.sheet.form .frame { width: ${p.width}mm; margin-left: ${p.left - 8}mm; }</style>`;
}

export const STYLE = `
@page { size: A4 portrait; margin: 8mm; }
* { box-sizing: border-box; }
/* ฟอนต์ตามแบบฟอร์ม Excel ต้นฉบับ (Angsana New) — เครื่องที่ไม่มี (เช่นเซิร์ฟเวอร์ Linux) ใช้ TH Sarabun New / Sarabun แทน
   ขนาดทุกอย่างคูณ --k = สเกลพิมพ์ของไฟล์ Excel แบบนั้น (ตั้งที่ <body> ดู docShell) จึงเท่ากับตอนพิมพ์จาก Excel */
body { margin: 0; font-family: 'Angsana New', 'TH Sarabun New', 'Sarabun', 'Tahoma', sans-serif; color: #000; --k: 1; }

.sheet { page-break-after: always; }
.sheet:last-child { page-break-after: auto; }
/* กรอบนอกวาดทับเนื้อหา และหดเข้าจากขอบพิมพ์ 1pt — ถ้าชิดขอบพอดี Chrome ตัดขอบขวาทิ้งตอนพิมพ์ (เส้นเหลือแต่เทาของตาราง)
   overflow ซ่อนเศษเส้นตารางที่ปัดพิกเซลแล้วล้นออกนอกกรอบ */
.frame { position: relative; margin: 0 1pt; overflow: hidden; }
.frame::after { content: ""; position: absolute; inset: 0; border: 1pt solid #000; pointer-events: none; }
.code { text-align: right; font-size: calc(11pt * var(--k)); margin-top: 1.5mm; }

/* ---------- หัวกระดาษ ---------- */
/* แถว 1 ของไฟล์ (สูง --hh) — ชื่อเอกสารกึ่งกลางทั้งแถวเพราะไฟล์รวมช่อง A1:H1
   โลโก้: ตำแหน่ง/ขนาดตามรูปในไฟล์ (--lx --ly --lw --lh หน่วย pt ดู docShell) ครอปบน 24.634% ล่าง 20.301% ยืดเต็มกรอบเหมือน Excel */
.hdr { position: relative; height: calc(var(--hh) * var(--k)); border-bottom: 1pt solid #000;
       display: flex; align-items: center; justify-content: center; }
.hdr .logo { position: absolute; overflow: hidden;
             left: calc(var(--lx) * var(--k)); top: calc(var(--ly) * var(--k));
             width: calc(var(--lw) * var(--k)); height: calc(var(--lh) * var(--k)); }
.hdr .logo img { display: block; width: 100%; height: calc(var(--lh) * var(--k) / 0.55065);
                 margin-top: calc(var(--lh) * var(--k) * -0.24634 / 0.55065); }
.hdr .name { font-size: calc(20pt * var(--k)); font-weight: 700; white-space: nowrap; }

/* ---------- ตารางหลัก ---------- */
table.main { width: 100%; border-collapse: collapse; table-layout: fixed; }
/* เส้นในตารางสีเทา (BFBFBF) ตามไฟล์ — เส้นดำมีแค่กรอบนอก แถบหัวข้อส่วน และเส้นบนช่องอ้างอิง
   ข้อความชิดเส้นซ้ายเหมือน Excel (เว้นราว 2px) */
table.main td, table.main th { border: 0.5pt solid #BFBFBF; padding: 0 0.6mm;
                               height: calc(var(--rh) * var(--k));   /* แถวปกติ 17.5pt ในไฟล์ — ตอนพิมพ์ย่อ Excel ปัดเป็นพิกเซล ความสูงจริงต่างกันตามสเกล (--rh ดู docShell) */
                               font-size: calc(12pt * var(--k)); line-height: 1.1; vertical-align: middle;
                               text-align: left; word-wrap: break-word; font-weight: 400; }
/* ช่องป้ายชื่อ หัวตาราง และหัวช่องลงนาม เป็นพื้นเทาอ่อนตามแบบฟอร์ม */
table.main th { font-weight: 400; background: #F2F2F2; }
/* ตัวหนาเฉพาะช่องที่ไฟล์ต้นฉบับเป็นตัวหนา (ใบล้างหนากว่าใบซ่อม/ใบติดตั้ง) */
table.main .hd, table.main .b { font-weight: 700 !important; }
.ctr { text-align: center !important; }
.lbl { }   /* ไฟล์ต้นฉบับไม่เยื้องข้อความ — คงชื่อคลาสไว้ให้ชี้ช่องป้ายชื่อ */
.v { color: #000; }
td.unit { color: #7F7F7F; background: #F2F2F2; }
.tight { white-space: nowrap; }   /* ขนาดเท่าช่องอื่นตามไฟล์ แค่ไม่ให้ตัดบรรทัด */

tr.sec td { background: #D9D9D9; font-weight: 700; font-size: calc(12pt * var(--k)); height: calc(var(--rh) * var(--k));
            padding: 0 1.2mm !important; border-left: none; border-right: none;
            border-top: 1pt solid #000; border-bottom: 1pt solid #000; }

/* เส้นขอบนอกเป็นของกรอบ (.frame) เส้นเดียวทั้งหน้าเหมือนแบบฟอร์ม Excel
   ช่องที่ชิดขอบซ้าย/ขวา และแถวแรกที่ชิดเส้นใต้หัวกระดาษ จึงไม่วาดเส้นซ้ำ
   ถ้าวาดซ้ำ ขอบจะหนาเฉพาะแถวข้อมูลแต่บางตรงแถบหัวข้อส่วน (ซึ่งไม่มีเส้นข้าง) เส้นเลยดูซ้อนไม่เท่ากัน */
table.main tr > :first-child, table.info tr > :first-child { border-left: none; }
table.main tr > :last-child, table.info tr > :last-child { border-right: none; }
table.main tr:first-child > *, table.info tr:first-child > * { border-top: none; }

td.choices .box { font-size: calc(13pt * var(--k)); line-height: 1; }
td.choices .gap { display: inline-block; width: 14mm; }
/* ช่องพิมพ์ผลสรุปของใบล้าง ตัวหนาสีน้ำเงินเข้มตามไฟล์ */
table.main td.res { font-weight: 700; color: #1F3864; }
/* กล่องติ๊กแบบตัวควบคุมของ Excel (ใบติดตั้ง) — กล่องเล็ก ตัวหนังสือเล็กกว่าช่องอื่น ช่อง E กับ F–H ไม่มีเส้นคั่นเพราะไฟล์รวมช่อง */
td.choices.xc { font-size: calc(11pt * var(--k)); }
td.choices.xc .box { font-size: calc(9.5pt * var(--k)); margin-right: calc(3pt * var(--k)); }
td.choices.xc.e { padding-left: calc(5pt * var(--k)) !important; border-right: none; }
td.choices.xc.f { padding-left: calc(3pt * var(--k)) !important; border-left: none; }

/* แถวบรรทัดของส่วนบันทึก (noteRows) — บรรทัดที่เกินจำนวนแถวขึ้นบรรทัดใหม่ในแถวสุดท้าย */
tr.note td { white-space: pre-wrap; }
/* แถวที่มีป้าย (อาการเสีย/สาเหตุ/การแก้ไขของใบซ่อม) สูง 17.75pt ตามไฟล์ */
tr.note.lead td { height: calc(17.75pt * var(--k)); }
/* หัวช่องลงนาม สูงตามไฟล์ของแต่ละแบบ (--sh) */
table.main th.sh { height: calc(var(--sh) * var(--k)); }
tr.sign td { height: calc(var(--sr) * var(--k)); vertical-align: bottom; padding-bottom: 1mm !important; }
tr.sign .who { margin-bottom: 1mm; }
/* ค่าที่พิมพ์ลงในช่องว่าง — คงเส้นใต้ไว้ให้ดูเป็นช่องที่ถูกกรอกแล้ว ไม่ใช่ข้อความลอยๆ
   ความกว้างขั้นต่ำเท่ากับความยาวเส้นประเดิม ช่องจึงไม่ขยับตามความยาวของชื่อ */
.fill { display: inline-block; text-align: center; border-bottom: 1px dotted #000;
        padding: 0 1.5mm; line-height: 1.2; }
.fill.nm { min-width: 38mm; }
.fill.dt { min-width: 22mm; }

/* ช่องอ้างอิงท้ายใบ สูง 36pt ตามไฟล์ทั้งสามแบบ */
.ref { display: flex; flex-direction: column; justify-content: center; text-align: center;
       min-height: calc(36pt * var(--k)); font-size: calc(var(--rs) * var(--k));
       font-style: italic; line-height: 1.25; padding: 0 4mm; background: #F2F2F2; border-top: 1pt solid #000; }

/* ---------- ลายน้ำฉบับร่าง (ยังอนุมัติไม่ครบ ดู approval.js) ----------
   position: fixed ตอนปริ้นจะซ้ำทุกหน้าเอง ทั้งหน้าลงนามและหน้ารูป */
.draft-mark { position: fixed; top: 50%; left: 50%; z-index: 50; pointer-events: none;
              transform: translate(-50%, -50%) rotate(-30deg);
              font-size: 72pt; font-weight: 700; letter-spacing: 4mm; white-space: nowrap;
              color: rgba(200, 30, 30, 0.16); border: 3mm solid rgba(200, 30, 30, 0.16);
              padding: 2mm 10mm; border-radius: 4mm; }

/* ---------- หน้ารูปภาพ ---------- */
/* หน้ารูป: ตำแหน่งกรอบบนกระดาษตามที่ Excel พิมพ์ (เหมือนกันทั้งสามแบบ) */
@page photo { margin: 12.97mm 8mm 8mm 8mm; }
.sheet.photo { page: photo; }
.sheet.photo .frame { width: 183.18mm; margin-left: 5.22mm; }
.sheet.photo .frame::after { border-width: 1.5pt; }
.sheet.photo .hdr .name { font-size: calc(14pt * var(--k)); }
table.photo { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.photo td, table.photo th { padding: 0 0.6mm; font-size: calc(12pt * var(--k)); line-height: 1.1;
                                 text-align: center; vertical-align: middle; font-weight: 400; }
/* แถวข้อมูล: ป้ายตัวหนาพื้นเทา · ค่าตัวเอียงสีเทา 11pt (ในไฟล์เป็นสูตรดึงจากหน้าเอกสาร) */
table.photo tr.info > * { border: 1pt solid #000; border-top: none; }
table.photo tr.info > :first-child { border-left: none; }
table.photo tr.info > :last-child { border-right: none; }
table.photo tr.info th { background: #F2F2F2; font-weight: 700; }
table.photo tr.info th.dt { text-align: left; }
table.photo tr.info th.dt.ctr { text-align: center; }
table.photo tr.info td { font-style: italic; font-size: calc(11pt * var(--k)); color: #808080; }
table.photo tr.info td .v { color: inherit; }
/* เส้น thin ของ Excel ที่สเกล 107% หนาราว 1.3pt (วัดจาก PDF ของไฟล์) — Chrome ปัดความหนาเส้นเป็นพิกเซลเต็ม: กรอบนอก 1.5pt ใกล้สุด ส่วนกรอบรูป 1pt ใกล้กว่า 1.5pt (1.5pt ซ้อนกันแล้วหนาเกิน) */
table.photo td.pic { border: 1pt solid #000; border-bottom: none; padding: 0; overflow: hidden;
                     font-style: italic; color: #808080; }
table.photo td.pic { position: relative; }
/* รูปเต็มกรอบ ตัดส่วนเกินให้พอดี (ความสูงแถวกำหนดจากไฟล์ จึงวางรูปลอยทับทั้งช่อง) */
table.photo td.pic img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
table.photo td.cap { border: 1pt solid #000; background: #F2F2F2; }
table.photo td.gap { border: none; padding: 0; }

table.info { width: 100%; border-collapse: collapse; }
table.info th, table.info td { border: 0.5pt solid #000; padding: 1.5mm 3mm; font-size: calc(16pt * var(--k)); }
table.info th { background: #ECECEC; font-weight: 700; text-align: center; width: 18%; }
table.info td { width: 32%; text-align: center; }

table.pics { width: 100%; border-collapse: separate; border-spacing: 3mm; table-layout: fixed; }
table.pics td.pic { width: 33.33%; border: none; padding: 0; vertical-align: top; }
table.pics .box { border: 0.75pt solid #000; }
table.pics img { display: block; width: 100%; height: 62mm; object-fit: cover; }
table.pics .ph { height: 62mm; display: flex; align-items: center; justify-content: center;
                 color: #7F7F7F; font-size: calc(12pt * var(--k)); text-align: center; padding: 2mm; }
table.pics .cap { border-top: 0.75pt solid #000; background: #ECECEC; text-align: center;
                  font-size: calc(12pt * var(--k)); padding: 1mm 1mm; min-height: 7mm; }

@media screen {
  body { background: #e9edf2; padding: 6mm 0; }
  .sheet { width: 210mm; margin: 0 auto 8mm; background: #fff; padding: 8mm;
           box-shadow: 0 1px 6px rgba(0,0,0,.2); }
}
`;
