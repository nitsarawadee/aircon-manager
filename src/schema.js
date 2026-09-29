/**
 * ขั้นอนุมัติของเอกสาร (ใบล้าง / ใบซ่อม / ใบติดตั้ง) — ดูเหตุผลที่ modules/approval.js
 * หนึ่งแถวต่อเอกสารหนึ่งใบ ผูกด้วย DocKind + FormID (ID ของแถวเอกสาร ซึ่งไม่เปลี่ยนตอนรวมใบ)
 * ⚠️ เพิ่มคอลัมน์ใหม่ต้องต่อท้ายสุดเท่านั้น
 */
export const APPROVAL_HEADERS = [
  'ID', 'DocKind', 'FormID', 'CreatedAt',
  'S1Name', 'S1By',
  'S2Name', 'S2By', 'S2At',
  'S3Name', 'S3By', 'S3Role', 'S3At',
  'S4Name', 'S4By', 'S4At'
];

/**
 * นิยามโครงสร้างชีตทั้งหมดของระบบ
 *
 * ⚠️ กติกาสำคัญที่ห้ามลืม (ยกมาจากโค้ด Apps Script เดิม):
 * คอลัมน์ที่เพิ่มภายหลัง "ต้องต่อท้ายสุดเสมอ" ห้ามแทรกกลาง
 * เพราะระบบเติมคอลัมน์ที่ขาดในชีตด้วยการต่อท้าย ถ้าในโค้ดวางไว้กลาง
 * ตำแหน่งในโค้ดจะไม่ตรงกับในชีต แล้วข้อมูลจะถูกเขียนลงผิดช่องทั้งแถว
 */

/**
 * ป้ายในช่อง Note ของประวัติ "ติดตั้ง" / "เปลี่ยนเครื่อง" ที่ยังไม่มีเอกสารติดตั้ง
 *
 * เพิ่มเครื่องใหม่ · เปลี่ยนเครื่อง · ย้ายเครื่องมาแทน (ฝั่งปลายทาง) ติดป้ายนี้ไว้
 * หน้างานซ่อมและติดตั้งแสดงเป็น "งานติดตั้งที่รอเอกสาร" จนกว่าจะกรอกฟอร์มติดตั้ง
 * ซึ่งจะเปลี่ยนป้ายเป็น "เอกสาร <เลขที่>" ในแถวเดิม (ไม่ลงประวัติติดตั้งซ้ำอีกแถว)
 * ประวัติเก่าที่ไม่มีป้ายนี้ไม่ถือเป็นงานค้าง
 */
export const INSTALL_PENDING_NOTE = 'รอเอกสารติดตั้ง';

export const SHEETS = {
  AIRLIST: 'AirList',
  HISTORY: 'History',
  CONFIG: 'Config',
  USERS: 'Users',
  BUDGET: 'Budget',
  CLEANFORM: 'CleaningForm',
  REPAIRFORM: 'RepairForm',
  INSTALLFORM: 'InstallForm',
  CONTRACTOR: 'Contractor',
  REPAIRLINK: 'RepairLink',
  APPROVAL: 'DocApproval'
};

export const AIRLIST_HEADERS = [
  'AirCode', 'Region', 'Province', 'NodeName', 'SiteCode', 'LocationType',
  'BTU', 'Brand', 'ModelIndoor', 'ModelOutdoor',
  'IndoorAsset', 'IndoorSN', 'OutdoorAsset', 'OutdoorSN',
  'InstallDate', 'WarrantyExpire', 'CleaningPricePerRound',
  'Status', 'Lat', 'Long', 'Address', 'Note', 'UpdatedAt', 'UpdatedBy'
];

export const HISTORY_HEADERS = [
  'ID', 'AirCode', 'Date', 'EventType', 'Detail', 'Cost', 'Technician', 'Note', 'CreatedAt', 'RecordedBy',
  'CaseID'
];

