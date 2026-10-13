/**
 * โครงสร้างฐานข้อมูล SQLite — ตัวแทนของ Google Sheets
 *
 * ============================================================================
 * หลักการออกแบบ: ให้เหมือนของเดิมมากที่สุด
 * ============================================================================
 * ชื่อคอลัมน์ทุกตัวตรงกับหัวตารางในชีตเป๊ะ เพื่อให้โค้ดส่วนธุรกิจทั้ง 7 โมดูล
 * ใช้ต่อได้โดยไม่ต้องแก้แม้แต่บรรทัดเดียว — ความเสี่ยงตอนย้ายจึงต่ำที่สุด
 * (ปรับให้เป็นตารางแบบ normalize สวยงามทีหลังได้ ตอนนี้เอาให้ย้ายสำเร็จก่อน)
 *
 * มี 3 อย่างที่ตั้งใจทำให้ "ดีกว่าเดิม" เพราะได้มาฟรีจากการย้าย:
 *
 *   1. id แทนเลขแถว — ของเดิมใช้ "เลขแถวในชีต" เป็นตัวระบุตัวตน ซึ่งจะเลื่อน
 *      ทุกครั้งที่มีการลบแถว ถ้าสองคนทำงานพร้อมกันมีโอกาสแก้โดนคนละแถวได้
 *      id ของฐานข้อมูลไม่เลื่อนตามการลบ ปัญหานี้จึงหายไปทั้งหมด
 *
 *   2. วันที่เก็บเป็นข้อความ yyyy-MM-dd ตรงๆ — ของเดิม Sheets ส่งวันที่กลับมา
 *      เป็นตัวเลขล้วนซึ่งแยกไม่ออกจากตัวเลขปกติ (เคยทำให้ BTU 36000
 *      กลายเป็นวันที่มาแล้ว) เก็บเป็นข้อความแล้วความกำกวมนี้หมดไป
 *
 *   3. แผนทุกปีอยู่ตารางเดียว — ของเดิมแยกเป็นชีต Plan_2026, Plan_2027
 *      สร้างแผนปีใหม่ตอนนี้คือเพิ่มแถว ไม่ใช่สร้างตารางใหม่
 * ============================================================================
 */

/** คอลัมน์ที่เก็บ "วันที่" (yyyy-MM-dd) */
const D = 'date';
/** คอลัมน์ที่เก็บ "วันที่+เวลา" (yyyy-MM-dd HH:mm:ss) */
const DT = 'datetime';
/** คอลัมน์ที่เก็บ "เวลา" อย่างเดียว (HH:mm) */
const T = 'time';
/** ตัวเลข */
const N = 'number';
/** จริง/เท็จ */
const B = 'boolean';
/** ข้อความ (ค่าเริ่มต้น) */
const S = 'text';

/**
 * นิยามตารางทั้งหมด
 * key = ชื่อตาราง, columns = { ชื่อคอลัมน์: ชนิด }
 * ชื่อคอลัมน์ต้องตรงกับหัวตารางในชีตเดิมทุกตัว
 */
