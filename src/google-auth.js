/**
 * ขอ access token ของ Google API ด้วย Service Account
 *
 * Apps Script ไม่ต้องทำขั้นตอนนี้เพราะรันอยู่ในบัญชี Google อยู่แล้ว
 * แต่พอย้าย backend ออกมาข้างนอก ต้องพิสูจน์ตัวตนกับ Google เอง
 * วิธีมาตรฐานคือสร้าง JWT เซ็นด้วย private key ของ service account
 * แล้วแลกเป็น access token (อายุ 1 ชั่วโมง)
 *
 * อย่าลืม: ต้องแชร์ Google Sheet ให้อีเมลของ service account เป็น "ผู้แก้ไข" ด้วย
 * ไม่งั้นจะได้ error 403 ทั้งที่ token ถูกต้อง
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/** เข้ารหัส base64url (JWT ใช้แบบนี้ ไม่ใช่ base64 ธรรมดา) */
function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * แปลง private key จากรูปแบบ PEM เป็น CryptoKey ที่ WebCrypto ใช้ได้
 *
 * ค่าที่คัดลอกมาจากไฟล์ JSON ของ service account จะมี "\n" เป็นตัวอักษรสองตัว
 * (แบ็กสแลชกับ n) ไม่ใช่การขึ้นบรรทัดจริง จึงต้องแปลงกลับก่อน
 * ไม่งั้น importKey จะพังโดยไม่บอกสาเหตุที่ชัดเจน
 */
async function importPrivateKey(pem) {
  const body = String(pem)
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');

  const raw = Uint8Array.from(atob(body), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    raw,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * ขอ access token ใหม่จาก Google
 * @param {string} clientEmail อีเมลของ service account
 * @param {string} privateKey  private key แบบ PEM
 * @returns {Promise<{token: string, expiresAt: number}>}
 */
export async function fetchAccessToken(clientEmail, privateKey) {
  if (!clientEmail || !privateKey) {
    throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now
  }));

  const key = await importPrivateKey(privateKey);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(header + '.' + claim)
  );

  const jwt = header + '.' + claim + '.' + b64url(sig);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || ('HTTP ' + res.status);
    throw new Error('ขอสิทธิ์เข้าถึง Google Sheets ไม่สำเร็จ: ' + detail);
  }

  return {
    token: data.access_token,
    // เผื่อเวลาไว้ 5 นาที กันกรณี token หมดอายุระหว่างที่ request กำลังทำงานอยู่
    expiresAt: Date.now() + (Number(data.expires_in || 3600) - 300) * 1000
  };
}

/**
 * แคช access token ไว้ในหน่วยความจำของ Worker isolate
 *
 * Worker หนึ่งตัวรับหลาย request ต่อเนื่องกัน จึงใช้ token เดิมซ้ำได้
 * ช่วยตัดการเรียก Google ไป 1 ครั้งต่อ request (ประหยัดราว 150-300 ms)
 * ถ้า isolate ถูกรีไซเคิลก็แค่ขอใหม่ ไม่มีผลเสียอะไร
 */
let cached = null;

export async function getAccessToken(env) {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  cached = await fetchAccessToken(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_PRIVATE_KEY);
  return cached.token;
}
