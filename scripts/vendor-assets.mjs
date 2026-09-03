/**
 * ดาวน์โหลดไฟล์ภายนอกที่หน้าเว็บใช้ มาเก็บไว้ในเครื่อง
 *
 * วิธีรัน:  node scripts/vendor-assets.mjs      (ต้องต่อเน็ตตอนรันคำสั่งนี้เท่านั้น)
 *
 * ทำไมต้องมี: หน้าเว็บโหลด Tailwind ไอคอน ฟอนต์ และกราฟ จากอินเทอร์เน็ต
 * ถ้าเน็ตหลุดหรือเอาไปรันในวงปิด หน้าเว็บจะขึ้นมาแบบไม่มีการจัดรูปแบบเลย
 * ซึ่งขัดกับข้อกำหนดของโปรเจคที่ต้องรันได้โดยไม่ต้องต่อเน็ต
 *
 * เรื่องที่พลาดง่ายและสคริปต์นี้จัดการให้:
 * ไฟล์ CSS ของฟอนต์และไอคอน ข้างในยังอ้างถึงไฟล์ฟอนต์อีกชั้น
 * ถ้าโหลดแค่ CSS มาแล้วจบ ตัวอักษรกับไอคอนจะยังเรียกเน็ตอยู่ดี
 * สคริปต์จึงไล่อ่าน url() ใน CSS แล้วตามไปโหลดไฟล์ฟอนต์มาด้วย
 * พร้อมแก้ path ใน CSS ให้ชี้มาที่ไฟล์ในเครื่อง
 */

import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'web', 'vendor');
const FONT_DIR = join(DIR, 'fonts');

mkdirSync(FONT_DIR, { recursive: true });

/**
 * ขอไฟล์จากเน็ต
 *
 * ต้องส่ง User-Agent ของเบราว์เซอร์สมัยใหม่ไปด้วย เพราะ Google Fonts
 * ดูค่านี้แล้วเลือกส่ง CSS คนละแบบ ถ้าไม่ส่งจะได้ฟอนต์รูปแบบเก่า (ttf)
 * ซึ่งไฟล์ใหญ่กว่าหลายเท่าโดยไม่จำเป็น
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + ' ← ' + url);
  return Buffer.from(await res.arrayBuffer());
}

const kb = n => (n / 1024).toFixed(0) + ' KB';

/** ไฟล์ที่โหลดมาตรงๆ ได้เลย */
const PLAIN = [
  { name: 'tailwind.js', url: 'https://cdn.tailwindcss.com', note: 'Tailwind CSS' },
  { name: 'chart.umd.min.js', url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js', note: 'Chart.js' },
  { name: 'xlsx.full.min.js', url: 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js', note: 'SheetJS (อ่านไฟล์ Excel)' }
];

/** ไฟล์ CSS ที่ต้องตามไปโหลดฟอนต์ที่มันอ้างถึงด้วย */
const CSS = [
  {
    name: 'phosphor.css',
    url: 'https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css',
    note: 'ไอคอน Phosphor (แบบเส้น)'
  },
  {
    name: 'phosphor-fill.css',
    url: 'https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css',
    note: 'ไอคอน Phosphor (แบบทึบ)'
  },
  {
    name: 'fonts.css',
    url: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Sarabun:wght@300;400;500;600;700&display=swap',
    note: 'ฟอนต์ Inter + Sarabun'
  }
];

console.log('ดาวน์โหลดไฟล์ที่หน้าเว็บใช้ มาเก็บไว้ที่ web/vendor/');
console.log();

let total = 0;

/* ---------------- ไฟล์ธรรมดา ---------------- */

for (const f of PLAIN) {
  process.stdout.write('  ' + f.note.padEnd(28));
  const buf = await fetchBuf(f.url);
  writeFileSync(join(DIR, f.name), buf);
  total += buf.length;
  console.log(kb(buf.length).padStart(9) + '   ' + f.name);
}

/* ---------------- CSS ที่ต้องตามโหลดฟอนต์ ---------------- */

const seen = new Map();   // url ของฟอนต์ -> ชื่อไฟล์ในเครื่อง

/**
 * ตัดฟอนต์รูปแบบเก่าออกจาก CSS เหลือแต่ woff2
 *
 * ไฟล์ CSS ของไอคอนใส่ฟอนต์มาให้ 5 รูปแบบ (eot ttf woff woff2 svg)
 * เพื่อรองรับเบราว์เซอร์เก่า ซึ่งรวมกันแล้วเกือบ 8 MB
 * แต่ระบบนี้ใช้ JavaScript สมัยใหม่อยู่แล้ว เบราว์เซอร์ที่เปิดได้
 * รองรับ woff2 ทุกตัว การเก็บอีก 4 รูปแบบจึงเป็นการถ่วงเปล่าๆ
 *
 * ต้องแก้ที่ตัว CSS ด้วย ไม่ใช่แค่ไม่โหลดไฟล์
 * ไม่งั้นเบราว์เซอร์จะพยายามโหลดไฟล์ที่ไม่มีแล้วขึ้น 404 เต็มคอนโซล
 */
function keepWoff2Only(css) {
  return css.replace(/src\s*:\s*([^;}]+)/g, (whole, value) => {
    // ถ้าไม่มี woff2 ในบรรทัดนี้เลย ปล่อยไว้ตามเดิม (เช่นฟอนต์ที่ฝังมาแบบ data:)
    if (!/woff2/.test(value)) return whole;

    const parts = value.split(',').map(s => s.trim()).filter(s => /woff2/.test(s));
    return 'src: ' + parts.join(', ');
  });
}

for (const f of CSS) {
  process.stdout.write('  ' + f.note.padEnd(28));

  let css = keepWoff2Only((await fetchBuf(f.url)).toString('utf8'));
  const urls = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map(m => m[2]);

  let fontBytes = 0;
  for (const raw of urls) {
    if (raw.startsWith('data:')) continue;                 // ฝังมาในไฟล์แล้ว ไม่ต้องโหลด
    const abs = new URL(raw, f.url).href;

    if (!seen.has(abs)) {
      // ตั้งชื่อไฟล์จากชื่อเดิมท้าย URL แล้วกันชนด้วยเลขต่อท้ายถ้าซ้ำ
      const base = (abs.split('/').pop().split('?')[0] || 'font').replace(/[^A-Za-z0-9._-]/g, '_');
      let name = base;
      let i = 1;
      while ([...seen.values()].includes(name)) name = base.replace(/(\.[^.]+)$/, '-' + (i++) + '$1');

      const buf = await fetchBuf(abs);
      writeFileSync(join(FONT_DIR, name), buf);
      seen.set(abs, name);
      fontBytes += buf.length;
    }

    // แก้ path ใน CSS ให้ชี้มาที่ไฟล์ในเครื่อง
    css = css.split(raw).join('fonts/' + seen.get(abs));
  }

  writeFileSync(join(DIR, f.name), css, 'utf8');
  const size = Buffer.byteLength(css) + fontBytes;
  total += size;
  console.log(kb(size).padStart(9) + '   ' + f.name + (urls.length ? '  (+ ฟอนต์ ' + urls.length + ' ไฟล์)' : ''));
}

console.log();
console.log('รวม ' + kb(total) + ' · ไฟล์ฟอนต์ ' + seen.size + ' ไฟล์');
console.log();
console.log('ขั้นตอนต่อไป: แก้ web/index.html ให้ชี้มาที่ vendor/ แทน แล้วทดสอบแบบตัดเน็ต');
