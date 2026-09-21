import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ที่เก็บไฟล์เอกสารที่ช่างเขียนด้วยมือแล้วถ่ายส่งกลับมา
 *
 * ============================================================================
 * ทำไมย้ายมาเก็บในเครื่อง
 * ============================================================================
 * เดิมไฟล์พวกนี้ถูกส่งไปเก็บบน Google Drive ผ่าน Apps Script ซึ่งเป็นสิ่งเดียว
 * ที่เหลืออยู่ที่ทำให้ระบบยังต้องออกเน็ต ทั้งที่ทุกอย่างอื่นทำงานในเครื่องได้หมดแล้ว
 *
 * เก็บเองแล้วระบบทำงานได้โดยไม่ต้องมีบัญชี Google ไม่ต้องมีคีย์ ไม่ต้องมีเน็ต
 * และไฟล์อยู่ในที่เดียวกับข้อมูลอื่น สำรองทีเดียวได้ครบ
 *
 * ============================================================================
 * ไฟล์ไปอยู่ไหน
 * ============================================================================
 *   <DATA_DIR>/attachments/<ปี>/<เดือน>/<เลขที่เอกสาร>/<ลำดับ>-<ชื่อไฟล์เดิม>
 * เช่น  data/attachments/2026/09/PM2609-03/1-IMG_1234.jpg
 *
 * แยกตามปี/เดือนเหมือนที่เก็บไฟล์ PDF และผูกกับเลขที่เอกสาร ทำให้ลบเอกสาร
 * แล้วลบไฟล์ตามได้ในคำสั่งเดียว และรู้เสมอว่าไฟล์ชุดนี้เป็นของใบไหน
 *
 * ใส่ลำดับนำหน้าชื่อไฟล์ เพราะช่างมักส่งไฟล์ชื่อซ้ำกันมาในคราวเดียว
 * (กล้องมือถือตั้งชื่อเหมือนกันหมด) ถ้าไม่ใส่ ไฟล์หลังจะทับไฟล์แรกเงียบๆ
 *
 * ============================================================================
 * ไฟล์ไม่ได้ถูกเสิร์ฟผ่าน URL สาธารณะ
 * ============================================================================
 * เหตุผลเดียวกับรูปถ่ายและไฟล์ PDF — หน้าเว็บขอไฟล์ผ่านคำสั่งปกติที่ตรวจสิทธิ์แล้ว
 * ไม่มีเส้นทางให้เดาที่อยู่ไฟล์เอาเอง
 */

/** เลขที่เอกสารใช้เป็นชื่อโฟลเดอร์ ต้องปลอดภัยแน่นอน */
const SAFE_DOC = /^[A-Za-z0-9_-]{1,64}$/;

/** โฟลเดอร์ของเอกสารที่ยังไม่รู้วันที่ — ไม่ควรมี เพราะวันที่เป็นช่องบังคับ */
const UNSORTED = 'unsorted';

/** ชนิดไฟล์ที่เดาได้จากนามสกุล เพื่อให้เบราว์เซอร์เปิดดูได้ถูกต้อง */
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', pdf: 'application/pdf'
};

const root = dir => join(dir, 'attachments');

function safeDocNo(docNo) {
  const name = String(docNo || '').trim();
  if (!SAFE_DOC.test(name)) throw new Error('เลขที่เอกสารไม่ถูกรูปแบบ จึงเก็บไฟล์แนบไม่ได้');
  return name;
}

function yearMonth(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})/);
  return m ? [m[1], m[2]] : [UNSORTED, UNSORTED];
}

/**
 * ทำชื่อไฟล์ที่ผู้ใช้ส่งมาให้ปลอดภัย โดยพยายามคงชื่อเดิมไว้ให้มากที่สุด
 *
 * ชื่อไฟล์มาจากเครื่องของผู้ใช้ จึงถือว่าไม่น่าเชื่อถือ ต้องกันไม่ให้พาออกนอก
 * โฟลเดอร์ที่เก็บ และกันชื่อที่ระบบไฟล์ของ Windows รับไม่ได้
 * ตัวอักษรไทยใช้ได้ปกติ เพราะคนตั้งชื่อไฟล์เป็นไทยกันจริง
 */
