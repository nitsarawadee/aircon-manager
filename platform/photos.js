import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ที่เก็บรูปถ่ายประกอบเอกสาร
 *
 * ============================================================================
 * ทำไมเก็บเป็นไฟล์ ไม่เก็บในฐานข้อมูล
 * ============================================================================
 * ตัวอ่านข้อมูลของระบบโหลดทั้งตารางขึ้นหน่วยความจำทีเดียว (ดู db/repository.js)
 * ถ้าเก็บรูปไว้ในตาราง ทุกครั้งที่เปิดหน้าเอกสารจะลากรูปทั้งหมดของทุกใบขึ้นมาด้วย
 * ซึ่งจะช้าลงเรื่อยๆ ตามจำนวนเอกสาร จนใช้งานไม่ได้ภายในไม่กี่เดือน
 *
 * ============================================================================
 * ไฟล์ไปอยู่ไหน
 * ============================================================================
 *   <DATA_DIR>/photos/<ชนิดเอกสาร>/<เลขที่เอกสาร>/u<เครื่อง>-<ช่อง>.jpg
 * เช่น  data/photos/cleaning/PM2609-01/u1-3.jpg
 *       data/photos/repair/CM2609-31/u1-3.jpg
 *
 * แยกตามชนิดเอกสารชั้นนอกสุด เพราะงานล้างกับงานซ่อมเป็นคนละแบบฟอร์มควบคุม
 * และคนที่ไปหยิบไฟล์ไปเก็บมักหยิบทีละประเภท ไม่ได้หยิบทั้งกอง
 *
 * แยกโฟลเดอร์ตามเลขเอกสารอีกชั้น เพื่อให้ลบเอกสารแล้วลบรูปตามได้ในคำสั่งเดียว
 * และเปิดดูด้วยตาเวลาต้องตรวจสอบย้อนหลังได้ง่าย
 *
 * ⚠️ ไฟล์ที่เก็บไว้ก่อนมีการแยกชนิด อยู่ที่ <DATA_DIR>/photos/<เลขที่เอกสาร>/
 * ตัวอ่านจึงมองที่เดิมให้ด้วยถ้าหาในที่ใหม่ไม่เจอ ของเก่าจะได้ไม่หายไปเฉยๆ
 *
 * ============================================================================
 * รูปไม่ได้ถูกเสิร์ฟผ่าน URL สาธารณะ
 * ============================================================================
 * หน้าเอกสารฝังรูปลงไปในตัวหน้าเลย (data: URL) แทนที่จะชี้ไปที่ที่อยู่ของไฟล์
 * จึงไม่มีเส้นทางใดที่เปิดรูปได้โดยไม่ผ่านการตรวจสิทธิ์ และไม่มีที่อยู่ให้เดา
 * แลกกับหน้าเอกสารที่ใหญ่ขึ้น ซึ่งยอมรับได้เพราะสร้างใหม่ทุกครั้งที่เปิด
 */

/** ขนาดไฟล์ต่อรูปที่ยอมรับ — หน้าเว็บย่อรูปมาก่อนแล้ว ถ้ายังใหญ่กว่านี้แปลว่าผิดปกติ */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** ชนิดไฟล์ที่รับ พร้อมนามสกุลที่ใช้เก็บ */
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** ชื่อโฟลเดอร์/ไฟล์ต้องปลอดภัย กันการพาออกนอกที่เก็บด้วยชื่อแปลกๆ */
const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

/** ชนิดเอกสารที่มีที่เก็บของตัวเอง */
const KINDS = ['cleaning', 'repair', 'install'];

function kindDir(root, kind) {
  if (!KINDS.includes(kind)) throw new Error('ชนิดเอกสารไม่ถูกต้อง: ' + kind);
  return join(root, 'photos', kind);
}

function docDir(root, kind, docNo) {
  const name = String(docNo || '').trim();
  if (!SAFE.test(name)) throw new Error('เลขที่เอกสารไม่ถูกรูปแบบ จึงเก็บรูปไม่ได้');
  return join(kindDir(root, kind), name);
}

/**
 * ที่เก็บเดิมก่อนมีการแยกชนิดเอกสาร — <DATA_DIR>/photos/<เลขที่เอกสาร>/
 * ใช้เฉพาะตอนอ่านและตอนลบ ของใหม่ไม่เขียนลงที่นี่แล้ว
 */
function legacyDir(root, docNo) {
  const name = String(docNo || '').trim();
  if (!SAFE.test(name)) throw new Error('เลขที่เอกสารไม่ถูกรูปแบบ จึงเก็บรูปไม่ได้');
  return join(root, 'photos', name);
}

/** โฟลเดอร์ที่มีรูปของใบนี้อยู่จริง — ที่ใหม่ก่อน ไม่มีค่อยดูที่เดิม */
function findDir(root, kind, docNo) {
  const now = docDir(root, kind, docNo);
  try { statSync(now); return now; } catch { /* ยังไม่มีที่ใหม่ */ }

  const old = legacyDir(root, docNo);
  try { statSync(old); return old; } catch { return null; }
}

