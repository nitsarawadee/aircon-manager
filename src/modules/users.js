import { SHEETS, MODULES } from '../schema.js';
import { formatDate, ymdhms } from '../values.js';

/**
 * การเข้าสู่ระบบและการจัดการผู้ใช้งาน
 * พอร์ตมาจากส่วน "USER / PERMISSIONS" ของ Code.gs เดิม
 *
 * ⚠️ หมายเหตุด้านความปลอดภัย
 * ระบบเดิมเก็บรหัสผ่านเป็นข้อความธรรมดาในคอลัมน์ Password ของชีต Users
 * โดยตั้งใจ (เพื่อให้ Admin เปิดดูรหัสของทุกคนได้จากในชีต)
 * เวอร์ชันนี้ยังคงพฤติกรรมเดิมไว้เพื่อไม่ให้บัญชีที่มีอยู่ใช้งานไม่ได้
 * แต่เมื่อระบบย้ายมาอยู่บนอินเทอร์เน็ตสาธารณะแล้ว ควรเปลี่ยนไปเก็บแบบแฮชโดยเร็ว
 * (ฟังก์ชัน hashPassword ด้านล่างพร้อมใช้งานอยู่แล้ว และ login รองรับทั้งสองแบบ)
 */

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,50}$/;

/** แฮชรหัสผ่านด้วย SHA-256 ผสมกับ salt (รูปแบบเดียวกับที่ Apps Script เดิมใช้) */
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

/** ตรวจรหัสผ่านของแถวผู้ใช้ รองรับทั้งแบบข้อความธรรมดาและแบบแฮช (บัญชีเก่า) */
async function verifyPassword(user, password) {
  if (user.Password) return safeEqual(password, user.Password);
  if (user.PasswordHash) return safeEqual(await hashPassword(password, user.PasswordSalt), user.PasswordHash);
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
      Password: String(password)
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

    ctx.ss.writeByHeaders(SHEETS.USERS, u._row, {
      Password: String(newPassword),
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

    const username = String(user.Username || '').trim();
    assertUsernameFormat(username);

    const list = ctx.ss.objects(SHEETS.USERS);
    const isEdit = !!user._row;

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

    let passwordPlain;
    if (user.Password) {
      if (String(user.Password).length < 6) throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
      passwordPlain = String(user.Password);
    } else if (isEdit) {
      // ไม่ได้ระบุรหัสใหม่ตอนแก้ไข -> คงรหัสเดิมของแถวนี้ไว้
      const existing = list.find(u => u._row === Number(user._row));
      passwordPlain = (existing && existing.Password) || '';
    } else {
      throw new Error('กรุณาตั้งรหัสผ่านสำหรับผู้ใช้ใหม่');
    }

    const isActive = !(user.Active === false || user.Active === 'false');
    const payload = {
      Username: username,
      Email: user.Email || '',
      Name: user.Name || '',
      Role: user.Role === 'Admin' ? 'Admin' : 'RegionAdmin',
      Regions: Array.isArray(user.Regions) ? user.Regions.join(',') : (user.Regions || ''),
      Permissions: permStr,
      Active: isActive,
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: await ctx.currentUser(),
      Password: passwordPlain
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

    return getUsers(ctx);
  });
}

export async function deleteUser(ctx, row) {
  return ctx.withLock(async () => {
    await ctx.assertAdmin();
    await ctx.ensureBase();

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
