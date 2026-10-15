import { SHEETS } from '../schema.js';
import { formatDate, plainText, ymdhms } from '../values.js';

/**
 * รายชื่อผู้รับเหมา
 *
 * ============================================================================
 * การทำงานตามที่เจ้าของงานกำหนด
 * ============================================================================
 * 1. Admin สร้างบัญชีผู้ใช้บทบาท "ผู้รับเหมา" แล้วเลือกชื่อบริษัท (หรือพิมพ์ชื่อใหม่)
 *    ชื่อใหม่จะถูกเพิ่มเข้ารายชื่อนี้ให้เอง (findOrCreateContractor)
 * 2. ในแผนล้าง ช่อง "ผู้รับเหมา" ของแต่ละรอบเป็นตัวเลือกจากรายชื่อนี้
 *    เลือกให้รอบไหน รอบนั้นคืองานของผู้รับเหมาเจ้านั้น
 * 3. ผู้รับเหมาล็อกอินเข้ามา เห็นเฉพาะรอบที่เป็นของตัวเอง (Ctx._contractorInfo)
 *
 * รายชื่อเป็นระดับ "บริษัท" ไม่ใช่ระดับบัญชี บริษัทหนึ่งมีช่างล็อกอินได้หลายคน
 * และทุกคนเห็นงานชุดเดียวกัน
 */

const isActive = v => v !== false && String(v).toUpperCase() !== 'FALSE';
const nameKey = v => plainText(v).toLowerCase().replace(/\s+/g, '');

/**
 * รหัสผู้รับเหมาตัวถัดไป เช่น CT001, CT002
 *
 * ต้องเรียกในล็อกเท่านั้น ไม่งั้นสองคนที่กดเพิ่มพร้อมกันจะได้รหัสเดียวกัน
 */
