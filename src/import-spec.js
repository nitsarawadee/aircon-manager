/**
 * นิยามคอลัมน์ของไฟล์นำเข้าข้อมูลเครื่องปรับอากาศ
 *
 * ไฟล์นี้เป็น "แหล่งความจริงเดียว" ของรูปแบบไฟล์นำเข้า
 * ทั้งตัวสร้าง template และตัวตรวจไฟล์อ่านจากที่นี่ที่เดียว
 * จึงเป็นไปไม่ได้ที่ template กับตัวตรวจจะไม่ตรงกัน
 *
 * ถ้าจะเพิ่ม/แก้คอลัมน์ ให้แก้ที่นี่ที่เดียวแล้วสั่งสร้าง template ใหม่
 */

/** ค่าที่ยอมรับได้ของแต่ละคอลัมน์ ตรงกับที่ระบบใช้อยู่จริง */
export const ALLOWED = {
  Region: ['1', '2', '3', '4', '5', '6'],
  LocationType: ['Shop House', 'Container', 'Pole', 'Office', 'Building', 'Warehouse', 'Room'],
  Status: ['ใช้งานปกติ', 'ชำรุด', 'รอซ่อม', 'รื้อถอน/ปลดระวาง', 'Write off']
};

/**
 * คอลัมน์ของไฟล์นำเข้า เรียงตามลำดับที่กรอกสะดวก
 *
 * required  ต้องมีค่า ถ้าว่างจะถือเป็นข้อผิดพลาด
 * kind      ชนิดข้อมูล ใช้ตรวจความถูกต้อง
 * text      บังคับให้เป็นข้อความ (กัน Excel ตัดเลขศูนย์นำหน้าทิ้ง)
 */
export const COLUMNS = [
  { name: 'Region', required: true, kind: 'enum', label: 'ภูมิภาค',
    desc: 'ใส่เลข 1-6 ตามภูมิภาคที่ดูแล', example: '1' },

  { name: 'Province', required: true, kind: 'text', label: 'จังหวัด',
    desc: 'ชื่อจังหวัดที่ตั้ง Node', example: 'อ่างทอง' },

  { name: 'NodeName', required: true, kind: 'text', label: 'ชื่อ Node',
    desc: 'ชื่อสถานีตามที่เรียกกันจริง', example: 'อ่างทอง' },

  { name: 'SiteCode', required: true, kind: 'text', text: true, label: 'รหัสไซต์',
    desc: 'รหัสประจำ Node ใช้สร้างรหัสเครื่องด้วย', example: 'ATG-ATG' },

  { name: 'LocationType', required: true, kind: 'enum', label: 'ประเภทสถานที่',
    desc: 'เลือกจากค่าที่กำหนดไว้เท่านั้น', example: 'Shop House' },

  { name: 'AirNo', required: true, kind: 'int', label: 'เครื่องตัวที่',
    desc: 'เลขเครื่องภายใน Node นั้น เริ่มที่ 1 — ระบบจะสร้างรหัสเครื่องให้เอง เช่น ATG-ATG-AIR-1',
    example: '1' },

  { name: 'Brand', required: false, kind: 'text', label: 'ยี่ห้อ', example: 'Carrier' },
  { name: 'BTU', required: false, kind: 'int', label: 'BTU', example: '18000' },

  { name: 'ModelIndoor', required: false, kind: 'text', text: true, label: 'รุ่นคอยล์เย็น', example: '42TSAA018' },
  { name: 'ModelOutdoor', required: false, kind: 'text', text: true, label: 'รุ่นคอยล์ร้อน', example: '38TSAA018' },

  { name: 'IndoorAsset', required: false, kind: 'text', text: true, label: 'Asset คอยล์เย็น', example: 'AIR00929' },
  { name: 'IndoorSN', required: false, kind: 'text', text: true, label: 'Serial คอยล์เย็น', example: '22505915' },
  { name: 'OutdoorAsset', required: false, kind: 'text', text: true, label: 'Asset คอยล์ร้อน', example: 'AIR00930' },
  { name: 'OutdoorSN', required: false, kind: 'text', text: true, label: 'Serial คอยล์ร้อน', example: '22600647' },

  { name: 'InstallDate', required: false, kind: 'date', label: 'วันที่ติดตั้ง',
    desc: 'รูปแบบ วว/ดด/ปปปป ค.ศ. เช่น 26/04/2018 (26 เม.ย. 2018) — ใส่ได้จะดีมาก เพราะระบบใช้คำนวณอายุเครื่อง',
    example: '26/04/2018' },

  { name: 'WarrantyExpire', required: false, kind: 'date', label: 'วันหมดประกัน',
    desc: 'รูปแบบเดียวกับวันที่ติดตั้ง (วว/ดด/ปปปป ค.ศ.)', example: '26/04/2021' },

  { name: 'CleaningPricePerRound', required: false, kind: 'number', label: 'ค่าล้างต่อรอบ (บาท)',
    desc: 'ใส่เฉพาะตัวเลข ไม่ต้องใส่ลูกน้ำหรือคำว่าบาท', example: '450' },

  { name: 'Status', required: false, kind: 'enum', label: 'สถานะ',
    desc: 'เว้นว่างได้ ระบบจะถือว่า "ใช้งานปกติ"', example: 'ใช้งานปกติ' },

  { name: 'Note', required: false, kind: 'text', label: 'หมายเหตุ', example: '' }
];

