import { SHEETS, MODULES, REGIONAL_ROLES } from '../schema.js';
import { formatDate, ymdhms } from '../values.js';
import { findOrCreateContractor } from './contractors.js';

/**
 * การเข้าสู่ระบบและการจัดการผู้ใช้งาน
 * พอร์ตมาจากส่วน "USER / PERMISSIONS" ของ Code.gs เดิม
 *
 * ============================================================================
 * รหัสผ่านเก็บอย่างไร
 * ============================================================================
 * รหัสผ่านที่ตั้งใหม่ตั้งแต่นี้ไป จะถูกแปลงเป็นแฮชก่อนเก็บเสมอ และช่องรหัส
 * แบบข้อความธรรมดาจะถูกล้างทิ้ง — เปิดไฟล์ฐานข้อมูลดูตรงๆ จะไม่เห็นรหัสจริงอีก
 *
 * รองรับ 3 รูปแบบตอนตรวจรหัส เพื่อไม่ให้ใครใช้งานไม่ได้ระหว่างเปลี่ยนผ่าน:
 *   1. pbkdf2$...                   แบบใหม่ (ที่ตั้งตั้งแต่นี้ไป)
 *   2. PasswordHash + PasswordSalt  แบบ SHA-256 ยุค Apps Script
 *   3. Password                     ข้อความธรรมดา ของบัญชีเก่าที่ยังไม่ได้แปลง
 *
 * ตรวจแบบแฮชก่อนเสมอ ถ้ามีแฮชอยู่แล้วให้ถือว่าช่องข้อความธรรมดาเป็นของเก่าค้าง
 * ไม่ใช่รหัสที่ใช้ได้ ไม่งั้นการเปลี่ยนรหัสจะไม่มีผลถ้าลืมล้างช่องเก่า
 */

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,50}$/;

/**
 * จำนวนรอบการคำนวณ
 *
 * 600,000 รอบตามคำแนะนำของ OWASP สำหรับ PBKDF2-HMAC-SHA256
 * วัดบนเครื่องที่ใช้งานจริงแล้วได้ราว 110 มิลลิวินาทีต่อครั้ง ซึ่งเกิดแค่ตอนล็อกอิน
 * (ครั้งเดียวต่อ 6 ชั่วโมง) คนใช้ไม่รู้สึก แต่คนที่ไล่เดารหัสจะช้าลงหกแสนเท่า
 *
 * เก็บจำนวนรอบไว้ในตัวแฮชเอง เพื่อให้เพิ่มรอบในอนาคตได้โดยแฮชเก่ายังตรวจได้อยู่
 */
const PBKDF2_ROUNDS = 600000;

/**
 * แฮชรหัสผ่านสำหรับเก็บลงฐานข้อมูล
 *
 * ใช้ PBKDF2 ผ่าน Web Crypto ไม่ใช่ scrypt ของ node:crypto ด้วยเหตุผลทางสถาปัตยกรรม:
 * โค้ดใน src/ ห้ามรู้จักแพลตฟอร์ม เพราะต้องรันได้ทั้งบน Node และบน Cloudflare
 * ซึ่ง Web Crypto มีให้ทั้งสองที่ ส่วน scrypt มีเฉพาะบน Node
 *
 * ผลลัพธ์เป็นข้อความชุดเดียวที่บอกทุกอย่างในตัวเอง — วิธี จำนวนรอบ salt และค่าแฮช
 * จึงไม่ต้องใช้คอลัมน์ salt แยก และเปลี่ยนวิธีในอนาคตได้โดยไม่ต้องแก้ฐานข้อมูล
 */
export async function makePasswordHash(password, rounds = PBKDF2_ROUNDS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, rounds);
  return 'pbkdf2$' + rounds + '$' + toB64(salt) + '$' + toB64(new Uint8Array(bits));
}

/** ตรวจรหัสผ่านกับแฮชรูปแบบใหม่ */
async function verifyPbkdf2(stored, password) {
  const parts = String(stored).split('$');
  if (parts.length !== 4) return false;

  const rounds = Number(parts[1]);
  if (!Number.isInteger(rounds) || rounds < 1000) return false;

  const salt = fromB64(parts[2]);
  if (!salt) return false;

  const bits = await deriveBits(password, salt, rounds);
  return safeEqual(toB64(new Uint8Array(bits)), parts[3]);
}

function deriveBits(password, salt, rounds) {
  return crypto.subtle
    .importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits'])
    .then(key => crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, key, 256
    ));
}

const toB64 = bytes => btoa(String.fromCharCode(...bytes));

