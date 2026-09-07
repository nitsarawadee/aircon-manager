/**
 * ตัดภาพมาสคอตให้เหลือเฉพาะส่วนบน แล้วบันทึกเป็นไอคอนแท็บเบราว์เซอร์
 *
 * วิธีรัน:  node scripts/make-favicon.mjs [สัดส่วนที่เก็บ]
 *   เช่น    node scripts/make-favicon.mjs 0.65     (ค่าเริ่มต้น)
 *
 * ทำไมต้องตัด: ไอคอนบนแท็บมีขนาด 16 จุดเท่านั้น เว็บสั่งให้ใหญ่กว่านี้ไม่ได้
 * ภาพมาสคอตเต็มตัวย่อลงมาแล้วตัวกับขากินพื้นที่ไปโดยไม่ช่วยให้จำได้
 * ตัดให้เหลือหัวกับหมวก ทำให้ส่วนที่จำได้ง่ายที่สุดกินพื้นที่เต็มกรอบ
 *
 * เขียนตัวอ่าน/เขียน PNG เองทั้งหมด เพราะโครงการนี้ไม่ใช้ไลบรารีภายนอก
 * ใช้ได้กับ PNG ชนิดตารางสี (3) และ RGB/RGBA (2/6) ที่ความลึก 8 บิต
 * ซึ่งครอบคลุมไฟล์ที่โปรแกรมแก้ภาพทั่วไปบันทึกออกมา
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'web', 'assets', 'mascot.png');
const OUT = join(ROOT, 'web', 'assets', 'favicon.png');

const keep = Number(process.argv[2]) || 0.65;   // เก็บกี่ส่วนจากด้านบน

if (!existsSync(SRC)) {
  console.error('\n❌ ไม่พบไฟล์ต้นฉบับที่ ' + SRC);
  console.error('   วางภาพมาสคอตเต็มตัวไว้ที่นั่นก่อน\n');
  process.exit(1);
}

/* ---------------- อ่านไฟล์ PNG ---------------- */

function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('ไม่ใช่ไฟล์ PNG');

  let p = 8, plte = null, trns = null;
  const idat = [];
  let w, h, depth, colorType, interlace;

  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);

    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;

    p += 12 + len;
  }

  if (depth !== 8) throw new Error('รองรับเฉพาะความลึก 8 บิต (ไฟล์นี้ ' + depth + ')');
  if (interlace) throw new Error('รองรับเฉพาะภาพแบบไม่ interlace');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('ชนิดสี ' + colorType + ' ยังไม่รองรับ');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(h * stride);

  // ถอดตัวกรองของแต่ละบรรทัด (PNG บีบข้อมูลโดยเก็บผลต่างจากพิกเซลข้างเคียง)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0;      // ซ้าย
      const b = prev ? prev[i] : 0;                          // บน
      const c = (prev && i >= channels) ? prev[i - channels] : 0;  // ซ้ายบน
      let v = line[i];

      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[i] = v & 255;
    }
  }

  // แปลงทุกชนิดให้เป็น RGBA เพื่อให้ขั้นตอนถัดไปทำงานแบบเดียวกันหมด
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (colorType === 3) {
      const idx = px[i];
      r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (colorType === 2) {
      r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2];
    } else if (colorType === 6) {
      r = px[i * 4]; g = px[i * 4 + 1]; b = px[i * 4 + 2]; a = px[i * 4 + 3];
    } else if (colorType === 0) {
      r = g = b = px[i];
    } else {
      r = g = b = px[i * 2]; a = px[i * 2 + 1];
    }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }

  return { w, h, rgba };
}

/* ---------------- เขียนไฟล์ PNG ---------------- */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function writePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // ใส่ตัวกรองแบบ 0 (ไม่กรอง) ทุกบรรทัด — ไฟล์ใหญ่ขึ้นเล็กน้อยแต่โค้ดตรงไปตรงมา
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- ตัดและย่อ ---------------- */

const src = readPng(readFileSync(SRC));
const { w: sw, h: sh, rgba: sp } = src;

// หากรอบเนื้อภาพจริง ไม่นับขอบโปร่งใสที่เหลืออยู่รอบๆ
let x0 = sw, x1 = -1, y0 = sh, y1 = -1;
for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
  if (sp[(y * sw + x) * 4 + 3] > 20) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
}
const cw = x1 - x0 + 1;
const chFull = y1 - y0 + 1;
const ch = Math.round(chFull * keep);

// วางลงผืนสี่เหลี่ยมจัตุรัส จัดกึ่งกลาง
const S = 128;
const side = Math.max(cw, ch) * 1.02;
const k = S / side;
const dw = Math.round(cw * k), dh = Math.round(ch * k);
const ox = Math.round((S - dw) / 2), oy = Math.round((S - dh) / 2);

const out = Buffer.alloc(S * S * 4);   // เริ่มจากโปร่งใสทั้งหมด

// ย่อแบบเฉลี่ยพื้นที่ ให้ขอบภาพเนียนกว่าการหยิบพิกเซลเดียว
for (let y = 0; y < dh; y++) {
  for (let x = 0; x < dw; x++) {
    const sx0 = x0 + Math.floor(x / k), sx1 = x0 + Math.min(Math.floor((x + 1) / k), cw - 1);
    const sy0 = y0 + Math.floor(y / k), sy1 = y0 + Math.min(Math.floor((y + 1) / k), ch - 1);

    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = sy0; yy <= sy1; yy++) for (let xx = sx0; xx <= sx1; xx++) {
      const i = (yy * sw + xx) * 4, al = sp[i + 3];
      // คูณสีด้วยค่าความทึบก่อนเฉลี่ย ไม่งั้นขอบภาพจะมีเงาสีแปลกๆ
      r += sp[i] * al; g += sp[i + 1] * al; b += sp[i + 2] * al; a += al; n++;
    }
    const o = ((y + oy) * S + (x + ox)) * 4;
    if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = a / n; }
  }
}

writeFileSync(OUT, writePng(S, S, out));

console.log('สร้างไอคอนเรียบร้อย');
console.log('  ต้นฉบับ     ' + sw + ' x ' + sh + '  (เนื้อภาพ ' + cw + ' x ' + chFull + ')');
console.log('  เก็บส่วนบน  ' + Math.round(keep * 100) + '%  = ' + cw + ' x ' + ch);
console.log('  ไฟล์ที่ได้   ' + S + ' x ' + S + '  → web/assets/favicon.png');
