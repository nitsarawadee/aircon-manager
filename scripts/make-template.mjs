/**
 * สร้างไฟล์ Template สำหรับกรอกข้อมูลเครื่องปรับอากาศ
 *
 * วิธีรัน:  node scripts/make-template.mjs
 *
 * สร้างจากนิยามใน src/import-spec.js ที่เดียว จึงตรงกับตัวตรวจไฟล์เสมอ
 * ถ้าเพิ่มหรือแก้คอลัมน์ ให้แก้ที่นั่นแล้วรันคำสั่งนี้ใหม่
 *
 * ได้ไฟล์ 2 อย่าง:
 *   aircon-template.csv           ไฟล์เปล่าพร้อมหัวตาราง สำหรับกรอกข้อมูลจริง
 *   aircon-template-ตัวอย่าง.csv   ไฟล์เดียวกันแต่มีตัวอย่าง 3 แถวให้ดูรูปแบบ
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COLUMNS, HEADERS, ALLOWED, makeAirCode } from '../src/import-spec.js';
import { toCsv, parseCsvObjects } from '../src/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'templates');

mkdirSync(DIR, { recursive: true });

/* ---------------- ไฟล์เปล่าสำหรับกรอกจริง ---------------- */

const blankPath = join(DIR, 'aircon-template.csv');

// กันเขียนทับงานที่กรอกไว้แล้ว
//
// ไฟล์นี้คือไฟล์ที่คนกรอกข้อมูลจริงลงไป ถ้ามีใครเผลอสั่งคำสั่งนี้ซ้ำ
// ข้อมูลที่นั่งกรอกมาทั้งวันจะหายทันทีโดยไม่มีอะไรถาม และกู้ไม่ได้
// เพราะโฟลเดอร์ data/ ไม่ได้ขึ้น git
let keptFilled = 0;
if (existsSync(blankPath)) {
  const { rows } = parseCsvObjects(readFileSync(blankPath, 'utf8'));
  keptFilled = rows.length;
}

// ไฟล์คู่มือกับไฟล์ตัวอย่างไม่มีข้อมูลของผู้ใช้ สร้างใหม่ทับได้เสมอ
// ข้ามเฉพาะไฟล์ที่คนกรอกข้อมูลจริงลงไปแล้วเท่านั้น
if (!keptFilled) writeFileSync(blankPath, toCsv(HEADERS, []), 'utf8');

/* ---------------- ไฟล์ตัวอย่าง ---------------- */

// ตัวอย่างจงใจใช้ Node ที่มีแอร์ 2 ตัว เพราะเป็นรูปแบบที่พบบ่อยที่สุด
// และ Node ที่มีตัวเดียว เพื่อให้เห็นว่ากรอกยังไงทั้งสองแบบ
const samples = [
  {
    Region: '1', Province: 'อ่างทอง', NodeName: 'อ่างทอง', SiteCode: 'ATG-ATG',
    LocationType: 'Shop House', AirNo: '1',
    Brand: 'Carrier', BTU: '18000', ModelIndoor: '42TSAA018', ModelOutdoor: '38TSAA018',
    IndoorAsset: 'AIR00929', IndoorSN: '22505915', OutdoorAsset: 'AIR00930', OutdoorSN: '22600647',
    InstallDate: '2020-03-15', WarrantyExpire: '2023-03-15',
    CleaningPricePerRound: '450', Status: 'ใช้งานปกติ', Note: ''
  },
  {
    Region: '1', Province: 'อ่างทอง', NodeName: 'อ่างทอง', SiteCode: 'ATG-ATG',
    LocationType: 'Shop House', AirNo: '2',
    Brand: 'Carrier', BTU: '18000', ModelIndoor: '42TSAA018', ModelOutdoor: '38TSAA018',
    IndoorAsset: 'AIR00931', IndoorSN: '22505022', OutdoorAsset: 'AIR00932', OutdoorSN: '22600648',
    InstallDate: '2020-03-15', WarrantyExpire: '2023-03-15',
    CleaningPricePerRound: '450', Status: 'ใช้งานปกติ', Note: ''
  },
  {
    Region: '2', Province: 'กาญจนบุรี', NodeName: 'สถานีรถไฟกาญจนบุรี', SiteCode: 'KCB-KCB',
    LocationType: 'Container', AirNo: '1',
    Brand: 'Eminent', BTU: '24000', ModelIndoor: '', ModelOutdoor: '',
    IndoorAsset: 'AIR01050', IndoorSN: '23110088', OutdoorAsset: 'AIR01051', OutdoorSN: '23110089',
    InstallDate: '', WarrantyExpire: '',
    CleaningPricePerRound: '550', Status: 'รอซ่อม', Note: 'คอมเพรสเซอร์มีเสียงดัง'
  }
];