export const PLAN_HEADERS = [
  'AirCode', 'NodeName', 'SiteCode', 'BTU',
  'R1_PlanDate', 'R1_ActualDate', 'R1_Price', 'R1_Technician', 'R1_Status', 'R1_Note',
  'R2_PlanDate', 'R2_ActualDate', 'R2_Price', 'R2_Technician', 'R2_Status', 'R2_Note',
  'R3_PlanDate', 'R3_ActualDate', 'R3_Price', 'R3_Technician', 'R3_Status', 'R3_Note',
  'UpdatedBy',
  // เพิ่มภายหลัง — ต่อท้ายสุดเท่านั้น
  'R1_FormUrl', 'R2_FormUrl', 'R3_FormUrl',
  // ผู้รับเหมาที่มอบหมายงานรอบนั้น (รหัสจากตาราง Contractor) — บัญชีผู้รับเหมาเห็นเฉพาะรอบของตัวเอง
  // แยกจาก R*_Technician ซึ่งเป็นข้อความพิมพ์เอง (ข้อมูลเก่ามีชื่อเดียวกันหลายแบบ ใช้ผูกสิทธิ์ไม่ได้)
  'R1_ContractorID', 'R2_ContractorID', 'R3_ContractorID'
];

export const BUDGET_HEADERS = ['Year', 'CleaningBudget', 'RepairBudget', 'Note', 'UpdatedAt', 'UpdatedBy'];

export const USERS_HEADERS = [
  'Email', 'Name', 'Role', 'Regions', 'Permissions', 'Active', 'UpdatedAt', 'UpdatedBy',
  'Username', 'Password', 'PasswordHash', 'PasswordSalt',
  // เพิ่มภายหลัง — ต่อท้ายสุดเท่านั้น
  // ผู้รับเหมาที่บัญชีนี้สังกัด ว่าง = พนักงาน INTERLINK
  'ContractorID'
];

/**
 * รายชื่อผู้รับเหมา — ดูเหตุผลที่ต้องเป็นตารางมีรหัสที่ db/schema.js (contractors)
 * ⚠️ เพิ่มคอลัมน์ใหม่ต้องต่อท้ายสุดเท่านั้น
 */
export const CONTRACTOR_HEADERS = [
  'ID', 'Name', 'Active', 'Note', 'CreatedAt', 'UpdatedAt', 'UpdatedBy'
];

/**
 * ลิงก์กรอกเอกสารซ่อมโดยไม่ต้องล็อกอิน — ดูเหตุผลที่ db/schema.js (repair_links)
 * ⚠️ เพิ่มคอลัมน์ใหม่ต้องต่อท้ายสุดเท่านั้น
 */
