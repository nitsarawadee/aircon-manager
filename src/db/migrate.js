import { TABLES, sqlType, createTableStatements } from './schema.js';

/**
 * สร้างตารางที่โค้ดต้องการแต่ฐานข้อมูลยังไม่มี
 *
 * ============================================================================
 * ทำไมต้องมี
 * ============================================================================
 * คำสั่งสร้างตารางเคยถูกรันแค่ตอนติดตั้งครั้งแรกเท่านั้น พอเพิ่มตารางใหม่ใน
 * schema.js (เช่นตอนทำเอกสารซ่อม) ฐานข้อมูลที่ใช้งานอยู่แล้วจะไม่มีตารางนั้น
 * แล้วทุกคำสั่งที่แตะตารางนั้นพังทันทีตั้งแต่เปิดเซิร์ฟเวอร์
 * (เกิดจริงตอนเพิ่ม repair_forms — หน้าเว็บเปิดไม่ขึ้นเลยเพราะ getSystemStatus พัง)
 *
 * addMissingColumns แก้ปัญหานี้ไม่ได้ เพราะมันข้ามตารางที่ยังไม่มีไปเลย
 * ตั้งใจให้ข้าม เพราะสมัยนั้นถือว่าตารางถูกสร้างครบตั้งแต่ติดตั้งแล้ว
 *
 * ทุกคำสั่งเป็น CREATE ... IF NOT EXISTS อยู่แล้ว จึงรันซ้ำได้ทุกครั้งที่เปิด
 * โดยไม่แตะตารางหรือดัชนีที่มีอยู่
 *
 * @returns {string[]} ชื่อตารางที่เพิ่งถูกสร้าง
 */
export function addMissingTables(db) {
  const namesOf = () => new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name)
  );

  const before = namesOf();
  for (const sql of createTableStatements()) db.exec(sql);

  return [...namesOf()].filter(t => !before.has(t));
}

/**
 * เติมคอลัมน์ที่โค้ดต้องการแต่ยังไม่มีในฐานข้อมูล
 *
 * ============================================================================
 * ทำไมต้องมี
 * ============================================================================
 * ตัวอ่านข้อมูลสร้างคำสั่ง SQL จากรายชื่อคอลัมน์ "ในโค้ด" ไม่ใช่จากฐานข้อมูล
 * (ดู _columnsOf ใน repository.js) เพิ่มคอลัมน์ใน schema.js เมื่อไหร่ ทุกคำสั่ง
 * SELECT จะอ้างถึงคอลัมน์นั้นทันที ถ้าฐานข้อมูลยังไม่มี ทุกหน้าที่อ่านตารางนั้น
 * จะพังหมดตั้งแต่วินาทีแรกที่เปิดเซิร์ฟเวอร์
 *
 * เดิมทางแก้คือ "ต้องจำว่าให้รันสคริปต์ก่อน" ซึ่งเป็นกับดักที่รอวันสะดุด
 * โดยเฉพาะตอนส่งให้ฝ่าย IT ที่ไม่รู้ว่ามีขั้นตอนนี้อยู่
 *
 * ตัวนี้เทียบรายชื่อคอลัมน์ในโค้ดกับของจริงทุกครั้งที่เปิดเซิร์ฟเวอร์
 * แล้วเติมส่วนที่ขาดให้เอง การอัปเดตจึงเหลือแค่เปลี่ยนโค้ดแล้วรีสตาร์ท
 *
 * ============================================================================
 * ขอบเขตที่ตั้งใจจำกัดไว้
 * ============================================================================
 * ทำได้อย่างเดียวคือ "เพิ่มคอลัมน์ใหม่ที่ยังไม่มี" เท่านั้น
 *
 * ไม่ลบคอลัมน์ที่หายไปจากโค้ด ไม่เปลี่ยนชนิดข้อมูล ไม่เปลี่ยนชื่อ
 * เพราะสามอย่างนั้นทำให้ข้อมูลที่มีอยู่หายได้ ซึ่งเป็นสิ่งที่ยอมให้เกิดขึ้น
 * อัตโนมัติไม่ได้ ต้องเป็นสคริปต์ที่คนตั้งใจสั่งเองและสำรองข้อมูลก่อน
 *
 * ALTER TABLE ADD COLUMN ของ SQLite ไม่เขียนข้อมูลเดิมใหม่ ใช้เวลาเท่าเดิม
 * ไม่ว่าตารางจะมีกี่แถว และแถวเก่าจะได้ค่าว่างในคอลัมน์ใหม่
 */
