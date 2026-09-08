/**
 * นิยามโครงสร้างชีตทั้งหมดของระบบ
 *
 * ⚠️ กติกาสำคัญที่ห้ามลืม (ยกมาจากโค้ด Apps Script เดิม):
 * คอลัมน์ที่เพิ่มภายหลัง "ต้องต่อท้ายสุดเสมอ" ห้ามแทรกกลาง
 * เพราะระบบเติมคอลัมน์ที่ขาดในชีตด้วยการต่อท้าย ถ้าในโค้ดวางไว้กลาง
 * ตำแหน่งในโค้ดจะไม่ตรงกับในชีต แล้วข้อมูลจะถูกเขียนลงผิดช่องทั้งแถว
 */

export const SHEETS = {
  AIRLIST: 'AirList',
  HISTORY: 'History',
  CONFIG: 'Config',
  USERS: 'Users',
  BUDGET: 'Budget',
  CLEANFORM: 'CleaningForm'
};

export const AIRLIST_HEADERS = [
  'AirCode', 'Region', 'Province', 'NodeName', 'SiteCode', 'LocationType',
  'BTU', 'Brand', 'ModelIndoor', 'ModelOutdoor',
  'IndoorAsset', 'IndoorSN', 'OutdoorAsset', 'OutdoorSN',
  'InstallDate', 'WarrantyExpire', 'CleaningPricePerRound',
  'Status', 'Lat', 'Long', 'Address', 'Note', 'UpdatedAt', 'UpdatedBy'
];

export const HISTORY_HEADERS = [
  'ID', 'AirCode', 'Date', 'EventType', 'Detail', 'Cost', 'Technician', 'Note', 'CreatedAt', 'RecordedBy'
];

export const PLAN_HEADERS = [
  'AirCode', 'NodeName', 'SiteCode', 'BTU',
  'R1_PlanDate', 'R1_ActualDate', 'R1_Price', 'R1_Technician', 'R1_Status', 'R1_Note',
  'R2_PlanDate', 'R2_ActualDate', 'R2_Price', 'R2_Technician', 'R2_Status', 'R2_Note',
  'R3_PlanDate', 'R3_ActualDate', 'R3_Price', 'R3_Technician', 'R3_Status', 'R3_Note',
  'UpdatedBy',
  // เพิ่มภายหลัง — ต่อท้ายสุดเท่านั้น
  'R1_FormUrl', 'R2_FormUrl', 'R3_FormUrl'
];

export const BUDGET_HEADERS = ['Year', 'CleaningBudget', 'RepairBudget', 'Note', 'UpdatedAt', 'UpdatedBy'];

export const USERS_HEADERS = [
  'Email', 'Name', 'Role', 'Regions', 'Permissions', 'Active', 'UpdatedAt', 'UpdatedBy',
  'Username', 'Password', 'PasswordHash', 'PasswordSalt'
];

export const CONFIG_HEADERS = ['Region', 'LocationType', 'Brand', 'Status', 'Technician', 'EventType'];

export const CLEANFORM_HEADERS = [
  'ID', 'Date', 'NodeName', 'SiteCode', 'Region', 'Province', 'LocationType',
  'AirCode1', 'AirCode2',
  'TimeStart', 'TimeEnd', 'TotalTime',
  'Unit1_Brand', 'Unit1_BTU', 'Unit1_IndoorSerial', 'Unit1_IndoorAsset', 'Unit1_OutdoorSerial', 'Unit1_OutdoorAsset',
  'Unit2_Brand', 'Unit2_BTU', 'Unit2_IndoorSerial', 'Unit2_IndoorAsset', 'Unit2_OutdoorSerial', 'Unit2_OutdoorAsset',
  'ChecklistJSON',
  'EquipmentCondition', 'AdditionalNote',
  'CompanyName', 'TechnicianName', 'SupervisorName',
  'PdfUrl', 'PdfFileId', 'CreatedAt', 'RecordedBy',
  // เพิ่มภายหลัง — ต่อท้ายสุดเท่านั้น
  'PlanYear', 'PlanRound', 'Price',
  // ราคาแยกรายเครื่อง — จำเป็นตอนล้าง 2 ตัวในใบเดียว
  // คอลัมน์ Price เดิมเก็บ "ยอดรวมทั้งใบ" ไว้เหมือนเดิมเพื่อไม่ให้ข้อมูลเก่าเสีย
  // ส่วนการลงประวัติและการปิดงานในแผนใช้ราคารายเครื่องจาก 2 คอลัมน์นี้แทน
  'Price1', 'Price2',
  // มาจากไหน: 'form' = กรอกในระบบ, 'attach' = ปริ้นไปเขียนมือแล้วถ่ายรูปแนบกลับ
  'Source'
];