export const REPAIRLINK_HEADERS = [
  'ID', 'TokenHash', 'AirCode', 'CreatedAt', 'CreatedBy', 'ExpiresAt',
  'UsedAt', 'DocNo', 'RevokedAt', 'RevokedBy'
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
  'Source',
  // ประเภทเอกสาร — หน้านี้จะเก็บเอกสารซ่อมและติดตั้งด้วยในอนาคต
  // ใบเก่าที่ยังว่างอยู่ ถือเป็นเอกสารล้างทั้งหมด (ตอนนั้นยังไม่มีประเภทอื่น)
  'DocType',
  // เลขที่เอกสารที่คนอ่านออก เช่น PM2609-01 — รูปแบบเดียวกับเลขที่ในหน้าประวัติ
  // ใบเก่าไม่มีเลขนี้ หน้าเว็บจึงแสดง ID เดิมแทนเมื่อช่องนี้ว่าง
  'DocNo',
  // ผลประเมินของเครื่องที่ 2 — แบบฟอร์มกระดาษให้ติ๊กแยกรายเครื่อง
  // คอลัมน์ EquipmentCondition เดิมกลายเป็นผลของเครื่องที่ 1 (ดู slotCols ใน cleaningform.js)
  'EquipmentCondition2',
  // เลขที่ของเครื่องตัวที่สอง — การล้างของแต่ละเครื่องมีเลขของตัวเอง
  // แม้จะอยู่ในเอกสารใบเดียวกัน (คอลัมน์ DocNo เดิมเป็นเลขของเครื่องตัวแรก)
  'DocNo2'
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

/* ==================== เอกสารซ่อม ITEL-FM-NE-005 ==================== */

/**
 * คอลัมน์ของชีต RepairForm
 *
 * ============================================================================
 * ทำไมเป็นตารางของตัวเอง ไม่ใช้ CleaningForm ร่วมกัน
 * ============================================================================
 * ใบซ่อมกับใบล้างเป็นคนละแบบฟอร์มควบคุม (NE-005 กับ NE-004) และช่องแทบไม่ทับกันเลย
 *
 * ใบล้างมีเช็คลิสต์ 21 ข้อ · สองเครื่องต่อใบ (Unit2_* · EquipmentCondition2 · DocNo2)
 * ซึ่งใบซ่อมไม่ใช้เลยสักช่อง — ใบซ่อมมีเครื่องเดียวทั้งใบ
 * ส่วนใบซ่อมมีอาการเสีย สาเหตุ การแก้ไข ตารางอะไหล่ และข้อเสนอแนะ ซึ่งใบล้างไม่มี
 *
 * ยัดรวมกันจะได้ตารางที่ครึ่งหนึ่งว่างตลอดเวลา และจะยิ่งบวมตอนมีเอกสารติดตั้งอีกใบ
 *
 * ⚠️ เพิ่มคอลัมน์ใหม่ต้องต่อท้ายสุดเท่านั้น (กติกาเดียวกับ CLEANFORM_HEADERS)
 */
export const REPAIRFORM_HEADERS = [
  'ID', 'Date', 'NodeName', 'SiteCode', 'Region', 'Province', 'LocationType',
  'AirCode',
  'Brand', 'BTU', 'IndoorSerial', 'IndoorAsset', 'OutdoorSerial', 'OutdoorAsset',
  // ส่วนที่ 2 ของแบบฟอร์ม — สามช่องข้อความยาว
  'Symptom', 'Cause', 'Fix',
  // ส่วนที่ 3 — ผลตรวจ 5 ข้อ เก็บเป็น JSON แบบเดียวกับใบล้าง
  'ChecklistJSON',
  // ส่วนที่ 4 — อะไหล่ที่ใช้ 4 แถว เก็บเป็น JSON [{no, name, qty, note}]
  'PartsJSON',
  // ส่วนที่ 5
  'Suggestion',
  'CompanyName', 'TechnicianName', 'SupervisorName',
  'Cost',
  'CreatedAt', 'RecordedBy',
  // เลขที่เอกสารที่คนอ่านออก ใช้ชุดเลขเดียวกับทั้งระบบ (งานซ่อมเป็น CM)
  'DocNo',
  // เคสงานซ่อมที่ใบนี้ผูกอยู่ ร้อยกับใบประวัติชุดเดียวกัน
  'CaseID',
  // เพิ่มภายหลัง — ต่อท้ายสุดเท่านั้น
];

/**
 * รายการบันทึกผล 5 ข้อ ตามแบบฟอร์ม NE-005
 * (มีก็อปปี้เดียวกันไว้ฝั่งหน้าเว็บ — ถ้าจะแก้ ให้แก้ทั้ง 2 ที่ให้ตรงกัน)
 */
export const REPAIR_CHECKLIST_ITEMS = [
  { no: 1, label: 'ค่าแรงดันไฟฟ้า (Voltage)', type: 'value', unit: 'V (220–240)' },
  { no: 2, label: 'ค่ากระแสคอมเพรสเซอร์ขณะทำงาน', type: 'value', unit: 'A' },
  { no: 3, label: 'ค่าแรงดันน้ำยาด้านต่ำ (Low/Suction)', type: 'value', unit: 'PSI' },
  { no: 4, label: 'ทดสอบเดินเครื่องต่อเนื่อง (Run Test)', type: 'check' },
  { no: 5, label: 'ทำความสะอาดพื้นที่หลังติดตั้ง', type: 'check' }
];

/** จำนวนแถวอะไหล่บนแบบฟอร์ม — กระดาษมี 4 แถว */
export const REPAIR_PART_ROWS = 4;

/* ==================== เอกสารติดตั้ง ITEL-FM-NE-006 ==================== */

/**
 * คอลัมน์ของชีต InstallForm
 *
 * ============================================================================
 * ใกล้เคียงใบล้างมากกว่าใบซ่อม
 * ============================================================================
 * ใบติดตั้งมี "สองเครื่องต่อใบ" เหมือนใบล้าง (ใบซ่อมมีเครื่องเดียว) ช่องข้อมูล
 * เครื่องจึงแยกเป็น Unit1_* / Unit2_* และผลตรวจรับก็แยกรายเครื่องเหมือนกัน
 *
 * แต่ยังต้องเป็นตารางของตัวเอง เพราะเช็คลิสต์คนละชุด (ติดตั้ง 18 ข้อ · ล้าง 21 ข้อ)
 * และใบติดตั้งมี "ผลการตรวจรับงานติดตั้ง" ซึ่งใบล้างไม่มี
 *
 * ============================================================================
 * ข้อมูลเครื่องคัดมาจากทะเบียน ไม่ได้กรอกในใบนี้
 * ============================================================================
 * ลำดับงานคือ เปลี่ยนเครื่องในหน้ารายการเครื่องก่อน (ปุ่มเปลี่ยนเครื่อง ซึ่งเก็บ
 * สเปกเครื่องเก่าไว้ในประวัติให้ด้วย) แล้วค่อยออกเอกสารติดตั้ง
 * ใบนี้จึงแค่คัดข้อมูลจากทะเบียนมาเก็บไว้เป็นภาพ ณ วันที่ติดตั้ง เหมือนใบล้าง
 *
 * ⚠️ เพิ่มคอลัมน์ใหม่ต้องต่อท้ายสุดเท่านั้น (กติกาเดียวกับ CLEANFORM_HEADERS)
 */
export const INSTALLFORM_HEADERS = [
  'ID', 'Date', 'NodeName', 'SiteCode', 'Region', 'Province', 'LocationType',
  'AirCode1', 'AirCode2',
  'TimeStart', 'TimeEnd', 'TotalTime',
  // ยี่ห้อกับ BTU อยู่ระดับ Node ในแบบฟอร์ม (ช่องเดียวต่อใบ) แต่เก็บรายเครื่อง
  // เผื่อ Node ที่ติดตั้งสองเครื่องคนละรุ่น ซึ่งเกิดได้ตอนเปลี่ยนทีละตัว
  'Unit1_Brand', 'Unit1_BTU', 'Unit1_IndoorSerial', 'Unit1_IndoorAsset',
  'Unit1_OutdoorSerial', 'Unit1_OutdoorAsset',
  'Unit2_Brand', 'Unit2_BTU', 'Unit2_IndoorSerial', 'Unit2_IndoorAsset',
  'Unit2_OutdoorSerial', 'Unit2_OutdoorAsset',
  // ส่วนที่ 3 — ผลตรวจ 18 ข้อ แยกรายเครื่อง เก็บเป็น JSON แบบเดียวกับใบล้าง
  'ChecklistJSON',
  // ส่วนที่ 4 — ผลการตรวจรับงานติดตั้ง แยกรายเครื่อง
  'AcceptResult1', 'AcceptResult2',
  // ส่วนที่ 5
  'AdditionalNote',
  // ส่วนที่ 6 — เก็บแค่สองช่องบน (ผู้ติดตั้ง · ผู้ควบคุมงาน) เหมือนอีกสองเอกสาร
  // ช่อง "ผู้ตรวจรับ" กับ "Approve (Infra)" เป็นขั้นอนุมัติที่เกิดหลังช่างส่งงาน
  // ระบบยังไม่รู้ตอนออกเอกสาร จึงเว้นเป็นเส้นประให้เซ็นจริง ไม่มีคอลัมน์เก็บ
  'CompanyName', 'TechnicianName', 'SupervisorName',
  'Cost',
  'CreatedAt', 'RecordedBy',
  // เลขที่เอกสารที่คนอ่านออก ใช้ชุดเลขเดียวกับทั้งระบบ (งานติดตั้งเป็น CM)
  'DocNo', 'DocNo2',
  // เพิ่มภายหลัง — ต่อท้ายสุดเท่านั้น
  // ใบนี้เป็นเครื่องคู่ไหนของ Node — 0 = เครื่องที่ 1–2, 2 = เครื่องที่ 3–4, 4 = 5–6 ...
  // แบบฟอร์มมีช่องเครื่องแค่ 2 ช่อง Node ที่มีเครื่องที่ 3 ขึ้นไปจึงออกใบแยก หน้าตาเดิม
  // ช่องที่ 1/2 ของใบ = เครื่องที่ SlotBase+1 / SlotBase+2 · ใบเก่าว่าง = 0
  'SlotBase'
];

/**
 * รายการตรวจสอบการติดตั้ง 18 ข้อ ตามแบบฟอร์ม NE-006
 *
 * ลำดับต้องตรงกับแถว 15–32 ของไฟล์แบบฟอร์มจริง เพราะเอกสารที่ปริ้นออกมา
 * ต้องเรียงเหมือนกระดาษที่ช่างถืออยู่ ไม่งั้นเทียบกันไม่ได้
 * (มีก็อปปี้เดียวกันไว้ฝั่งหน้าเว็บ — ถ้าจะแก้ ให้แก้ทั้ง 2 ที่ให้ตรงกัน)
 */
export const INSTALL_CHECKLIST_ITEMS = [
  { no: 1, label: 'ตำแหน่งติดตั้งเหมาะสม แข็งแรง', type: 'check' },
  { no: 2, label: 'ระดับการติดตั้ง Indoor/Outdoor ได้ระดับ', type: 'check' },
  { no: 3, label: 'ระยะห่างระบายความร้อน Outdoor เพียงพอ', type: 'check' },
  { no: 4, label: 'เดินท่อน้ำยาและหุ้มฉนวนเรียบร้อย', type: 'check' },
  { no: 5, label: 'ทดสอบรั่ว (Leak Test) ผ่าน', type: 'check' },
  { no: 6, label: 'ทำสุญญากาศ (Vacuum) ตามมาตรฐาน', type: 'check' },
  { no: 7, label: 'เดินท่อน้ำทิ้งมีความลาดเอียง ระบายได้ดี', type: 'check' },
  { no: 8, label: 'เดินสายไฟ/เบรกเกอร์ได้ขนาด ต่อสายแน่น', type: 'check' },
  { no: 9, label: 'การต่อลงดิน (Grounding)', type: 'check' },
  { no: 10, label: 'ค่าแรงดันไฟฟ้า (Voltage)', type: 'value', unit: 'V (220–240)' },
  { no: 11, label: 'ค่ากระแสคอมเพรสเซอร์ตาม Nameplate (FLA)', type: 'value', unit: 'A' },
  { no: 12, label: 'ค่ากระแสคอมเพรสเซอร์ขณะทำงาน', type: 'value', unit: 'A' },
  { no: 13, label: 'ค่าแรงดันน้ำยาด้านต่ำ (Low/Suction)', type: 'value', unit: 'PSI' },
  { no: 14, label: 'ค่าอุณหภูมิที่ตั้งไว้ (Set Point)', type: 'value', unit: '°C  (24–26)' },
  { no: 15, label: 'ค่าอุณหภูมิภายในห้อง (Room Temp)', type: 'value', unit: '°C  (24–28)' },
  { no: 16, label: 'ตั้งค่า Auto Changeover / สลับการทำงาน', type: 'value', unit: 'ชม.  (4–6)' },
  { no: 17, label: 'ทดสอบเดินเครื่องต่อเนื่อง (Run Test)', type: 'check' },
  { no: 18, label: 'ทำความสะอาดพื้นที่หลังติดตั้ง', type: 'check' }
];

/** ค่าตั้งต้นของชีต Config — เติมเฉพาะค่าที่ยังไม่มี ไม่ลบ/แก้ค่าที่ผู้ใช้เพิ่มเอง */
export const CONFIG_DEFAULTS = {
  Region: ['1', '2', '3', '4', '5', '6'],
  LocationType: ['Shop House', 'Container', 'Pole', 'Office', 'Building', 'Warehouse', 'Room'],
  Brand: ['Carrier', 'Eminent'],
  // จบวงจรที่ "รื้อถอน/ปลดระวาง" (ถอดออกจากหน้างาน) แล้วไป "Write off" ตอนขายออก
  Status: ['ใช้งานปกติ', 'ชำรุด', 'รอซ่อม', 'รื้อถอน/ปลดระวาง', 'Write off'],
  // เรียงตามลำดับงานจริง: ติดตั้งเครื่องใหม่ -> แจ้งซ่อม -> ล้าง/ซ่อมระหว่างใช้งาน -> ย้าย/เปลี่ยนเมื่อจำเป็น
  // ไม่มี "ซ่อม" เดี่ยวๆ เพราะซ้ำความหมายกับ "ซ่อมแล้ว" ที่ปุ่มปิดงานซ่อมเขียนจริง
  // ถ้าใส่ไว้ เซิร์ฟเวอร์จะเติมกลับเข้ารายการทุกครั้งที่เปิด แม้ลบออกไปแล้ว
  // "ชำรุด" กับ "รอซ่อม" เป็นขั้นของเคสงานซ่อม ระบบเขียนให้เองตอนสถานะเครื่องเปลี่ยน
  // ใส่ไว้ในรายการด้วยเพื่อให้ตัวกรองในหน้าประวัติและการบันทึกเองใช้ชื่อเดียวกัน
  EventType: ['ติดตั้ง', 'แจ้งซ่อม', 'ชำรุด', 'รอซ่อม', 'ล้างแอร์', 'ซ่อมแล้ว', 'เปลี่ยนอะไหล่', 'ย้าย', 'เปลี่ยนเครื่อง', 'ตรวจเช็คทั่วไป', 'รื้อถอน/ปลดระวาง', 'Write off', 'อื่นๆ']
};

/** โมดูลที่กำหนดสิทธิ์แยกรายเมนูได้ (ไม่รวม dashboard ซึ่งอ่านได้ทุกคนที่เข้าระบบ) */
/**
 * โมดูลที่กำหนดสิทธิ์ได้
 *
 * เอกสารแยกเป็น 3 สิทธิ์ (cleaningform / repairform / installform)
 * เดิมเอกสารทั้งสามแบบใช้ cleaningform ดอกเดียวกัน ให้สิทธิ์กรอกใบล้าง
 * ก็เท่ากับให้สิทธิ์กรอกใบซ่อมกับใบติดตั้งไปด้วย แยกไม่ได้
 *
 * ชื่อ cleaningform คงไว้เป็นของใบล้าง ไม่เปลี่ยนชื่อ เพราะสิทธิ์ของผู้ใช้เดิม
 * เก็บเป็นข้อความ "cleaningform:edit" อยู่ในฐานข้อมูลแล้ว
 */
export const MODULES = [
  'airlist', 'plan', 'history', 'repair',
  'cleaningform', 'repairform', 'installform',
  'budget'
];

export const MODULE_LABELS_TH = {
  airlist: 'รายการเครื่อง',
  plan: 'แผนล้างแอร์',
  history: 'ประวัติ',
  repair: 'งานซ่อม',
  cleaningform: 'เอกสารล้างแอร์',
  repairform: 'เอกสารซ่อม',
  installform: 'เอกสารติดตั้ง',
  budget: 'งบประมาณ'
};

/**
 * สิทธิ์ที่ยังไม่เคยตั้ง ให้ใช้ค่าเดียวกับสิทธิ์ตัวไหนแทน
 *
 * ผู้ใช้ที่ตั้งสิทธิ์ไว้ก่อนแยกเอกสาร มีแค่ "cleaningform:edit" ซึ่งเดิมใช้ได้กับ
 * เอกสารทั้งสามแบบ ถ้าสิทธิ์ใหม่สองตัวนี้ตกเป็น "ไม่ให้เข้าถึง" ตามกติกาปกติ
 * ผู้ใช้เหล่านั้นจะเสียสิทธิ์เอกสารซ่อมกับติดตั้งทันทีที่อัปเดตระบบ ทั้งที่ยังไม่มี
 * ใครตั้งใจตัดสิทธิ์ให้ (เจ้าหน้าที่ภาค 2 คนในระบบจริงเป็นแบบนี้)
 *
 * ใช้เฉพาะตอนที่ไม่ได้ระบุไว้เลยเท่านั้น พอ Admin ตั้งค่าใหม่ในหน้าจัดการผู้ใช้
 * ค่าจะถูกบันทึกแยกของใครของมัน แล้วกติกานี้จะไม่มีผลกับผู้ใช้คนนั้นอีก
 *
 * ⚠️ หน้าเว็บมีก็อปปี้ของกติกานี้ในหน้าแก้สิทธิ์ ถ้าแก้ต้องแก้ทั้งสองที่
 * ไม่งั้นหน้าจอจะแสดงสิทธิ์ไม่ตรงกับที่เซิร์ฟเวอร์ใช้จริง
 */
export const PERMISSION_INHERITS = {
  repairform: 'cleaningform',
  installform: 'cleaningform'
};

/**
 * ชื่อบทบาทที่คนเห็น (ตรงกับที่บริษัทเรียกในระบบอื่น เช่น PV9)
 *
 * ============================================================================
 * ทำไมเปลี่ยนแค่ชื่อที่โชว์ ไม่เปลี่ยนค่าที่เก็บ
 * ============================================================================
 * ค่าในคอลัมน์ Role กับรหัสบทบาทในโค้ด (Admin / RegionAdmin / Contractor) ถูกใช้ตรวจสิทธิ์
 * อยู่หลายสิบจุด ถ้าเปลี่ยนค่าที่เก็บ ต้องแก้ทุกจุดพร้อมกันและแปลงข้อมูลผู้ใช้เดิมด้วย
 * พลาดจุดเดียว = สิทธิ์รั่วหรือคนเข้าไม่ได้ จึงเปลี่ยนเฉพาะชื่อที่โชว์ ตรรกะเดิมทุกอย่าง
 *
 *   เก็บในคอลัมน์ Role   ทำงานเป็น      ชื่อที่โชว์
 *   Admin               Admin          Infrastructure  ทำได้ทุกอย่าง
 *   RegionAdmin         RegionAdmin    Regional        เฉพาะภูมิภาคที่กำหนด
 *   Staff               RegionAdmin    Staff           เหมือน Regional ทุกอย่าง
 *   Supervisor          RegionAdmin    Supervisor      เหมือน Regional ทุกอย่าง
 *   Contractor          Contractor     Subcontract     เฉพาะงานที่ได้รับมอบหมาย
 *
 * Staff กับ Supervisor เก็บค่าของตัวเองไว้ในคอลัมน์ Role เพื่อให้รู้ว่าใครเป็นอะไร
 * (และเผื่อวันหน้าอยากให้สิทธิ์ต่างกัน) แต่ตอนนี้ตรวจสิทธิ์แบบ Regional ทุกอย่าง
 */
export const ROLE_TITLES = {
  Admin: 'Infrastructure',
  RegionAdmin: 'Regional',
  Staff: 'Staff',
  Supervisor: 'Supervisor',
  Contractor: 'Subcontract'
};

/** ค่าในคอลัมน์ Role ที่ทำงานเป็น RegionAdmin (ดูแลเฉพาะภูมิภาคที่กำหนด) */
export const REGIONAL_ROLES = ['RegionAdmin', 'Staff', 'Supervisor'];

/**
 * สิทธิ์ของบัญชีผู้รับเหมา — ตายตัว ไม่ได้ตั้งรายคนเหมือนเจ้าหน้าที่
 *
 * ผู้รับเหมาทุกเจ้าทำงานแบบเดียวกัน คือกรอกเอกสารของงานล้างที่มอบหมายไว้ในแผน
 * (และใบติดตั้งของเครื่องที่มีงานของตัวเอง) ถ้าเปิดให้ตั้งรายคน วันหนึ่งจะมีคนติ๊กเผลอให้ผู้รับเหมา
 * เห็นงบประมาณหรือแก้ทะเบียนเครื่องได้ โดยไม่มีใครสังเกต
 *
 * - แผนล้าง: ดูได้ เพื่อรู้ว่ารอบไหนถึงกำหนด ส่วนการปิดรอบเกิดจากการกรอกเอกสาร
 *   (แก้แผนเองไม่ได้ เพราะหน้าแก้แผนแก้ราคากับวันที่ได้ด้วย)
 * - รายการเครื่อง: ไม่ได้ — การเปลี่ยนเครื่องก่อนกรอกใบติดตั้งเป็นงานของเจ้าหน้าที่
 * - งานซ่อม/เอกสารซ่อม: ไม่ได้ — งานซ่อมส่งเป็นลิงก์ให้กรอก ไม่ต้องล็อกอิน
 * - งบประมาณ/ประวัติ: ไม่ได้ — มีราคางานของผู้รับเหมาเจ้าอื่นปนอยู่
 *
 * โมดูลที่ไม่ได้เขียนไว้ในนี้ถือว่า "none" เสมอ (ดู contractorPermissions ใน context.js)
 * โมดูลที่เพิ่มในอนาคตจึงปิดไว้ก่อนโดยอัตโนมัติ
 */
export const CONTRACTOR_PERMISSIONS = {
  plan: 'view',
  cleaningform: 'edit',
  installform: 'edit'
};

/**
 * รายการตรวจเช็ค 21 ข้อ ตามฟอร์มกระดาษเดิม
 * (มีก็อปปี้เดียวกันไว้ฝั่งหน้าเว็บเพื่อ render ฟอร์ม — ถ้าจะแก้ ให้แก้ทั้ง 2 ที่ให้ตรงกัน)
 */
export const CLEANING_CHECKLIST_ITEMS = [
  { no: 1, label: 'ตรวจเช็คสภาพทั่วไป', type: 'check' },
  { no: 2, label: 'ตรวจเช็คฉนวนหุ้มท่อน้ำยา', type: 'check' },
  { no: 3, label: 'ตรวจเช็ครอยรั่วของระบบน้ำยา', type: 'check' },
  { no: 4, label: 'ตรวจเช็คการผุกร่อนของโครงสร้าง', type: 'check' },
  { no: 5, label: 'ตรวจเช็คขั้วต่อและจุดต่อสายไฟ', type: 'check' },
  { no: 6, label: 'ทำความสะอาดแผ่นกรองอากาศ', type: 'check' },
  { no: 7, label: 'ทำความสะอาดคอยล์ร้อน (Condenser)', type: 'check' },
  { no: 8, label: 'ทำความสะอาดคอยล์เย็น (Evaporator)', type: 'check' },
  { no: 9, label: 'ทำความสะอาดถาดน้ำทิ้งและท่อน้ำทิ้ง', type: 'check' },
  { no: 10, label: 'ค่าอุณหภูมิที่ตั้งไว้ (Set Point)', type: 'value', unit: '°C (24–26)' },
  { no: 11, label: 'ค่าอุณหภูมิภายในห้อง (Room Temp)', type: 'value', unit: '°C (24–28)' },
  { no: 12, label: 'ชนิดน้ำยา (R22/R32/R410A)', type: 'select', options: ['R22', 'R32', 'R410A'], unit: 'Type' },
  { no: 13, label: 'ค่าแรงดันน้ำยาด้านต่ำ (Low/Suction)', type: 'value', unit: 'PSI' },
  { no: 14, label: 'ค่ากระแสคอมเพรสเซอร์ตาม Nameplate', type: 'value', unit: 'A' },
  { no: 15, label: 'ค่ากระแสคอมเพรสเซอร์ขณะทำงาน', type: 'value', unit: 'A' },
  { no: 16, label: 'ค่าแรงดันไฟฟ้า (Voltage)', type: 'value', unit: 'V (220–240)' },
  { no: 17, label: 'ตรวจเช็คชุดควบคุมสลับการทำงาน', type: 'check' },
  { no: 18, label: 'อุณหภูมิตั้งให้แอร์ทำงาน 2 ตัว', type: 'value', unit: '°C (33–35)' },
  { no: 19, label: 'เวลาที่ตั้งให้สลับการทำงาน', type: 'value', unit: 'ชม. (4–6)' },
  { no: 20, label: 'ตรวจสอบความเรียบร้อยหลังล้างและทดสอบระบบ', type: 'check' },
  { no: 21, label: 'ตรวจสอบการตั้งอุณหภูมิก่อนออกจาก Node', type: 'check' }
];