export function addMissingColumns(db) {
  const added = [];

  for (const [table, def] of Object.entries(TABLES)) {
    let existing;
    try {
      existing = db.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name);
    } catch {
      continue;   // ยังไม่มีตารางนี้ — createTableStatements จะสร้างให้เองตอนติดตั้งครั้งแรก
    }
    if (!existing.length) continue;

    for (const [col, kind] of Object.entries(def.columns)) {
      if (existing.includes(col)) continue;

      // ชื่อตารางกับคอลัมน์มาจากนิยามในโค้ดของเราเอง ไม่ได้มาจากผู้ใช้
      // แต่ยังใส่เครื่องหมายคำพูดครอบไว้ เผื่อชื่อไปตรงกับคำสงวนของ SQLite
      db.exec('ALTER TABLE ' + table + ' ADD COLUMN "' + col + '" ' + sqlType(kind));
      added.push(table + '.' + col);
    }
  }

  return added;
}

/**
 * ซ่อมแผนล้างที่ค่าเลื่อนคอลัมน์ — ผลของบั๊กเดิมใน createCleaningPlan
 *
 * ============================================================================
 * เกิดอะไรขึ้น
 * ============================================================================
 * createCleaningPlan เขียนแถวเป็น "ลำดับช่อง" ตามแบบชีตเดิม ซึ่งรอบหนึ่งมี 6 ช่อง
 * แต่ตาราง plans มี R*_FormUrl ต่อท้ายทุกรอบ (รอบละ 7 ช่อง) ค่าจึงเลื่อน:
 * รอบ 1 ตรง · รอบ 2 เลื่อนไป 1 ช่อง · รอบ 3 เลื่อนไป 2 ช่อง
 *
 *   ช่องจริง        ได้ค่าอะไรไป
 *   R2_ActualDate   ราคาของรอบ 2
 *   R2_Technician   "รอดำเนินการ" (สถานะ)
 *   R3_PlanDate     ราคาของรอบ 3
 *   R3_Price        "รอดำเนินการ" (ตัวเลขรับไม่ได้ กลายเป็นว่าง)
 *   R3_Status       ชื่อคนสร้างแผน
 *
 * แผนที่ย้ายมาจากชีตเดิมไม่โดน เพราะไม่ได้สร้างผ่านฟังก์ชันนั้น
 *
 * ============================================================================
 * ซ่อมอย่างไร
 * ============================================================================
 * ย้ายค่ากลับที่เดิม เฉพาะแถวที่ยังเป็นรูปแบบที่เลื่อนแน่ๆ และยังไม่มีใครแตะรอบนั้น
 * แยกซ่อมทีละรอบ รอบไหนมีคนแก้ไปแล้ว (มีวันที่จริง / สถานะจริง) ไม่แตะรอบนั้น
 * รันซ้ำได้ทุกครั้งที่เปิดเซิร์ฟเวอร์ แถวที่ซ่อมแล้วไม่เข้าเงื่อนไขอีก
 *
 * @returns {number} จำนวนรอบที่ซ่อม
 */
