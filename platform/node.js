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
import { webcrypto } from 'node:crypto';

// Node รุ่นเก่ากว่า 20 ยังไม่มี crypto เป็นตัวแปรกลาง แต่โค้ดส่วนกลางใช้ crypto.subtle
// กับ crypto.randomUUID อยู่ (เหมือนที่ใช้บนเบราว์เซอร์และ Cloudflare)
// เติมให้ตรงนี้ทีเดียว โค้ดส่วนอื่นจะได้ไม่ต้องรู้ว่ากำลังรันอยู่บนอะไร
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

const { handleApi, isApiPath } = await import('../src/api.js');
const { LocalState } = await import('../src/local-state.js');

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const WEB_DIR = join(ROOT, 'web');

/** ขนาดข้อมูลสูงสุดที่รับได้ต่อ 1 คำสั่ง — เผื่อไว้สำหรับการแนบไฟล์เอกสารเข้ากับ Node */
const MAX_BODY_BYTES = 50 * 1024 * 1024;

/* ============================ อ่านค่าตั้งค่าจาก .env ============================ */

/**
 * อ่านไฟล์ .env แบบง่ายๆ โดยไม่ต้องพึ่งไลบรารีภายนอก
 *
 * รองรับรูปแบบ KEY=VALUE บรรทัดละตัว ใส่เครื่องหมายคำพูดครอบค่าได้
 * ⚠️ ค่า GOOGLE_PRIVATE_KEY ต้องอยู่ในบรรทัดเดียว โดยมี \n เป็นตัวอักษรสองตัวคั่น
 *    (คัดลอกมาจากไฟล์ JSON ของ service account ได้ตรงๆ เลย)
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

async function serveStatic(pathname, res) {
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
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      // หน้าเว็บหลักห้ามแคช ไม่งั้นผู้ใช้จะยังเห็นเวอร์ชันเก่าหลังอัปเดตระบบ
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600'
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

/* ---------------------------- เปิดแหล่งข้อมูล ----------------------------
   src/ ห้ามเปิดไฟล์เอง การเปิดฐานข้อมูลจึงต้องทำที่นี่แล้วส่งเข้าไปให้
   ------------------------------------------------------------------------ */

const useSqlite = String(env.DATA_SOURCE || 'sqlite').toLowerCase() !== 'sheets';
let db = null;

if (useSqlite) {
  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = resolve(ROOT, env.DB_PATH || join('data', 'aircon.db'));

  if (!existsSync(dbPath)) {
    console.error('\n❌ ไม่พบไฟล์ฐานข้อมูล: ' + dbPath);
    console.error('   สร้างด้วยคำสั่ง: node scripts/migrate-from-sheets.mjs');
    console.error('   หรือถ้ายังอยากใช้ Google Sheets ให้ตั้ง DATA_SOURCE=sheets ในไฟล์ .env\n');
    process.exit(1);
  }

  db = new DatabaseSync(dbPath);
  // WAL ให้หลายคนอ่านพร้อมกันได้ขณะที่มีคนเขียนอยู่
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // ถ้ามีคนเขียนอยู่ ให้รอคิวสูงสุด 5 วินาทีแทนที่จะฟ้องพังทันที
  db.exec('PRAGMA busy_timeout = 5000');

  console.log('แหล่งข้อมูล: SQLite (' + dbPath + ')');
} else {
  const missing = ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'SPREADSHEET_ID']
    .filter(k => !env[k]);
  if (missing.length) {
    console.error('\n❌ ตั้ง DATA_SOURCE=sheets ไว้ แต่ยังตั้งค่าไม่ครบ ขาด: ' + missing.join(', '));
    console.error('   คัดลอกไฟล์ .env.example เป็น .env แล้วใส่ค่าให้ครบก่อนครับ\n');
    process.exit(1);
  }
  console.log('แหล่งข้อมูล: Google Sheets');
}

const state = new LocalState(join(ROOT, '.sessions.json'));
await state.load();

const PORT = Number(env.PORT) || 8787;

const server = createServer(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0];

  if (!isApiPath(pathname)) {
    return serveStatic(req.url || '/', res);
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, error: 'ต้องเรียกด้วยวิธี POST เท่านั้น' }));
  }

  let payload;
  let status;
  try {
    const body = JSON.parse(await readBody(req));
    ({ status, payload } = await handleApi({ pathname, body, env, state, db }));
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
