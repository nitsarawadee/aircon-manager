/************************************************************
 * บริการสร้าง PDF ฟอร์มล้างแอร์ + เก็บไฟล์ลง Google Drive
 *
 * ไฟล์นี้คือ "ส่วนที่เหลืออยู่" ของ Apps Script หลังย้ายระบบไป Cloudflare Workers
 * งานอื่นทั้งหมด (อ่าน/เขียนข้อมูล, ล็อกอิน, สิทธิ์, แดชบอร์ด) ย้ายออกไปหมดแล้ว
 *
 * เหลือไว้เฉพาะ 2 อย่างที่ผูกกับ Google โดยตรงจนเขียนใหม่ไม่คุ้ม:
 *   1) สร้าง PDF ให้หน้าตาตรงกับฟอร์มกระดาษ (วาดลงชีตแล้วให้ Google export)
 *   2) เก็บไฟล์ลง Google Drive ตามโครงสร้างโฟลเดอร์เดิม
 *
 * ============================================================================
 * วิธีติดตั้ง
 * ============================================================================
 * 1. เปิด script.google.com แล้วเข้าโปรเจกต์ที่สร้างไว้
 * 2. ลบโค้ดเดิมใน Code.gs ทิ้งทั้งหมด แล้ววางไฟล์นี้แทน
 * 3. กด Ctrl+S บันทึก — ไม่ต้องแก้อะไรในไฟล์นี้แล้ว ค่าทั้งหมดใส่ไว้ให้เรียบร้อย
 * 4. กด Run ที่ฟังก์ชัน setupPermissions หนึ่งครั้ง แล้วกด Allow ตามที่ระบบถาม
 *    (ทำครั้งแรกครั้งเดียว ถ้าเคยทำแล้วข้ามได้)
 * 5. Deploy > Manage deployments > ไอคอนดินสอ > เวอร์ชัน: New version > Deploy
 *    (ครั้งแรกสุดใช้ Deploy > New deployment > Web app / Execute as: Me / Anyone)
 *
 * ⚠️ ทุกครั้งที่แก้ไฟล์นี้ ต้องทำขั้นที่ 5 ซ้ำเสมอ
 *    แค่กดบันทึกอย่างเดียวระบบจะยังใช้โค้ดเวอร์ชันเก่าอยู่
 *
 * ⚠️ ไฟล์นี้มีรหัสลับของระบบอยู่ข้างใน อย่าอัปโหลดขึ้นที่สาธารณะหรือส่งให้คนนอกทีม
 * ============================================================================
 */

/**
 * รหัสลับที่ใช้ยืนยันว่า request มาจาก Worker ของเราจริง
 * ต้องตรงกับค่า PDF_SERVICE_SECRET ที่ตั้งไว้ฝั่ง Cloudflare
 *
 * ⚠️ จำเป็นต้องมี เพราะ Web App ถูกตั้งเป็น "Anyone" (Worker ล็อกอินบัญชี Google ไม่ได้)
 * ถ้าไม่ตั้งรหัสนี้ ใครก็ตามที่รู้ URL จะสั่งสร้างไฟล์ใน Drive ของคุณได้
 */
// ⚠️ ค่าจริงไม่เก็บไว้ในไฟล์นี้ เพราะไฟล์นี้อยู่ใน git ถ้าใส่ค่าจริงจะฝังอยู่ในประวัติตลอดไป
// ตอนจะใช้งาน ให้คัดลอกค่าจาก PDF_SERVICE_SECRET ในไฟล์ .env มาวางแทนบรรทัดนี้
// (แล้วอย่าคอมมิตกลับเข้า git — ไฟล์ทั้งโฟลเดอร์นี้จะถูกลบทิ้งในเฟส 5 อยู่แล้ว)
const SHARED_SECRET = 'ใส่ค่าจาก PDF_SERVICE_SECRET ใน .env';

/**
 * ถ้าต้องการให้ PDF ทั้งหมดไปเก็บใน Shared Drive หรือโฟลเดอร์เฉพาะที่กำหนดเอง
 * ให้ใส่ Folder ID ตรงนี้ (เปิดโฟลเดอร์ใน Drive แล้วคัดลอกส่วนท้ายของ URL)
 * ถ้าเว้นว่างไว้ ระบบจะสร้างโฟลเดอร์ "CleaningReports" ไว้ที่ My Drive ให้อัตโนมัติ
 */
const CLEANING_PDF_ROOT_FOLDER_ID = '';

/**
 * สเปรดชีตที่ใช้เป็น "กระดาษทด" สำหรับวาดแม่แบบฟอร์มก่อน export เป็น PDF เท่านั้น
 * ไม่ได้อ่านข้อมูลแอร์จากชีตนี้เลย (ข้อมูลถูกส่งมาจากตัวระบบผ่านอินเทอร์เน็ตอยู่แล้ว)
 * จะชี้ไปที่ชีตสำเนาหรือชีตจริงก็ได้ ผลลัพธ์เหมือนกัน
 *
 * ค่าปัจจุบันคือชีตสำเนาที่ใช้ทดสอบอยู่
 * ถ้าจะเปลี่ยน ให้แทนที่เฉพาะข้อความข้างในเครื่องหมาย ' ' เท่านั้น
 * ระวังอย่าลบเครื่องหมาย ' หรือ ; ออก ไม่งั้น Apps Script จะฟ้อง SyntaxError ทันที
 * (ID ดูได้จาก URL ของชีต ส่วนที่อยู่ระหว่าง /d/ กับ /edit)
 */
// ค่าจริงอยู่ใน SPREADSHEET_ID ของไฟล์ .env — คัดลอกมาวางแทนบรรทัดนี้ตอนใช้งาน
const SPREADSHEET_ID = 'ใส่ค่าจาก SPREADSHEET_ID ใน .env';

/**
 * คืนสเปรดชีตที่จะใช้วาดแม่แบบ
 *
 * ถ้าสคริปต์นี้ผูกอยู่กับชีตใดชีตหนึ่ง (เปิดจากเมนู ส่วนขยาย > Apps Script)
 * จะใช้ชีตนั้น — แต่ถ้าเป็นโปรเจกต์แยกอิสระ (สร้างจาก script.google.com)
 * getActiveSpreadsheet() จะคืนค่าว่าง จึงต้องเปิดด้วย ID ที่ตั้งไว้ข้างบนแทน
 */
function getSS_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  return active ? active : SpreadsheetApp.openById(SPREADSHEET_ID);
}

/* ============================ จุดรับคำสั่งจาก Worker ============================ */

