import { SHEETS, MODULES, REGIONAL_ROLES, ROLE_TITLES, REGIONAL_DEFAULT_PERMISSIONS } from '../schema.js';
import { plainText } from '../values.js';
import { getConfig } from './airlist.js';
import { getUsers, writeUserRecord } from './users.js';

/**
 * นำเข้าผู้ใช้หลายคนทีเดียวจากไฟล์ Excel/CSV
 *
 * หลักคิดเหมือนนำเข้ารายการเครื่อง: ดูผลก่อน (planUserImport ไม่เขียนอะไร) แล้วค่อยยืนยัน (applyUserImport)
 * ผิดแถวเดียว = ไม่เขียนอะไรเลยทั้งไฟล์ ไม่ให้มีบัญชีที่สร้างไปครึ่งเดียว
 *
 * - เฉพาะสร้างบัญชีใหม่ — Username ที่มีอยู่แล้วถูกข้าม ไม่ทับข้อมูลและไม่เปลี่ยนรหัสผ่านใคร
 * - สิทธิ์รายเมนูของ Regional / Staff / Supervisor ใช้ค่าตั้งต้นเดียวกับฟอร์มเพิ่มผู้ใช้
 *   (REGIONAL_DEFAULT_PERMISSIONS) ไม่มีคอลัมน์สิทธิ์ในไฟล์ — Infrastructure ปรับรายคนทีหลังได้
 * - ผลที่ส่งกลับหน้าเว็บไม่มีรหัสผ่านอยู่เลย
 */

export const MAX_IMPORT_ROWS = 500;

/** คอลัมน์ในไฟล์ — หน้าเว็บประกอบ Template จากรายการนี้ ไฟล์ที่โหลดไปจึงตรงกับที่ระบบรับเสมอ */
export const USER_IMPORT_COLUMNS = [
  { name: 'Username', required: true, desc: 'ชื่อสำหรับเข้าระบบ 3–50 ตัว ใช้ได้เฉพาะ a-z A-Z 0-9 . _ -', example: 'somchai.j' },
  { name: 'ชื่อ-นามสกุล', required: false, desc: 'ชื่อที่แสดงในระบบ', example: 'สมชาย ใจดี' },
  { name: 'อีเมล', required: false, desc: 'ใช้อ้างอิงเท่านั้น (ไม่บังคับ)', example: 'somchai@company.com' },
  { name: 'บทบาท', required: true, desc: 'Infrastructure / Regional / Staff / Supervisor / Subcontract', example: 'Staff' },
  { name: 'Region', required: false, desc: 'จำเป็นสำหรับ Regional / Staff / Supervisor — หลาย Region คั่นด้วย , เช่น 1,2', example: '1' },
  { name: 'รหัสผ่าน', required: true, desc: 'อย่างน้อย 6 ตัวอักษร (ผู้ใช้เปลี่ยนเองได้หลังเข้าระบบ)', example: '' },
  // ชื่อหัวคอลัมน์ "ผู้รับเหมา" ตามคำที่ใช้ทั้งเว็บ (d82eca8 — ช่างรายคนก็เป็นผู้รับเหมาได้) · ไฟล์เก่าที่ใช้หัว "บริษัทผู้รับเหมา" ยังอ่านได้ (ดู companyOf)
  { name: 'ผู้รับเหมา', required: false, desc: 'จำเป็นสำหรับ Subcontract — ชื่อบริษัทหรือชื่อช่าง ไม่มีในรายชื่อจะเพิ่มให้', example: 'บริษัท เอ แอร์ จำกัด' }
];

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,50}$/;

/** ชื่อที่ผู้ใช้พิมพ์ในไฟล์ → ค่าที่เก็บจริง (รองรับชื่อเดิมด้วย) */
const ROLE_ALIASES = {
  infrastructure: 'Admin', admin: 'Admin',
  regional: 'RegionAdmin', regionadmin: 'RegionAdmin',
  staff: 'Staff', supervisor: 'Supervisor',
  subcontract: 'Contractor', contractor: 'Contractor', ผู้รับเหมา: 'Contractor'
};

const key = v => plainText(v).trim().toLowerCase().replace(/\s+/g, '');
const cell = (row, name) => plainText(row[name] == null ? '' : row[name]).trim();
/** ชื่อผู้รับเหมาในแถว — หัวคอลัมน์ใหม่ก่อน ไม่มีค่อยดูหัวเดิม (Template ที่โหลดไปก่อน 16/10/2569) */
const companyOf = row => cell(row, 'ผู้รับเหมา') || cell(row, 'บริษัทผู้รับเหมา');