export const TABLES = {
  air_units: {
    sheet: 'AirList',
    columns: {
      AirCode: S, Region: S, Province: S, NodeName: S, SiteCode: S, LocationType: S,
      BTU: N, Brand: S, ModelIndoor: S, ModelOutdoor: S,
      IndoorAsset: S, IndoorSN: S, OutdoorAsset: S, OutdoorSN: S,
      InstallDate: D, WarrantyExpire: D, CleaningPricePerRound: N,
      Status: S, Lat: S, Long: S, Address: S, Note: S,
      UpdatedAt: DT, UpdatedBy: S
    },
    // ค้นหาด้วยรหัสเครื่องและกรองตามภูมิภาคบ่อยที่สุด
    indexes: [['AirCode'], ['Region'], ['NodeName']],
    unique: ['AirCode']
  },

  history: {
    sheet: 'History',
    columns: {
      ID: S, AirCode: S, Date: D, EventType: S, Detail: S,
      Cost: N, Technician: S, Note: S, CreatedAt: DT, RecordedBy: S,
      // เลขเคสงานซ่อม — ทุกใบตั้งแต่เปิดเคสจนปิดเคสถือเลขเดียวกัน
      // ใบที่ไม่ใช่งานซ่อม (ล้างแอร์ ติดตั้ง ย้าย) เว้นว่างไว้
      CaseID: S
    },
    indexes: [['AirCode'], ['Date'], ['EventType'], ['CaseID']]
  },

  /**
   * แผนล้างแอร์ทุกปีรวมอยู่ตารางเดียว โดยมีคอลัมน์ Year เพิ่มเข้ามา
   * คอลัมน์ที่เหลือตรงกับชีต Plan_YYYY เดิมทุกตัว
   */
  plans: {
    sheet: null, // มาจากหลายชีต (Plan_2026, Plan_2027, ...)
    columns: {
      Year: N,
      AirCode: S, NodeName: S, SiteCode: S, BTU: N,
      R1_PlanDate: D, R1_ActualDate: D, R1_Price: N, R1_Technician: S, R1_Status: S, R1_Note: S, R1_FormUrl: S,
      R2_PlanDate: D, R2_ActualDate: D, R2_Price: N, R2_Technician: S, R2_Status: S, R2_Note: S, R2_FormUrl: S,
      R3_PlanDate: D, R3_ActualDate: D, R3_Price: N, R3_Technician: S, R3_Status: S, R3_Note: S, R3_FormUrl: S,
      UpdatedBy: S,
      // ผู้รับเหมาที่มอบหมายงานแต่ละรอบ (ดู PLAN_HEADERS ใน src/schema.js)
      R1_ContractorID: S, R2_ContractorID: S, R3_ContractorID: S,
      // ปีนี้ล้างกี่รอบ (1–3) เลือกตอนสร้างแผน — ว่าง = แผนเก่าก่อนมีตัวเลือกนี้ = 3 รอบ (ดู planRounds)
      Rounds: N
    },
    indexes: [['Year'], ['Year', 'AirCode'], ['NodeName']],
    unique: ['Year', 'AirCode']
  },

  cleaning_forms: {
    sheet: 'CleaningForm',
    columns: {
      ID: S, Date: D, NodeName: S, SiteCode: S, Region: S, Province: S, LocationType: S,
      AirCode1: S, AirCode2: S,
      TimeStart: T, TimeEnd: T, TotalTime: T,
      Unit1_Brand: S, Unit1_BTU: N, Unit1_IndoorSerial: S, Unit1_IndoorAsset: S, Unit1_OutdoorSerial: S, Unit1_OutdoorAsset: S,
      Unit2_Brand: S, Unit2_BTU: N, Unit2_IndoorSerial: S, Unit2_IndoorAsset: S, Unit2_OutdoorSerial: S, Unit2_OutdoorAsset: S,
      ChecklistJSON: S, EquipmentCondition: S, AdditionalNote: S,
      CompanyName: S, TechnicianName: S, SupervisorName: S,
      PdfUrl: S, PdfFileId: S, PhotoUrl: S,
      CreatedAt: DT, RecordedBy: S,
      PlanYear: N, PlanRound: N, Price: N, Price1: N, Price2: N, Source: S,
      DocType: S, DocNo: S,
      // ผลประเมินของเครื่องที่ 2 — ของเครื่องที่ 1 ยังใช้คอลัมน์ EquipmentCondition เดิม
      EquipmentCondition2: S,
      // เลขที่ของเครื่องตัวที่สองในใบเดียวกัน — ของตัวแรกใช้คอลัมน์ DocNo เดิม
      DocNo2: S,
      // เครื่องคู่ไหนของ Node (ดู CLEANFORM_HEADERS)
      SlotBase: N
    },
    indexes: [['AirCode1'], ['AirCode2'], ['Region'], ['CreatedAt']]
  },

  /**
   * เอกสารบันทึกผลการซ่อม ตามแบบฟอร์มควบคุม ITEL-FM-NE-005
   *
   * แยกจาก cleaning_forms เพราะเป็นคนละแบบฟอร์มและช่องแทบไม่ทับกัน
   * (ดูเหตุผลเต็มที่ REPAIRFORM_HEADERS ใน src/schema.js)
   *
   * ⚠️ ลำดับคอลัมน์ต้องตรงกับ REPAIRFORM_HEADERS เป๊ะ มีเทสต์เฝ้าไว้
   */
  repair_forms: {
    sheet: 'RepairForm',
    columns: {
      ID: S, Date: D, NodeName: S, SiteCode: S, Region: S, Province: S, LocationType: S,
      AirCode: S,
      Brand: S, BTU: N, IndoorSerial: S, IndoorAsset: S, OutdoorSerial: S, OutdoorAsset: S,
      Symptom: S, Cause: S, Fix: S,
      ChecklistJSON: S,
      PartsJSON: S,
      Suggestion: S,
      CompanyName: S, TechnicianName: S, SupervisorName: S,
      Cost: N,
      CreatedAt: DT, RecordedBy: S,
      DocNo: S,
      CaseID: S,
      Source: S
    },
    indexes: [['AirCode'], ['Region'], ['CaseID'], ['CreatedAt']]
  },

  /**
   * เอกสารบันทึกผลการติดตั้ง ตามแบบฟอร์มควบคุม ITEL-FM-NE-006
   *
   * สองเครื่องต่อใบเหมือน cleaning_forms แต่เช็คลิสต์คนละชุดและมีผลตรวจรับ
   * (ดูเหตุผลเต็มที่ INSTALLFORM_HEADERS ใน src/schema.js)
   *
   * ⚠️ ลำดับคอลัมน์ต้องตรงกับ INSTALLFORM_HEADERS เป๊ะ มีเทสต์เฝ้าไว้
   */
  install_forms: {
    sheet: 'InstallForm',
    columns: {
      ID: S, Date: D, NodeName: S, SiteCode: S, Region: S, Province: S, LocationType: S,
      AirCode1: S, AirCode2: S,
      TimeStart: S, TimeEnd: S, TotalTime: S,
      Unit1_Brand: S, Unit1_BTU: N, Unit1_IndoorSerial: S, Unit1_IndoorAsset: S,
      Unit1_OutdoorSerial: S, Unit1_OutdoorAsset: S,
      Unit2_Brand: S, Unit2_BTU: N, Unit2_IndoorSerial: S, Unit2_IndoorAsset: S,
      Unit2_OutdoorSerial: S, Unit2_OutdoorAsset: S,
      ChecklistJSON: S,
      AcceptResult1: S, AcceptResult2: S,
      AdditionalNote: S,
      CompanyName: S, TechnicianName: S, SupervisorName: S,
      Cost: N,
      CreatedAt: DT, RecordedBy: S,
      DocNo: S, DocNo2: S,
      // เครื่องคู่ไหนของ Node (ดู INSTALLFORM_HEADERS)
      SlotBase: N,
      Source: S
    },
    indexes: [['AirCode1'], ['AirCode2'], ['Region'], ['CreatedAt']]
  },

  users: {
    sheet: 'Users',
    columns: {
      Email: S, Name: S, Role: S, Regions: S, Permissions: S,
      Active: B, UpdatedAt: DT, UpdatedBy: S,
      Username: S, Password: S, PasswordHash: S, PasswordSalt: S,
      // ผู้รับเหมาที่บัญชีนี้สังกัด — ว่าง = พนักงาน INTERLINK (ใช้สิทธิ์แบบเดิมทุกอย่าง)
      ContractorID: S
    },
    indexes: [['Username']],
    unique: ['Username']
  },

  /**
   * รายชื่อผู้รับเหมา
   *
   * แยกเป็นตารางที่มีรหัส ไม่ใช้ช่องชื่อบริษัทที่พิมพ์เอง เพราะสิทธิ์ของผู้รับเหมา
   * ผูกกับรหัสนี้ ถ้าผูกกับชื่อที่พิมพ์ พิมพ์ต่างกันนิดเดียวก็เห็นงานคนละชุด
   * (ข้อมูลจริงมีชื่อบริษัทเดียวกัน 7 แบบ: T&N / ทีแอนด์เอ็น / เติ้ล ...)
   *
   * ⚠️ ลำดับคอลัมน์ต้องตรงกับ CONTRACTOR_HEADERS เป๊ะ มีเทสต์เฝ้าไว้
   */
  /**
   * ลิงก์กรอกเอกสารซ่อม — เจ้าหน้าที่สร้างแล้วส่งให้ใครก็ได้ (ส่วนใหญ่ผู้รับเหมา)
   * คนที่ถือลิงก์กรอกใบซ่อมของงานนั้นได้โดยไม่ต้องมีบัญชี
   *
   * เก็บแค่แฮชของรหัสในลิงก์ (TokenHash) ไม่เก็บตัวรหัสเอง
   * ถ้าไฟล์ฐานข้อมูลหลุดไป (เช่นไฟล์สำรอง) คนที่ได้ไปก็เอาไปเปิดลิงก์ไม่ได้
   * ผลคือเจ้าหน้าที่ขอดูลิงก์เดิมซ้ำไม่ได้ ต้องสร้างใหม่ (ลิงก์เก่าจะถูกยกเลิกให้)
   *
   * ใช้ได้ครั้งเดียว: ส่งแล้ว UsedAt กับ DocNo มีค่า ลิงก์เหลือแค่เพิ่มรูปกับโหลด PDF
   */
  repair_links: {
    sheet: 'RepairLink',
    columns: {
      ID: S, TokenHash: S, AirCode: S, CreatedAt: DT, CreatedBy: S, ExpiresAt: DT,
      UsedAt: DT, DocNo: S, RevokedAt: DT, RevokedBy: S,
      // ว่าง/'repair' = ลิงก์ใบซ่อม · 'install' = ลิงก์ใบติดตั้ง
      Kind: S,
      // วันนัดให้ช่างเข้าทำงาน — ใส่ตอนสร้างลิงก์ (เลื่อนนัด = สร้างลิงก์ใหม่ ตามที่เจ้าของงานเลือก)
      ApptDate: D
    },
    indexes: [['TokenHash'], ['AirCode']],
    unique: ['ID']
  },

  /**
   * งานซ่อม/ติดตั้งที่มอบหมายให้ผู้รับเหมาประจำ พร้อมวันนัด (ดู modules/assign.js)
   *
   * ผูกกับ "งานครั้งนั้น" ไม่ใช่แค่เครื่อง — RefID = เลขเคสซ่อม (IC…) หรือเลขแถวประวัติ
   * ที่รอเอกสารติดตั้ง พองานนั้นปิด (กรอกเอกสารแล้ว) การมอบหมายก็หมดผลไปเอง
   * งานครั้งถัดไปของเครื่องเดียวกันต้องมอบหมายใหม่ ไม่ติดไปอัตโนมัติ
   * ContractorID ว่าง = ยกเลิกการมอบหมาย (เก็บแถวไว้เป็นร่องรอย)
   * ⚠️ ลำดับคอลัมน์ต้องตรงกับ ASSIGN_HEADERS เป๊ะ มีเทสต์เฝ้าไว้
   */
  job_assignments: {
    sheet: 'JobAssign',
    columns: {
      ID: S, Kind: S, AirCode: S, RefID: S, ContractorID: S, ApptDate: D, Note: S,
      AssignedBy: S, AssignedAt: DT
    },
    indexes: [['ContractorID'], ['AirCode']],
    unique: ['ID']
  },

  /**
   * ขั้นอนุมัติของเอกสาร — หนึ่งแถวต่อเอกสารหนึ่งใบ (ดู modules/approval.js)
   *
   * แยกเป็นตารางของตัวเอง ไม่เพิ่มคอลัมน์ในตารางเอกสารทั้งสาม เพราะ:
   *   - ใบเก่าที่ออกไปก่อนมีขั้นอนุมัติ = ไม่มีแถวที่นี่ = ไม่ต้องอนุมัติ แยกออกง่าย
   *   - กติกาอนุมัติอยู่ที่เดียว ไม่ต้องไปแก้ตารางเอกสารสามที่พร้อมกัน
   *
   * S1 = ผู้รับเหมา (ไม่ต้องกด ใส่ชื่อบัญชีคนกรอกตอนบันทึก) · S2 = Staff
   * S3 = Supervisor หรือ Regional (S3Role บอกว่าใคร) · S4 = Infrastructure
   * ⚠️ ลำดับคอลัมน์ต้องตรงกับ APPROVAL_HEADERS เป๊ะ มีเทสต์เฝ้าไว้
   */
  doc_approvals: {
    sheet: 'DocApproval',
    columns: {
      ID: S, DocKind: S, FormID: S, CreatedAt: DT,
      S1Name: S, S1By: S,
      S2Name: S, S2By: S, S2At: DT,
      S3Name: S, S3By: S, S3Role: S, S3At: DT,
      S4Name: S, S4By: S, S4At: DT
    },
    indexes: [['DocKind', 'FormID']],
    unique: ['ID']
  },

  /**
   * คลังแอร์ — เครื่องเก่าที่ถูกถอดออกจากตำแหน่งตอนเปลี่ยน/ย้ายเครื่อง (ดู modules/warehouse.js)
   * AirCode/Node/Region คือตำแหน่งเดิมที่ถอดออกมา ใช้กรองตามภูมิภาคของผู้ใช้
   * ⚠️ ลำดับคอลัมน์ต้องตรงกับ WAREHOUSE_HEADERS เป๊ะ มีเทสต์เฝ้าไว้
   */
  warehouse_units: {
    sheet: 'Warehouse',
    columns: {
      ID: S, AirCode: S, NodeName: S, SiteCode: S, Region: S, Province: S,
      Brand: S, BTU: N, ModelIndoor: S, ModelOutdoor: S,
      IndoorAsset: S, IndoorSN: S, OutdoorAsset: S, OutdoorSN: S, InstallDate: D, WarrantyExpire: D,
      Status: S, InDate: D, InReason: S, CaseID: S, Note: S,
      WriteOffDate: D, WriteOffBy: S, CreatedAt: DT, CreatedBy: S,
      Remark: S, RemarkBy: S, RemarkAt: DT
    },
    indexes: [['Region'], ['AirCode']],
    unique: ['ID']
  },

  contractors: {
    sheet: 'Contractor',
    columns: {
      ID: S, Name: S, Active: B, Note: S,
      CreatedAt: DT, UpdatedAt: DT, UpdatedBy: S
    },
    indexes: [['ID']],
    unique: ['ID']
  },

  budgets: {
    sheet: 'Budget',
    columns: {
      Year: N, CleaningBudget: N, RepairBudget: N, Note: S, UpdatedAt: DT, UpdatedBy: S
    },
    unique: ['Year']
  },

  /**
   * ค่าตัวเลือกใน dropdown ต่างๆ
   * ชีตเดิมเก็บเป็น 1 คอลัมน์ต่อ 1 ประเภท ซึ่งอ่านยากและเพิ่มประเภทใหม่ลำบาก
   * เปลี่ยนเป็นแนวตั้งแทน: ประเภทอะไร ค่าอะไร ลำดับที่เท่าไหร่
   */
  config_values: {
    sheet: 'Config',
    columns: { Category: S, Value: S, Position: N },
    indexes: [['Category']]
  }
};

