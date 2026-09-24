import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ที่เก็บไฟล์ PDF ของเอกสารบันทึกผลการล้าง
 *
 * ============================================================================
 * ทำไมกลับมาเก็บไฟล์ไว้ ทั้งที่เคยตั้งใจไม่เก็บ
 * ============================================================================
 * ตอนเลิกใช้ Google Drive ระบบเปลี่ยนมาประกอบเอกสารสดทุกครั้งที่เปิด แล้วไม่เก็บ
 * ไฟล์ไว้เลย เพราะรูปต้นฉบับยังอยู่ครบ การเก็บ PDF ซ้ำอีกชุดจึงเปลืองที่เปล่าๆ
 *
 * แต่เจ้าของงานต้องการให้มี "ตัวไฟล์จริง" อยู่บนเครื่องที่รันระบบด้วย เพื่อให้
 * คัดลอกไปเก็บ ส่งต่อ หรือสำรองเป็นชุดได้โดยไม่ต้องเปิดเว็บทีละใบ ซึ่งเป็น
 * เหตุผลคนละเรื่องกับเหตุผลเดิม จึงเก็บทั้งสองอย่าง: ฐานข้อมูลเป็นตัวจริง
 * ส่วนไฟล์ในโฟลเดอร์นี้เป็นสำเนาที่สร้างใหม่ได้เสมอ
 *
 * ⚠️ พื้นที่จะโตประมาณเท่าตัวของโฟลเดอร์รูปถ่าย เพราะรูปถูกฝังลงใน PDF ด้วย
 *
 * ============================================================================
 * ไฟล์ไปอยู่ไหน
 * ============================================================================
 *   <DATA_DIR>/docs/<ปี>/<เดือน>/<เลขที่เอกสาร>.pdf
 * เช่น  data/docs/2026/09/PM2609-01.pdf
 *
 * แยกตามปี/เดือนเพื่อให้โฟลเดอร์เดียวไม่บวมจนเปิดไม่ไหว และคัดลอกไปเก็บ
 * เป็นชุดต่อเดือนได้ง่าย ซึ่งเป็นวิธีที่คนเก็บเอกสารกระดาษคุ้นอยู่แล้ว
 *
 * ============================================================================
 * ไฟล์ไม่ได้ถูกเสิร์ฟผ่าน URL สาธารณะ
 * ============================================================================
 * เหตุผลเดียวกับรูปถ่าย — ไม่มีเส้นทางใดเปิดไฟล์ได้โดยไม่ผ่านการตรวจสิทธิ์
 * หน้าเว็บขอไฟล์ผ่านคำสั่งปกติ แล้วเซิร์ฟเวอร์ส่งเนื้อไฟล์กลับไปให้
 */

/** ชื่อไฟล์ต้องปลอดภัย กันการพาออกนอกที่เก็บด้วยชื่อแปลกๆ */
const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

/** โฟลเดอร์ของเอกสารที่ยังไม่รู้วันที่ — ไม่ควรมี เพราะวันที่เป็นช่องบังคับ */
const UNSORTED = 'unsorted';

/** ชนิดเอกสารที่มีที่เก็บของตัวเอง */
const KINDS = ['cleaning', 'repair', 'install'];

const root = (dir, kind) => {
  if (!KINDS.includes(kind)) throw new Error('ชนิดเอกสารไม่ถูกต้อง: ' + kind);
  return join(dir, 'docs', kind);
};

/** ที่เก็บเดิมก่อนมีการแยกชนิดเอกสาร — ใช้เฉพาะตอนอ่านและตอนลบ */
const legacyRoot = dir => join(dir, 'docs');

function safeDocNo(docNo) {
  const name = String(docNo || '').trim();
  if (!SAFE.test(name)) throw new Error('เลขที่เอกสารไม่ถูกรูปแบบ จึงเก็บไฟล์ไม่ได้');
  return name;
}

/** [ปี, เดือน] จากวันที่ของเอกสาร — วันที่เพี้ยนก็ยังต้องเก็บไฟล์ได้ ไม่ใช่โยนทิ้ง */
function yearMonth(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})/);
  return m ? [m[1], m[2]] : [UNSORTED, UNSORTED];
}

