/**
 * ============================================================================
 * อ่าน/เขียนไฟล์ ZIP
 * ============================================================================
 *
 * มีไว้เพื่ออย่างเดียว: แกะไฟล์ .xlsx ต้นฉบับออกมา เติมข้อมูลลงไป แล้วประกอบกลับ
 * (ไฟล์ .xlsx ที่จริงคือไฟล์ ZIP ที่ข้างในเป็น XML หลายไฟล์)
 *
 * ----------------------------------------------------------------------------
 * ทำไมต้องเขียนเอง ทั้งที่มี SheetJS อยู่แล้วในหน้าเว็บ
 * ----------------------------------------------------------------------------
 * SheetJS รุ่นฟรี "เขียนสไตล์ไม่ได้" — สร้างไฟล์ใหม่ออกมาได้แค่ตารางเปล่า
 * ไม่มีเส้นกรอบ ไม่มีตัวหนา ไม่มีโลโก้ ซึ่งใช้เป็นแบบฟอร์มควบคุมไม่ได้
 *
 * วิธีที่ใช้แทนคือไม่สร้างไฟล์ใหม่เลย แต่เอา "ไฟล์ฟอร์มจริง" มาเป็นแม่แบบ
 * แล้วแก้เฉพาะช่องข้อมูลที่ต้องเติม ส่วนอื่น — เส้นกรอบ โลโก้ การตั้งค่าหน้ากระดาษ
 * กรอบวางรูป — ถูกคัดลอกกลับไปแบบไบต์ต่อไบต์ จึงเหมือนต้นฉบับเป๊ะโดยไม่ต้องรู้
 * ด้วยซ้ำว่าข้างในมันเขียนไว้ยังไง
 *
 * ----------------------------------------------------------------------------
 * ทำไมใช้ CompressionStream แทน node:zlib
 * ----------------------------------------------------------------------------
 * ไฟล์นี้อยู่ใน src/ ซึ่งมีกฎว่าห้ามรู้จัก Node.js  node:zlib มีเฉพาะบน Node
 * ส่วน CompressionStream เป็นของมาตรฐานเว็บ มีทั้งบน Node และเบราว์เซอร์
 * โค้ดชุดนี้จึงย้ายไปรันที่ไหนก็ได้โดยไม่ต้องแก้
 * ============================================================================
 */

/* ============================== ตัวเลขประจำ ZIP ============================== */

const SIG_LOCAL = 0x04034b50;   // หัวไฟล์ย่อยแต่ละไฟล์
const SIG_CENTRAL = 0x02014b50; // สารบัญท้ายไฟล์
const SIG_EOCD = 0x06054b50;    // เครื่องหมายจบไฟล์

const METHOD_DEFLATE = 8;

/** บอกว่าชื่อไฟล์ข้างในเข้ารหัสเป็น UTF-8 — จำเป็นเพราะเอกสารมีชื่อชีตภาษาไทย */
const FLAG_UTF8 = 0x0800;

/* ================================== CRC32 ================================== */

/**
 * ตาราง CRC32 มาตรฐาน — ZIP บังคับให้ทุกไฟล์ย่อยมีค่านี้กำกับ
 * ถ้าใส่ผิด Excel จะฟ้องว่าไฟล์เสียและไม่ยอมเปิด
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ============================== บีบอัด/คลายบีบอัด ============================== */

/** ส่งข้อมูลผ่านท่อบีบอัดหรือคลายบีบอัด แล้วรวบผลกลับมาเป็นก้อนเดียว */
async function pipe(bytes, stream) {
  const source = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(source).arrayBuffer());
}

const inflateRaw = bytes => pipe(bytes, new DecompressionStream('deflate-raw'));
const deflateRaw = bytes => pipe(bytes, new CompressionStream('deflate-raw'));

/* ================================ ตัวช่วยอ่าน ================================ */

const u16 = (v, p) => v.getUint16(p, true);
const u32 = (v, p) => v.getUint32(p, true);

/* =================================== อ่าน =================================== */