/** ชนิดของคอลัมน์ในตารางนั้น คืน 'text' ถ้าไม่รู้จัก */
export function columnKind(table, column) {
  const t = TABLES[table];
  return (t && t.columns[column]) || S;
}

/** คอลัมน์ที่เก็บวันที่/เวลาของตารางนั้น (ใช้ตอนแปลงค่าไป-กลับ) */
export function temporalColumns(table) {
  const cols = (TABLES[table] || {}).columns || {};
  return Object.keys(cols).filter(c => cols[c] === D || cols[c] === DT || cols[c] === T);
}

/** แปลงชนิดของเราเป็นชนิดของ SQLite */
export function sqlType(kind) {
  if (kind === N) return 'REAL';
  if (kind === B) return 'INTEGER';
  return 'TEXT';
}

/** คำสั่ง SQL สร้างตารางทั้งหมด */
export function createTableStatements() {
  const out = [];

  for (const [name, def] of Object.entries(TABLES)) {
    const cols = Object.entries(def.columns)
      .map(([c, kind]) => `  "${c}" ${sqlType(kind)}`)
      .join(',\n');

    // row_id เป็นตัวระบุตัวตนที่ไม่เลื่อนตามการลบแถว ต่างจากเลขแถวในชีต
    //
    // ตั้งชื่อว่า row_id ไม่ใช่ id เพราะชีต History กับ CleaningForm มีคอลัมน์ชื่อ "ID"
    // อยู่แล้ว และ SQLite ไม่แยกตัวพิมพ์เล็ก-ใหญ่ของชื่อคอลัมน์ จะชนกันทันที
    out.push(`CREATE TABLE IF NOT EXISTS ${name} (\n  row_id INTEGER PRIMARY KEY AUTOINCREMENT,\n${cols}\n);`);

    for (const idx of def.indexes || []) {
      out.push(
        `CREATE INDEX IF NOT EXISTS idx_${name}_${idx.join('_')} ON ${name} (${idx.map(c => `"${c}"`).join(', ')});`
      );
    }
    if (def.unique) {
      out.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_${name} ON ${name} (${def.unique.map(c => `"${c}"`).join(', ')});`
      );
    }
  }

  return out;
}
