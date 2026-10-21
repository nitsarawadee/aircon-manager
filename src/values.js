/**
 * ตัวแปลงและตรวจค่าที่ใช้ทั้งระบบ — วันที่/เวลาตามเวลาไทย เงิน รหัสเครื่อง ภูมิภาค
 *
 * เรื่องที่ต้องเข้าใจก่อนแก้ไฟล์นี้:
 * วันที่ที่มาเป็นตัวเลขคือ "ตัวเลขลำดับวัน" (serial number) นับจาก 30 ธ.ค. 1899 แบบ Excel/Google Sheets
 * เช่น 45000 = 22 ก.พ. 2023 ส่วนเวลาเก็บเป็นเศษของวัน เช่น 0.5 = 12:00 น.
 * formatDate() กับ safeParseDate() ยังรับค่าแบบนี้อยู่
 *
 * (ประวัติ) ยุคที่ข้อมูลอยู่ใน Google Sheets เราสั่ง Sheets API ให้ส่งค่าดิบมาแบบ serial number เสมอ
 * (ไม่ใช่ข้อความที่จัดรูปแบบแล้ว) เพราะข้อความที่จัดรูปแบบจะเปลี่ยนไปตาม
 * การตั้งค่าของแต่ละชีต เช่นบางชีตแสดง 25/08/2026 บางชีตแสดง 2026-08-25
 * ถ้าอ่านมาเป็นข้อความ ระบบจะเดาไม่ถูกว่าเลขไหนคือวันไหน
 * การอ่านเป็น serial number ทำให้แปลงกลับได้ตรงเสมอไม่ว่าชีตจะตั้งรูปแบบไว้ยังไง
 */

/** เขตเวลาที่ใช้ทั้งระบบ (Apps Script เดิมใช้ค่าจาก Session.getScriptTimeZone()) */
export const TZ = 'Asia/Bangkok';

/** จุดเริ่มนับ serial number ของ Google Sheets: 30 ธ.ค. 1899 เวลา 00:00 UTC */
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

/** ช่วงตัวเลขที่ถือว่า "น่าจะเป็นวันที่" — ประมาณปี 1970 ถึง 2100 */
const SERIAL_MIN = 25569;
const SERIAL_MAX = 73415;

/** แปลง serial number ของ Sheets เป็น Date (ตีความว่าเป็นเวลาตามเขตเวลาไทย) */
export function serialToDate(n) {
  const num = Number(n);
  if (!isFinite(num)) return null;
  // serial ของ Sheets อิงเวลาท้องถิ่นของสเปรดชีต จึงต้องลบออฟเซ็ตของเขตเวลาออก
  // ไม่งั้นวันที่จะเพี้ยนไป 1 วันในช่วงหัวค่ำ (ไทยเร็วกว่า UTC 7 ชั่วโมง)
  const asUtc = SHEETS_EPOCH_MS + num * MS_PER_DAY;
  return new Date(asUtc - tzOffsetMs(new Date(asUtc)));
}

/** แปลง Date เป็น serial number ของ Sheets */
export function dateToSerial(d) {
  return (d.getTime() + tzOffsetMs(d) - SHEETS_EPOCH_MS) / MS_PER_DAY;
}

/** ออฟเซ็ตเขตเวลาไทยเทียบ UTC เป็นมิลลิวินาที (+7 ชม. คงที่ ไม่มี daylight saving) */
function tzOffsetMs() {
  return 7 * 3600000;
}

/**
 * ชิ้นส่วนวันที่-เวลาตามเขตเวลาไทย
 *
 * ⚠️ ต้องใช้ฟังก์ชันนี้เสมอเวลาต้องการ ปี/เดือน/วัน ห้ามใช้ d.getFullYear() ตรงๆ
 * เพราะเครื่องที่รันอาจตั้งเขตเวลาเป็น UTC (เซิร์ฟเวอร์คลาวด์มักเป็นแบบนั้น)
 * เที่ยงคืนของไทยคือ 17:00 น. ของ "เมื่อวาน" ตามเวลา UTC
 * ถ้าใช้ getFullYear()/getMonth() ตรงๆ วันที่ 1 ของทุกเดือนจะถูกนับเป็นเดือนก่อนหน้า
 * และวันที่ 1 ม.ค. จะถูกนับเป็นปีก่อนหน้า ทำให้รายงานงบประมาณและกราฟแนวโน้มผิด
 */