async function buildPlan(ctx, rows) {
  await ctx.assertAdmin();
  await ctx.ensureBase();
  if (!Array.isArray(rows) || !rows.length) throw new Error('ไม่พบข้อมูลในไฟล์');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error('ไฟล์มี ' + rows.length + ' แถว ระบบรับครั้งละไม่เกิน ' + MAX_IMPORT_ROWS + ' แถว กรุณาแบ่งไฟล์');
  }

  const regions = ((await getConfig(ctx)).Region || []).map(r => plainText(r).trim());
  const existing = new Set(ctx.ss.objects(SHEETS.USERS).map(u => key(u.Username)));
  const contractors = new Set(ctx.ss.objects(SHEETS.CONTRACTOR).map(c => key(c.Name)));

  const adds = [], skips = [], errors = [];
  const seen = new Map();          // username → แถวแรกที่พบในไฟล์
  const newCompanies = new Set();

  rows.forEach((row, i) => {
    const no = i + 2;              // แถวใน Excel (แถว 1 คือหัวตาราง)
    const values = USER_IMPORT_COLUMNS.map(c => cell(row, c.name));
    if (values.every(v => !v)) return;                 // แถวว่าง

    const username = cell(row, 'Username');
    const fail = message => errors.push({ row: no, username, message });

    if (!username) return fail('ไม่ได้ใส่ Username');
    if (!USERNAME_RE.test(username)) return fail('Username ต้องยาว 3–50 ตัว ใช้ได้เฉพาะ a-z A-Z 0-9 . _ -');
    const k = key(username);
    if (seen.has(k)) return fail('Username ซ้ำกับแถว ' + seen.get(k) + ' ในไฟล์เดียวกัน');
    seen.set(k, no);
    if (existing.has(k)) return skips.push({ row: no, username, reason: 'มี Username นี้ในระบบแล้ว (ไม่แก้ข้อมูลเดิม)' });

    const roleText = cell(row, 'บทบาท');
    const role = ROLE_ALIASES[key(roleText)];
    if (!role) return fail(roleText ? 'ไม่รู้จักบทบาท "' + roleText + '" (ใช้ได้: Infrastructure, Regional, Staff, Supervisor, Subcontract)' : 'ไม่ได้ใส่บทบาท');

    const password = cell(row, 'รหัสผ่าน');
    if (password.length < 6) return fail(password ? 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' : 'ไม่ได้ใส่รหัสผ่าน');

    let regionList = [];
    if (REGIONAL_ROLES.includes(role) || role === 'RegionAdmin') {
      regionList = [...new Set(cell(row, 'Region').split(/[,\s/]+/).map(r => r.trim()).filter(Boolean))];
      if (!regionList.length) return fail('บทบาท ' + ROLE_TITLES[role] + ' ต้องระบุ Region อย่างน้อย 1 ค่า');
      const bad = regionList.filter(r => !regions.includes(r));
      if (bad.length) return fail('ไม่มี Region ' + bad.join(', ') + ' ในระบบ (มี: ' + regions.join(', ') + ')');
    }

    let company = '';
    if (role === 'Contractor') {
      company = companyOf(row);
      if (!company) return fail('Subcontract ต้องระบุผู้รับเหมา');
      if (!contractors.has(key(company)) && !newCompanies.has(key(company))) newCompanies.add(key(company));
    }

    adds.push({
      row: no, username, name: cell(row, 'ชื่อ-นามสกุล'), email: cell(row, 'อีเมล'),
      role, roleTitle: ROLE_TITLES[role], regions: regionList, company,
      newCompany: !!company && !contractors.has(key(company))
    });
  });

  return { adds, skips, errors, newCompanies: newCompanies.size };
}

/** เอาข้อมูลที่ไม่ควรออกจากเซิร์ฟเวอร์ออก (ไม่มีรหัสผ่านอยู่ในแผนอยู่แล้ว) และสรุปตัวเลข */
function summarize(plan) {
  return {
    adds: plan.adds, skips: plan.skips, errors: plan.errors, newCompanies: plan.newCompanies,
    counts: { adds: plan.adds.length, skips: plan.skips.length, errors: plan.errors.length }
  };
}

export async function getUserImportTemplate(ctx) {
  await ctx.assertAdmin();
  return { columns: USER_IMPORT_COLUMNS };
}

/** ดูว่านำเข้าไฟล์นี้แล้วจะเกิดอะไร — ไม่เขียนอะไรทั้งสิ้น */
export async function planUserImport(ctx, rows) {
  return summarize(await buildPlan(ctx, rows));
}

/**
 * สร้างบัญชีจริง — คำนวณแผนใหม่จากแถวชุดเดิม ไม่เชื่อแผนที่หน้าเว็บส่งมา
 * @param {Object} payload { rows, expect: { adds } }
 */
export async function applyUserImport(ctx, payload) {
  return ctx.withLock(async () => {
    const { rows, expect } = payload || {};
    const plan = await buildPlan(ctx, rows);

    if (plan.errors.length) {
      throw new Error('ไฟล์ยังมีข้อผิดพลาด ' + plan.errors.length + ' แถว ต้องแก้ให้หมดก่อนจึงจะนำเข้าได้');
    }
    if (!plan.adds.length) throw new Error('ไม่มีบัญชีใหม่ให้สร้าง (Username ในไฟล์มีในระบบแล้วทั้งหมด)');
    if (expect && Number(expect.adds) !== plan.adds.length) {
      throw new Error('ข้อมูลผู้ใช้ในระบบเปลี่ยนไประหว่างที่ดูผลอยู่ (ตอนนี้จะสร้าง ' + plan.adds.length + ' บัญชี) กรุณาเลือกไฟล์ใหม่เพื่อดูผลอีกครั้ง');
    }

    // สำรองก่อนเขียนเสมอ — ถ้าสำรองไม่ได้ต้องหยุด (แพลตฟอร์มที่ไม่มีดิสก์ไม่ส่งตัวนี้เข้ามา)
    const backupName = ctx.backup ? ctx.backup('ก่อนนำเข้าผู้ใช้') : '';

    // รหัสผ่านอ่านจากแถวชุดเดิมตอนเขียนเท่านั้น ไม่เก็บไว้ในแผน
    const byRow = new Map(rows.map((r, i) => [i + 2, r]));
    const perms = {};
    MODULES.forEach(m => { perms[m] = REGIONAL_DEFAULT_PERMISSIONS[m] || 'none'; });

    for (const a of plan.adds) {
      const src = byRow.get(a.row);
      await writeUserRecord(ctx, {
        Username: a.username, Name: a.name, Email: a.email, Role: a.role,
        Regions: a.regions, Permissions: perms, Password: cell(src, 'รหัสผ่าน'),
        NewContractorName: a.company, Active: true
      });
    }

    return { added: plan.adds.length, skipped: plan.skips.length, backupName, users: await getUsers(ctx) };
  });
}
