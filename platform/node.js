/**
 * ============================================================================
 * รันระบบบนเครื่องตัวเอง หรือบน server ของบริษัท
 * ============================================================================
 *
 * วิธีเริ่ม:  npm start
 *
 * ไฟล์นี้คือ "ส่วนที่รู้จัก Node.js" ของระบบ ซึ่งมีอยู่แค่ไฟล์เดียว
 * หน้าที่มี 3 อย่างเท่านั้น:
 *   1. อ่านค่าตั้งค่าจากไฟล์ .env
 *   2. เสิร์ฟไฟล์หน้าเว็บจากโฟลเดอร์ web/
 *   3. ส่งคำสั่ง /api/* ต่อให้ src/api.js จัดการ
 *
 * ตรรกะของระบบทั้งหมดอยู่ใน src/ ซึ่งไม่รู้จัก Node.js เลย
 * ตอนย้ายขึ้น cloud ของบริษัทจึงก็อปทั้งโฟลเดอร์ไปวางแล้วสั่ง npm start ได้เลย
 * ไม่ต้องแก้โค้ดอะไร แค่เปลี่ยนค่าในไฟล์ .env
 * ============================================================================
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

import { savePhoto, removePhoto, removeDocPhotos, readDocPhotos } from './photos.js';
import { saveDocFile, readDocFile, removeDocFile, docsDiskUsage } from './docs.js';
import { saveAttachments, listAttachments, readAttachment, removeAttachments, attachmentsDiskUsage }
  from './attachments.js';
import { renderPdf, findBrowser } from './pdf-render.js';
import { webcrypto } from 'node:crypto';

// Node รุ่นเก่ากว่า 20 ยังไม่มี crypto เป็นตัวแปรกลาง แต่โค้ดส่วนกลางใช้ crypto.subtle
// กับ crypto.randomUUID อยู่ (เหมือนที่ใช้บนเบราว์เซอร์และ Cloudflare)
// เติมให้ตรงนี้ทีเดียว โค้ดส่วนอื่นจะได้ไม่ต้องรู้ว่ากำลังรันอยู่บนอะไร
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

const { handleApi, isApiPath } = await import('../src/api.js');
const { LocalState } = await import('../src/local-state.js');
const { backupDatabase, pruneBackups } = await import('./backup.js');
const { addMissingTables, addMissingColumns } = await import('../src/db/migrate.js');

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const WEB_DIR = join(ROOT, 'web');

/**
 * ที่เก็บข้อมูลที่ต้องอยู่ถาวร
 *
 * บนคลาวด์ส่วนใหญ่ ดิสก์ของแอปหายทุกครั้งที่ deploy ใหม่ ทั้งสามอย่างนี้จึงต้อง
 * ชี้ไปที่ volume ที่ผูกไว้ถาวร ไม่งั้นข้อมูลแอร์ ไฟล์สำรอง และ session
 * จะหายทุกครั้งที่ปล่อยเวอร์ชันใหม่
 *
 * ตั้งได้ทีเดียวด้วย DATA_DIR หรือแยกทีละอย่างถ้าต้องการ
 * ค่าเริ่มต้นเป็นโฟลเดอร์ในโปรเจกต์ ซึ่งถูกต้องสำหรับการรันบนเครื่องในออฟฟิศ
 */
function dataPaths(env) {
  const dir = env.DATA_DIR || join(ROOT, 'data');
  return {
    db: env.DB_PATH || join(dir, 'aircon.db'),
    backups: env.BACKUP_DIR || join(dir, 'backups'),
    photos: env.PHOTO_DIR || dir,   // รูปถ่ายอยู่ใต้ <dir>/photos อีกชั้น
    docs: env.DOC_DIR || dir,       // ไฟล์ PDF อยู่ใต้ <dir>/docs/<ปี>/<เดือน>
    attachments: env.ATTACH_DIR || dir,   // ไฟล์แนบอยู่ใต้ <dir>/attachments/<ปี>/<เดือน>
    // ค่าเริ่มต้นยังเป็นไฟล์เดิมที่ราก เพื่อไม่ให้คนที่ล็อกอินค้างไว้หลุดตอนอัปเดต
    sessions: env.SESSION_PATH || join(ROOT, '.sessions.json')
  };
}

/** ขนาดข้อมูลสูงสุดที่รับได้ต่อ 1 คำสั่ง — เผื่อไว้สำหรับการแนบไฟล์เอกสารเข้ากับ Node */
const MAX_BODY_BYTES = 50 * 1024 * 1024;