function fromB64(text) {
  try {
    return Uint8Array.from(atob(text), c => c.charCodeAt(0));
  } catch {
    return null;   // ข้อมูลในฐานข้อมูลเสีย ถือว่าตรวจไม่ผ่าน ไม่ใช่ทำให้ระบบล้ม
  }
}

/** แฮชแบบ SHA-256 ของยุค Apps Script — เหลือไว้ตรวจบัญชีเก่าเท่านั้น ไม่ใช้เขียนใหม่ */
export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(String(password) + '|' + String(salt));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** เทียบข้อความสองอันแบบใช้เวลาคงที่ กันการเดารหัสผ่านจากเวลาที่ตอบกลับ */
function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/**
 * ตรวจรหัสผ่านของแถวผู้ใช้ รองรับทั้งสามรูปแบบ (ดูคำอธิบายที่หัวไฟล์)
 *
 * เรียงจากใหม่ไปเก่า และตรวจแบบแฮชก่อนข้อความธรรมดาเสมอ
 * ถ้าบัญชีมีแฮชแล้ว แปลว่ารหัสจริงคือแฮชนั้น ช่องข้อความธรรมดาที่อาจค้างอยู่
 * เป็นของเก่าที่ยังไม่ได้ล้าง ไม่ใช่รหัสที่ยังใช้เข้าระบบได้
 */
async function verifyPassword(user, password) {
  const hash = String(user.PasswordHash || '');

  if (hash.startsWith('pbkdf2$')) return verifyPbkdf2(hash, password);
  if (hash) return safeEqual(await hashPassword(password, user.PasswordSalt), hash);
  if (user.Password) return safeEqual(password, user.Password);
  return false;
}

function assertUsernameFormat(name) {
  if (!name) throw new Error('กรุณาระบุ Username');
  if (!USERNAME_RE.test(name)) {
    throw new Error('Username ต้องมีความยาว 3-50 ตัวอักษร และใช้ได้เฉพาะ a-z, A-Z, 0-9, . _ -');
  }
}

/* ============================ เข้าสู่ระบบ ============================ */

/** ระบบยังไม่เคยตั้งค่าผู้ดูแลระบบคนแรกเลยหรือไม่ */
export async function getSystemStatus(ctx) {
  await ctx.ensureBase();
  const list = ctx.ss.objects(SHEETS.USERS);
  const hasAnyCredential = list.some(u => u.Password || u.PasswordHash);
  return { needsSetup: !hasAnyCredential };
}

/**
 * ตั้งค่าเริ่มต้นระบบ: สร้างผู้ดูแลระบบ (Admin) คนแรก
 * ใช้ได้ครั้งเดียวตอนที่ยังไม่มีผู้ใช้คนไหนมีรหัสผ่านเลยเท่านั้น
 */
export async function setupFirstAdmin(ctx, username, password, name) {
  return ctx.withLockNoAuth(async () => {
    await ctx.ensureBase();
    const list = ctx.ss.objects(SHEETS.USERS);
    if (list.some(u => u.Password || u.PasswordHash)) {
      throw new Error('ระบบมีผู้ดูแลระบบอยู่แล้ว กรุณาเข้าสู่ระบบตามปกติ');
    }

    const uname = String(username || '').trim();
    assertUsernameFormat(uname);
    if (!password || String(password).length < 6) {
      throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    }

    const payload = {
      Username: uname, Name: name || uname, Role: 'Admin', Regions: '', Permissions: '',
      Active: true, UpdatedAt: ymdhms(new Date()), UpdatedBy: uname, Email: '',
      // ผู้ดูแลระบบคนแรกก็เก็บเป็นแฮชเหมือนกัน ไม่มีข้อยกเว้น
      PasswordHash: await makePasswordHash(password), PasswordSalt: '', Password: ''
    };

    const headers = ctx.ss.headers(SHEETS.USERS);
    ctx.ss.appendRow(SHEETS.USERS, headers.map(h => (payload[h] !== undefined ? payload[h] : '')));
    await ctx.ss.flush();

    return { token: await ctx.state.createSession(uname) };
  });
}