function doPost(e) {
  var out = { ok: false, error: 'ไม่ทราบสาเหตุ' };
  try {
    var body = JSON.parse(e.postData.contents);

    if (String(body.secret || '') !== SHARED_SECRET) {
      throw new Error('รหัสลับไม่ถูกต้อง — ตรวจว่า PDF_SERVICE_SECRET ฝั่ง Worker ตรงกับ SHARED_SECRET ในไฟล์นี้');
    }

    var result;
    if (body.action === 'buildPdf') {
      var file = buildCleaningFormPdf_(body.payload || {});
      result = { url: file.getUrl(), fileId: file.getId() };
    } else if (body.action === 'uploadDocs') {
      result = uploadNodeDocuments_(body.payload || {});
    } else {
      throw new Error('ไม่รู้จักคำสั่ง: ' + body.action);
    }

    out = { ok: true, result: result };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }

  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * รันฟังก์ชันนี้ครั้งเดียวจาก Editor เพื่อขออนุญาตสิทธิ์ Drive และสร้างชีตแม่แบบ
 * (ฟังก์ชันที่ลงท้ายด้วย _ จะไม่ขึ้นในเมนูเลือกฟังก์ชัน จึงต้องมีตัวนี้ไว้เรียกแทน)
 */
function setupPermissions() {
  var tmp = DriveApp.createFile(Utilities.newBlob('setup', 'text/plain', 'tmp_setup_check.txt'));
  tmp.setTrashed(true);

  ScriptApp.getOAuthToken();
  UrlFetchApp.fetch('https://www.googleapis.com/discovery/v1/apis', { muteHttpExceptions: true });

  buildCleaningFormTemplate();
  return 'อนุญาตสิทธิ์และสร้างแม่แบบฟอร์มเรียบร้อย พร้อมใช้งานสร้าง PDF แล้ว';
}

/* ============================ ค่าคงที่ของฟอร์ม ============================ */

/**
 * รายการตรวจเช็ค 21 ข้อ ตามฟอร์มกระดาษเดิม
 * (มีก็อปปี้เดียวกันไว้ฝั่งหน้าเว็บและใน worker/src/schema.js — แก้ให้ตรงกันทั้ง 3 ที่)
 */
const CLEANING_CHECKLIST_ITEMS = [
  { no: 1, label: 'ตรวจเช็คสภาพทั่วไป', type: 'check' },
  { no: 2, label: 'ตรวจเช็คฉนวนหุ้มท่อน้ำยา', type: 'check' },
  { no: 3, label: 'ตรวจเช็ครอยรั่วของระบบ', type: 'check' },
  { no: 4, label: 'ตรวจเช็คการผุกร่อนของโครงสร้าง', type: 'check' },
  { no: 5, label: 'ตรวจเช็คขั้วต่อและจุดต่อสายไฟ', type: 'check' },
  { no: 6, label: 'ทำความสะอาดแผ่นกรองอากาศ', type: 'check' },
  { no: 7, label: 'ทำความสะอาดคอล์ยร้อน', type: 'check' },
  { no: 8, label: 'ทำความสะอาดคอล์ยเย็น', type: 'check' },
  { no: 9, label: 'ทำความสะอาดถาดน้ำทิ้งและท่อน้ำทิ้ง', type: 'check' },
  { no: 10, label: 'ค่าอุณหภูมิที่ปรับตั้งไว้ (24-26 องศา)', type: 'value', unit: 'องศา' },
  { no: 11, label: 'วัดค่าอุณหภูมิภายในห้อง ( 24 - 28 องศา )', type: 'value', unit: 'องศา' },
  { no: 12, label: 'ระบุชนิดน้ำยา ( R22 , R32 , R410A )', type: 'select', options: ['R22', 'R32', 'R410A'] },
  { no: 13, label: 'วัดค่าน้ำยาด้านแรงดันต่ำ (Low)', type: 'value', unit: 'PSI' },
  { no: 14, label: 'ค่ากระแสไฟฟ้าคอมเพรสเซอร์ระบุตามเนมเพส', type: 'value', unit: 'A' },
  { no: 15, label: 'วัดค่ากระแสไฟฟ้าคอมเพรสเซอร์ขณะทำงาน', type: 'value', unit: 'A' },
  { no: 16, label: 'วัดค่าแรงดันไฟฟ้า ( 220 - 240 V )', type: 'value', unit: 'V' },
  { no: 17, label: 'ตรวจเช็คชุดควบคุมสลับการทำของแอร์', type: 'check' },
  { no: 18, label: 'ค่าอุณหภูมิที่ปรับตั้ง ให้แอร์ทำงาน 2 ตัว (33 - 35 องศา)', type: 'value', unit: 'องศา' },
  { no: 19, label: 'เวลาที่ตั้งค่าให้สลับการทำงาน (4 - 6 ชั่วโมง)', type: 'value', unit: 'ชั่วโมง' },
  { no: 20, label: 'ตรวจสอบความเรียบร้อยหลังการล้างและทดสอบระบบ', type: 'check' },
  { no: 21, label: 'ตรวจสอบการปรับตั้งอุณหภูมิของเครื่องปรับอากาศก่อนออกจาก Node', type: 'check' }
];

const CLEANFORM_TEMPLATE_SHEET = 'FormTemplate';

/** ความกว้างคอลัมน์ A-I (พิกเซล) แปลงจากค่าความกว้างในไฟล์ Excel ต้นฉบับ */
const CF_COL_WIDTHS = [32, 72, 239, 68, 64, 107, 64, 120, 64];

const CF_GRAY = '#D9D9D9';
const CF_YELLOW = '#FFFF66';

/** ความสูงแถว 1-44 (พอยต์) ตามไฟล์ Excel ต้นฉบับ */
function cfRowHeights_() {
  const h = [28, 32, 26];              // แถว 1-3
  for (let i = 4; i <= 42; i++) h.push(24);
  h.push(46);                          // แถว 43 (กล่องค่าแรงดันน้ำยา)
  h.push(24);                          // แถว 44
  return h;
}

/* ============================ ตัวช่วยแปลงค่า ============================ */

/**
 * แปลงค่าให้เป็นข้อความธรรมดาสำหรับแสดงในเอกสาร
 * สำคัญ: Serial number ที่เป็นตัวเลขยาวๆ จะถูกแสดงเป็น 5.230054E7 ถ้าไม่ดักไว้
 * และ BTU จะกลายเป็น 18000.0 — ตรงนี้บังคับให้แสดงเป็นเลขเต็มเสมอ
 */
function plainText_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!isFinite(v)) return '';
    return Number.isInteger(v) ? v.toFixed(0) : String(v);
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    if (v.getFullYear() < 1970) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

/**
 * ช่องติ๊ก
 * หมายเหตุสำคัญ: ห้ามใช้ตัวอักษร ☐ / ☑ (U+2610, U+2611) เพราะฟอนต์ที่ Google ใช้ตอน
 * export PDF ไม่มีตัวอักษรพวกนี้ ช่องสี่เหลี่ยมจะหายไปทั้งหมด
 * จึงใช้วงเล็บเหลี่ยมกับเครื่องหมายถูก (U+2713) ซึ่งแสดงผลได้แน่นอนทุกฟอนต์
 */
function tick_(on) {
  return on ? '[ ✓ ]' : '[   ]';
}

/**
 * จับคู่ประเภทสถานที่ในระบบ เข้ากับช่องติ๊ก 3 ช่องบนฟอร์มกระดาษ
 *
 * ระบบให้เลือกประเภทได้ 7 แบบ แต่ฟอร์มกระดาษมีแค่ 3 ช่อง
 * (Container / Shop House-Room / Office) จึงต้องจับกลุ่มให้
 * และเทียบแบบไม่สนตัวพิมพ์เล็ก-ใหญ่ เว้นวรรค และขีด เผื่อกรณีพิมพ์เองในชีต
 */
function matchLocationType_(value, box) {
  const v = plainText_(value).toLowerCase().replace(/[\s\-_/]/g, '');
  if (!v) return false;

  const groups = {
    container: ['container', 'ตู้', 'คอนเทนเนอร์'],
    shophouse: ['shophouse', 'room', 'ห้อง', 'ห้องแถว', 'อาคารพาณิชย์', 'ตึกแถว'],
    office: ['office', 'building', 'warehouse', 'สำนักงาน', 'อาคาร', 'โกดัง', 'คลัง']
  };
  const words = groups[box] || [];
  for (let i = 0; i < words.length; i++) {
    if (v.indexOf(words[i].toLowerCase().replace(/[\s\-_/]/g, '')) > -1) return true;
  }
  return false;
}

/**
 * ประมาณความกว้างของข้อความเป็นพิกเซล (ฟอนต์ Calibri 11pt ในหน่วยของ Google Sheets)
 * ใช้คำนวณจำนวนจุดในบรรทัดลงนาม ให้ชื่ออยู่กึ่งกลางและเหลือที่เขียนวันที่เสมอ
 */
function textWidthPx_(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i), code = s.charCodeAt(i);
    if (c === '.') w += 3.2;
    else if (c === ' ') w += 3.0;
    else if (code >= 0x0E00 && code <= 0x0E7F) w += 7.5;  // อักษรไทยกว้างกว่าอังกฤษ
    else w += 5.6;
  }
  return w;
}

/** ค่าที่จะแสดงในช่องเช็คลิสต์ของเอกสาร */
function cfCell_(item, value) {
  const v = plainText_(value).trim();
  if (!v) return (item.type === 'value' && item.unit) ? '______ ' + item.unit : '';
  if (item.type === 'check') return v === 'ปกติ' ? '✓' : (v === 'ผิดปกติ' ? 'X' : v);
  if (item.type === 'value' && item.unit) return v + ' ' + item.unit;
  return v;
}

/* ============================ โฟลเดอร์ใน Drive ============================ */

function getRootFolder_() {
  if (CLEANING_PDF_ROOT_FOLDER_ID) return DriveApp.getFolderById(CLEANING_PDF_ROOT_FOLDER_ID);
  const it = DriveApp.getRootFolder().getFoldersByName('CleaningReports');
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder('CleaningReports');
}

/**
 * โฟลเดอร์เก็บไฟล์ "ตัวอย่างสำหรับพิมพ์" แยกจากเอกสารบันทึกผลจริง
 *
 * ปุ่ม "ปริ้นฟอร์ม (ไม่บันทึกข้อมูล)" ยังต้องสร้างไฟล์ PDF จริงถึงจะพิมพ์ได้
 * ถ้าปล่อยให้กองรวมกับเอกสารของแต่ละ Node จะแยกไม่ออกว่าอันไหนคือผลการล้างจริง
 * แยกไว้โฟลเดอร์เดียวจึงลบทิ้งทีเดียวได้ง่ายเมื่อไม่ต้องการแล้ว
 */
