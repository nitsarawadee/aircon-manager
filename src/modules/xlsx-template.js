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
 * @returns {{xml: string, filled: string[], missing: string[]}}
 */
export function setCells(xml, values) {
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
    const attrs = found[1].replace(/\s+t="[^"]*"/g, '').trimEnd();

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
 * @returns {Promise<Uint8Array>} ไฟล์ .xlsx ที่เติมค่าแล้ว
 */
export async function fillXlsx(template, sheets) {
  const entries = await readZip(template);

  for (const [path, values] of Object.entries(sheets)) {
    const entry = entries.find(e => e.name === path);
    if (!entry) throw new Error('ไฟล์แม่แบบไม่มีชีต ' + path);

    const { xml } = setCells(new TextDecoder().decode(entry.data), values);
    entry.data = new TextEncoder().encode(xml);
  }

  return writeZip(entries);
}