export function partsOf(d) {
  const shifted = new Date(d.getTime() + tzOffsetMs(d));
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hh: shifted.getUTCHours(),
    mm: shifted.getUTCMinutes(),
    ss: shifted.getUTCSeconds()
  };
}

const pad = n => String(n).padStart(2, '0');

/** วันที่รูปแบบ yyyy-MM-dd ตามเขตเวลาไทย */
export function ymd(d) {
  const p = partsOf(d);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** วันที่+เวลารูปแบบ yyyy-MM-dd HH:mm:ss ตามเขตเวลาไทย (ใช้ตอนเขียนลงชีต) */
export function ymdhms(d) {
  const p = partsOf(d);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}`;
}

/**
 * แปลงค่าจากชีตให้เป็นข้อความวันที่ yyyy-MM-dd
 * เทียบเท่า formatDate_() ของ Apps Script เดิม
 * ค่าที่ไม่ใช่วันที่จะส่งกลับไปตามเดิม (เช่นผู้ใช้พิมพ์ข้อความอื่นลงช่องวันที่)
 */
export function formatDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : ymd(v);
  if (typeof v === 'number') {
    if (v >= SERIAL_MIN && v <= SERIAL_MAX) return ymd(serialToDate(v));
    return String(v);
  }
  return String(v);
}

/**
 * แปลงค่าใดๆ ให้เป็น Date ที่ใช้งานได้จริง คืน null ถ้าแปลงไม่ได้
 * เทียบเท่า safeParseDate_() ของเดิม — กันข้อมูลเพี้ยนทำให้แดชบอร์ดคำนวณผิด
 */
export function safeParseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    if (v >= SERIAL_MIN && v <= SERIAL_MAX) return serialToDate(v);
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  // รองรับรูปแบบไทยที่พบบ่อย dd/mm/yyyy ซึ่ง Date() มาตรฐานตีความเป็น mm/dd/yyyy
  const thai = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (thai) {
    const d = new Date(Date.UTC(+thai[3], +thai[2] - 1, +thai[1]) - tzOffsetMs());
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * แปลงค่าจากชีตให้เป็นข้อความธรรมดาที่ปลอดภัยต่อการแสดงผล
 * เทียบเท่า plainText_() ของเดิม
 *
 * สำคัญ: Serial number ที่เป็นตัวเลขยาวๆ จะถูก JavaScript แสดงเป็น 5.230054E7
 * และ BTU จะกลายเป็น 18000.0 ถ้าไม่ดักไว้ ตรงนี้บังคับให้แสดงเป็นเลขเต็มเสมอ
 */
/**
 * ตรวจค่าเงินที่กรอกมา — ว่างได้ (ไม่ระบุ) ถ้าใส่ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป
 *
 * ติดลบหรือเป็นตัวอักษรเข้าไปแล้วยอดงบและแดชบอร์ดเพี้ยนโดยไม่มีใครรู้ (ค่าติดลบไปหักค่าใช้จ่ายรวม)
 * หน้าเว็บมี min="0" อยู่บางช่อง แต่ไม่ใช่ด่านจริง — ต้องตรวจที่เซิร์ฟเวอร์ (กติกาเดียวกับงบประมาณ)
 */
export function assertMoney(label, v) {
  if (v === '' || v === null || v === undefined) return;
  if (typeof v === 'string' && !v.trim()) return;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(label + 'ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
}

/**
 * ตรวจวันที่ปิดงาน (วันที่ล้าง/ซ่อมเสร็จ/ติดตั้ง) — ต้องไม่เกินวันนี้ตามเวลาไทย (ผู้ใช้ขอ 20/10/2569)
 *
 * ปิดงานด้วยวันล่วงหน้าแล้วประวัติขึ้นว่าทำเสร็จวันที่ยังมาไม่ถึง และค่าใช้จ่ายไปลงงบเดือนนั้น
 * หน้าเว็บกันไว้แล้ว แต่ด่านจริงต้องอยู่ที่เซิร์ฟเวอร์ (ลิงก์ซ่อมเรียกตรงได้)
 * วันนัดในแผน/มอบหมายงานไม่ใช้ตัวนี้ — นัดล่วงหน้าได้ตามปกติ
 */
export function assertNotFuture(label, v) {
  const d = safeParseDate(v);
  if (!d) return;   // ว่างหรืออ่านไม่ออก ให้ด่าน "กรุณาระบุวันที่" ของแต่ละฟอร์มตัดสิน
  const today = ymd(new Date());
  if (ymd(d) > today) {
    const [y, m, dd] = today.split('-');
    throw new Error(label + 'เป็นวันล่วงหน้าไม่ได้ (วันนี้ ' + dd + '/' + m + '/' + y + ')');
  }
}

export function plainText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!isFinite(v)) return '';
    return Number.isInteger(v) ? v.toFixed(0) : String(v);
  }
  if (v instanceof Date) return ymd(v);
  return String(v);
}

/** แปลงเศษของวัน (0-1) ที่ Sheets ใช้เก็บ "เวลา" กลับเป็น HH:mm */
export function formatTime(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v !== 'number') return String(v);
  if (v < 0 || v >= 1) return String(v);
  const totalMin = Math.round(v * 24 * 60);
  return `${pad(Math.floor(totalMin / 60) % 24)}:${pad(totalMin % 60)}`;
}

/**
 * แปลงค่าของฟอร์มล้างแอร์ให้ส่งกลับหน้าเว็บได้แน่นอน
 * เทียบเท่า cleanFormValue_() ของเดิม
 *
 * ⚠️ ต้องบอก kind มาด้วยว่าช่องนี้เก็บอะไร ห้ามให้ระบบเดาเองจากค่าตัวเลข
 *
 * เหตุผล: Sheets เก็บวันที่เป็นตัวเลขลำดับวัน ซึ่งช่วงราวๆ 25,000 ถึง 73,000
 * คือปี 1970 ถึง 2100 แต่ตัวเลขในช่วงนั้นก็เป็นค่าปกติของระบบนี้เหมือนกัน
 * เช่น BTU 36000 หรือค่าล้าง 30000 บาท ถ้าปล่อยให้เดาจากช่วงตัวเลข
 * ค่าพวกนี้จะถูกแปลงเป็นวันที่มั่วๆ แล้วแสดงผิดทั้งบนหน้าเว็บและในไฟล์ PDF
 *
 * @param {*} v ค่าที่อ่านมาจากชีต
 * @param {'date'|'time'|'plain'} kind ชนิดของคอลัมน์นั้น
 */
export function cleanFormValue(v, kind = 'plain') {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : ymd(v);

  if (kind === 'date') return formatDate(v);
  if (kind === 'time') return formatTime(v);

  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

/** เทียบรหัสเครื่องแบบตัดช่องว่างหัวท้ายและไม่สนตัวพิมพ์เล็ก-ใหญ่ */
export function normalizeCode(v) {
  return String(v == null ? '' : v).trim().toUpperCase();
}

/** รหัสไซต์ (SiteCode) ใช้กติกาเดียวกับรหัสเครื่อง */
export const normalizeSiteCode = normalizeCode;

/**
 * เรียงเครื่องให้ Node เดียวกันอยู่ติดกัน และในแต่ละ Node เรียงตามเลขเครื่อง (AIR-1, AIR-2, AIR-3)
 *
 * ลำดับของ Node คงไว้ตามที่ Node นั้นโผล่ครั้งแรก (= ลำดับไฟล์ Excel ที่นำเข้ามา) ไม่เรียง A→Z ใหม่
 * เครื่องที่เพิ่มทีหลังถูกต่อท้ายตาราง ถ้าไม่เรียงจะไปโผล่แถวสุดท้าย ห่างจากเครื่องอื่นใน Node เดียวกัน
 * (เจ้าของงานขอ — เช่น Node มี 1 กับ 3 แล้วเพิ่ม 2 ต้องได้ 1, 2, 3)
 * รหัสที่ไม่มีเลขเครื่องอยู่ท้าย Node ตามลำดับเดิม · ไม่แก้ array ที่ส่งมา
 */
export function orderByNode(rows) {
  const text = v => String(v == null ? '' : v).trim();
  const keyOf = r => normalizeCode(text(r.SiteCode) || text(r.NodeName) || text(r.AirCode).replace(/-AIR-\d+$/i, ''));
  const noOf = r => {
    const m = /-AIR-(\d+)$/i.exec(text(r.AirCode));
    return m ? Number(m[1]) : Infinity;
  };
  const first = new Map();
  rows.forEach((r, i) => { const k = keyOf(r); if (!first.has(k)) first.set(k, i); });
  return rows
    .map((r, i) => ({ r, i, g: first.get(keyOf(r)), n: noOf(r) }))
    .sort((a, b) => a.g - b.g || (a.n === b.n ? 0 : a.n < b.n ? -1 : 1) || a.i - b.i)
    .map(x => x.r);
}

/**
 * แปลงค่า Region ให้เป็นข้อความเสมอก่อนเทียบ
 * กัน Google Sheets แปลงค่าที่พิมพ์เป็นตัวเลข (เช่น "6") ให้กลายเป็น Number
 * ซึ่งจะทำให้เทียบกับค่าในชีต Users (ที่เป็นข้อความเสมอ) ไม่ตรงกัน
 */
/**
 * เครื่องนี้ออกจากการใช้งานไปแล้วหรือยัง
 *
 * วงจรของเครื่องจบที่สองสถานะนี้ — รื้อถอนออกจากหน้างานแล้ว และขายออกไปแล้ว
 * เครื่องพวกนี้ยังอยู่ในระบบเพราะต้องเก็บประวัติไว้ แต่ต้องไม่ถูกนับเป็นของที่ยังมีอยู่
 * ไม่งั้นยอดเครื่องทั้งหมดจะบวมเรื่อยๆ ทุกปี และแผนล้างจะสั่งไปล้างเครื่องที่ไม่มีอยู่จริง
 *
 * เทียบแบบ "มีคำนี้อยู่ในข้อความ" ไม่ใช่เทียบเท่ากันตรงๆ เพื่อให้รองรับ
 * ชื่อเก่าที่ยังค้างในข้อมูล ("ปลดระวาง", "ชำรุด/ปลดระวาง") ไปพร้อมกับชื่อใหม่
 */
export function isRetiredStatus(status) {
  const s = String(status == null ? '' : status).trim();
  if (!s) return false;
  return s.includes('ปลดระวาง') || s.includes('รื้อถอน') || /write\s*[-_]?\s*off/i.test(s);
}

/**
 * เครื่องติดตั้งใหม่ที่ยังรอใบติดตั้งอนุมัติครบ (เจ้าของงานขอ)
 *
 * เพิ่มเครื่องใหม่ = ตั้งสถานะนี้ให้เอง เครื่องยังไม่นับว่ามีอยู่จริง — ไม่ขึ้นแดชบอร์ด แผนล้าง
 * ใบล้าง แจ้งซ่อม และรายการเครื่อง (ยกเว้นตัวกรอง "รอติดตั้ง") ขึ้นแค่หน้างานซ่อมและติดตั้ง
 * ให้กรอกเอกสาร ส่งลิงก์ หรือมอบหมาย · ใบติดตั้งอนุมัติถึงขั้นสุดท้าย → "ใช้งานปกติ" (ดู approveDoc)
 * ตั้ง/เปลี่ยนสถานะนี้เองไม่ได้ ระบบเป็นคนตั้งและปลดเท่านั้น (ดู saveAirUnit)
 */
export const AWAITING_INSTALL_STATUS = 'รอติดตั้ง';
export function isAwaitingInstall(status) {
  return String(status == null ? '' : status).trim() === AWAITING_INSTALL_STATUS;
}

export function normalizeRegion(v) {
  return String(v == null ? '' : v).trim();
}

/** วันนี้เวลา 00:00 น. ตามเขตเวลาไทย ใช้เป็นจุดอ้างอิงในการเปรียบเทียบวันที่ */
export function todayStart() {
  const p = partsOf(new Date());
  return new Date(Date.UTC(p.y, p.m - 1, p.d) - tzOffsetMs());
}