/**
 * คอลัมน์ของชีต CleaningForm ที่เก็บ "วันที่" และ "เวลา"
 *
 * ต้องระบุไว้ชัดเจนแบบนี้ เพราะ Sheets ส่งค่าวันที่กลับมาเป็นตัวเลขล้วน
 * แยกไม่ออกจากตัวเลขปกติ ถ้าปล่อยให้เดาจากขนาดของตัวเลข
 * ค่าอย่าง BTU 36000 หรือค่าล้าง 30000 บาท จะกลายเป็นวันที่มั่วๆ
 * คอลัมน์อื่นที่ไม่ได้อยู่ใน 2 รายการนี้จะถูกส่งกลับตามค่าเดิมเสมอ
 */
export const CLEANFORM_DATE_COLS = ['Date', 'CreatedAt'];
export const CLEANFORM_TIME_COLS = ['TimeStart', 'TimeEnd', 'TotalTime'];

/** ชนิดของคอลัมน์ในชีต CleaningForm ใช้บอก cleanFormValue ว่าต้องแปลงค่าแบบไหน */
export function cleanFormColKind(name) {
  if (CLEANFORM_DATE_COLS.includes(name)) return 'date';
  if (CLEANFORM_TIME_COLS.includes(name)) return 'time';
  return 'plain';
}

/** ค่าตั้งต้นของชีต Config — เติมเฉพาะค่าที่ยังไม่มี ไม่ลบ/แก้ค่าที่ผู้ใช้เพิ่มเอง */
export const CONFIG_DEFAULTS = {
  Region: ['1', '2', '3', '4', '5', '6'],
  LocationType: ['Shop House', 'Container', 'Pole', 'Office', 'Building', 'Warehouse', 'Room'],
  Brand: ['Carrier', 'Eminent'],
  // จบวงจรที่ "รื้อถอน/ปลดระวาง" (ถอดออกจากหน้างาน) แล้วไป "Write off" ตอนขายออก
  Status: ['ใช้งานปกติ', 'ชำรุด', 'รอซ่อม', 'รื้อถอน/ปลดระวาง', 'Write off'],
  // เรียงตามลำดับงานจริง: ติดตั้งเครื่องใหม่ -> แจ้งซ่อม -> ล้าง/ซ่อมระหว่างใช้งาน -> ย้าย/เปลี่ยนเมื่อจำเป็น
  EventType: ['ติดตั้ง', 'แจ้งซ่อม', 'ล้างแอร์', 'ซ่อม', 'เปลี่ยนอะไหล่', 'ย้าย', 'เปลี่ยนเครื่อง', 'ตรวจเช็คทั่วไป', 'รื้อถอน/ปลดระวาง', 'Write off', 'อื่นๆ']
};

/** โมดูลที่กำหนดสิทธิ์แยกรายเมนูได้ (ไม่รวม dashboard ซึ่งอ่านได้ทุกคนที่เข้าระบบ) */
export const MODULES = ['airlist', 'plan', 'history', 'repair', 'cleaningform', 'budget'];

export const MODULE_LABELS_TH = {
  airlist: 'รายการเครื่อง',
  plan: 'แผนล้างแอร์',
  history: 'ประวัติ',
  repair: 'งานซ่อม',
  cleaningform: 'ฟอร์มล้างแอร์',
  budget: 'งบประมาณ'
};

/**
 * รายการตรวจเช็ค 21 ข้อ ตามฟอร์มกระดาษเดิม
 * (มีก็อปปี้เดียวกันไว้ฝั่งหน้าเว็บเพื่อ render ฟอร์ม — ถ้าจะแก้ ให้แก้ทั้ง 2 ที่ให้ตรงกัน)
 */
export const CLEANING_CHECKLIST_ITEMS = [
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
