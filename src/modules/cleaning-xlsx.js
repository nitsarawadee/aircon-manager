/**
 * ============================================================================
 * ฟอร์มล้างเปล่าแบบ Excel (ITEL-FM-NE-004)
 * ============================================================================
 *
 * คู่กับ repair-xlsx.js เหตุผลเดียวกัน — ฟอร์มที่ปริ้นออกไปแล้วแนบรูปไม่ได้
 * ไฟล์ Excel วางรูปลงในกรอบที่เตรียมไว้ได้เลย
 *
 * ----------------------------------------------------------------------------
 * ต่างจากใบซ่อมตรงไหน
 * ----------------------------------------------------------------------------
 * ใบล้างมีเครื่อง 2 ตัวในใบเดียว ข้อมูลเครื่องจึงแยกเป็นสองคอลัมน์
 * (F = เครื่องที่ 1, G = เครื่องที่ 2) และมีหน้ารูปแยกกันคนละชีต
 * ตัวละหนึ่งหน้า รวมเป็น 3 ชีต
 *
 * ถ้า Node นั้นมีเครื่องเดียว คอลัมน์ของเครื่องที่ 2 จะว่างไว้ทั้งแถบ
 * ซึ่งถูกต้องแล้ว ไม่ใช่ปล่อยให้ข้อมูลเลื่อนไปลงช่องของอีกตัว
 * ============================================================================
 */

import { thaiDate } from './doc-common.js';

/** ชีตในแม่แบบ — หน้าฟอร์ม กับหน้ารูปของเครื่องแต่ละตัว */
const SHEET_MAIN = 'xl/worksheets/sheet1.xml';
const SHEET_PHOTO_1 = 'xl/worksheets/sheet2.xml';
const SHEET_PHOTO_2 = 'xl/worksheets/sheet3.xml';

/**
 * ช่องข้อมูล Node ในส่วนที่ 1 อ้างอิงตามไฟล์ฟอร์มจริง Rev2026
 *
 *   แถว 3   Node / รหัส Node    | ประเภท Node
 *   แถว 4   จังหวัด / Province   | Brand / ยี่ห้อแอร์
 *   แถว 5   วันที่ (DD/MM/YYYY)  | BTU / ขนาดทำความเย็น
 *   แถว 6   เวลาเริ่ม–สิ้นสุด     | รวมเวลา (ชม.)   ← เว้นว่าง กรอกหน้างาน
 *
 * ยี่ห้อกับ BTU ในฟอร์มนี้มีช่องเดียวต่อทั้ง Node ไม่ได้แยกรายเครื่อง
 * จึงใช้ของเครื่องตัวที่ 1 เหมือนที่หน้าเอกสารแบบปริ้นทำอยู่ (ดู cleaning-doc.js)
 */
export const CLEANING_XLSX_NODE_CELLS = {
  C3: 'NodeName',
  G3: 'LocationType',
  C4: 'Province',
  G4: 'Unit1_Brand',
  C5: 'Date',
  G5: 'Unit1_BTU'
};

/**
 * ช่องข้อมูลเครื่องในส่วนที่ 2 — แถวเดียวกันแต่คนละคอลัมน์ต่อเครื่องหนึ่งตัว
 *
 *   แถว 9   Indoor Serial No.
 *   แถว 10  Indoor Asset No.
 *   แถว 11  Outdoor Serial No.
 *   แถว 12  Outdoor Asset No.
 */
export const CLEANING_XLSX_UNIT_ROWS = {
  9: 'IndoorSerial',
  10: 'IndoorAsset',
  11: 'OutdoorSerial',
  12: 'OutdoorAsset'
};

/** คอลัมน์ของเครื่องแต่ละตัวในส่วนที่ 2 */
const UNIT_COLUMN = { 1: 'F', 2: 'G' };

