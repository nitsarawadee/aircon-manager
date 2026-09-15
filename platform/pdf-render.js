import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * แปลงหน้าเอกสาร HTML เป็นไฟล์ PDF โดยใช้เบราว์เซอร์ที่ติดตั้งอยู่ในเครื่อง
 *
 * ============================================================================
 * ทำไมใช้เบราว์เซอร์ ไม่เขียนตัวสร้าง PDF เอง
 * ============================================================================
 * โปรเจกต์นี้ไม่พึ่งไลบรารีจาก npm เลยสักตัว การเขียนตัวสร้าง PDF เองที่รองรับ
 * ฟอนต์ไทย (สระลอย วรรณยุกต์ซ้อน) เป็นงานใหญ่มากและพลาดง่าย
 *
 * ส่วนเบราว์เซอร์จัดหน้าและฝังฟอนต์ไทยได้ถูกต้องอยู่แล้ว และ Windows ทุกเครื่อง
 * มี Edge ติดมาให้ จึงไม่ต้องลงอะไรเพิ่มในทางปฏิบัติ
 *
 * ============================================================================
 * ไม่มีเบราว์เซอร์ก็ต้องไม่พัง
 * ============================================================================
 * ถ้าหาเบราว์เซอร์ไม่เจอ ให้โยนข้อความที่บอกทางออกให้ผู้ใช้ชัดเจน
 * (เปิดหน้าเอกสารแล้วสั่งปริ้นเองได้ ซึ่งได้ผลเหมือนกัน)
 * ห้ามทำให้ทั้งระบบใช้ไม่ได้เพราะเครื่องปลายทางไม่มีเบราว์เซอร์
 */

/** เวลาที่ยอมรอเบราว์เซอร์ต่อหนึ่งไฟล์ — เอกสารที่มีรูป 18 ใบใช้เวลาไม่กี่วินาที */
const TIMEOUT_MS = 60000;

/** ที่อยู่ที่เบราว์เซอร์มักติดตั้งอยู่ เรียงตามลำดับที่อยากใช้ */
const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

/**
 * จำผลการค้นหาไว้ แยกตามค่า BROWSER_PATH ที่ส่งเข้ามา
 *
 * ต้องแยกตามค่า ไม่ใช่จำผลเดียวไว้เฉยๆ เพราะถ้าจำผลเดียว การเรียกครั้งที่สอง
 * ด้วยค่าคนละอันจะได้คำตอบของครั้งแรกกลับไป ซึ่งผิด
 * (ในระบบจริงเรียกครั้งเดียวตอนเปิดเซิร์ฟเวอร์ แต่ความถูกต้องไม่ควรขึ้นกับเรื่องนั้น)
 */
const cache = new Map();

/**
 * หาที่อยู่ของเบราว์เซอร์ที่ใช้แปลง PDF ได้
 * ตั้ง BROWSER_PATH ใน .env เพื่อระบุเองได้ ถ้าติดตั้งไว้ที่อื่น
 *
 * @returns {string|null} ที่อยู่ของเบราว์เซอร์ หรือ null ถ้าหาไม่เจอ
 */
export function findBrowser(env = {}) {
  const wanted = String(env.BROWSER_PATH || '').trim();
  if (cache.has(wanted)) return cache.get(wanted);

  const found = wanted
    ? (existsSync(wanted) ? wanted : null)
    : (CANDIDATES.find(p => existsSync(p)) || null);

  cache.set(wanted, found);
  return found;
}

/**
 * แปลงหน้า HTML เป็นไฟล์ PDF
 *
 * @param {string} html หน้าเอกสารเต็มใบ
 * @param {Object} env  ค่าตั้งค่า (ใช้หา BROWSER_PATH)
 * @returns {Promise<Buffer>} เนื้อไฟล์ PDF
 */
export function renderPdf(html, env = {}) {
  const exe = findBrowser(env);
  if (!exe) {
    throw new Error(
      'เครื่องนี้ไม่มีเบราว์เซอร์สำหรับแปลงเป็นไฟล์ PDF — ' +
      'กด "เปิดเอกสาร" แล้วสั่งปริ้นเองได้ผลเหมือนกัน ' +
      '(หรือให้ผู้ดูแลระบบติดตั้ง Chrome/Edge หรือตั้งค่า BROWSER_PATH)'
    );
  }

  // โฟลเดอร์ชั่วคราวแยกต่อหนึ่งครั้ง กันสองคำขอที่ทำพร้อมกันเขียนทับไฟล์กัน
  const dir = mkdtempSync(join(tmpdir(), 'aircon-pdf-'));
  const src = join(dir, 'doc.html');
  const out = join(dir, 'doc.pdf');

  writeFileSync(src, html, 'utf8');

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    // ต้องมีโปรไฟล์ของตัวเอง ไม่งั้นจะไปชนกับเบราว์เซอร์ที่ผู้ใช้เปิดอยู่
    // แล้วคำสั่งจะเงียบหายไปโดยไม่สร้างไฟล์ให้ (เจอมาแล้วตอนทดสอบ)
    '--user-data-dir=' + join(dir, 'profile'),
    '--no-pdf-header-footer',
    '--print-to-pdf=' + out,
    'file:///' + src.replace(/\\/g, '/')
  ];

  return new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: TIMEOUT_MS, windowsHide: true }, err => {
      try {
        // เบราว์เซอร์พ่นคำเตือนลง stderr เป็นปกติ จึงไม่ถือว่าเป็นความผิดพลาด
        // สิ่งที่ตัดสินว่าสำเร็จคือ "มีไฟล์ออกมาหรือไม่" เท่านั้น
        if (!existsSync(out)) {
          const why = err && err.killed ? 'ใช้เวลานานเกินกำหนด' : 'เบราว์เซอร์ไม่ได้สร้างไฟล์ออกมา';
          reject(new Error('แปลงเป็น PDF ไม่สำเร็จ: ' + why));
          return;
        }
        resolve(readFileSync(out));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}
