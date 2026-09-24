/**
 * ============================================================================
 * เติมข้อมูลลงไฟล์ Excel แม่แบบ
 * ============================================================================
 *
 * รับไฟล์ .xlsx ตัวจริงเข้ามา เติมค่าลงเฉพาะช่องที่ระบุ แล้วคืนไฟล์ออกไป
 * ทุกอย่างที่ไม่ได้ระบุจะถูกคัดลอกกลับไปเหมือนเดิมทุกไบต์ — เส้นกรอบ โลโก้
 * การตั้งค่าหน้ากระดาษ กรอบวางรูป ฟอนต์ ความกว้างคอลัมน์
 *
 * ----------------------------------------------------------------------------
 * ทำไมเติมเป็น inlineStr ไม่ใช่ sharedStrings
 * ----------------------------------------------------------------------------
 * ข้อความใน Excel เก็บได้ 2 แบบ คือรวมไว้ที่ไฟล์กลาง (sharedStrings) แล้วให้เซลล์
 * ชี้เลขลำดับไปหา หรือเขียนลงในเซลล์ตรงๆ (inlineStr)
 *
 * แบบแรกประหยัดกว่าถ้าข้อความซ้ำกันเยอะ แต่ต้องไปแก้ไฟล์กลางด้วย ซึ่งแปลว่า
 * ต้องเลื่อนเลขลำดับของเซลล์อื่นทั้งไฟล์ให้ถูก พลาดนิดเดียวข้อความทั้งฟอร์ม
 * จะสลับที่กันหมด  แบบที่สองแตะแค่เซลล์ที่เราจะเติมจริงๆ ไฟล์กลางไม่ต้องยุ่งเลย
 * เราเติมแค่ไม่กี่ช่อง จึงไม่คุ้มที่จะรับความเสี่ยงนั้นเพื่อประหยัดไม่กี่ไบต์
 * ============================================================================
 */

import { readZip, writeZip } from './zip.js';

/** อักขระที่ห้ามหลุดเข้าไปใน XML ดิบ */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ============================== สีตัวอักษรของช่องที่เติม ============================== */

/**
 * ============================================================================
 * ทำไมต้องมายุ่งกับสีตัวอักษร
 * ============================================================================
 * คนที่ทำไฟล์ฟอร์มตั้งใจให้ "ช่องที่ต้องกรอก" เป็นสีน้ำเงิน แต่ทำไม่ครบ —
 * ในส่วนข้อมูล Node คอลัมน์ซ้ายเป็นสีดำ คอลัมน์ขวาเป็นสีน้ำเงิน ทั้งที่เป็น
 * ข้อมูลชนิดเดียวกัน ตอนช่องยังว่างมองไม่เห็นความต่าง พอระบบเติมข้อมูลลงไป
 * เอกสารเลยออกมาสีปนกันครึ่งดำครึ่งน้ำเงิน
 *
 * แก้เฉพาะช่องที่ระบบเติมให้เท่านั้น ช่องว่างที่เหลือไว้ให้คนกรอกเองยังเป็น
 * สีเดิมทุกช่อง เพราะนั่นคือหน้าตาของแบบฟอร์มควบคุมที่ไม่ควรไปเปลี่ยน
 *
 * ============================================================================
 * วิธีทำ: เพิ่มสไตล์ใหม่ต่อท้าย ไม่แก้ของเดิม
 * ============================================================================
 * เลขสไตล์ในไฟล์ Excel เป็น "ลำดับที่เท่าไหร่ในรายการ" ถ้าไปแก้รายการเดิม
 * เซลล์อื่นทั้งไฟล์ที่ใช้สไตล์นั้นร่วมกันจะเปลี่ยนตามไปด้วยทันที
 * การเพิ่มต่อท้ายแล้วชี้เฉพาะเซลล์ที่เราเติมไปที่ตัวใหม่ จึงเป็นวิธีเดียว
 * ที่รับประกันได้ว่าไม่มีอะไรอื่นในฟอร์มขยับ
 * ============================================================================
 */

/** ตัดรายการย่อยใน styles.xml ออกมาเป็นอาร์เรย์ (รองรับทั้งแท็กปิดในตัวและแท็กที่มีลูก) */
function parseList(xml, tag) {
  const block = xml.match(new RegExp('<' + tag + 's\\b[^>]*>([\\s\\S]*?)</' + tag + 's>'));
  if (!block) return [];
  const one = new RegExp('<' + tag + '\\b[^>]*/>|<' + tag + '\\b[^>]*>[\\s\\S]*?</' + tag + '>', 'g');
  return block[1].match(one) || [];
}

/** เขียนจำนวนรายการใหม่กลับเข้าไปใน count ไม่งั้น Excel บางรุ่นจะฟ้องว่าไฟล์เสีย */
function replaceList(xml, tag, items) {
  return xml.replace(
    new RegExp('<' + tag + 's\\b[^>]*>[\\s\\S]*?</' + tag + 's>'),
    '<' + tag + 's count="' + items.length + '">' + items.join('') + '</' + tag + 's>'
  );
}