function nextContractorId(ctx) {
  let max = 0;
  for (const c of ctx.ss.objects(SHEETS.CONTRACTOR)) {
    const m = /^CT(\d+)$/i.exec(String(c.ID || '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'CT' + String(max + 1).padStart(3, '0');
}

/**
 * รายชื่อผู้รับเหมาทั้งหมด — ใช้เป็นตัวเลือกในแผนล้างและในหน้าจัดการผู้ใช้
 * เจ้าหน้าที่เท่านั้น ผู้รับเหมาไม่ต้องเห็นรายชื่อคู่แข่ง
 */
export async function getContractors(ctx) {
  await ctx.assertStaff('ดูรายชื่อผู้รับเหมา');
  await ctx.ensureBase();

  const users = ctx.ss.objects(SHEETS.USERS);
  const sameId = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

  return ctx.ss.objects(SHEETS.CONTRACTOR)
    .map(c => ({
      ID: plainText(c.ID),
      Name: plainText(c.Name),
      Active: isActive(c.Active),
      UpdatedAt: formatDate(c.UpdatedAt),
      UserCount: users.filter(u => sameId(u.ContractorID, c.ID)).length
    }))
    .sort((a, b) => a.Name.localeCompare(b.Name, 'th'));
}

/**
 * หาผู้รับเหมาจากชื่อ ไม่เจอก็สร้างใหม่ — คืนรหัส
 *
 * ชื่อซ้ำคือปัญหาเดิมที่ตารางนี้มีไว้แก้ (ข้อมูลเก่ามีบริษัทเดียวกันถึง 7 ชื่อ)
 * จึงเทียบแบบไม่สนตัวพิมพ์และช่องว่าง "T&N" กับ "t&n " คือเจ้าเดียวกัน
 * ถ้าเจอเจ้าที่ถูกปิดไว้ ให้เปิดกลับมาใช้ ไม่สร้างซ้ำ
 *
 * ต้องเรียกในล็อก (ผู้เรียกคือ saveUser ซึ่งถือล็อกอยู่แล้ว)
 */
export async function findOrCreateContractor(ctx, rawName) {
  const name = plainText(rawName).trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('กรุณาระบุชื่อผู้รับเหมา');

  const existing = ctx.ss.objects(SHEETS.CONTRACTOR).find(c => nameKey(c.Name) === nameKey(name));
  const now = ymdhms(new Date());
  const by = await ctx.currentUser();

  if (existing) {
    if (!isActive(existing.Active)) {
      ctx.ss.writeByHeaders(SHEETS.CONTRACTOR, existing._row, { Active: true, UpdatedAt: now, UpdatedBy: by });
    }
    return String(existing.ID).trim();
  }

  const row = { ID: nextContractorId(ctx), Name: name, Active: true, Note: '', CreatedAt: now, UpdatedAt: now, UpdatedBy: by };
  const headers = ctx.ss.headers(SHEETS.CONTRACTOR);
  ctx.ss.appendRow(SHEETS.CONTRACTOR, headers.map(h => (row[h] !== undefined ? row[h] : '')));
  return row.ID;
}

/**
 * ลบบริษัทผู้รับเหมา — ไว้ลบชื่อที่พิมพ์ผิด/ซ้ำตอนสร้างบัญชี (เจ้าของงานขอ 15/10/2569)
 *
 * Infrastructure เท่านั้น เหมือนการลบเครื่องและลบผู้ใช้
 * ลบได้เฉพาะบริษัทที่ยังไม่มีอะไรอ้างถึง เพราะทุกที่เก็บแค่รหัส (CT…)
 * ถ้าลบทั้งที่ยังมีบัญชี แผนล้าง หรืองานที่มอบหมายอยู่ ที่เหล่านั้นจะเหลือรหัสลอยๆ ไม่รู้ว่าเป็นของใคร
 * และบัญชีของบริษัทนั้นจะล็อกอินแล้วไม่มีสิทธิ์อะไร (Ctx ถือว่าบริษัทที่ไม่มีในรายชื่อ = ไม่ให้เข้าถึง)
 *
 * @param {string} id รหัสบริษัท เช่น CT002
 */
export async function deleteContractor(ctx, id) {
  return ctx.withLock(async () => {
    await ctx.assertAdmin();
    await ctx.ensureBase();

    const want = plainText(id).trim().toUpperCase();
    const same = v => String(v || '').trim().toUpperCase() === want;
    const c = want && ctx.ss.objects(SHEETS.CONTRACTOR).find(x => same(x.ID));
    if (!c) throw new Error('ไม่พบผู้รับเหมานี้ — อาจถูกลบไปแล้ว กรุณารีเฟรชหน้าจอ');
    const name = plainText(c.Name) || want;

    const users = ctx.ss.objects(SHEETS.USERS).filter(u => same(u.ContractorID)).map(u => plainText(u.Username));
    if (users.length) {
      throw new Error('ลบ "' + name + '" ไม่ได้ เพราะยังมีบัญชีผู้ใช้สังกัดอยู่ (' + users.join(', ') + ') — ลบหรือย้ายบัญชีเหล่านั้นก่อน');
    }

    const planNames = (await ctx.ss.sheetNames()).filter(n => /^Plan_\d{4}$/.test(n));
    await ctx.ss.load(planNames);
    const years = planNames.filter(n => ctx.ss.objects(n).some(p => [1, 2, 3].some(r => same(p['R' + r + '_ContractorID']))));
    if (years.length) {
      throw new Error('ลบ "' + name + '" ไม่ได้ เพราะยังถูกเลือกเป็นผู้รับเหมาในแผนล้างปี ' +
        years.map(n => n.slice(5)).join(', ') + ' — เปลี่ยนผู้รับเหมาในแผนก่อน');
    }

    const jobs = ctx.ss.objects(SHEETS.ASSIGN).filter(a => same(a.ContractorID)).length;
    if (jobs) {
      throw new Error('ลบ "' + name + '" ไม่ได้ เพราะมีงานซ่อม/ติดตั้งที่มอบหมายให้ผู้รับเหมานี้ ' + jobs + ' งาน (เก็บไว้เป็นประวัติว่าใครทำ)');
    }

    await ctx.ss.deleteRow(SHEETS.CONTRACTOR, c._row);
    await ctx.ss.flush();
    return getContractors(ctx);
  });
}