function getPreviewFolder_() {
  const root = getRootFolder_();
  const name = '_ตัวอย่างสำหรับพิมพ์ (ลบได้)';
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function getOrCreateCleaningFolder_(record) {
  const root = getRootFolder_();

  const yearName = String((record.Date || '').split('-')[0] || new Date().getFullYear());
  const it2 = root.getFoldersByName(yearName);
  const yearFolder = it2.hasNext() ? it2.next() : root.createFolder(yearName);

  const nodeName = String(record.NodeName || 'ไม่ระบุ Node').replace(/[\\/:*?"<>|]/g, '_');
  const it3 = yearFolder.getFoldersByName(nodeName);
  return it3.hasNext() ? it3.next() : yearFolder.createFolder(nodeName);
}

/* ============================ แม่แบบฟอร์ม ============================ */

/** โลโก้ INTERLINK Telecom ฝังเป็น Base64 สำหรับใส่ลงในเอกสาร */
const INTERLINK_LOGO_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUwAAAC4CAMAAAC/xCXWAAABgFBMVEX///////7+///+//79///9//73/////v7+/v/+/v7+/v3//fz+/f3+/fz+/fv9/v/9/v79/v38/v79/f79/f38/f79/fz+/Pv9/Pv8/P38/Pz8/Pv9+/r8+/v8+/r8+vn8+ff8+PX89vH7+/v6+vr6+fj79vP39/b68u367+j67eT56t/45tr449X338/23Mr22MT11L30z7bm8/fg5+zZ2NjrzLa16far3vGb1u20zN6Eze3yxafyvpvwvJjFwsLvtY7vsYjuroPtqn3sp3nso3LrnmvrmWPqlVzpkFXojU/niUqswtmyuMCRv+GPttupq66MrNGZnqaQj5F4vON6rdl7pdJtpNVwnc5vlMFels5WjMbnhUTmgDvkezTkdi3jcynkcibicificSXkbyHibyPibiHhbyKRhH1/gIR0c3VSgblOc6Q9drfjbR7hbR/hbB3gbB7jaxvhaxvgahziaRjgaRjhZhR7ZlldW1xLWW1EQUAyaKkpX6cxOkoiHx5bkdiTAAAlP0lEQVR42u2ciVsa1/rHT06m1SFQCbLJvqjs2wiPiR1g2DeNCNWorIGAEasQCXK5JvVf/71nAJfsTW/73Od359vWMivMh3c9ZwaEBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBP2AHj1aEPFaWFgQaPx14ZloRNN/8VSLtHRZMdOydBH/zxKlJSqVRPTjOGnFiuxjtisr0v8doJJ1h8vj8/t9HqfdIoUVIp34x8xTukT+KjaCd9pYnW5Z/B+BqXN4AiyXTGcy6STH+t12MFHVDxrn4qotuLW9e3A41cHei63ghk3xv+PbaovLx7BcKle/GF00qumwd53Ezj/NUQHWF9w+OK4cH77cn+klWdoNgXkqpD/+EUWSjyX6L02UNC1WGU3mdbvLz+VejcevG3nOhZ7Qf87TabC+J1u7hwDyYH/3xVy7+wcvXx4fHmxtAM4fNFD6sxGX/i+FSWMKU0R2D5vpj8cXjbQf02Lxn/i8wGk1uH1Yqbx88WJ7e/v58xcvnvM0t+F/+2CeuwTnMv4RKLTR7nwgB/xn+e+ECRdITWGSV95Y9e270WXWh9Cfi5u2raOz493tra2ZTT5//vzXWwN98bJS2Q2u/NDnW0BONh6PPVCc89Po0X+hYarM5It32M1GJSUXYxNbHbQHlxnXgur7w+UKCu6dVfZ3tzY3Ccxf72nu7y8rx1uQ1T96c823vzAV8mZfXzRf3an56qLBLWLRVz7QwhOV6onon4dp8TDheDqTjrFeM5bJFnVMdXAyehWxL0i+zzQXlxHaAg/f34JS6NmcJBjmA567h5XjFzakuPN02qqBP8E1OS/6S0EaYOZHo+7FxeByNBwNLy8uuoPxK+4xFn/lokjNjPDjfxymyeH2MZFUodEsJAIWSo2NbL3fv8x5wc8ffV+8XN46Pj9+wbO8Rfn8+bNnz57f4oSctA+uvoEehE1bKBr6KH5/gnQK86TbP2k2QC140b/6Bkyly+8P+F2qfxwm+Qopi4dN1cfjQthBGbE53rjq1lm15LtgYrSydVZ5uQsF5ebzO5TPn23+vLE5xwk0QcfnQPMWJ5SkO71e1LZmW1tdtWq+5PEzmP1+t90CnQymlvkVN1/AxnChVitETPgfrqBoWiRWkurDyGSH4zq3juUST/aq+5qz09/1WVbQjGVw89kM5bNnm5vPNoGb7OeNZ3euvrt/fL63ihcXeUeUh8qTyXVvJ0oUAgVta7OPJL/PVYRcHPQT6XSu3ml1WlV4CYvMVz6cCK/GXo1Hr+MmLP5nkz6tNFrsdihaaJ07MxjXGCNFPY00RpcJF0bfhgl9Yujo/JiwDPKGCRa5CV0k6SQ3AOfPc3PlA+de5WzXiqb1JoF5/UePZ7kzE8EatPFbbyk8os1ONxFbGLb7zZTX7YF/7F8ug2kx1sdejUav4uZ/HKbO4WUicS5gRsiTGV+lXFiK/bnxOOnG+Jv5cFGKNg7Pj/e3N4O8SwNKApEouLm5ufEz4Jwyfg7l5/bufuVsy7o4bdTtoZ3ypBclHTwxzDlUYqb2+wXovGj350btQTP+GFFTj/oKTB3X6J40Yv84TJHa7g6wyXw+4sKYqY2rfiwXuRIA0/UdMBXItndeOdjf2nw2YwkYbTYeJqEZtFFTms+fb21tAU0gH0S3rdBqtBi13jud1RYMRXeKxSjk+HuBSKJSGZUSJn8JMJOWJ2adSiX+KkxjrHHRb8b+WTeH3CkSYYwpR7jWia9LnMlxg6GUUnPkYhR3fNvNFxcXQufnhwf7LwDlb7yLb2zcs0wInj9jnubzLTA+oLlXgSS0iOaDSHKbTfPgjHLrGgDdKe4E79smTaspHOBhJtaxjqa/0uxCDsCGWKPfb4Kbi0R/F036U5Q0LZdLl2UybA7U64zpEdtqsVippNjmJWcWfbPJUKDgIRgm34v/NoUZvA+Tp4lkEDcBpofQJOXm1rTvmiUa+p5mp10LhorFoPw+TckdTKR7wJIWq1Q6EG+tvB7CpMmF0yIJv5NO9UnxfHe85ME3BOdRz4+ZnoXfusCfSELcZXY+/i1VOrJoMGj1eoMcSRP1uAX5qw0WadWYqTdZ+tulkcK6fX5+fPBi68U+sPz1vmnOWD5/vvHzz5tTmB4C8+BlZW8DT+MeGOJHBRH5cnnEIWKb92Hiz8NcADu8LdIk4hlM40cwRZLb8VQsfjDi9OB4WnK3aUEixvfOLHmE5CTy4OlAN5Q8843wpuLbBUqj12qMSsxkU/YFX7YWAJiPmXrV/82inQy5Hb6vHO6Tquc3QvP5cxIn+Wg5ZQkwn21swCsImYQmGeo83t+yIuk3og8KFkOfg9mawrzbgDFtNFtAZiN5TXxNOYcJMVPE44VIpiM7rZtNcKLFe8cv8sevk+PJJkxPbZDmN/DHWNZNKn4D36VJZUayzrSEJfwJyUG3n2HdJKZkGrlWRvsSMTvyZbI+pFdjtp52o281ENBGbp+dE5i7+1OYfI15J1K7//orWCtY5ixoknHjg+2NT0OO/GHoRLbi/d4IYKIpzOQ9mPSySoTVHpZLplJJjnU/JrYpVysp3s2hNKKUct4HMXYw/E6xsA9SvOQ2rvwiwrrp8al42GdBj1WzDRIxUruZ6YZIwEnhaRBRIQOTSKfSjFbqIxsTYZ+M0lGUi43xS14z9VRpWELeCGtBvnTMhQ0qiq2y60j8jeGcRWQ7/HB+fLgPLAnM3+bNz534EvMZn863t0g+J5Z5uBtUPGgraTmk9LX7qUiD7Pctk8DEJJtfNO9g0lisQ5SPy9YarfarZr2aiUA1p1OqtXOYJkqplsp1GLvYdKHefNV+1ajl4n4TeC2A0ShEOvQTHF+db0owZqSSy5dp8S9I7ucysw31QjoMZ1bKpVIdMnP10cVlzBvO1ZsteNdcxI5dYbJrqwVLnIeijDLKy7iNyJ9kzJRebAxnPbTky144rdfRcqjy4ewYkvnLO5qfE4HKj3Nu7+4dQAba3bTdg0nz8Sy4E9LcM9O1aDH4LZjiRWRnMo3RaHR1dTW8HI0aKQAltz6AqVZjgy9ZuxxdDq+uRpej8assa8cLQJM0sNPjyaary8vRa2in8ZJcKcLIwWYblyOy/mo4Gl3U0wEzlqrVq9jMNcbDYSZVG4OuhuNxPeyL10cjsgR/WymPRLcic3nMCqU/4qTUCuyKcJZverkCre6enQPMly/5aYovwwT9Nh062j3gYW5toPszbFAghcqn0XvwVkOl0Nr9WCB+CHMqbInURoN2Gxr3fr/Tao8u84yasuopK4HZApgavYbSQnwYtdsd2KcL/X1/VItYkISEQGwOk+NbnW6/2+c3NWKOZbmaol1gf3DiTrcLGzrt9nBUZS1YrjFiU6Q+IuMtVwP+TZvtYbXQeNfnP8JJszkeQn2ukZvNCmrd6zcSK/WxftPnB4dpufyuKbcdnp9Xjg8PD+c0X7z49ROk/DJUTmSkY28fQmalsr8dnMLk8wVaC0VLk0l0bWbxJHxGS1Ebuh9GxdMEdHGbzUn8ssAld1r9q5NGrd4Y9Nvt/jjPyCnDNAG14muUVi+jmMJo0OqMBo1arX4yhP5+XI/YkRrc3xSuj2F5yG96dXnRao0bHHim1Jl8Ney2OpcXZEPz4rLT7I/qYbtUsUZgXjUB4VWjkM3VTrqtdrd70h22q9lstQXHjBospVyWPwWYDotMoVfIvD7L58piWiOfjpsFab6TDFbez2EeEJi7L377gsAmCe4DMm1ZqRzyo+60mvdrfbBYLk6uS2s8PFoOK+3QGNke1sXihwmIpJUn62wNWAwbWY5lGJbLt1qt4TDrUz+ljHM3N8h/8mXH/Wa/W0iQncLpBgFTYy1PNUpToDo+aZwMakmWCTCRTP3y3bjKmKSUPd4ct1rvXufjZEM4WYV2qjuusVrKSE1hDlpZ1ufxBtKNk2b7pNvNR/xej5+rD2C/pJOWaRQahU5NKTWaFb3dvkh/PlSSfg8KagITSbfOPwDM4znM/d3dL8H87Y4lwISgucGff20DUnx5Uo5OehtIObubxAYNELB8+GV+ClOCvLlRt/muFvPZSUXoSbdPmo3xOOHEdzC12J48GTbeNtOMU0FhYsv9VgMM2E8pkDt9OWj0u1nWJYPax+zlqoMCu66gTWx93GwN6ynGIaUgpbmYdHPQbI/zPql8CrPTyfiX4Bjkyw66jU63wJrIR3Ck2v32GOohmUGv0SwvyTUgvVz62TZMbgtGi6XSTmgVrGYRrc5gEpoHB/PZ3U84zjcAy5fA8rhyVnnxbIOk741otFguX09CO6fFeXG0BmZJqqKHpdInMEVYvM696jeHjYgFP6VUZk+sCjHu5KoFMUs6c3OoU9SB2lWz2015ECVbMjrYXLPTPnk3zAUoSsw2Bq3+IOenFuVqteoXtM6mGT1WYm/2XRdOHHMirCbClDvV7DcHnSR8a2aIma1hlUEik1GrM4Tb/eaozpppg8Ek0THVcfsqH0BLBqC4ssLD1MiffuzkfOsXKpaBpG06CCFFG7vn7yEBEZhQPN7SJNPld5qt2SMsiWEeH0NpSmDSwZ3TSTFU6t1MdsolaMX51sdGUNrkn3jFR3UmWfZnx523nZQdGynkCOfbXbCmUTXiUqupOUwpdib6w/bbnG9BocSGQKbRbTX743rCZ5ZRruRVt3VZDSixdHFapZvsJkom14bBDgdNYElhvt9eorAnNei0rmp+Aw+zM0y5sQyMT0sxjf7JIO+mtBqNgZJ68wCzwGAe5lR8qf/QJDX8CE+pGA0F70r2jT0CszKHefApyRlOPvfwLIH8y4PDvS0yXWEvXl9HbTu9616pt4P4wSMwfHiLtc8MI9yDidU8TByuD1vjaoDGlDqQqg+HneG4kfRbMKW9g4l8eVjfDJsRxmC7g9FJfwx+7SRzsYHCVXvQiK9jo3IaN2iEKauCdqVGnc5F1o3FalKoi8VKOWS/6rA16nAOBDCvOpdxh1gxhVnvDrpZB2UkMOXe3Lg9LjBoDpP0xvIHQ9189IJARvybL6inW5dR8OD8nIc5p0k0R3hMuN2x3N0DmocHu7sv9oo7gKx8GkLRyQT+vJmcQtSEotJORt/4avPTGYwHMA28mxvi7ZPOVQqqHHc4P7w66Qy7/DCi2qCcwzRJEVMftEdVD4IWKN0a99vvhrWEbxlLoWuBL6M9ygfUonmpJVLpDMYlqBpG7WE9oqGNt42SETni3Yv+u4wHWQjMi7iDJjA1U5gZ50+GGczRt2DC1dmj5fKOnXdF+tYyeZjnD2HeQ8mLZ8mXmABzb3s7FC2/Ke5MQGVb8HQSpaOnvdPeZFJchSBSIgNvSP6ZcP0AplFOix9T9tTFyaARQeZAuj3uNvuDespPYaPWoJZTqzOYWAwxrd/PWFSeWH38DqqgTo41Y7VOr6X0MYiCFynnEhbfQpMDEczWCGSfAatu16ulBqZ+efKu4CcwRwTmIoGpJjDfdrNOzMMUP4A5n3N94OVgKqFyORpcox8McPPDb5+YJn+/Fo+xAgKfBpTzRnL/xU75DXj19u7pvyaT6yiBSSzz+hrY7miCoY21L40+PoRJBoYoZ2bUuaqxDq72Fsrrq36OdUgoBUmfaqybwUSmSKd71Yw7mHwHKtLBsMa5jZiCfZSUJXHShYxvpMT3xgDlWoqK1Aedy4xrDpkf9FVS3uoQiqjArWUuEZjKKcyMg8C0Eph3bn7L8v51WJFtp1zkZxJ4m5FbrSSS0Cv3YR5NYc5IVniSlalZAsoQZK4daCV3d8qT65vf9w9Lkz8m16fFMoFZvr65AZq9IB82vzDo+3mY7be1dKox7rbeXdXiPjNES+J6Vj26hWmOnHTfNbLJwtWw1R1DgeSAwkCrhnqFsiehu2lwMkpyy2wGs0Es1kHR09H8qWlSnvxFd1Bn0Poc5pJaLr+FSVnlci2+tUxqVTO3yo+uxw4sgyRUwonX1m5HP5ZpcPMPPE0C7nh2F+Hh1Mmn7r29tb29BRGyNOkBzIODF8UewDw+Ll3f/DHplacw/7i5vgFDPY3aNPI/YZmONPSIjUb/Xbs7bmdZB7j4qlbDw7yzzF/CnT7sdDI8aY8GVc5DYZ0BrvMWZjMmo8Sfg5n+BGZhcPJFmE7oDuTqezCtX4Bp3SlHIZfzKzWQhe02m1XMV0pQGt0LmtOYCUUQZBuIjltbZDKnuP1sc6sEjny6SQaMDnbeAMyXx6f/ur6+7r3p8TChNOrB4g2kJPRdMHXEMShL8uKkBTmo3b+qJzzUsmZejvDxcBYzEQvNSuvkpN0dNTMBK5brZ/soqfVEu3vyOmmhaNFDNw+Dm48ybvpeLBUpf/LVLk8GVf+tmy8+gIl1D2Fqv2CY0dLOrFahkTxaLpVOyyEyn2hDtq3dw6PDvd3tW0FshPqpWNrbLr4p9yYQGU+3NoNRYFWewiyeEpiV09NS+ea6dz2DGYpObm4mxY3vhDktjaRcs99uQTP8OstYKD5aQkbQacjYxm02x4HaEBo+MlARdv5CyaYkdXoAruAakOizXhW6G95UK7UUZqqj9qjAGGn17XqlyB5uDE/e5by3lvlFmHAogkX6sxNVJIvfrg0VCZhgtFQuF+22aKlX3oqWTks7pfLppETamTeQm6+vS892ehPAQ15uboTe8DD3Do/nMMu9YnDyxzWBGQKXPy32esVQ0PqVISrxp0U7ZN0OdNp5zqvDFOnfNAYDhuyiU96rM7254dtGu1VLBiwYazUQB6yGJUwpVqdZe1gPq29LIIkSy1dllA8yW78B7ZPpdlLJhN2ZwcnbftI1rTM/D3NaGvEw1Z9niXohtHq78CgEDUuUvxmDWNW/rsvgxJPeKSyCtxZ7k+tJidB5vg15pRcskj8bUR7mi4NK5bBI3Py4Up6UEG+NoYVojxhlNPiN8b5PYS74sqNOY1QPG5HaZNSDDFJsd61r5fc6IOSMd68a3Q5QwKY1q1ZvMGix2mU3WJehaxx32oOcB9NqwgVQUqYlmVJqjw34zugpVkmUcrFSosJoPdwYNK8arOWvwoze9cm0NXR6A3QRGN716ZptMjnYn1z3ypObXunmeu9FicD7+c11efdFEeiGdoDrDObW3tF9mGUalSCLh+ynEDyjpFD/+t2FH8MUY9rCvb5ogmk5aGpJoVCQB29M4aRfSxmotVhzOtDxkzFQJ7150qOmlsgDNUsUpfYnWTulkVq4LrSNrYQLUdTSEpir3M26MfWUYsBkO92sTw3rlvASRuQ+y8t2Z5RzU/grMPHHMNFnYc6zLK0BmNC2IBIGr3fQm97RMSRqANfbBrC75EUo+ua0xMMEy7y52dkMbhGY24eH0ATtETc/Piv3StBUnd78EQ31yiHb6renqT83auQvQDzs1jhI5EvkTl3s4hrdhBlgGudzQAbsSHfeNk+aaS9FxkQXEbIwhRGYI1SjvvzopDloJNwYLT6mMOVLN1JAlu/nyWgSY+Afj4J6Jgwsm+N6xEzxo0bfjpmSL0zsQ7c8HWcEomCZPQKTBh8FiwqVT4+Oy6XtEoFZKu0dFMFeYeXW7v4upPByqHd9GtzaJDBPd4/3okUC8xosc6d3GtSgUK8XCk4dXE7/AExLuDFutK7qadbncjo9gXCmPoJm3fSUMkwtE2DSokBh3Gy+O8lF/G6n0+1jk9V341cROxiImW2QobZGhhzvDnC5zriV8il/Unrz4y58G4UY43E5XT42VbvsNIdDqD31/Ej7p6XRx27+JZhQZkb5kn3q5jxMBMHw+o9JuXz6e+XoYA9g/psfySjxPt97fnC4C/GzV76e7GxChicwXx7vFMsHJJT+vn9ABtatGlsotEHqrVX591lm7qLVvxtpF0uwM/Vq3G4OB7VsKpFM5+rDYWM8ijkQmQPqdpvg5no9BX5JRoevGrl0MpHK1rpXUJhmPXjJyA8Ct5sXl7UsbMk1LrutcTtiomglU4UGtTN6VZgdMmy1RpcZH5by0xbDdvcezJN+5z7M1ij/FZiEZomUl2uamZuDpZYg55BK8fR3KDQPwaX/fVA5rxyUwPv/uO7tHxKY1yRdl55BxQQwe2Crb073CczJDgSJXtQ6HVnXfAfJaWnE5Eedy1fzCTUwzQW5J81PL4zGYzKj9bbd7ozrYfsjcHNA3CZzQKsK7ODqV4NWe0BmvGDHE9i/k/T8JDMuLzoTr4b9VvvdeHQ5InM+/WGegSAhXWarw8s2FKfjy8vReAiHXEEMpdTTOaBx//IezMG7fvYO5rhD6kz0xZuu6TV+SLgYDcnRHcwicelJ7+z8/fuj0r/mMIHwzU1vCzrHImRpaG2gEYcmEizzWfDNpExYQu4OQXdq+3O39oBlMoXxcDxIWQDm/AYtkTtWvxx1OzP1R5d51v4UcMT74/ElhE8oOhXYzhZGo/7JbKeT4agWc5EEDjnJydVGo5M2WU9mkF5n/GDNcIgukO2O3043dDrd4aiRdD9d0mjWsJlrjkfjBPTmGgITIsV4nJvD9JGPWP0KzOlMAhkei9poBV8aAcxJEfIwJOyjGczJAbkdgfTcp9e94A5U7RNSld9MStCdQ5KfFIFokdxDeHrGPxU0v3Pj+x8GCmSbjWaduPl84p7mR9Zqr8CsRmCbo0414V8nNaSBqzebjRg/Owmd47o/UWgOR7wBj/oQYyFlEbuSL2E7k65fjHnB4TGvnFLoNVodVnu5fGM429CvZVgXRUGLReaAaq8bzdh0CA4ss9ZsNdOOeQLKvm68zgW+YpnTm2w00PSs0ShY/oMkoBJfKILhlcA0K7xlnp2fHZGYuQMdUqm0vdO76e2QUhK4/gtsFGr53t7e0dnhceVlEMnX5H/OMgGmi42EI+GAEUnunF+CsIeNZ3KFarWQz8QZB8ZKq0Zm9UdAfq0UYGqMBorc0JEmO1UL2WTYI8NyNf9UglqFKQ+bzJIt5HA7plY1pJcyYmwPzA7JZ5OsV42VRlivlVp9YQ5OvS7lYcrc4QgXYdalxNBpuZPlIhzrAkf6ipXMJ3ghAZV5yyxOSjZb6Y+bXnT//EMFXPrfB+fvz44A22Q7GC33jgjMyc4puHo5BDYJBlk+OKycAfoP5y8+vhnm+2++/8icIXBCMDW6fAGGCficVoz1VrkcaCyRofTF+dSBQb2IZA4v7MT43esUpVQr5TOpNRS17iFbfC6ArtKToTPScuqfYsox22CGr0irVU+3yMipKcW0fdUo+KfRFNMRN80K/zgVRX+fy4VI0CtpoGgv2VCI1OXB8w+HO+Dxe2fvz/agnQGYZbDBbSgob053en/wXebRwdEZgISQADAPNhD6sYd8+arv0SeMMZLodAatcnpVZFBIs8Q/dHc7EcNfs1xNbgGkyavZWCP534oMSlSyRbl0B+XuEINOraShdlfwG+YwKWplduLp0vxtlglKcpPXt2+MBXMKlUgcjAbJlKJmrQgtzOpBZY8QPj06PyKd900PSsnTbaiMoDTaLh3xqlR4krwqm+SOrx/QI/I8qvjj+28XxBLxFDQl1er1M5ha0jjq72DqDVMbAiwag34Kc2qaYINyAgC6ICU54ham3qBX8EdQUrVer73bAhv0d6cmbaz2dklr0Ksl32WX/FRQNFoqhUKlSS+6hoITaC2D22SQ8rp3AF5OBs0JxaO9o9MjiJBHR4dHZ7///jsw/J0UUe/Bybdt4h+D+YUHLfmSUwe2ZQTBdfEDxHDBxuk18tetJa270WgyGVd5YEpI5holHKMne8OmNXKsGg4z8G4O7BQKOGDNuLZmWjNaAZJBCzFhfm5yRg3/1QFJvWEVvjh4P4PWYDRa1WLRn3uG1wbZyG6l16LRIEbBndPT03Lp6PysVOYJHhCnhn9/fyDeLD+8BydfQf9pQbUKLRoY0tKKRiEDZ5XJFEsYK6x6Ge/5Ct4ToTFX3LojdHT8E6P8GhIByX8y4s9kWSaD0EuW4NUSrFuRkQ0r/N4ySsa/iYI/Ckt5R6eIvy/BH+myXP6nb/3m6WusAOZRkM8s5+e/n831+yfiSYION9DCf/5HJqb3k5P+XK6XkTme6WO1UniBCQA+rOmlaDagaYCAtaRWYuLeUmJflEyphV2sFERzWF5ZoqQk7iIMlSTss2RUYywj5PiTwRvIKajZ4RtRUIiipkGGBHR4iZVK6fdaJnzmjyYXltHqVoWPiITn5zVH+eEw+KPJ55s0xVIXy/r0UNJ4pVKvz8WwXqNS6gy4TVK13e9VaJDJ77NLSeGJZb4AJHV3OMYxFryksDqg8HQ6FGseJgDVkWLF4rRLZa4A44XKyc8G7EjrZx0yqT3gMUilHr9TrXQ48FOnXS11BZw+lg2zPi/LsV4Pw3oo9Gd/lIOeTvnyFr2MrNsVcGASF0GfWOb7W5TvgeUKxn8TTIrJZZKsw5PkKCoSZ9L5uEf92J9mLEjtTXFL2BnJhO3YoFFTdjYTMRtgj1w+F3MplswMF/AlGLweyWUjbgM2+cN+hJlMLsWyiRiX5FxMJu7ElCsTNmMqnA7o5GzMw8b8JsRk/EymWkuFuXwhzkSy+QTrxH/lB3iWMdo6hprnwwznpyhnLCFeKv6mH5JZoCUUW4gkMmF/JoFxPM3mGoWwGRr6sB3pfLkENnDVtN9I6dWkvcz6df58jWPYbD3hRuvxej7TiYksyVw2G/cgS7wQQShSzabT1XrSH6km81m/hsaeamwd41ieMa4nW7Apso7CVcbFVQtsIFXLsYFkPp2qxhyLf+2ZzZXg3vkHguw+z/dz8Sghj2/8fU80LUCnzmY99kiGTcfgglNsrl2Pu1Agx9qRwZvlcCCXtOhIOoZXcY/KmckxZp3RHa+FsT1VL+RrKaclmQoweXbBkb1MKlAkyzpcyXrKZYm3cn61wojdeW6dwlyOUXnScEQ1ZUdslZF400mXM1WvJ9hkyu+IF8IYi//CpSgQ2tg+nNkf7+/v72m6+mjL9vf9sgY4lphiM3awxEiawxSXYrOpSCLp8Wd5mJmIIZ4B19UbFQpzJO9DOFDljOShdG81aXHnUr5AIhswJeN2Ty1M+XONlAeHswxC/kzKjQK1mAKvGCkCE2MuG1hgs3HGl8x5FtgCg9yphN2Ryif9vkTKi9y5tAX/pV8uU0iRLLhXOb/F+bFVVnYh9az8bb9uNIWZC/gTKQYskwLLzLIWJhdm0zOY6+m402jVa2TYHss4FuyEgtm0LlnPptyBAovI16CIpyPxnG+di3PxCGZzrOWJJ5nyPvFmwytqyPWePGdZIDARR0YzwCoRU2AWvOmU05VK+bEjmWFUVDLj/J5HeL/6eO8yUmzuQYX04VNBoxl8jJal6O90cxIzU9l0wJuOI7DMcJZFxngynmIgZgJMUwqMTaZXSrGFy7qRiamGFVimxS7IU+Fc4InJnUusc/laPrzsy7IeLmOGr8OMvHAY8ucia081BgwwzbxlqhNZt+lJIMc9ZQoBBG7ucKWTHmRPpv3InknbEfrrD7rLVoNbB2fvPyZ5sBVc/bsfCAWYmKlmOY/Rm4k9oqcwTclEDGAu6HyZiCycC09nhEVsgV1HnnzagyikY+usO5X2ItkK/OUKmYAFs7UYk6562AzsNodpfbpiwO5cRIYQl/G70imjDHtSaWcADJzAdJJzAEyIDgVO9Jdi5tQ2ieWtBoNbu/z4EFHl8IA8iU4mxBf/bpzg5gXWgZA3l6SoBGRz1snmWYbcOGPwZWPYkS6wTmhagEkizzlM4WqWcXtj1azDV+UcUHRzmUgyzYohBDayiUItHMuEAWYamPvz3Jp0xUB5CkmfyxTPQBEAoYSyRwp+BlzdC3EVTpdwO5NZLpIHE/0PGCaSrvBdt20juDXT7LfgVlakCP39MLMuTKsdySzLZmL+XJpLxZ2+fDrC+HyZOMaBDIRRSgs9tjedZw32WCGbSlezAfgSGJ1URjPJZJLzISWTToVZLpVIpW7dPBteJTBduUKac3NJhkuzj2UKtT/HQpxGnnTSjTzJaiwQyxcycS8l/g9d0uKy4uEwxgKs+Ed+VU9M+TmPAto/fyILV+SIZxJgqO54Gip5T5ilnlJejnVgtVz9GLu4sAVbmFQ2w0EgDURclFJKORmWZTw0FQh7MOQsaGu8RuRkoQh3h/1W8qSbPZxKJ7zQGJFGR6HHjkjADzs7Wcb5SO6OJRgmnmTWf/iH9P6bhI0WMm+J1XaPx65U2512E8Y6u9MFLywWOY0l6+vT+1cxbbaoyTaH3SzGSrOZv9voqdFsMmlpudksJ125ed1kFNEqk0lC68xGOen5xGaL3U7GnswmtZQ0XXCAWSdVkn2waN1ihvcx/sjv6H3tqhalc9H/7G+Rkhv6xdPfNOK9YVE8G1RGWEwmOPkdyO0gZDqOnj0yDUt49ugvSE4WJRIRnp6OP4Y81EsGk/H8ZNPHf2nML0j5fcg5+U75kQj9f5DoCX9zoEQllqgkol9UKpWIPJn/i0Qskkgwebp3fr8brCWP9OpUOpUYLFbFHyciP8TKL4r5s6h+EZP73GGjaH6gSqdT8T+ZOH3GF04oJpt/IU/3wzlhve7JI/T/TPS816Lpv+n0XxyrFiRIkCBBggQJEiRIkCBBggQJEiRIkCBBggQJEiRIkCBBggQJEiRIkCBBggQJEiRIkCBBggQJEiRIkCBBggQJEiRIkCBBggQJEiRI0F/Q/wHIuUREmBNr8gAAAABJRU5ErkJggg==';

/**
 * สร้าง (หรือสร้างใหม่) ชีตแม่แบบของฟอร์ม ให้เหมือนไฟล์ Excel ต้นฉบับ
 * เรียกอัตโนมัติครั้งแรกที่สร้าง PDF และเรียกซ้ำได้ถ้าอยากรีเซ็ตแม่แบบ
 */
function buildCleaningFormTemplate() {
  const SS = getSS_();
  const old = SS.getSheetByName(CLEANFORM_TEMPLATE_SHEET);
  if (old) SS.deleteSheet(old);

  const sh = SS.insertSheet(CLEANFORM_TEMPLATE_SHEET);
  sh.setHiddenGridlines(true);

  // ---------- ขนาดคอลัมน์ / แถว ----------
  CF_COL_WIDTHS.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  cfRowHeights_().forEach((h, i) => sh.setRowHeight(i + 1, h));
  if (sh.getMaxColumns() > 9) sh.deleteColumns(10, sh.getMaxColumns() - 9);
  if (sh.getMaxRows() > 44) sh.deleteRows(45, sh.getMaxRows() - 44);

  // ---------- รูปแบบตัวอักษรพื้นฐานทั้งแผ่น ----------
  sh.getRange(1, 1, 44, 9)
    .setFontFamily('Calibri').setFontSize(11).setVerticalAlignment('middle').setWrap(false);

  // ---------- ผสานเซลล์ตามไฟล์ต้นฉบับ ----------
  [
    'A1:I2', 'A3:B4', 'C3:E3', 'C4:E4', 'F3:F4', 'G3:G4', 'H3:I4',
    'A5:B5', 'A6:B6', 'A7:B7', 'A8:B8', 'A9:B9', 'A10:B10', 'A11:B11',
    'D5:D6', 'D7:D8', 'D9:E9', 'D10:E10', 'D11:E11',
    'H5:I5', 'H6:I6', 'H7:I7', 'H8:I8', 'H9:I9', 'H10:I10', 'H11:I11',
    'A12:E12', 'H12:I12',
    'A34:I34', 'A35:I35', 'A36:I36', 'A37:I37', 'A38:I38',
    'A39:E39', 'F39:I39', 'A40:E40', 'F40:I40',
    'A41:E41', 'F41:I41', 'A42:E42', 'F42:I42',
    'A43:I43', 'A44:I44'
  ].forEach(r => sh.getRange(r).merge());

  // แถวเช็คลิสต์: ผสานช่องชื่อรายการ (B:E) และช่องหมายเหตุ (H:I)
  for (let r = 13; r <= 33; r++) {
    sh.getRange(r, 2, 1, 4).merge();
    sh.getRange(r, 8, 1, 2).merge();
  }

  // ---------- หัวเรื่อง ----------
  sh.getRange('A1').setValue('รายงานบันทึกผลการล้างเครื่องปรับอากาศ')
    .setFontSize(18).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  // ---------- ส่วนหัวข้อมูล ----------
  [
    ['A3', 'Type'], ['F3', 'ตัวที่ 1'], ['G3', 'ตัวที่ 2'],
    ['A5', 'Node'], ['A6', 'จังหวัด'], ['A7', 'วันที่/เดือน/ปี'],
    ['A8', 'เวลาเริ่ม'], ['A9', 'เวลาสิ้นสุด'], ['A10', 'รวมเวลา'],
    ['D5', 'Indoor'], ['D7', 'Outdoor'], ['D9', 'BTU'], ['D11', 'Brand'],
    ['E5', 'Serial'], ['E6', 'Asset'], ['E7', 'Serial'], ['E8', 'Asset'],
    ['A12', 'รายละเอียดการบำรุงรักษา'], ['H12', 'หมายเหตุ']
  ].forEach(p => {
    sh.getRange(p[0]).setValue(p[1]).setFontWeight('bold')
      .setHorizontalAlignment('center').setBackground(CF_GRAY);
  });
  sh.getRange('F12:G12').setValue('ตรวจเช็ค/ระบุค่า').setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('center').setBackground(CF_GRAY);
  sh.getRange('C3:E4').setBackground(CF_GRAY).setFontWeight('bold').setHorizontalAlignment('left');
  sh.getRange('H3:I4').setBackground(CF_GRAY);

  // ---------- รายการตรวจเช็ค 21 ข้อ ----------
  const nos = [], labels = [];
  CLEANING_CHECKLIST_ITEMS.forEach(it => { nos.push([it.no]); labels.push([it.label]); });
  sh.getRange(13, 1, 21, 1).setValues(nos).setHorizontalAlignment('center');
  sh.getRange(13, 2, 21, 1).setValues(labels).setHorizontalAlignment('left');
  sh.getRange(13, 6, 21, 2).setHorizontalAlignment('center');
  sh.getRange(13, 8, 21, 1).setHorizontalAlignment('left');

  // ---------- คำอธิบายสัญลักษณ์ / บันทึกเพิ่มเติม / ผลประเมิน ----------
  sh.getRange('A34').setValue('✓  ปกติ          X  ผิดปกติ     (หากผิดปกติหรือพบจุดที่ต้องแก้ไข ให้ระบุลงช่องหมายเหตุ )')
    .setHorizontalAlignment('center').setBackground(CF_GRAY);
  sh.getRange('A35:A37').setHorizontalAlignment('left');
  sh.getRange('A38').setHorizontalAlignment('left').setFontWeight('bold').setBackground(CF_GRAY);

  // ---------- ช่องลงนาม ----------
  sh.getRange('F39').setValue('ผู้ควบคุมงาน Interlink');
  sh.getRange('A41').setValue('ผู้ตรวจสอบ (Supervisor/Area Manager/Region Manager)');
  sh.getRange('F41').setValue('Approve (Infra)');
  sh.getRange('A39:I42').setHorizontalAlignment('center');
  sh.getRange('A39:I39').setBackground(CF_GRAY);
  sh.getRange('A41:I41').setBackground(CF_GRAY);

  // ---------- กล่องค่าแรงดันน้ำยา ----------
  sh.getRange('A43')
    .setValue('ค่าแรงดันน้ำยาแต่ละชนิด      R22  High = 180 – 230 / Low = 60 – 80' +
              '        R32  High = 250 – 340 / Low = 135 – 150' +
              '        R410A  High = 200 – 250 / Low = 120 – 145')
    .setBackground(CF_YELLOW).setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
  sh.getRange('A44')
    .setValue('ค่าแรงดันน้ำยาจะขึ้นอยู่กับปริมาณน้ำยาในระบบ ประสิทธิภาพคอมเพรสเซอร์แต่ละยี่ห้อ ' +
              'และปัจจัยอื่นๆ เช่น ระยะความยาวของท่อน้ำยา อุณหภูมิห้องฯ')
    .setFontColor('#FF0000').setFontSize(9).setHorizontalAlignment('center').setBackground(CF_GRAY);

  // ---------- เส้นตาราง ----------
  sh.getRange('A3:I44').setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('A35:I37').setBorder(null, true, null, true, false, false, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('A1:I44').setBorder(true, true, true, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.getRange('A1:I2').setBorder(true, true, true, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.getRange('A12:I12').setBorder(true, true, true, true, true, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.getRange('A34:I34').setBorder(true, true, true, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.getRange('A38:I38').setBorder(true, true, true, true, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // ---------- โลโก้ ----------
  try {
    const logo = Utilities.newBlob(
      Utilities.base64Decode(INTERLINK_LOGO_DATA_URI.split(',')[1]), 'image/png', 'logo.png');
    sh.insertImage(logo, 1, 1, 6, 4).setWidth(150).setHeight(83);
  } catch (e) { /* ไม่มีโลโก้ก็ยังออกเอกสารได้ */ }

  sh.hideSheet();
  return sh;
}

/** คืนชีตแม่แบบ ถ้ายังไม่มีให้สร้างให้อัตโนมัติ */
function ensureCleaningTemplate_() {
  const sh = getSS_().getSheetByName(CLEANFORM_TEMPLATE_SHEET);
  return sh ? sh : buildCleaningFormTemplate();
}

/* ============================ สร้าง PDF ============================ */

/**
 * สร้าง PDF ของรายงาน โดยคัดลอกชีตแม่แบบ เติมข้อมูล แล้ว export เป็น PDF
 *
 * ทำไมใช้วิธีนี้แทนการแปลง HTML เป็น PDF:
 *   ตัวแปลง HTML -> PDF ของ Google เรนเดอร์ไม่เหมือนกันในแต่ละเครื่อง คุมความสูงไม่ได้
 *   และล้นเป็น 2 หน้าอยู่เรื่อยๆ วิธีนี้ใช้ Google Sheets สร้างเอกสารตามฟอร์มจริง
 *   แล้ว export ด้วยพารามิเตอร์ scale=4 (ย่อให้พอดี 1 หน้า) ซึ่ง Google เป็นคนย่อให้เอง
 *   จึงเป็นไปไม่ได้ที่จะออกมาเกิน 1 หน้า และสี/เส้นตาราง/ฟอนต์ตรงกับไฟล์ Excel ต้นฉบับ
 */
function buildCleaningFormPdf_(record) {
  const SS = getSS_();
  const tpl = ensureCleaningTemplate_();
  const sh = tpl.copyTo(SS).setName('tmp_cf_' + new Date().getTime());
  sh.showSheet();

  try {
    const lt = plainText_(record.LocationType);
    const cond = plainText_(record.EquipmentCondition);

    // ---------- Type ----------
    sh.getRange('C3').setValue('  ' + tick_(matchLocationType_(lt, 'container')) + ' Container      ' +
      tick_(matchLocationType_(lt, 'shophouse')) + ' Shop House/Room');
    sh.getRange('C4').setValue('  ' + tick_(matchLocationType_(lt, 'office')) + ' Office');

    // ---------- ข้อมูลหัวเอกสาร ----------
    sh.getRange('C5').setValue(plainText_(record.NodeName));
    sh.getRange('C6').setValue(plainText_(record.Province));
    sh.getRange('C7').setValue(plainText_(record.Date));
    sh.getRange('C8').setValue(plainText_(record.TimeStart));
    sh.getRange('C9').setValue(plainText_(record.TimeEnd));
    sh.getRange('C10').setValue(plainText_(record.TotalTime));
    sh.getRange('C5:C11').setHorizontalAlignment('left');

    // ---------- Serial / Asset / BTU / Brand ----------
    // บังคับรูปแบบเป็นข้อความ (@) กัน Serial ยาวๆ กลายเป็น 5.23E7
    [
      ['F5', record.Unit1_IndoorSerial], ['G5', record.Unit2_IndoorSerial],
      ['F6', record.Unit1_IndoorAsset], ['G6', record.Unit2_IndoorAsset],
      ['F7', record.Unit1_OutdoorSerial], ['G7', record.Unit2_OutdoorSerial],
      ['F8', record.Unit1_OutdoorAsset], ['G8', record.Unit2_OutdoorAsset],
      ['F9', record.Unit1_BTU], ['G9', record.Unit2_BTU],
      ['F11', record.Unit1_Brand], ['G11', record.Unit2_Brand]
    ].forEach(p => {
      sh.getRange(p[0]).setNumberFormat('@').setValue(plainText_(p[1])).setHorizontalAlignment('center');
    });

    // ---------- เช็คลิสต์ 21 ข้อ ----------
    const checklist = JSON.parse(record.ChecklistJSON || '[]');
    const byNo = {};
    checklist.forEach(c => { byNo[Number(c.no)] = c; });

    // ล้างช่องของเครื่องที่ไม่ได้เลือกให้ว่างสนิท
    //
    // ฟอร์มมี 2 ช่องเสมอ (ตัวที่ 1 / ตัวที่ 2) แต่บางครั้งล้างแค่เครื่องเดียว
    // ถ้าไม่ดักไว้ ช่องของเครื่องที่ไม่ได้ล้างจะมีเส้นประ "______ องศา" โผล่มาเต็มไปหมด
    // ทำให้ดูเหมือนต้องกรอกด้วย ทั้งที่ไม่มีเครื่องอยู่ตรงนั้นเลย
    const hasUnit1 = !!plainText_(record.AirCode1).trim();
    const hasUnit2 = !!plainText_(record.AirCode2).trim();

    const vals = [];
    CLEANING_CHECKLIST_ITEMS.forEach(item => {
      const f = byNo[item.no] || {};
      vals.push([
        hasUnit1 ? cfCell_(item, f.val1) : '',
        hasUnit2 ? cfCell_(item, f.val2) : '',
        plainText_(f.note || '')
      ]);
    });
    sh.getRange(13, 6, 21, 1).setNumberFormat('@').setValues(vals.map(v => [v[0]]));
    sh.getRange(13, 7, 21, 1).setNumberFormat('@').setValues(vals.map(v => [v[1]]));
    sh.getRange(13, 8, 21, 1).setNumberFormat('@').setValues(vals.map(v => [v[2]]));

    // ---------- บันทึกเพิ่มเติม / ผลประเมิน ----------
    sh.getRange('A35').setValue('บันทึกเพิ่มเติม ' + plainText_(record.AdditionalNote) +
      ' ………………………………………………………………………………………………………………………………');
    sh.getRange('A36').setValue('………………………………………………………………………………………………………………………………………………………………………………………');
    sh.getRange('A37').setValue('………………………………………………………………………………………………………………………………………………………………………………………');
    sh.getRange('A38').setValue('ผลประเมินสภาพเครื่องปรับอากาศ        ' +
      tick_(cond === 'สภาพเครื่องสมบูรณ์') + ' สภาพเครื่องสมบูรณ์            ' +
      tick_(cond === 'สภาพเครื่องควรปรับปรุง') + ' สภาพเครื่องควรปรับปรุง…………………………...');

    // ---------- ลงนาม ----------
    /**
     * บรรทัดลงนาม: คำนวณจำนวนจุดจากความกว้างช่องจริง หักด้วยความกว้างของชื่อและข้อความวันที่
     * เพื่อให้ชื่ออยู่กึ่งกลางและเหลือที่เขียนวันที่เสมอ ไม่ว่าชื่อจะยาวแค่ไหน
     * (เดิมกำหนดจำนวนจุดตายตัว พอชื่อยาวก็ดันจนข้อความวันที่ล้นออกนอกช่องแล้วถูกตัดหาย)
     */
    const line = function (name, cellPx) {
      const n = plainText_(name).trim();
      const dateTxt = '   วันที่ ....../....../.........';
      const avail = cellPx - 16 - textWidthPx_(dateTxt) - textWidthPx_(n ? '  ' + n + '  ' : '');
      let dots = Math.floor(avail / 2 / 3.2);
      if (dots < 5) dots = 5;
      if (dots > 45) dots = 45;
      const d = new Array(dots + 1).join('.');
      return (n ? d + '  ' + n + '  ' + d : d + '....' + d) + dateTxt;
    };

    const wLeft = CF_COL_WIDTHS[0] + CF_COL_WIDTHS[1] + CF_COL_WIDTHS[2] + CF_COL_WIDTHS[3] + CF_COL_WIDTHS[4];
    const wRight = CF_COL_WIDTHS[5] + CF_COL_WIDTHS[6] + CF_COL_WIDTHS[7] + CF_COL_WIDTHS[8];

    /** ใส่ข้อความลงช่อง ถ้ายาวเกินช่องให้ย่อขนาดตัวอักษรลงพอดี (กันชื่อบริษัทยาวๆ ทำให้วันที่หาย) */
    const fitCell_ = function (a1, text, cellPx) {
      const w = textWidthPx_(text);
      let size = 11;
      if (w > cellPx - 8) size = Math.max(7, Math.floor(11 * (cellPx - 8) / w * 10) / 10);
      sh.getRange(a1).setValue(text).setFontSize(size);
    };

    fitCell_('A39', 'ผู้ดำเนินการล้างแอร์ บ./หจก. ' + plainText_(record.CompanyName), wLeft);
    fitCell_('A40', line(record.TechnicianName, wLeft), wLeft);
    fitCell_('F40', line(record.SupervisorName, wRight), wRight);
    fitCell_('A42', line('', wLeft), wLeft);
    fitCell_('F42', line('', wRight), wRight);
    sh.getRange('A40:I42').setWrap(false).setHorizontalAlignment('center');

    SpreadsheetApp.flush();

    // ---------- export เป็น PDF: scale=4 คือย่อให้พอดี 1 หน้า ----------
    const url = 'https://docs.google.com/spreadsheets/d/' + SS.getId() + '/export?' + [
      'format=pdf', 'gid=' + sh.getSheetId(), 'range=A1:I44',
      'portrait=true', 'size=A4', 'scale=4',
      'top_margin=0.20', 'bottom_margin=0.20', 'left_margin=0.20', 'right_margin=0.20',
      'gridlines=false', 'printtitle=false', 'sheetnames=false',
      'pagenum=UNDEFINED', 'fzr=false', 'horizontal_alignment=CENTER', 'vertical_alignment=TOP'
    ].join('&');

    const resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      throw new Error('ส่งออก PDF ไม่สำเร็จ (รหัส ' + resp.getResponseCode() + ')');
    }

    const safeNode = String(record.NodeName || 'ไม่ระบุ').replace(/[\\/:*?"<>|]/g, '_');
    const isPreview = !!record.__preview;
    const blob = resp.getBlob().setName(
      (isPreview ? 'ตัวอย่าง_' : 'ล้างแอร์_') + safeNode + '_' +
      plainText_(record.Date) + '_' + record.ID + '.pdf');

    return (isPreview ? getPreviewFolder_() : getOrCreateCleaningFolder_(record)).createFile(blob);
  } finally {
    // ลบชีตชั่วคราวเสมอ แม้ export จะพลาด จะได้ไม่มีชีตขยะค้างในไฟล์
    SS.deleteSheet(sh);
  }
}

/* ============================ แนบไฟล์เอกสารเข้ากับ Node ============================ */

/** ขนาดไฟล์ที่รับได้ ตั้งไว้ให้ปลอดภัยกับขีดจำกัดของ Apps Script */
const NODE_DOC_MAX_FILES = 10;
const NODE_DOC_MAX_MB_EACH = 10;
const NODE_DOC_MAX_MB_TOTAL = 25;

/**
 * อัปโหลดไฟล์เอกสารแนบเข้าโฟลเดอร์ของ Node ที่เลือก
 * ไฟล์จะถูกเก็บที่ CleaningReports/<ปี>/<ชื่อ Node>/เอกสารแนบ/
 * แยกโฟลเดอร์ย่อยไว้ ไม่ให้ปนกับไฟล์ฟอร์ม PDF ที่ระบบสร้างเอง
 *
 * หมายเหตุ: การตรวจสิทธิ์ภูมิภาคทำที่ฝั่ง Worker ไปแล้วก่อนจะเรียกมาถึงตรงนี้
 */
function uploadNodeDocuments_(payload) {
  const nodeName = plainText_(payload.nodeName).trim();
  const files = payload.files || [];
  if (!nodeName) throw new Error('กรุณาเลือก Node ก่อนแนบไฟล์');
  if (!files.length) throw new Error('กรุณาเลือกไฟล์อย่างน้อย 1 ไฟล์');
  if (files.length > NODE_DOC_MAX_FILES) {
    throw new Error('แนบได้ครั้งละไม่เกิน ' + NODE_DOC_MAX_FILES + ' ไฟล์');
  }

  const today = payload.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const nodeFolder = getOrCreateCleaningFolder_({ NodeName: nodeName, Date: today });
  const it = nodeFolder.getFoldersByName('เอกสารแนบ');
  const docFolder = it.hasNext() ? it.next() : nodeFolder.createFolder('เอกสารแนบ');

  const saved = [];
  let totalBytes = 0;

  files.forEach(f => {
    if (!f || !f.data) return;
    const bytes = Utilities.base64Decode(f.data);
    const mb = bytes.length / 1024 / 1024;
    if (mb > NODE_DOC_MAX_MB_EACH) {
      throw new Error('ไฟล์ "' + (f.name || '') + '" ใหญ่เกิน ' + NODE_DOC_MAX_MB_EACH + ' MB');
    }
    totalBytes += bytes.length;
    if (totalBytes / 1024 / 1024 > NODE_DOC_MAX_MB_TOTAL) {ฟ
      throw new Error('ไฟล์รวมกันเกิน ' + NODE_DOC_MAX_MB_TOTAL + ' MB กรุณาแบ่งอัปโหลดหลายครั้ง');
    }
    const safeName = String(f.name || 'ไฟล์แนบ').replace(/[\\/:*?"<>|]/g, '_');
    const blob = Utilities.newBlob(bytes, f.mimeType || 'application/octet-stream', today + '_' + safeName);
    const created = docFolder.createFile(blob);
    saved.push({ name: created.getName(), url: created.getUrl() });
  });

  if (!saved.length) throw new Error('ไม่มีไฟล์ที่อัปโหลดได้');

  return { count: saved.length, folderUrl: docFolder.getUrl(), files: saved };
}