/**
 * ทำให้สไตล์ที่ระบุใช้ตัวอักษรสีที่ต้องการ โดยไม่แตะสไตล์เดิม
 *
 * ขนาด ฟอนต์ ตัวหนา เส้นกรอบ สีพื้น การจัดวาง คงไว้ทุกอย่าง เปลี่ยนแค่สี
 *
 * @param {string} stylesXml เนื้อไฟล์ xl/styles.xml
 * @param {number[]} indices เลขสไตล์ของเซลล์ที่ระบบจะเติม
 * @param {string} rgb สีที่ต้องการ เช่น 'FF000000' = ดำ
 * @returns {{xml: string, map: Map<number,number>}} map = เลขสไตล์เดิม → เลขใหม่
 */
export function recolorStyles(stylesXml, indices, rgb = 'FF000000') {
  const fonts = parseList(stylesXml, 'font');
  // cellXfs คือรายการที่เซลล์อ้างถึงด้วย s="..." ส่วน cellStyleXfs เป็นคนละรายการ
  // จึงต้องตัดเฉพาะก้อน cellXfs ออกมา ไม่ใช่ <xf> ทุกตัวในไฟล์
  const cellXfsBlock = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfsBlock) return { xml: stylesXml, map: new Map() };
  const cellXfs = cellXfsBlock[1].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) || [];

  const map = new Map();
  const newFonts = [...fonts];
  const newXfs = [...cellXfs];

  for (const index of new Set(indices)) {
    const xf = newXfs[index];
    if (!xf) continue;

    const fontId = Number((xf.match(/fontId="(\d+)"/) || [])[1] || 0);
    const font = newFonts[fontId];
    if (!font) continue;

    // เปลี่ยนเฉพาะสี ถ้าไม่เคยกำหนดสีไว้ก็เติมเข้าไป
    const wanted = /<color\b[^>]*\/>/.test(font)
      ? font.replace(/<color\b[^>]*\/>/, '<color rgb="' + rgb + '"/>')
      : font.replace('</font>', '<color rgb="' + rgb + '"/></font>');

    if (wanted === font) { map.set(index, index); continue; }   // สีถูกอยู่แล้ว

    // ฟอนต์หน้าตาแบบนี้อาจมีอยู่แล้วในไฟล์ ใช้ซ้ำดีกว่าเพิ่มตัวซ้ำ
    let newFontId = newFonts.indexOf(wanted);
    if (newFontId < 0) newFontId = newFonts.push(wanted) - 1;

    const wantedXf = xf
      .replace(/fontId="\d+"/, 'fontId="' + newFontId + '"')
      .replace(/(<xf\b[^>]*?)(\/?>)/, (all, head, close) =>
        /applyFont=/.test(head) ? all : head + ' applyFont="1"' + close);

    let newIndex = newXfs.indexOf(wantedXf);
    if (newIndex < 0) newIndex = newXfs.push(wantedXf) - 1;
    map.set(index, newIndex);
  }

  let xml = replaceList(stylesXml, 'font', newFonts);
  xml = xml.replace(
    /<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,
    '<cellXfs count="' + newXfs.length + '">' + newXfs.join('') + '</cellXfs>'
  );

  return { xml, map };
}

/** อ่านเลขสไตล์ของเซลล์ที่ระบุ — ต้องอ่านก่อนเติมค่า เพราะการเติมจะเขียนทับแท็ก */
export function cellStyleIndices(sheetXml, refs) {
  const out = {};
  for (const ref of refs) {
    const m = sheetXml.match(new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>)'));
    if (!m) continue;
    const s = (m[1].match(/\ss="(\d+)"/) || [])[1];
    if (s !== undefined) out[ref] = Number(s);
  }
  return out;
}

/**
 * เขียนค่าลงเซลล์ที่มีอยู่แล้วในชีต
 *
 * เซลล์ปลายทางต้องมีอยู่ในไฟล์แม่แบบก่อน (ปกติมีอยู่แล้วเพราะช่องกรอกในฟอร์ม
 * ถูกตีกรอบไว้ ซึ่งแปลว่า Excel เขียนเซลล์นั้นไว้พร้อมเลขสไตล์เรียบร้อย)
 * ถ้าไม่มีจะข้ามไป ไม่สร้างเซลล์ใหม่ เพราะเซลล์ที่สร้างเองจะไม่มีกรอบ
 * แล้วฟอร์มจะเพี้ยนแบบที่มองไม่ออกจนกว่าจะปริ้นออกมา
 *
 * @param {string} xml เนื้อไฟล์ชีต
 * @param {Object<string,string>} values เช่น { C3: 'ชุมสาย A', F3: 'Node หลัก' }
 * @param {Object<string,number>} [styleOf] ref → เลขสไตล์ใหม่ที่ต้องการให้ช่องนั้นใช้
 * @returns {{xml: string, filled: string[], missing: string[]}}
 */