writeFileSync(join(DIR, 'aircon-template-ตัวอย่าง.csv'), toCsv(HEADERS, samples), 'utf8');

/* ---------------- คู่มือกรอก ---------------- */

const rows = COLUMNS.map(c => {
  const allowed = ALLOWED[c.name];
  return '| `' + c.name + '` | ' + c.label + ' | ' +
    (c.required ? '**ต้องมี**' : 'ไม่บังคับ') + ' | ' +
    (allowed ? allowed.map(v => '`' + v + '`').join(' / ') : (c.desc || '')) + ' | `' +
    (c.example || '(เว้นว่าง)') + '` |';
});

const guide = `# วิธีกรอกไฟล์นำเข้าข้อมูลเครื่องปรับอากาศ

> ไฟล์นี้สร้างอัตโนมัติจาก \`src/import-spec.js\`
> ถ้าแก้คอลัมน์ ให้แก้ที่นั่นแล้วสั่ง \`node scripts/make-template.mjs\` ใหม่

## ไฟล์ที่ให้มา

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| \`aircon-template.csv\` | ไฟล์เปล่า มีแต่หัวตาราง — **กรอกข้อมูลจริงลงไฟล์นี้** |
| \`aircon-template-ตัวอย่าง.csv\` | ไฟล์เดียวกันแต่มีตัวอย่าง 3 แถว ไว้ดูว่าหน้าตาที่ถูกต้องเป็นยังไง |

## ⚠️ อ่านก่อนเปิดด้วย Excel

Excel ชอบ "แก้ข้อมูลให้เอง" ตอนบันทึก ซึ่งทำให้ข้อมูลเสียโดยไม่มีอะไรเตือน มี 2 เรื่องที่เจอบ่อยที่สุด

**1. เลขศูนย์นำหน้าหาย** — Serial \`0022505915\` กลายเป็น \`22505915\`

**2. วันที่ถูกแปลงรูปแบบ** — \`2020-03-15\` กลายเป็น \`15/3/2020\`

**วิธีป้องกัน:** ก่อนกรอก ให้เลือกทั้งคอลัมน์ที่เป็นรหัส Serial Asset และวันที่ แล้วตั้งรูปแบบเป็น **ข้อความ (Text)** ก่อน จากนั้นค่อยพิมพ์ข้อมูล

**และก่อนนำเข้าจริง ให้รันตัวตรวจไฟล์เสมอ** ตัวตรวจจับทั้งสองอาการนี้ได้:

\`\`\`bash
node scripts/check-import.mjs data/templates/aircon-template.csv
\`\`\`

## รหัสเครื่องไม่ต้องกรอก ระบบสร้างให้เอง

ระบบสร้างจาก \`SiteCode\` + \`AirNo\` ตามรูปแบบที่ใช้อยู่จริงทั้ง 457 เครื่อง

\`\`\`
SiteCode = ATG-ATG   AirNo = 1   ->   ${makeAirCode('ATG-ATG', 1)}
SiteCode = ATG-ATG   AirNo = 2   ->   ${makeAirCode('ATG-ATG', 2)}
SiteCode = KCB-KCB   AirNo = 1   ->   ${makeAirCode('KCB-KCB', 1)}
\`\`\`

Node ที่มีแอร์ 2 ตัว ให้กรอก **2 แถว** โดยใช้ \`SiteCode\` เดียวกัน แล้วเปลี่ยนแค่ \`AirNo\` เป็น 1 กับ 2

## คอลัมน์ทั้งหมด ${COLUMNS.length} ช่อง

| คอลัมน์ | ความหมาย | บังคับ | ค่าที่ใช้ได้ / คำอธิบาย | ตัวอย่าง |
|---|---|---|---|---|
${rows.join('\n')}

## ข้อแนะนำ

**\`InstallDate\` ควรใส่ให้ครบถ้าหาข้อมูลได้** ตอนนี้ข้อมูลชุดเดโม่ไม่มีวันติดตั้งเลยสักเครื่อง
ทำให้ตัวเลข 2 ตัวบนแดชบอร์ดคือ "เครื่องอายุเกิน 8 ปี" กับ "ใกล้หมดประกัน" ขึ้นศูนย์ตลอด
ถ้าใส่ข้อมูลนี้เข้ามา ทั้งสองตัวจะใช้งานได้ทันทีโดยไม่ต้องแก้ระบบอะไรเลย

**ไม่ต้องกรอกให้ครบทุกช่องในรอบเดียว** ช่องที่ไม่บังคับเว้นว่างไว้ก่อนได้
แล้วค่อยนำเข้าไฟล์ใหม่ทับทีหลังเพื่อเติมข้อมูลเพิ่ม โดยจับคู่ด้วยรหัสเครื่อง

## ⭐ วิธีที่ปลอดภัยที่สุดในการแก้ข้อมูลจำนวนมาก

**อย่าเริ่มจากไฟล์เปล่า ให้โหลดข้อมูลปัจจุบันออกมาแก้แทน**

\`\`\`bash
node scripts/export.mjs
\`\`\`

จะได้ไฟล์ที่มีข้อมูลจริงครบทุกเครื่อง คอลัมน์ถูกต้อง รหัสเครื่องถูกต้องอยู่แล้ว
แก้เฉพาะช่องที่ต้องการใน Excel แล้วนำเข้ากลับได้เลย
ไม่ต้องพิมพ์รหัสเครื่องเอง และไม่มีทางใส่คอลัมน์ผิด

ไฟล์เปล่ายังมีไว้ใช้ตอน **เพิ่มเครื่องใหม่ยกล็อต** ได้เหมือนเดิม

## วิธีนำเข้า

\`\`\`bash
node scripts/import.mjs <ไฟล์.csv>            # ดูอย่างเดียวว่าจะเปลี่ยนอะไร
node scripts/import.mjs <ไฟล์.csv> --apply    # เขียนจริง
\`\`\`

ถ้าไม่ใส่ \`--apply\` จะไม่เขียนอะไรลงฐานข้อมูลเลย ใช้ดูก่อนได้ตลอด
และจะแสดงให้เห็นเลยว่าเครื่องไหนเปลี่ยนช่องไหน จากอะไรเป็นอะไร

**สิ่งที่การนำเข้าไม่ทำ ไม่ว่ากรณีใด**

- ไม่ลบเครื่องที่ไม่ได้อยู่ในไฟล์ (ไฟล์มี 5 แถว อีก 452 เครื่องอยู่ครบ)
- **ช่องที่เว้นว่าง = ไม่ยุ่งกับช่องนั้น ไม่ใช่ล้างค่าเดิมทิ้ง**
- ไม่ล้างพิกัดกับที่อยู่ เพราะไฟล์นำเข้าไม่มีคอลัมน์พวกนี้
- ไม่เขียนอะไรเลยถ้ายังมีข้อผิดพลาดค้างอยู่แม้แต่จุดเดียว
- สำรองข้อมูลให้อัตโนมัติก่อนเขียนทุกครั้ง เก็บไว้ที่ \`data/backups/\` 10 ไฟล์ล่าสุด

## ทยอยเติมข้อมูลทีละรอบได้

ไม่ต้องหาข้อมูลให้ครบทุกช่องก่อนถึงจะนำเข้าได้ กรอกเท่าที่มีแล้วนำเข้าไปก่อนได้เลย
รอบหน้าหาเพิ่มได้ก็กรอกเฉพาะช่องใหม่แล้วนำเข้าซ้ำ ของเดิมจะไม่หาย

\`\`\`
รอบที่ 1   กรอกแค่ Region Province NodeName SiteCode LocationType AirNo
รอบที่ 2   หา Serial กับ Asset มาได้ กรอกเฉพาะช่องนั้น ช่องอื่นเว้นว่าง
รอบที่ 3   หาวันติดตั้งมาได้ กรอกเฉพาะช่องนั้น
\`\`\`

ทุกรอบข้อมูลจะสะสมเพิ่มขึ้นเรื่อยๆ ไม่ทับกันเอง

> **ถ้าต้องการล้างค่าในช่องไหนจริงๆ** ให้ไปลบในหน้าเว็บทีละเครื่อง
> ซึ่งเห็นค่าเดิมอยู่ตรงหน้าและระบบบันทึกประวัติไว้ให้ด้วย
`;

writeFileSync(join(DIR, 'README.md'), guide, 'utf8');

console.log('สร้าง template เรียบร้อยที่ data/templates/');
if (keptFilled) {
  console.log('  aircon-template.csv           ⚠️  ไม่แตะ — มีข้อมูลกรอกไว้แล้ว ' + keptFilled + ' แถว');
  console.log('                                (ถ้าอยากได้ไฟล์เปล่าใหม่ ให้ย้ายไฟล์เดิมไปเก็บที่อื่นก่อน)');
} else {
  console.log('  aircon-template.csv           ไฟล์เปล่าสำหรับกรอกจริง (' + HEADERS.length + ' คอลัมน์)');
}
console.log('  aircon-template-ตัวอย่าง.csv   มีตัวอย่าง ' + samples.length + ' แถว');
console.log('  README.md                     คู่มือกรอกทีละคอลัมน์');