/** สำรองอัตโนมัติทุก 24 ชั่วโมง
 *  ต้องประกาศไว้เหนือจุดที่ startAutoBackup ถูกเรียก เพราะ const ไม่ถูกยกขึ้นเหมือน function */
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;

/* ============================ อ่านค่าตั้งค่าจาก .env ============================ */

/**
 * อ่านไฟล์ .env แบบง่ายๆ โดยไม่ต้องพึ่งไลบรารีภายนอก
 *
 * รองรับรูปแบบ KEY=VALUE บรรทัดละตัว ใส่เครื่องหมายคำพูดครอบค่าได้
 *
 * ทุกค่าไม่ใส่ก็ได้ ระบบมีค่าเริ่มต้นที่ใช้งานได้ครบ และไม่ต้องต่อเน็ตเลย
 */
async function loadEnvFile(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return {}; // ไม่มีไฟล์ .env ก็ไม่เป็นไร อาจตั้งค่าผ่าน environment variable ของระบบแทน
  }

  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // ตัดเครื่องหมายคำพูดที่ครอบอยู่ออก แต่ไม่แตะ \n ข้างใน
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/* ============================ เสิร์ฟไฟล์หน้าเว็บ ============================ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf'
};

/**
 * เสิร์ฟไฟล์หน้าเว็บ
 *
 * ⚠️ เรื่องแคชสำคัญกว่าที่คิด
 * เดิมสั่งให้เบราว์เซอร์เก็บไฟล์ไว้ 1 ชั่วโมง ซึ่งแปลว่าเปลี่ยนโลโก้หรือแก้หน้าเว็บแล้ว
 * ผู้ใช้จะยังเห็นของเก่าไปอีกชั่วโมงโดยไม่รู้ตัว และคิดว่าระบบไม่ทำงาน
 * (เจอมาแล้วตอนเปลี่ยนไฟล์โลโก้ ต้องกด Ctrl+F5 ถึงจะเห็น)
 *
 * ตอนนี้ให้ถามเซิร์ฟเวอร์ทุกครั้งว่าไฟล์เปลี่ยนหรือยัง (no-cache)
 * ถ้าไม่เปลี่ยนตอบ 304 กลับไปซึ่งไม่มีเนื้อไฟล์ติดไปด้วย จึงเบามาก
 * ระบบนี้รันในวงแลนของบริษัท การถามเพิ่มหนึ่งครั้งไม่มีผลกับความเร็ว
 * แต่การเห็นข้อมูลเก่ามีผลกับความเชื่อถือของทั้งระบบ
 */