export function setCells(xml, values, styleOf) {
  const filled = [];
  const missing = [];
  let out = xml;

  for (const [ref, raw] of Object.entries(values)) {
    const text = raw === undefined || raw === null ? '' : String(raw);
    if (!text) continue;   // ไม่มีค่าก็ปล่อยช่องว่างไว้ให้เขียนมือ

    // แอตทริบิวต์ของแท็กห้ามมี > อยู่ข้างใน [^>]* จึงกินเกินแท็กไม่ได้
    const cell = new RegExp('<c r="' + ref + '"([^>]*?)(/>|>[\\s\\S]*?</c>)');
    const found = out.match(cell);
    if (!found) { missing.push(ref); continue; }

    // เก็บ s="..." (เลขสไตล์ = กรอบและฟอนต์ของช่องนั้น) ไว้ ทิ้งเฉพาะ t="..." เดิม
    let attrs = found[1].replace(/\s+t="[^"]*"/g, '').trimEnd();

    // ชี้ไปสไตล์ใหม่ที่สีตัวอักษรถูกต้อง (เส้นกรอบและอย่างอื่นเหมือนเดิมทุกอย่าง)
    const restyled = styleOf && styleOf[ref];
    if (restyled !== undefined) {
      attrs = /\ss="\d+"/.test(attrs)
        ? attrs.replace(/\ss="\d+"/, ' s="' + restyled + '"')
        : attrs + ' s="' + restyled + '"';
    }

    // ช่องว่างหัวท้ายจะถูก Excel ตัดทิ้งถ้าไม่สั่งให้เก็บไว้
    const preserve = text !== text.trim() ? ' xml:space="preserve"' : '';

    out = out.replace(
      cell,
      '<c r="' + ref + '"' + attrs + ' t="inlineStr"><is><t' + preserve + '>' +
      escapeXml(text) + '</t></is></c>'
    );
    filled.push(ref);
  }

  return { xml: out, filled, missing };
}

/**
 * เติมข้อมูลลงไฟล์แม่แบบทั้งไฟล์
 *
 * @param {Uint8Array} template เนื้อไฟล์ .xlsx ต้นฉบับ
 * @param {Object<string,Object<string,string>>} sheets
 *   ชื่อไฟล์ชีตข้างใน zip → ค่าที่จะเติม เช่น { 'xl/worksheets/sheet1.xml': { C3: '...' } }
 * @param {Object} [opts]
 * @param {string} [opts.fontColor] บังคับสีตัวอักษรของ "เฉพาะช่องที่เติม" เช่น 'FF000000'
 *   ช่องว่างที่เหลือไว้ให้คนกรอกเองไม่ถูกแตะ
 * @returns {Promise<Uint8Array>} ไฟล์ .xlsx ที่เติมค่าแล้ว
 */
export async function fillXlsx(template, sheets, opts = {}) {
  const entries = await readZip(template);
  const decode = data => new TextDecoder().decode(data);
  const encode = xml => new TextEncoder().encode(xml);

  const styles = entries.find(e => e.name === 'xl/styles.xml');
  const plan = [];

  // รอบแรก: ดูว่าแต่ละช่องที่จะเติมใช้สไตล์เบอร์อะไรอยู่
  // ต้องดูให้ครบทุกชีตก่อนแก้ เพราะสไตล์เป็นรายการกลางที่ใช้ร่วมกันทั้งไฟล์
  for (const [path, values] of Object.entries(sheets)) {
    const entry = entries.find(e => e.name === path);
    if (!entry) throw new Error('ไฟล์แม่แบบไม่มีชีต ' + path);

    const xml = decode(entry.data);
    const refs = Object.keys(values).filter(ref => values[ref]);
    plan.push({ entry, values, xml, styleIndex: cellStyleIndices(xml, refs) });
  }

  // รอบสอง: เพิ่มสไตล์สีใหม่ต่อท้ายรายการกลาง แล้วจำว่าช่องไหนต้องชี้ไปเบอร์อะไร
  const styleOf = new Map();
  if (opts.fontColor && styles) {
    const all = plan.flatMap(p => Object.values(p.styleIndex));
    const { xml, map } = recolorStyles(decode(styles.data), all, opts.fontColor);
    styles.data = encode(xml);

    for (const p of plan) {
      const per = {};
      for (const [ref, index] of Object.entries(p.styleIndex)) {
        if (map.has(index)) per[ref] = map.get(index);
      }
      styleOf.set(p.entry, per);
    }
  }

  // รอบสาม: เติมค่าจริง
  for (const p of plan) {
    const { xml } = setCells(p.xml, p.values, styleOf.get(p.entry));
    p.entry.data = encode(xml);
  }

  return writeZip(entries);
}