/** ชื่อคอลัมน์ทั้งหมด เรียงตามลำดับในไฟล์ */
export const HEADERS = COLUMNS.map(c => c.name);

/**
 * ปรับค่าให้ตรงรูปแบบมาตรฐาน ถ้าต่างกันแค่ตัวพิมพ์ใหญ่เล็กหรือช่องว่าง
 *
 * ทำไมต้องมี: ข้อมูลจริงในระบบมีทั้ง "Shop House" และ "Shop house" ปนกันอยู่
 * ตกค้างมาจากตอนที่ยังพิมพ์มือลง Google Sheets
 *
 * คนที่พิมพ์ "shop house" ย่อมหมายถึงค่าเดียวกันแน่นอน ไม่มีทางหมายถึงอย่างอื่น
 * การปัดตกเป็นข้อผิดพลาดจึงเป็นการกวนคนใช้โดยไม่จำเป็น
 * รับไว้แล้วแก้ให้เป็นรูปแบบมาตรฐานดีกว่า และการแก้นี้จะแสดงในหน้าสรุปให้เห็นด้วย
 *
 * @returns {string} ค่ามาตรฐานถ้าเทียบได้ ไม่งั้นคืนค่าเดิมกลับไปตามที่กรอกมา
 */
export function canonicalize(column, value) {
  const v = String(value ?? '').trim();
  // วันที่: รับ 26/04/2018 (วว/ดด/ปปปป ตาม Template) แล้วเก็บเป็นรูปแบบของระบบ 2018-04-26
  if (DATE_COLUMNS.has(column)) {
    const iso = toIsoDate(v);
    return iso === null ? v : iso;
  }
  const allowed = ALLOWED[column];
  if (!allowed || !v) return v;

  const hit = allowed.find(a => a.toLowerCase() === v.toLowerCase());
  return hit || v;
}

/** คอลัมน์วันที่ของไฟล์นำเข้า */
const DATE_COLUMNS = new Set(COLUMNS.filter(c => c.kind === 'date').map(c => c.name));

/**
 * วันที่จากไฟล์นำเข้า → รูปแบบที่ระบบเก็บ (ปี-เดือน-วัน)
 *
 * รับสองแบบ: 26/04/2018 (วว/ดด/ปปปป ค.ศ. — แบบใน Template · เจ้าของงานเปลี่ยนจาก เดือน/วัน/ปี เมื่อ 15/10/2569)
 * และ 2018-04-26 (แบบที่ไฟล์สำหรับแก้และข้อมูลเดิมใช้)
 * ต้องเป็นวันที่มีอยู่จริง และปี ค.ศ. เท่านั้น — ใส่ปี พ.ศ. เช่น 2561 อายุเครื่องจะเพี้ยนไป 543 ปี
 *
 * @returns {string|null} '' = ว่าง · null = อ่านไม่ได้ / ไม่ใช่วันที่จริง
 */
