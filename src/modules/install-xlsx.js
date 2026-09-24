/**
 * ============================================================================
 * ฟอร์มติดตั้งเปล่าแบบ Excel (ITEL-FM-NE-006)
 * ============================================================================
 *
 * คู่กับ cleaning-xlsx.js และ repair-xlsx.js เหตุผลเดียวกัน — ฟอร์มที่ปริ้น
 * ออกไปแล้วแนบรูปไม่ได้ ไฟล์ Excel วางรูปลงในกรอบที่เตรียมไว้ได้เลย
 *
 * โครงเหมือนฟอร์มล้าง: สองเครื่องต่อใบ (F = ตัวที่ 1, G = ตัวที่ 2)
 * และมีหน้ารูปแยกกันคนละชีต ตัวละหนึ่งหน้า รวมเป็น 3 ชีต
 *
 * ----------------------------------------------------------------------------
 * ไฟล์นี้มีช่องติ๊กจริงของ Excel ด้วย
 * ----------------------------------------------------------------------------
 * ส่วนที่ 4 "ผลการตรวจรับงานติดตั้ง" ใช้ช่องติ๊ก ผ่าน/ไม่ผ่าน ซึ่งเป็น form control
 * ของ Excel ไม่ใช่ข้อความในเซลล์ ระบบจึงติ๊กให้ไม่ได้และไม่ควรพยายาม
 * (ค่าของมันอยู่คนละที่กับเซลล์ และแตะพลาดทีเดียวช่องติ๊กหายทั้งไฟล์)
 * ปล่อยให้คนที่ตรวจรับติ๊กเองตอนเปิดไฟล์ ซึ่งเป็นสิ่งที่เขาต้องทำอยู่แล้ว
 */

import { thaiDate } from './doc-common.js';

/** ชีตในแม่แบบ — หน้าฟอร์ม กับหน้ารูปของเครื่องแต่ละตัว */
const SHEET_MAIN = 'xl/worksheets/sheet1.xml';
const SHEET_PHOTO_1 = 'xl/worksheets/sheet2.xml';
const SHEET_PHOTO_2 = 'xl/worksheets/sheet3.xml';

/**
 * ช่องข้อมูล Node ในส่วนที่ 1 อ้างอิงตามไฟล์ฟอร์มจริง
 *
 *   แถว 3   Node Nane           | ประเภท Node
 *   แถว 4   จังหวัด / Province   | Brand / ยี่ห้อแอร์
 *   แถว 5   วันที่ (DD/MM/YYYY)  | BTU / ขนาดทำความเย็น
 *   แถว 6   เวลาเริ่ม–สิ้นสุด     | รวมเวลา (ชม.)   ← เว้นว่าง กรอกหน้างาน
 *
 * ยี่ห้อกับ BTU มีช่องเดียวต่อทั้งใบ จึงใช้ของเครื่องตัวที่ 1
 * เหมือนที่หน้าเอกสารแบบปริ้นทำอยู่ (ดู install-doc.js)
 */
export const INSTALL_XLSX_NODE_CELLS = {
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
export const INSTALL_XLSX_UNIT_ROWS = {
  9: 'IndoorSerial',
  10: 'IndoorAsset',
  11: 'OutdoorSerial',
  12: 'OutdoorAsset'
};

/** คอลัมน์ของเครื่องแต่ละตัวในส่วนที่ 2 */
const UNIT_COLUMN = { 1: 'F', 2: 'G' };

/** หัวกระดาษของหน้ารูปทั้งสองหน้า — เติมให้จะได้ไม่ต้องพิมพ์ซ้ำสองหน้า */
const PHOTO_HEADER_CELLS = { C2: 'NodeName', H2: 'Date' };

/**
 * แปลงข้อมูลที่หน้าเว็บส่งมาเป็นค่าที่จะเติมลงแต่ละชีต
 *
 * @param {Object} record ข้อมูลจากหน้าเว็บ (รูปแบบเดียวกับฟอร์มเปล่าแบบปริ้น)
 * @returns {Object<string,Object<string,string>>} ชีต → ช่อง → ข้อความ
 */
export function installXlsxValues(record) {
  const r = record || {};
  const date = r.Date ? thaiDate(r.Date) : '';

  const main = {};
  for (const [cell, field] of Object.entries(INSTALL_XLSX_NODE_CELLS)) {
    main[cell] = field === 'Date' ? date : (r[field] == null ? '' : String(r[field]));
  }

  for (const [slot, column] of Object.entries(UNIT_COLUMN)) {
    for (const [row, field] of Object.entries(INSTALL_XLSX_UNIT_ROWS)) {
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
 * สร้างไฟล์ฟอร์มติดตั้งเปล่าที่เติมข้อมูล Node กับเครื่องให้แล้ว
 *
 * @param {Uint8Array} template เนื้อไฟล์แม่แบบ (ชั้น platform อ่านมาให้)
 * @param {Object} record ข้อมูล Node และเครื่อง
 * @returns {Promise<Uint8Array>}
 */
export async function buildInstallXlsx(template, record) {
  const { fillXlsx } = await import('./xlsx-template.js');

  // บังคับสีดำเฉพาะช่องที่ระบบเติม ด้วยเหตุผลเดียวกับอีกสองฟอร์ม
  // (ไฟล์ฟอร์มต้นฉบับทำสีช่องกรอกไม่ครบ พอเติมข้อมูลจริงสีเลยปนกัน)
  return fillXlsx(template, installXlsxValues(record), { fontColor: 'FF000000' });
}

/**
 * ชื่อไฟล์ที่ผู้ใช้จะเห็นตอนโหลด
 *
 * ใช้ชื่อ Node ไม่ใช่รหัสเครื่อง เพราะใบติดตั้งหนึ่งใบครอบคลุมได้ถึงสองเครื่อง
 * ในฐานะงานเดียวกัน (กติกาเดียวกับใบล้าง)
 */
export function installXlsxFileName(record) {
  const r = record || {};
  // อักขระพวก / : * ? " < > | ตั้งเป็นชื่อไฟล์บน Windows ไม่ได้
  const node = String(r.NodeName || '').replace(/[\\/:*?"<>|]/g, '-').trim();
  const date = String(r.Date || '').slice(0, 10).replace(/-/g, '');

  return 'ฟอร์มติดตั้ง' + (node ? '-' + node : '') + (date ? '-' + date : '') + '.xlsx';
}