export function safeFileName(name) {
  const base = String(name || '')
    .split(/[\\/]/).pop()                   // ตัดเส้นทางทิ้ง เหลือเฉพาะชื่อไฟล์
    .replace(/[\u0000-\u001f<>:"|?*]/g, '') // อักขระที่ตั้งชื่อไฟล์ไม่ได้
    .replace(/^\.+/, '')                    // กันชื่อที่ขึ้นต้นด้วยจุด เช่น ".." 
    .trim()
    .slice(0, 100);

  return base || 'file';
}

/** นามสกุลของไฟล์ (ตัวพิมพ์เล็ก) */
const extOf = name => String(name).split('.').pop().toLowerCase();

function docDir(dir, docNo, ymd) {
  const [y, mo] = yearMonth(ymd);
  return join(root(dir), y, mo, safeDocNo(docNo));
}

/**
 * โฟลเดอร์ของเอกสารใบนี้ ถ้าเคยเก็บไฟล์ไว้แล้ว (ไม่ต้องรู้วันที่)
 * @returns {string | null}
 */
export function findAttachmentDir(dir, docNo) {
  const name = safeDocNo(docNo);

  let years;
  try { years = readdirSync(root(dir)); } catch { return null; }

  for (const y of years) {
    let months;
    try { months = readdirSync(join(root(dir), y)); } catch { continue; }
    for (const mo of months) {
      const full = join(root(dir), y, mo, name);
      try {
        if (statSync(full).isDirectory()) return full;
      } catch { /* ไม่ใช่เดือนนี้ */ }
    }
  }
  return null;
}

/**
 * เก็บไฟล์แนบของเอกสารใบหนึ่ง
 *
 * @param {Array} files [{ name, data(base64) }]
 * @returns {Array} [{ name, bytes }] ชื่อไฟล์ที่เก็บจริง (อาจต่างจากชื่อที่ส่งมา)
 */
export function saveAttachments(dir, docNo, ymd, files) {
  const folder = docDir(dir, docNo, ymd);
  mkdirSync(folder, { recursive: true });

  // เริ่มลำดับต่อจากไฟล์ที่มีอยู่ เผื่อแนบเพิ่มทีหลัง จะได้ไม่ทับของเดิม
  let next = 1;
  try { next = readdirSync(folder).length + 1; } catch { /* โฟลเดอร์เพิ่งสร้าง */ }

  const saved = [];
  for (const f of files || []) {
    const bytes = Buffer.from(String((f && f.data) || ''), 'base64');
    if (!bytes.length) throw new Error('ไฟล์ "' + String(f && f.name) + '" ว่างเปล่า');

    const name = next + '-' + safeFileName(f && f.name);
    writeFileSync(join(folder, name), bytes);
    saved.push({ name, bytes: bytes.length });
    next++;
  }
  return saved;
}

/** รายชื่อไฟล์แนบของเอกสารใบหนึ่ง เรียงตามลำดับที่แนบ */
export function listAttachments(dir, docNo) {
  const folder = findAttachmentDir(dir, docNo);
  if (!folder) return [];

  return readdirSync(folder)
    .map(name => {
      let bytes = 0;
      try { bytes = statSync(join(folder, name)).size; } catch { /* ถูกลบระหว่างอ่าน */ }
      return { name, bytes, mime: MIME[extOf(name)] || 'application/octet-stream' };
    })
    .sort((a, b) => (parseInt(a.name, 10) || 0) - (parseInt(b.name, 10) || 0));
}

/**
 * อ่านไฟล์แนบหนึ่งไฟล์
 *
 * เทียบชื่อกับรายการที่มีอยู่จริงเสมอ แทนที่จะเอาชื่อที่ส่งมาไปต่อเป็นเส้นทางตรงๆ
 * ชื่อที่ส่งมาจากหน้าเว็บจึงพาไปอ่านไฟล์นอกโฟลเดอร์ไม่ได้เลย
 *
 * @returns {{ name: string, mime: string, base64: string } | null}
 */
export function readAttachment(dir, docNo, wanted) {
  const folder = findAttachmentDir(dir, docNo);
  if (!folder) return null;

  const found = listAttachments(dir, docNo).find(f => f.name === String(wanted));
  if (!found) return null;

  return { name: found.name, mime: found.mime, base64: readFileSync(join(folder, found.name)).toString('base64') };
}

/** ลบไฟล์แนบทั้งหมดของเอกสารใบหนึ่ง ใช้ตอนลบเอกสาร */
export function removeAttachments(dir, docNo) {
  const folder = findAttachmentDir(dir, docNo);
  if (folder) rmSync(folder, { recursive: true, force: true });
}

/** พื้นที่ที่ไฟล์แนบใช้ไปทั้งหมด */
export function attachmentsDiskUsage(dir) {
  let files = 0, bytes = 0;

  const walk = path => {
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(path, e.name));
      else {
        try { bytes += statSync(join(path, e.name)).size; files++; } catch { /* ถูกลบระหว่างนับ */ }
      }
    }
  };
  walk(root(dir));
  return { files, bytes };
}