export function repairShiftedPlanRows(db) {
  const STATUSES = new Set(['', 'รอดำเนินการ', 'นัดหมายแล้ว', 'ยกเลิก', 'ล้างเสร็จสิ้น']);
  const text = v => (v == null ? '' : String(v).trim());
  const isPrice = v => /^\d+(\.\d+)?$/.test(text(v));
  const num = v => (isPrice(v) ? Number(text(v)) : null);

  let fixed = 0;
  const rows = db.prepare('SELECT * FROM plans').all();
  const fixR2 = db.prepare(`UPDATE plans SET R2_ActualDate = '', R2_Price = ?, R2_Technician = '',
    R2_Status = 'รอดำเนินการ' WHERE row_id = ?`);
  const fixR3 = db.prepare(`UPDATE plans SET R3_PlanDate = '', R3_Price = ?, R3_Status = 'รอดำเนินการ',
    UpdatedBy = CASE WHEN COALESCE(UpdatedBy, '') = '' THEN ? ELSE UpdatedBy END WHERE row_id = ?`);

  db.exec('BEGIN');
  try {
    for (const r of rows) {
      // รอบ 2: สถานะไปอยู่ช่องชื่อช่าง ช่องสถานะว่าง ยังไม่มีวันตามแผน และช่องวันที่จริงเป็นราคา (หรือว่าง)
      if (text(r.R2_Technician) === 'รอดำเนินการ' && !text(r.R2_Status) && !text(r.R2_PlanDate) &&
          (isPrice(r.R2_ActualDate) || !text(r.R2_ActualDate)) && r.R2_Price == null) {
        fixR2.run(num(r.R2_ActualDate), r.row_id);
        fixed++;
      }
      // รอบ 3: ช่องสถานะไม่ใช่สถานะที่มีจริง (เป็นชื่อคน) ยังไม่มีวันที่จริง และช่องวันตามแผนเป็นราคา (หรือว่าง)
      if (!STATUSES.has(text(r.R3_Status)) && !text(r.R3_ActualDate) && r.R3_Price == null &&
          (isPrice(r.R3_PlanDate) || !text(r.R3_PlanDate)) && !text(r.R3_Technician)) {
        fixR3.run(num(r.R3_PlanDate), text(r.R3_Status), r.row_id);
        fixed++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return fixed;
}

/**
 * เปลี่ยนเลขเคสงานซ่อมเก่าจาก RC เป็น IC (เจ้าของงานสั่ง — เคสใหม่ออกเป็น IC แล้ว ดู makeCaseId)
 *
 * เลขลำดับคงเดิม RC2609-03 → IC2609-03 เปลี่ยนพร้อมกันทุกที่ที่เก็บเลขเคส
 * (history กับ repair_forms) ในคำสั่งเดียว ไม่งั้นใบของเคสเดียวกันจะแยกเป็นสองเคส
 *
 * ถ้าเลข IC นั้นมีคนใช้ไปแล้ว (เคสใหม่ที่เปิดหลังเปลี่ยนเป็น IC ในเดือนเดียวกัน)
 * ให้เลขถัดไปที่ว่างของเดือนนั้นแทน — ห้ามชน เพราะสองเคสจะกลายเป็นเคสเดียว
 *
 * รันซ้ำได้ทุกครั้งที่เปิดเซิร์ฟเวอร์ ไม่เหลือ RC ก็ไม่ทำอะไร
 * @returns {number} จำนวนเคสที่เปลี่ยนเลข
 */
export function renameRepairCaseIds(db) {
  const TABLES = ['history', 'repair_forms'];
  const ids = new Set();
  for (const t of TABLES) {
    for (const r of db.prepare(`SELECT DISTINCT CaseID FROM ${t} WHERE CaseID IS NOT NULL AND CaseID <> ''`).all()) {
      ids.add(String(r.CaseID).trim());
    }
  }
  const old = [...ids].filter(id => /^RC\d{4}-\d+$/.test(id)).sort();
  if (!old.length) return 0;

  const used = new Set([...ids].filter(id => id.startsWith('IC')));
  const nextFree = stem => {
    let n = 1;
    while (used.has(stem + String(n).padStart(2, '0'))) n++;
    return stem + String(n).padStart(2, '0');
  };

  const updates = TABLES.map(t => db.prepare(`UPDATE ${t} SET CaseID = ? WHERE CaseID = ?`));
  db.exec('BEGIN');
  try {
    for (const id of old) {
      let to = 'IC' + id.slice(2);
      if (used.has(to)) to = nextFree(to.slice(0, to.indexOf('-') + 1));
      used.add(to);
      for (const u of updates) u.run(to, id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return old.length;
}