/**
 * แกะไฟล์ ZIP ออกมาเป็นรายการไฟล์ย่อย
 *
 * อ่านจาก "สารบัญ" ท้ายไฟล์ ไม่ใช่ไล่อ่านหัวไฟล์ย่อยไปเรื่อยๆ เพราะบางโปรแกรม
 * เขียนขนาดไฟล์ไว้ที่หัวเป็น 0 แล้วค่อยบอกขนาดจริงไว้ท้ายก้อนข้อมูล
 * (ธงบิตที่ 3) ถ้าไล่อ่านจากหัวจะหลงทางทันที ส่วนสารบัญมีขนาดจริงเสมอ
 *
 * @param {Uint8Array} bytes เนื้อไฟล์ทั้งก้อน
 * @returns {Promise<Array<{name: string, data: Uint8Array}>>} เรียงตามลำดับในสารบัญ
 */
export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // หาเครื่องหมายจบไฟล์ โดยไล่ย้อนจากท้าย (ท้ายไฟล์อาจมีหมายเหตุต่อท้ายได้ถึง 64KB)
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  for (let p = bytes.length - 22; p >= floor; p--) {
    if (u32(view, p) === SIG_EOCD) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ ZIP (หาท้ายไฟล์ไม่เจอ)');

  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (u32(view, p) !== SIG_CENTRAL) throw new Error('สารบัญไฟล์ ZIP เสียหาย');

    const method = u16(view, p + 10);
    const compressedSize = u32(view, p + 20);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const localAt = u32(view, p + 42);

    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // ข้ามไปอ่านเนื้อจริงที่หัวไฟล์ย่อย — ความยาวส่วนเสริมของหัวไฟล์ย่อย
    // มักไม่เท่ากับของสารบัญ จึงต้องอ่านจากหัวไฟล์ย่อยเอง ใช้ค่าจากสารบัญไม่ได้
    if (u32(view, localAt) !== SIG_LOCAL) throw new Error('หัวไฟล์ย่อยใน ZIP เสียหาย: ' + name);
    const dataAt = localAt + 30 + u16(view, localAt + 26) + u16(view, localAt + 28);
    const raw = bytes.subarray(dataAt, dataAt + compressedSize);

    entries.push({ name, data: method === METHOD_DEFLATE ? await inflateRaw(raw) : raw.slice() });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* =================================== เขียน =================================== */

/**
 * ประกอบไฟล์ ZIP ขึ้นใหม่จากรายการไฟล์ย่อย
 *
 * เขียนแบบง่ายที่สุดที่ Excel ยอมรับ: บีบอัดด้วย deflate ทุกไฟล์
 * ไม่ใส่วันเวลา (ปล่อยเป็น 0) เพราะไฟล์ที่ได้ควรเหมือนเดิมทุกครั้งที่สร้าง
 * จะได้เทียบได้ว่าผลลัพธ์เปลี่ยนเพราะข้อมูลเปลี่ยน ไม่ใช่เพราะสร้างคนละเวลา
 *
 * @param {Array<{name: string, data: Uint8Array}>} entries เรียงตามลำดับที่ต้องการ
 * @returns {Promise<Uint8Array>}
 */
export async function writeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const data = entry.data;
    const packed = await deflateRaw(data);
    const sum = crc32(data);

    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true);          // ต้องการโปรแกรมแกะรุ่น 2.0 ขึ้นไป
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, METHOD_DEFLATE, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    locals.push(local, name, packed);

    const dir = new Uint8Array(46);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, SIG_CENTRAL, true);
    dv.setUint16(4, 20, true);          // สร้างโดยโปรแกรมรุ่น 2.0
    dv.setUint16(6, 20, true);
    dv.setUint16(8, FLAG_UTF8, true);
    dv.setUint16(10, METHOD_DEFLATE, true);
    dv.setUint32(16, sum, true);
    dv.setUint32(20, packed.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    central.push(dir, name);

    offset += local.length + name.length + packed.length;
  }

  const dirBytes = concat(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirBytes.length, true);
  ev.setUint32(16, offset, true);

  return concat([...locals, dirBytes, end]);
}

/** ต่อก้อนไบต์หลายก้อนเป็นก้อนเดียว */
function concat(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