/**
 * ที่อยู่ของไฟล์เอกสารใบนี้ ถ้ามีเก็บไว้แล้ว
 * @returns {{full: string, rel: string} | null}
 */
export function findDocFile(dir, kind, docNo) {
  const name = safeDocNo(docNo) + '.pdf';

  // ที่ใหม่ก่อน ไม่เจอค่อยมองที่เดิม (ไฟล์ที่เก็บไว้ก่อนแยกชนิดยังอยู่ที่นั่น)
  for (const [base, rel] of [[root(dir, kind), ['docs', kind]], [legacyRoot(dir), ['docs']]]) {
    let years;
    try { years = readdirSync(base); } catch { continue; }

    for (const y of years) {
      if (KINDS.includes(y)) continue;   // โฟลเดอร์ชนิด ไม่ใช่ปี
      let months;
      try { months = readdirSync(join(base, y)); } catch { continue; }
      for (const mo of months) {
        const full = join(base, y, mo, name);
        try {
          statSync(full);
          return { full, rel: rel.concat([y, mo, name]).join('/') };
        } catch { /* ไม่ใช่เดือนนี้ */ }
      }
    }
  }
  return null;
}

/**
 * เก็บไฟล์ PDF ของเอกสารใบหนึ่ง ทับของเดิมถ้ามีอยู่แล้ว
 *
 * ถ้าเคยเก็บไว้ในเดือนอื่น (เช่นแก้วันที่ของเอกสารภายหลัง) ลบตัวเก่าทิ้งก่อน
 * ไม่งั้นจะเหลือไฟล์ของใบเดียวกันสองที่ แล้วไม่มีใครรู้ว่าอันไหนใหม่กว่า
 *
 * @returns {{rel: string, bytes: number}}
 */
export function saveDocFile(dir, kind, docNo, ymd, base64) {
  const name = safeDocNo(docNo);
  const bytes = Buffer.from(String(base64 || ''), 'base64');
  if (!bytes.length) throw new Error('ไฟล์เอกสารว่างเปล่า จึงไม่เก็บ');

  const [y, mo] = yearMonth(ymd);
  const folder = join(root(dir, kind), y, mo);
  const full = join(folder, name + '.pdf');

  const old = findDocFile(dir, kind, name);
  if (old && old.full !== full) rmSync(old.full, { force: true });

  mkdirSync(folder, { recursive: true });
  writeFileSync(full, bytes);
  return { rel: ['docs', kind, y, mo, name + '.pdf'].join('/'), bytes: bytes.length };
}

/** อ่านไฟล์ที่เก็บไว้ออกมาเป็น base64 (ยังไม่มีไฟล์ก็คืน null) */
export function readDocFile(dir, kind, docNo) {
  const found = findDocFile(dir, kind, docNo);
  if (!found) return null;
  return readFileSync(found.full).toString('base64');
}

/** ลบไฟล์ของเอกสารใบหนึ่ง ใช้ตอนลบเอกสาร (ไม่มีอยู่ก็ไม่เป็นไร) */
export function removeDocFile(dir, kind, docNo) {
  const found = findDocFile(dir, kind, docNo);
  if (found) rmSync(found.full, { force: true });
}

/** พื้นที่ที่ไฟล์เอกสารใช้ไปทั้งหมด สำหรับดูว่าโตเร็วแค่ไหน */
export function docsDiskUsage(dir) {
  // เดินลงทุกชั้น เพราะมีทั้งของใหม่ที่ลึกสี่ชั้น (docs/<ชนิด>/<ปี>/<เดือน>/ไฟล์)
  // และของเดิมที่ลึกสามชั้น (docs/<ปี>/<เดือน>/ไฟล์) ปนกันอยู่
  const walk = folder => {
    const out = { files: 0, bytes: 0 };
    let entries;
    try { entries = readdirSync(folder, { withFileTypes: true }); } catch { return out; }

    for (const e of entries) {
      const full = join(folder, e.name);
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

  return walk(legacyRoot(dir));
}