/** ชื่อไฟล์ของช่องรูปหนึ่งช่อง */
function slotName(unitSlot, index, ext) {
  const u = Number(unitSlot), i = Number(index);
  if (![1, 2].includes(u)) throw new Error('เลขเครื่องต้องเป็น 1 หรือ 2');
  if (!Number.isInteger(i) || i < 1 || i > 9) throw new Error('ช่องรูปต้องอยู่ระหว่าง 1 ถึง 9');
  return 'u' + u + '-' + i + '.' + ext;
}

/**
 * แยกข้อมูลรูปออกจาก data URL ที่หน้าเว็บส่งมา
 * @returns {{bytes: Buffer, ext: string, mime: string}}
 */
export function decodePhoto(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) throw new Error('รูปที่ส่งมาไม่ถูกรูปแบบ');

  const mime = m[1].toLowerCase();
  const ext = TYPES[mime];
  if (!ext) throw new Error('รับเฉพาะไฟล์ภาพ JPG, PNG หรือ WEBP เท่านั้น');

  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) throw new Error('ไฟล์ภาพว่างเปล่า');
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new Error('ไฟล์ภาพใหญ่เกิน ' + Math.round(MAX_PHOTO_BYTES / 1024 / 1024) + ' MB');
  }
  return { bytes, ext, mime };
}

/**
 * เก็บรูปหนึ่งช่อง — ทับของเดิมถ้าช่องนั้นมีรูปอยู่แล้ว
 * @returns {{name: string, bytes: number}}
 */
export function savePhoto(root, kind, docNo, unitSlot, index, dataUrl) {
  const { bytes, ext } = decodePhoto(dataUrl);
  const dir = docDir(root, kind, docNo);
  mkdirSync(dir, { recursive: true });

  // ช่องเดียวกันอาจเคยเก็บเป็นนามสกุลอื่น ลบของเดิมก่อนเพื่อไม่ให้เหลือสองไฟล์
  removePhoto(root, kind, docNo, unitSlot, index);

  const name = slotName(unitSlot, index, ext);
  writeFileSync(join(dir, name), bytes);
  return { name, bytes: bytes.length };
}

/** ลบรูปของช่องที่ระบุ (ไม่มีอยู่ก็ไม่เป็นไร) */
export function removePhoto(root, kind, docNo, unitSlot, index) {
  // ลบทั้งที่ใหม่และที่เดิม เผื่อใบนั้นยังเก็บอยู่ที่เดิม
  for (const dir of [docDir(root, kind, docNo), legacyDir(root, docNo)]) {
    for (const ext of Object.values(TYPES)) {
      try { rmSync(join(dir, slotName(unitSlot, index, ext))); } catch { /* ไม่มีไฟล์นั้น */ }
    }
  }
}

/** ลบรูปทั้งหมดของเอกสารใบหนึ่ง ใช้ตอนลบเอกสาร */
export function removeDocPhotos(root, kind, docNo) {
  for (const dir of [docDir(root, kind, docNo), legacyDir(root, docNo)]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ไม่มีโฟลเดอร์ */ }
  }
}

/**
 * อ่านรูปทั้งหมดของเอกสารใบหนึ่ง ออกมาเป็น data URL พร้อมฝังลงหน้าเอกสาร
 *
 * @returns {Object} เช่น { '1-3': 'data:image/jpeg;base64,...' } โดยคีย์คือ เครื่อง-ช่อง
 */
export function readDocPhotos(root, kind, docNo) {
  const dir = findDir(root, kind, docNo);
  if (!dir) return {};

  let files;
  try { files = readdirSync(dir); } catch { return {}; }

  const out = {};
  for (const f of files) {
    const m = f.match(/^u([12])-([1-9])\.(jpg|png|webp)$/);
    if (!m) continue;

    const mime = Object.keys(TYPES).find(k => TYPES[k] === m[3]);
    const bytes = readFileSync(join(dir, f));
    out[m[1] + '-' + m[2]] = 'data:' + mime + ';base64,' + bytes.toString('base64');
  }
  return out;
}

/**
 * พื้นที่ที่รูปใช้ไปทั้งหมด สำหรับดูว่าโตเร็วแค่ไหน
 *
 * เดินลงทุกชั้น เพราะตอนนี้มีทั้งของใหม่ที่ลึกสามชั้น (photos/<ชนิด>/<เลขที่>/ไฟล์)
 * และของเดิมที่ลึกสองชั้น (photos/<เลขที่>/ไฟล์) ปนกันอยู่
 */
export function photosDiskUsage(root) {
  const walk = dir => {
    let out = { files: 0, bytes: 0 };
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }

    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        const sub = walk(full);
        out.files += sub.files;
        out.bytes += sub.bytes;
      } else {
        try { out.bytes += statSync(full).size; out.files++; } catch { /* ถูกลบระหว่างนับ */ }
      }
    }
    return out;
  };

  return walk(join(root, 'photos'));
}
