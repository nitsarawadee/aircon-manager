/**
 * สำรองฐานข้อมูล
 *
 * อยู่ในชั้น platform เพราะแตะระบบไฟล์ ตรรกะใน src/ ห้ามรู้จักเรื่องพวกนี้
 * ใช้ได้ทั้งจากคำสั่ง command line และจากหน้าเว็บ
 *
 * ใช้คำสั่ง VACUUM INTO ของ SQLite แทนการก๊อปไฟล์เอง เพราะ:
 *   - ได้ไฟล์ที่ข้อมูลครบถ้วนแน่นอน แม้มีคนใช้งานเว็บอยู่ในขณะนั้น
 *     (ก๊อปไฟล์ตรงๆ ระหว่างมีคนเขียนอยู่ จะได้ไฟล์ที่เสีย)
 *   - รวมข้อมูลที่ยังค้างอยู่ในไฟล์ WAL เข้ามาให้ด้วย
 *   - ไฟล์ที่ได้เปิดใช้ได้ทันที ไม่ต้องกู้อะไรเพิ่ม
 */

import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** จำนวนไฟล์สำรองที่เก็บไว้ ก่อนจะเริ่มลบตัวเก่าสุดทิ้ง */
/**
 * เก็บไฟล์สำรองไว้กี่ไฟล์
 *
 * 30 เพราะสำรองอัตโนมัติวันละครั้ง จึงย้อนกลับได้ราวหนึ่งเดือน
 * ซึ่งนานพอจะจับความผิดพลาดที่กว่าจะรู้ตัวก็ผ่านไปหลายสัปดาห์
 * (เช่นแก้ข้อมูลผิดไว้ตั้งแต่ต้นเดือน มารู้ตอนทำรายงานสิ้นเดือน)
 * ไฟล์ละไม่ถึงหนึ่งเมกะไบต์ 30 ไฟล์จึงยังไม่ถึง 30 MB
 */
const KEEP = 30;

/** ชื่อไฟล์สำรองที่ระบบสร้าง — ใช้แยกจากไฟล์อื่นที่คนเอามาวางเอง */
const PATTERN = /^aircon-(\d{4}-\d{2}-\d{2}_\d{6})(?:-(.+))?\.db$/;

/**
 * สำรองฐานข้อมูลลงโฟลเดอร์ที่กำหนด
 *
 * @param {import('node:sqlite').DatabaseSync} db ฐานข้อมูลที่เปิดอยู่
 * @param {string} dir โฟลเดอร์ปลายทาง
 * @param {string} [label] คำต่อท้ายชื่อไฟล์ เช่น 'ก่อนนำเข้า'
 * @returns {{path: string, name: string}}
 */
export function backupDatabase(db, dir, label = '') {
  mkdirSync(dir, { recursive: true });

  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const stampText =
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());

  // กันอักขระที่ใช้ในชื่อไฟล์ไม่ได้ และกันไม่ให้ label พาออกนอกโฟลเดอร์
  //
  // ต้องอนุญาต \p{M} ด้วย เพราะสระและวรรณยุกต์ไทย (เช่น ่ ้ ื) นับเป็น "เครื่องหมายประกอบ"
  // ไม่ใช่ "ตัวอักษร" ถ้าไม่ใส่ ชื่อไฟล์ "ก่อนนำเข้า" จะกลายเป็น "ก-อนนำเข-า"
  const safe = String(label).replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  const name = 'aircon-' + stampText + (safe ? '-' + safe : '') + '.db';
  const path = join(dir, name);

  // VACUUM INTO ไม่รับพารามิเตอร์แบบ bind ต้องต่อสตริงเอง
  // จึงต้อง escape เครื่องหมายคำพูดเดี่ยวด้วยการพิมพ์ซ้ำตามกฎของ SQLite
  db.exec("VACUUM INTO '" + path.replace(/'/g, "''") + "'");

  return { path, name };
}

/**
 * ลบไฟล์สำรองเก่าที่เกินจำนวนที่กำหนด
 *
 * ลบเฉพาะไฟล์ที่ระบบตั้งชื่อเองเท่านั้น ไฟล์อื่นที่คนเอามาวางไว้ในโฟลเดอร์นี้
 * จะไม่ถูกแตะเลย เพราะการลบไฟล์ที่ไม่ได้สร้างเองเป็นเรื่องที่ให้อภัยไม่ได้
 *
 * @returns {string[]} ชื่อไฟล์ที่ลบไป
 */
export function pruneBackups(dir, keep = KEEP) {
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];   // ยังไม่มีโฟลเดอร์ = ยังไม่มีอะไรให้ลบ
  }

  const mine = files
    .filter(f => PATTERN.test(f))
    .map(f => ({ name: f, at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);

  const removed = [];
  for (const f of mine.slice(keep)) {
    unlinkSync(join(dir, f.name));
    removed.push(f.name);
  }
  return removed;
}

/** รายชื่อไฟล์สำรองที่มีอยู่ ใหม่สุดขึ้นก่อน */
export function listBackups(dir) {
  try {
    return readdirSync(dir)
      .filter(f => PATTERN.test(f))
      .map(f => {
        const s = statSync(join(dir, f));
        return { name: f, path: join(dir, f), size: s.size, at: s.mtime };
      })
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}