/**
 * หน้ารูปทั้งสองหน้ามีหัวกระดาษที่ต้องกรอกซ้ำ
 *
 * ในแม่แบบช่องพวกนี้มีข้อความกำกับว่า "ลิ้งข้อมูลหน้าเอกสารล้าง" ซึ่งแปลว่า
 * ให้คัดค่ามาจากหน้าแรก ระบบเติมให้เลยจะได้ไม่ต้องพิมพ์ซ้ำสองหน้า
 */
const PHOTO_HEADER_CELLS = { C2: 'NodeName', H2: 'Date' };

/**
 * แปลงข้อมูลที่หน้าเว็บส่งมาเป็นค่าที่จะเติมลงแต่ละชีต
 *
 * แยกจากขั้นตอนเขียนไฟล์ เพื่อทดสอบได้ว่าข้อมูลไปลงช่องถูกช่องโดยไม่ต้อง
 * สร้างไฟล์ .xlsx จริง
 *
 * @param {Object} record ข้อมูลจากหน้าเว็บ (รูปแบบเดียวกับฟอร์มเปล่าแบบปริ้น)
 * @returns {Object<string,Object<string,string>>} ชีต → ช่อง → ข้อความ
 */
export function cleaningXlsxValues(record) {
  const r = record || {};
  const date = r.Date ? thaiDate(r.Date) : '';

  const main = {};
  for (const [cell, field] of Object.entries(CLEANING_XLSX_NODE_CELLS)) {
    main[cell] = field === 'Date' ? date : (r[field] == null ? '' : String(r[field]));
  }

  for (const [slot, column] of Object.entries(UNIT_COLUMN)) {
    for (const [row, field] of Object.entries(CLEANING_XLSX_UNIT_ROWS)) {
      const value = r['Unit' + slot + '_' + field];
      main[column + row] = value == null ? '' : String(value);
    }
  }

  const photoHeader = {};
  for (const [cell, field] of Object.entries(PHOTO_HEADER_CELLS)) {
    photoHeader[cell] = field === 'Date' ? date : (r[field] == null ? '' : String(r[field]));
  }

  return {
    [SHEET_MAIN]: main,
    [SHEET_PHOTO_1]: { ...photoHeader },
    [SHEET_PHOTO_2]: { ...photoHeader }
  };
}

/**
 * สร้างไฟล์ฟอร์มล้างเปล่าที่เติมข้อมูล Node กับเครื่องให้แล้ว
 *
 * @param {Uint8Array} template เนื้อไฟล์แม่แบบ (ชั้น platform อ่านมาให้)
 * @param {Object} record ข้อมูล Node และเครื่อง
 * @returns {Promise<Uint8Array>}
 */
export async function buildCleaningXlsx(template, record) {
  const { fillXlsx } = await import('./xlsx-template.js');

  // บังคับสีดำเฉพาะช่องที่ระบบเติม ด้วยเหตุผลเดียวกับใบซ่อม
  // (ไฟล์ฟอร์มต้นฉบับทำสีช่องกรอกไม่ครบ พอเติมข้อมูลจริงสีเลยปนกัน)
  return fillXlsx(template, cleaningXlsxValues(record), { fontColor: 'FF000000' });
}

/**
 * ชื่อไฟล์ที่ผู้ใช้จะเห็นตอนโหลด
 *
 * ใช้ชื่อ Node ไม่ใช่รหัสเครื่อง เพราะใบล้างหนึ่งใบครอบคลุมทั้ง Node
 * (ต่างจากใบซ่อมที่เป็นเครื่องเดียวต่อใบ)
 */
export function cleaningXlsxFileName(record) {
  const r = record || {};
  const node = String(r.NodeName || '').replace(/[\\/:*?"<>|]/g, '-').trim();
  const date = String(r.Date || '').slice(0, 10).replace(/-/g, '');

  return 'ฟอร์มล้าง' + (node ? '-' + node : '') + (date ? '-' + date : '') + '.xlsx';
}