export function toIsoDate(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  let y, m, d;
  let hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (hit) [y, m, d] = [hit[1], hit[2], hit[3]].map(Number);
  else if ((hit = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v))) [d, m, y] = [hit[1], hit[2], hit[3]].map(Number);
  else return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** สร้างรหัสเครื่องจากรหัสไซต์กับเลขเครื่อง — รูปแบบเดียวกับที่ใช้อยู่จริงทั้ง 457 เครื่อง */
export function makeAirCode(siteCode, airNo) {
  return String(siteCode).trim() + '-AIR-' + String(airNo).trim();
}

/**
 * ตรวจข้อมูลหนึ่งแถว คืนรายการปัญหาที่พบ
 *
 * แยก error (ต้องแก้ก่อนนำเข้า) กับ warn (น่าสงสัย ให้คนดูยืนยัน)
 * เพราะบางอย่างระบบฟันธงแทนคนไม่ได้ เช่น Serial ที่เป็นตัวเลขล้วน
 * อาจถูก Excel ตัดเลขศูนย์นำหน้าทิ้งไปแล้ว หรืออาจไม่มีศูนย์มาแต่แรกก็ได้
 */
export function validateRow(row) {
  const problems = [];
  const add = (level, column, message) => problems.push({ level, column, message });

  for (const col of COLUMNS) {
    const raw = row[col.name];
    const v = raw === undefined || raw === null ? '' : String(raw).trim();

    if (v === '') {
      if (col.required) add('error', col.name, 'ต้องมีค่า ห้ามเว้นว่าง');
      continue;
    }

    if (col.kind === 'enum') {
      const allowed = ALLOWED[col.name];
      // เทียบแบบไม่สนตัวพิมพ์ใหญ่เล็ก เพราะระบบจะปรับให้ตรงมาตรฐานเองตอนนำเข้า
      if (allowed && canonicalize(col.name, v) === v && !allowed.includes(v)) {
        add('error', col.name, `ค่า "${v}" ไม่อยู่ในรายการที่ใช้ได้ (${allowed.join(' / ')})`);
      }
    }

    if (col.kind === 'int' || col.kind === 'number') {
      // เลขที่มีลูกน้ำคั่นหลัก เช่น 18,000 — Excel ใส่ให้เองตอนจัดรูปแบบ
      if (/,/.test(v)) {
        add('error', col.name, `"${v}" มีลูกน้ำคั่นหลัก ให้ใส่เป็นตัวเลขล้วน เช่น ${v.replace(/,/g, '')}`);
      } else if (isNaN(Number(v))) {
        add('error', col.name, `"${v}" ไม่ใช่ตัวเลข`);
      } else if (col.kind === 'int' && !Number.isInteger(Number(v))) {
        add('error', col.name, `"${v}" ต้องเป็นจำนวนเต็ม`);
      }
    }

    if (col.kind === 'date' && toIsoDate(v) === null) {
      // ใส่เดือนก่อนวัน (4/26/2018 แบบ Excel ภาษาอังกฤษ) หรือปี พ.ศ. เป็นอาการที่เจอบ่อยสุด บอกให้ตรงจุด
      const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(v);
      const hint = !slash ? ''
        : Number(slash[2]) > 12 ? ' — ดูเหมือนใส่เดือนก่อนวัน ต้องเป็น วว/ดด/ปปปป'
        : slash[3].length !== 4 ? ' — ปีต้องมี 4 หลัก'
        : Number(slash[3]) > 2400 ? ' — ใช้ปี ค.ศ. ไม่ใช่ พ.ศ.'
        : '';
      add('error', col.name, `"${v}" ไม่ใช่วันที่ที่ถูกต้อง ใช้รูปแบบ วว/ดด/ปปปป ค.ศ. เช่น 26/04/2018` + hint);
    }

    // เลขศูนย์นำหน้าหายเป็นความเสียหายที่มองไม่เห็น ต้องให้คนยืนยันเอง
    if (col.text && /^\d+$/.test(v) && v.length <= 6) {
      add('warn', col.name, `"${v}" เป็นตัวเลขล้วน — ถ้าค่าจริงมีศูนย์นำหน้า Excel อาจตัดทิ้งไปแล้ว ช่วยตรวจสอบ`);
    }
  }

  return problems;
}