async function serveStatic(pathname, res, req) {
  // ตัด query string ออก และแปลง %20 ฯลฯ กลับเป็นตัวอักษรปกติ
  let rel = decodeURIComponent(pathname.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  let filePath = resolve(join(WEB_DIR, rel));

  // กันการไต่ออกนอกโฟลเดอร์ web/ ด้วย ../../ (path traversal)
  // ถ้าไม่เช็ค คนภายนอกจะอ่านไฟล์อะไรก็ได้ในเครื่อง รวมถึงไฟล์ .env ที่มีค่าลับ
  if (filePath !== WEB_DIR && !filePath.startsWith(WEB_DIR + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // ไม่เจอไฟล์ -> ส่งหน้าเว็บหลักกลับไป (หน้าเดียวจบ ไม่มีหลาย path จริง)
    filePath = join(WEB_DIR, 'index.html');
  }

  try {
    const info = await stat(filePath);

    // ใช้เวลาแก้ไขไฟล์เป็นตัวบอกว่าไฟล์เปลี่ยนหรือยัง
    // ตัดเศษมิลลิวินาทีทิ้งก่อน เพราะรูปแบบวันเวลาของ HTTP ละเอียดถึงแค่วินาที
    // ถ้าไม่ตัด การเทียบจะไม่ตรงกันเสมอ แล้วจะไม่มีวันตอบ 304 เลย
    const mtime = new Date(Math.floor(info.mtimeMs / 1000) * 1000);
    const since = req && req.headers['if-modified-since'];

    if (since && new Date(since).getTime() >= mtime.getTime()) {
      res.writeHead(304, { 'Cache-Control': 'no-cache', 'Last-Modified': mtime.toUTCString() }).end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Last-Modified': mtime.toUTCString(),
      // no-cache ไม่ได้แปลว่าห้ามเก็บ แต่แปลว่าเก็บได้และต้องถามก่อนใช้ทุกครั้ง
      'Cache-Control': 'no-cache'
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ไม่พบไฟล์ที่ต้องการ');
  }
}

/* ============================ อ่านข้อมูลที่ส่งมา ============================ */

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('ข้อมูลที่ส่งมาใหญ่เกินกำหนด'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ================================ เริ่มทำงาน ================================ */

const fileEnv = await loadEnvFile(join(ROOT, '.env'));
// ค่าจาก environment ของระบบมาก่อนค่าในไฟล์ .env เสมอ
// เผื่อตอนขึ้น server บริษัทที่มักตั้งค่าลับผ่าน environment ไม่ใช่ไฟล์
const env = { ...fileEnv, ...process.env };
const PATHS = dataPaths(env);

/* ---------------------------- เปิดฐานข้อมูล ----------------------------
   src/ ห้ามเปิดไฟล์เอง การเปิดฐานข้อมูลจึงต้องทำที่นี่แล้วส่งเข้าไปให้
   ------------------------------------------------------------------------ */

const { DatabaseSync } = await import('node:sqlite');
const dbPath = resolve(ROOT, PATHS.db);

if (!existsSync(dbPath)) {
  console.error('\n❌ ไม่พบไฟล์ฐานข้อมูล: ' + dbPath);
  console.error('   ตรวจว่าตั้ง DATA_DIR หรือ DB_PATH ในไฟล์ .env ไว้ถูกที่หรือยัง');
  console.error('   ถ้าเป็นการติดตั้งใหม่ ให้คัดลอกไฟล์ฐานข้อมูลจากเครื่องเดิมมาวางไว้ตรงนี้\n');
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
// WAL ให้หลายคนอ่านพร้อมกันได้ขณะที่มีคนเขียนอยู่
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// ถ้ามีคนเขียนอยู่ ให้รอคิวสูงสุด 5 วินาทีแทนที่จะฟ้องพังทันที
db.exec('PRAGMA busy_timeout = 5000');

console.log('ฐานข้อมูล: ' + dbPath);

// เติมตารางและคอลัมน์ที่โค้ดต้องการแต่ฐานข้อมูลยังไม่มี ก่อนเปิดรับคำสั่งใดๆ
// ตัวอ่านข้อมูลสร้าง SQL จากนิยามในโค้ด ถ้าฐานข้อมูลตามไม่ทัน
// ทุกหน้าที่แตะตารางนั้นจะพังทันที การอัปเดตจึงต้องเหลือแค่รีสตาร์ท
//
// ตารางต้องมาก่อนคอลัมน์เสมอ เพราะตัวเติมคอลัมน์ข้ามตารางที่ยังไม่มีไปเลย
const addedTables = addMissingTables(db);
if (addedTables.length) console.log('สร้างตารางใหม่ในฐานข้อมูล: ' + addedTables.join(', '));

const addedCols = addMissingColumns(db);
if (addedCols.length) console.log('เพิ่มคอลัมน์ใหม่ในฐานข้อมูล: ' + addedCols.join(', '));

startAutoBackup(db, resolve(ROOT, PATHS.backups));

/**
 * ตัวเก็บรูปถ่ายประกอบเอกสาร ที่ส่งเข้าไปให้ src/ ใช้
 *
 * src/ ห้ามแตะระบบไฟล์เอง จึงได้รับเป็นชุดฟังก์ชันแบบนี้แทน
 * เหมือนที่ฐานข้อมูลถูกเปิดที่นี่แล้วส่งเข้าไป
 *
 * ฝั่ง Cloudflare ไม่ส่งตัวนี้เข้าไป ระบบจึงยังทำงานได้ครบ แค่แนบรูปไม่ได้
 * ซึ่งถูกต้อง เพราะที่นั่นไม่มีดิสก์ให้เขียน
 */
const photoRoot = resolve(ROOT, PATHS.photos);
const photos = {
  save: (kind, docNo, unitSlot, index, dataUrl) => savePhoto(photoRoot, kind, docNo, unitSlot, index, dataUrl),
  remove: (kind, docNo, unitSlot, index) => removePhoto(photoRoot, kind, docNo, unitSlot, index),
  removeAll: (kind, docNo) => removeDocPhotos(photoRoot, kind, docNo),
  readAll: (kind, docNo) => readDocPhotos(photoRoot, kind, docNo)
};

/**
 * ตัวแปลงหน้าเอกสารเป็นไฟล์ PDF ที่ส่งเข้าไปให้ src/ ใช้
 *
 * เหตุผลเดียวกับที่เก็บรูป — src/ ห้ามสั่งโปรแกรมอื่นหรือแตะไฟล์ชั่วคราวเอง
 * ไม่มีเบราว์เซอร์ในเครื่อง = ไม่ส่งตัวนี้เข้าไป ระบบยังใช้ได้ครบ
 * แค่ต้องกดเปิดเอกสารแล้วสั่งปริ้นเองแทน
 */
const browserPath = findBrowser(env);
const pdf = browserPath ? {
  // คืนเป็น base64 เลย เพราะ src/ ใช้ Buffer ของ Node ไม่ได้ (ต้องรันบน Cloudflare ได้ด้วย)
  render: async html => (await renderPdf(html, env)).toString('base64'),
  // เบราว์เซอร์เปิดหน้าเอกสารจากไฟล์ชั่วคราว ที่อยู่แบบ /vendor/... จึงหาไฟล์ไม่เจอ
  // ต้องบอกที่อยู่เต็มของเซิร์ฟเวอร์ตัวเองให้ไปดึงฟอนต์และโลโก้
  baseUrl: 'http://127.0.0.1:' + (Number(env.PORT) || 8787)
} : null;

console.log(browserPath
  ? 'แปลงเป็นไฟล์ PDF ได้ (ใช้ ' + browserPath.split(/[\/]/).pop() + ')'
  : 'ไม่พบเบราว์เซอร์ในเครื่อง — เปิดเอกสารแล้วสั่งปริ้นเองได้ แต่กดบันทึกเป็นไฟล์ PDF ไม่ได้');

/**
 * ที่เก็บไฟล์ PDF ของเอกสาร ที่ส่งเข้าไปให้ src/ ใช้
 *
 * เหตุผลเดียวกับที่เก็บรูป — src/ ห้ามแตะระบบไฟล์เอง
 * ฝั่ง Cloudflare ไม่ส่งตัวนี้เข้าไป ระบบยังใช้ได้ครบ แค่ไม่มีสำเนาเก็บบนเซิร์ฟเวอร์
 */
const docRoot = resolve(ROOT, PATHS.docs);
const docs = {
  save: (kind, docNo, date, base64) => saveDocFile(docRoot, kind, docNo, date, base64),
  read: (kind, docNo) => readDocFile(docRoot, kind, docNo),
  remove: (kind, docNo) => removeDocFile(docRoot, kind, docNo)
};

/**
 * ที่เก็บไฟล์เอกสารที่ช่างเขียนมือแล้วถ่ายส่งกลับมา
 *
 * เดิมไฟล์ชุดนี้ถูกส่งไป Google Drive ผ่าน Apps Script ซึ่งเป็นสิ่งสุดท้าย
 * ที่ทำให้ระบบยังต้องออกเน็ต ตอนนี้เก็บลงดิสก์เหมือนรูปถ่ายและไฟล์ PDF
 */
const attachRoot = resolve(ROOT, PATHS.attachments);
const attachments = {
  save: (docNo, date, files) => saveAttachments(attachRoot, docNo, date, files),
  list: docNo => listAttachments(attachRoot, docNo),
  read: (docNo, name) => readAttachment(attachRoot, docNo, name),
  removeAll: docNo => removeAttachments(attachRoot, docNo)
};

/**
 * สำรองฐานข้อมูลทันทีตามคำสั่ง — ใช้ก่อนงานที่เขียนทีละมากๆ เช่นการนำเข้าไฟล์
 *
 * ต่างจากการสำรองอัตโนมัติตรงที่ตัวนี้ "ต้องสำเร็จ" ถึงจะเขียนต่อ
 * เพราะถ้าสำรองไม่ได้แล้วยังเขียนทับข้อมูล 457 เครื่องต่อไป ก็ไม่มีทางย้อนกลับ
 */
const backup = label => {
  const { name } = backupDatabase(db, resolve(ROOT, PATHS.backups), label);
  try { pruneBackups(resolve(ROOT, PATHS.backups)); } catch { /* ลบไฟล์เก่าไม่ได้ ไม่ใช่เรื่องคอขาดบาดตาย */ }
  return name;
};

/** เครื่องมือทั้งหมดที่ส่งเข้าไปให้ src/ ใช้ */
const services = { photos, pdf, docs, attachments, backup };

{
  const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
  const d = docsDiskUsage(docRoot);
  const a = attachmentsDiskUsage(attachRoot);
  console.log('ไฟล์ PDF ของเอกสาร: ' + join(docRoot, 'docs') + ' (' + d.files + ' ไฟล์ ' + mb(d.bytes) + ')');
  console.log('ไฟล์เอกสารแนบ:      ' + join(attachRoot, 'attachments') + ' (' + a.files + ' ไฟล์ ' + mb(a.bytes) + ')');
}

/**
 * สำรองฐานข้อมูลอัตโนมัติ — ตอนเปิดเซิร์ฟเวอร์ครั้งหนึ่ง แล้วทุกวัน
 *
 * ก่อนหน้านี้สำรองเฉพาะตอนรันสคริปต์บำรุงรักษา ซึ่งนานๆ ครั้ง
 * ถ้าไฟล์ฐานข้อมูลเสียหรือมีคนแก้ผิดแล้วรู้ตัวช้า จะย้อนได้แค่ถึงวันที่รันสคริปต์
 * ครั้งล่าสุดเท่านั้น ข้อมูลที่กรอกหลังจากนั้นหายทั้งหมด
 *
 * ใช้ VACUUM INTO ไม่ใช่การคัดลอกไฟล์ เพราะฐานข้อมูลเปิดโหมด WAL อยู่
 * การคัดลอกไฟล์เฉยๆ จะได้สำเนาที่ขาดข้อมูลล่าสุดที่ยังค้างอยู่ใน WAL
 * และ VACUUM INTO อ่านภาพ ณ ขณะนั้นได้โดยไม่ต้องหยุดให้คนอื่นใช้งาน
 *
 * ห้ามให้การสำรองล้มแล้วทำให้ระบบล่ม — ดิสก์เต็มหรือเขียนไม่ได้ ต้องแค่เตือน
 * แล้วให้ระบบทำงานต่อ เพราะการใช้งานประจำวันสำคัญกว่าการสำรองรอบเดียว
 */
function startAutoBackup(db, dir) {
  const once = label => {
    try {
      const { name } = backupDatabase(db, dir, label);
      const removed = pruneBackups(dir);
      console.log('สำรองข้อมูล: ' + name + (removed.length ? ' (ลบไฟล์เก่า ' + removed.length + ' ไฟล์)' : ''));
    } catch (err) {
      console.error('⚠️  สำรองข้อมูลไม่สำเร็จ: ' + String((err && err.message) || err));
    }
  };

  once('เปิดเซิร์ฟเวอร์');

  // ปล่อยให้ตัวจับเวลาไม่กันไม่ให้โปรเซสปิด เวลาสั่งหยุดจะได้ปิดได้ทันที
  const timer = setInterval(() => once('อัตโนมัติรายวัน'), BACKUP_EVERY_MS);
  if (timer.unref) timer.unref();
}

const state = new LocalState(resolve(ROOT, PATHS.sessions));
await state.load();

const PORT = Number(env.PORT) || 8787;

const server = createServer(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0];

  if (!isApiPath(pathname)) {
    return serveStatic(req.url || '/', res, req);
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: 'ต้องเรียกด้วยวิธี POST เท่านั้น' }));
  }

  let payload;
  let status;
  try {
    const body = JSON.parse(await readBody(req));
    ({ status, payload } = await handleApi({ pathname, body, env, state, db, services }));
  } catch (err) {
    status = 400;
    payload = { ok: false, error: String((err && err.message) || 'ข้อมูลที่ส่งมาไม่ถูกต้อง') };
  }

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
});

// ฟังทุกการ์ดเครือข่าย (ไม่ใช่แค่ localhost) เพื่อให้เครื่องอื่นในออฟฟิศเข้าถึงได้
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n✅ ระบบบริหารจัดการเครื่องปรับอากาศ ITEL พร้อมใช้งานแล้ว\n');
  console.log('   เครื่องนี้        http://localhost:' + PORT);

  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log('   เครื่องอื่นในวง  http://' + net.address + ':' + PORT);
      }
    }
  }

  console.log('\n   กด Ctrl+C เพื่อหยุดการทำงาน\n');
});

// บันทึก session ลงไฟล์ก่อนปิด ผู้ใช้จะได้ไม่หลุดล็อกอินตอนรีสตาร์ท server
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log('\nกำลังปิดระบบ...');
    server.close();
    try { await state._save(); } catch { /* ปิดต่อไปแม้บันทึกไม่สำเร็จ */ }
    try { if (db) db.close(); } catch { /* ปิดต่อไป */ }
    process.exit(0);
  });
}