/** เข้าสู่ระบบด้วย Username/Password คืนค่า session token เมื่อสำเร็จ */
export async function login(ctx, username, password) {
  await ctx.ensureBase();
  const list = ctx.ss.objects(SHEETS.USERS);
  const uname = String(username || '').trim().toLowerCase();
  const found = list.find(u => String(u.Username || '').trim().toLowerCase() === uname);

  if (!found || (!found.Password && !found.PasswordHash)) {
    throw new Error('ไม่พบชื่อผู้ใช้นี้ในระบบ');
  }

  const active = found.Active !== false && String(found.Active).toUpperCase() !== 'FALSE';
  if (!active) {
    throw new Error('บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  }

  if (!(await verifyPassword(found, password))) {
    throw new Error('รหัสผ่านไม่ถูกต้อง');
  }

  return { token: await ctx.state.createSession(String(found.Username)) };
}

/** ออกจากระบบ: ทำลาย session token ปัจจุบัน */
export async function logout(ctx, token) {
  await ctx.state.destroySession(token || ctx.token);
  return true;
}

/** เปลี่ยนรหัสผ่านของบัญชีตัวเอง (ต้องล็อกอินอยู่ และรู้รหัสผ่านเดิม) */
export async function changeOwnPassword(ctx, oldPassword, newPassword) {
  return ctx.withLock(async () => {
    const u = await ctx.sessionUser();
    if (!u) throw new Error('กรุณาเข้าสู่ระบบใหม่อีกครั้ง');

    if (!(await verifyPassword(u, oldPassword))) {
      throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
    }
    if (!newPassword || String(newPassword).length < 6) {
      throw new Error('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
    }

    // เก็บเฉพาะแฮช และล้างสองช่องเดิมทิ้ง ไม่ให้เหลือรหัสจริงค้างในฐานข้อมูล
    // ถ้าไม่ล้าง ตัวตรวจจะยังผ่านด้วยแฮชใหม่ก็จริง แต่รหัสเก่ายังนอนอยู่ในไฟล์
    ctx.ss.writeByHeaders(SHEETS.USERS, u._row, {
      PasswordHash: await makePasswordHash(newPassword),
      PasswordSalt: '',
      Password: '',
      UpdatedAt: ymdhms(new Date())
    });
    await ctx.ss.flush();
    return true;
  });
}

/* ============================ จัดการผู้ใช้ (Admin) ============================ */

export async function getUsers(ctx) {
  await ctx.requireAccess();
  await ctx.assertAdmin();
  await ctx.ensureBase();

  return ctx.ss.objects(SHEETS.USERS).map(o => {
    const out = { ...o, UpdatedAt: formatDate(o.UpdatedAt) };
    // บอกฝั่งหน้าเว็บว่าผู้ใช้นี้ตั้งรหัสผ่านแล้วหรือยัง โดยไม่ส่งรหัสจริงออกไป
    out.HasPassword = !!(o.Password || o.PasswordHash);
    delete out.Password;
    delete out.PasswordHash;
    delete out.PasswordSalt;
    return out;
  });
}

/**
 * บันทึกผู้ใช้ (สร้างใหม่/แก้ไข) — เฉพาะ Admin เท่านั้น (ผู้ใช้สมัครเองไม่ได้)
 * user.Username คือรหัสที่ใช้ Login (แยกจาก Email) และเป็นคีย์หลักที่ห้ามซ้ำ
 * user._row มีค่า = แก้ไขแถวนั้น / ไม่มีค่า = สร้างผู้ใช้ใหม่
 * user.Password ระบุมา = ตั้ง/รีเซ็ตรหัสใหม่ / ไม่ระบุตอนแก้ไข = คงรหัสเดิมไว้
 */
export async function saveUser(ctx, user) {
  return ctx.withLock(async () => {
    await ctx.assertAdmin();
    await ctx.ensureBase();
    await writeUserRecord(ctx, user);
    return getUsers(ctx);
  });
}

/**
 * เขียนผู้ใช้หนึ่งคนลงตาราง (สร้างใหม่/แก้ไข) — ผู้เรียกต้องถือล็อกและตรวจสิทธิ์ Admin มาแล้ว
 * แยกออกมาให้นำเข้าผู้ใช้หลายคนทีเดียวเรียกซ้ำได้ใต้ล็อกเดียว (ล็อกของระบบซ้อนกันไม่ได้)
 */
export async function writeUserRecord(ctx, user) {
  const username = String(user.Username || '').trim();
  assertUsernameFormat(username);

  const list = ctx.ss.objects(SHEETS.USERS);
  const isEdit = !!user._row;

  // ตรวจว่าแถวนั้นยังเป็นผู้ใช้คนเดิมอยู่จริง ก่อนตรวจอย่างอื่นทั้งหมด
  //
  // _row คือ "ลำดับที่เท่าไหร่ในตาราง" ไม่ใช่ id ถาวร มีคนลบแถวข้างบนไป
  // ระหว่างที่อีกคนเปิดหน้าค้างไว้ คำสั่งนี้จะไปเขียนทับผู้ใช้คนถัดไปแทน
  //
  // เทียบกับชื่อ "ตอนที่เปิดหน้ามา" ไม่ใช่ชื่อใหม่ในฟอร์ม เพราะการแก้ไข
  // เปลี่ยนชื่อผู้ใช้ได้ด้วย ถ้าเทียบกับชื่อใหม่จะไม่มีวันตรงกันเลย
  //
  // ต้องอยู่ก่อนด่านเช็คชื่อซ้ำ ไม่งั้นพอลำดับเลื่อน คนใช้จะได้ข้อความว่า
  // "มี Username นี้อยู่แล้ว" ซึ่งชี้ไปผิดเรื่องจนหาสาเหตุไม่เจอ
  if (isEdit) {
    ctx.assertRowIs(SHEETS.USERS, Number(user._row), 'Username', user._expectUsername, 'ผู้ใช้');
  }

  // เช็ค Username ซ้ำกับผู้ใช้คนอื่น (ยกเว้นแถวของตัวเองตอนแก้ไข)
  const clash = list.some(u =>
    (!isEdit || u._row !== Number(user._row)) &&
    String(u.Username || '').trim().toLowerCase() === username.toLowerCase()
  );
  if (clash) throw new Error('มี Username นี้อยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น');

  // Permissions ส่งมาเป็น object เช่น {airlist:'edit', plan:'view', ...}
  // เก็บลงชีตเป็นข้อความ "airlist:edit,plan:view,..." เฉพาะโมดูลที่รู้จัก
  const permObj = user.Permissions && typeof user.Permissions === 'object' ? user.Permissions : {};
  const permStr = MODULES
    .map(m => m + ':' + (['edit', 'view', 'none'].includes(permObj[m]) ? permObj[m] : 'view'))
    .join(',');

  /**
   * ช่องรหัสผ่านที่จะเขียนลงแถว
   *
   * ตั้งรหัสใหม่  -> เขียนแฮช และล้างสองช่องเดิมทิ้ง
   * แก้ไขโดยไม่แตะรหัส -> ไม่ใส่ช่องรหัสลงใน payload เลยสักช่อง
   *
   * เหตุผลของกรณีที่สอง: writeByHeaders เขียนเฉพาะช่องที่ส่งไป ช่องที่ไม่ส่ง
   * จะไม่ถูกแตะเลย การไม่ส่งจึงตรงกับเจตนา "ไม่ได้ตั้งใจเปลี่ยนรหัส" ที่สุด
   *
   * โค้ดเดิมอ่าน existing.Password มาเขียนกลับ ซึ่งไม่ได้ผิดจนข้อมูลหาย
   * (เขียนค่าว่างทับช่องที่ว่างอยู่แล้ว ส่วนแฮชไม่ถูกแตะ) แต่เป็นรูปแบบที่
   * เชิญชวนให้ผิดในอนาคต เพราะพอมีช่องรหัสสามช่องแล้ว คนที่มาเก็บกวาดโค้ด
   * ทีหลังมีโอกาสใส่ทั้งสามช่องลง payload พร้อมกัน ซึ่งจะล้างรหัสทิ้งจริง
   * เทสต์ "แก้ไขผู้ใช้โดยไม่แตะรหัสผ่าน" คุมกรณีนั้นไว้ (ลองแล้วแดงจริง)
   */
  let passwordFields;
  if (user.Password) {
    if (String(user.Password).length < 6) throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    passwordFields = {
      PasswordHash: await makePasswordHash(user.Password),
      PasswordSalt: '',
      Password: ''
    };
  } else if (isEdit) {
    passwordFields = {};
  } else {
    throw new Error('กรุณาตั้งรหัสผ่านสำหรับผู้ใช้ใหม่');
  }

  // บัญชีผู้รับเหมาต้องเลือกผู้รับเหมาจากรายชื่อที่มีอยู่ ห้ามพิมพ์ชื่อเอง
  // ขอบเขตของบัญชีนี้มาจาก Node ที่มอบหมายให้รหัสนั้น พิมพ์ผิดคือเห็นงานผิดเจ้า
  //
  // ภูมิภาคกับสิทธิ์รายเมนูล้างทิ้ง เพราะผู้รับเหมาใช้สิทธิ์ตายตัว (CONTRACTOR_PERMISSIONS)
  // ถ้าเก็บค่าเก่าค้างไว้ วันที่เปลี่ยนบัญชีกลับเป็นเจ้าหน้าที่ สิทธิ์เก่าจะกลับมาเองโดยไม่มีใครตั้ง
  // Staff / Supervisor เก็บค่าของตัวเอง แต่ตรวจสิทธิ์แบบ Regional (ดู ROLE_TITLES ใน schema.js)
  // ค่าอื่นที่ไม่รู้จัก ถือเป็น Regional — ปลอดภัยกว่าเดาให้เป็นบทบาทที่เห็นมากกว่า
  const role = ['Admin', 'Contractor', ...REGIONAL_ROLES].includes(user.Role) ? user.Role : 'RegionAdmin';
  let contractorId = '';
  if (role === 'Contractor') {
    contractorId = String(user.ContractorID || '').trim();
    if (contractorId) {
      const exists = ctx.ss.objects(SHEETS.CONTRACTOR)
        .some(c => String(c.ID || '').trim().toUpperCase() === contractorId.toUpperCase());
      if (!exists) throw new Error('ไม่พบผู้รับเหมารหัส ' + contractorId + ' กรุณารีเฟรชหน้าจอแล้วเลือกใหม่');
    } else if (String(user.NewContractorName || '').trim()) {
      // บริษัทที่ยังไม่มีในรายชื่อ — เพิ่มให้เลย แล้วจะไปโผล่เป็นตัวเลือกในแผนล้างทันที
      contractorId = await findOrCreateContractor(ctx, user.NewContractorName);
    } else {
      throw new Error('กรุณาเลือกหรือพิมพ์ชื่อผู้รับเหมาที่บัญชีนี้สังกัด');
    }
  }

  const isActive = !(user.Active === false || user.Active === 'false');
  const payload = {
    Username: username,
    Email: user.Email || '',
    Name: user.Name || '',
    Role: role,
    Regions: role === 'Contractor' ? ''
      : (Array.isArray(user.Regions) ? user.Regions.join(',') : (user.Regions || '')),
    // ไม่ใช้ค่าว่าง เพราะช่องว่าง = "แก้ไขได้ทุกเมนู" (ผู้ใช้ยุคก่อนมีระบบสิทธิ์)
    Permissions: role === 'Contractor' ? MODULES.map(m => m + ':none').join(',') : permStr,
    ContractorID: contractorId,
    Active: isActive,
    UpdatedAt: ymdhms(new Date()),
    UpdatedBy: await ctx.currentUser(),
    ...passwordFields
  };

  if (isEdit) {
    ctx.ss.writeByHeaders(SHEETS.USERS, Number(user._row), payload);
  } else {
    const headers = ctx.ss.headers(SHEETS.USERS);
    ctx.ss.appendRow(SHEETS.USERS, headers.map(h => (payload[h] !== undefined ? payload[h] : '')));
  }

  await ctx.ss.flush();

  // ปิดบัญชีหรือเปลี่ยนรหัสผ่าน = ต้องเตะ session ที่ค้างอยู่ออกด้วย
  // ไม่งั้นผู้ใช้ที่ถูกปิดบัญชีจะยังใช้งานต่อได้จนกว่า session จะหมดอายุเอง (นานถึง 6 ชั่วโมง)
  if (!isActive || user.Password) {
    await ctx.state.destroySessionsOf(username);
  }
}

export async function deleteUser(ctx, row, expectUsername) {
  return ctx.withLock(async () => {
    await ctx.assertAdmin();
    await ctx.ensureBase();

    // เลขแถวคือ "ลำดับที่เท่าไหร่ในตาราง" ไม่ใช่ id ถาวร มีคนลบแถวข้างบนไป
    // ระหว่างที่อีกคนเปิดหน้าค้างไว้ คำสั่งนี้จะไปโดนผู้ใช้คนถัดไปแทน
    ctx.assertRowIs(SHEETS.USERS, row, 'Username', expectUsername, 'ผู้ใช้');

    const headers = ctx.ss.headers(SHEETS.USERS);
    const rowUsername = String(ctx.ss.cell(SHEETS.USERS, row, headers.indexOf('Username') + 1) || '').trim();
    const info = await ctx.userInfo();

    if (rowUsername && rowUsername.toLowerCase() === String(info.username || '').trim().toLowerCase()) {
      throw new Error('ไม่สามารถลบบัญชีผู้ใช้ที่กำลังเข้าสู่ระบบอยู่ในขณะนี้ได้');
    }

    await ctx.ss.deleteRow(SHEETS.USERS, row);
    await ctx.ss.flush();
    await ctx.state.destroySessionsOf(rowUsername);

    return getUsers(ctx);
  });
}
