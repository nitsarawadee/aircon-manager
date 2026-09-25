import { SHEETS } from '../schema.js';
import { formatDate, normalizeSiteCode, plainText, ymdhms } from '../values.js';
import { unitsInScope } from './airlist.js';

/**
 * รายชื่อผู้รับเหมา และการมอบหมาย Node ให้ผู้รับเหมา
 *
 * ============================================================================
 * การทำงานตามที่เจ้าของงานกำหนด
 * ============================================================================
 * 1. เจ้าหน้าที่เพิ่มชื่อผู้รับเหมาไว้ในรายชื่อ (ได้รหัสของตัวเอง)
 * 2. เจ้าหน้าที่มอบหมาย Node ให้ผู้รับเหมา — ตั้งครั้งเดียวใช้ยาว
 *    Node หนึ่งมีผู้รับเหมาเจ้าเดียว ดูแลทั้งงานล้างและงานติดตั้ง
 * 3. Admin สร้างบัญชีผู้ใช้ แล้วเลือกผู้รับเหมาที่บัญชีนั้นสังกัด (หน้าจัดการผู้ใช้)
 * 4. ผู้รับเหมาล็อกอินเข้ามา เห็นเฉพาะ Node ที่ได้รับมอบหมาย (ctx.scopeFilter)
 *
 * ============================================================================
 * ใครทำอะไรได้
 * ============================================================================
 * - ดูรายชื่อ / เพิ่มผู้รับเหมาใหม่: เจ้าหน้าที่ทุกคน
 * - แก้ชื่อ / ปิดใช้งานผู้รับเหมา: Admin เท่านั้น
 *   ผู้รับเหมาเจ้าหนึ่งรับงานได้หลายภูมิภาค ถ้าให้เจ้าหน้าที่ภาคไหนก็ปิดได้
 *   บัญชีของผู้รับเหมาจะใช้ไม่ได้ในทุกภาคโดยที่ภาคอื่นไม่รู้เรื่อง
 * - มอบหมาย Node: Admin ทุก Node / RegionAdmin ที่แก้แผนล้างได้ เฉพาะ Node ในภาคตัวเอง
 *   (การเลือกว่าใครไปล้างที่ไหน เป็นส่วนหนึ่งของการจัดแผนล้าง)
 * - ผู้รับเหมาเอง: ไม่เห็นหน้านี้เลย
 */

const isActive = v => v !== false && String(v).toUpperCase() !== 'FALSE';
const sameId = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

/**
 * รหัสผู้รับเหมาตัวถัดไป เช่น CT001, CT002
 *
 * ต้องเรียกในล็อกเท่านั้น ไม่งั้นสองคนที่กดเพิ่มพร้อมกันจะได้รหัสเดียวกัน
 * (ตารางกันรหัสซ้ำไว้อยู่แล้ว แต่คนที่สองจะได้ error แทนที่จะได้รหัสถัดไป)
 */
function nextContractorId(ctx) {
  let max = 0;
  for (const c of ctx.ss.objects(SHEETS.CONTRACTOR)) {
    const m = /^CT(\d+)$/i.exec(String(c.ID || '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'CT' + String(max + 1).padStart(3, '0');
}

/** รายชื่อผู้รับเหมาทั้งหมด พร้อมจำนวน Node และจำนวนบัญชีผู้ใช้ของแต่ละเจ้า */
export async function getContractors(ctx) {
  await ctx.assertStaff('ดูรายชื่อผู้รับเหมา');
  await ctx.ensureBase();

  const assigns = ctx.ss.objects(SHEETS.NODEASSIGN);
  const users = ctx.ss.objects(SHEETS.USERS);

  return ctx.ss.objects(SHEETS.CONTRACTOR)
    .map(c => ({
      _row: c._row,
      ID: plainText(c.ID),
      Name: plainText(c.Name),
      Active: isActive(c.Active),
      Note: plainText(c.Note),
      UpdatedAt: formatDate(c.UpdatedAt),
      NodeCount: assigns.filter(a => sameId(a.ContractorID, c.ID)).length,
      UserCount: users.filter(u => sameId(u.ContractorID, c.ID)).length
    }))
    .sort((a, b) => a.Name.localeCompare(b.Name, 'th'));
}

/**
 * เพิ่มหรือแก้ไขผู้รับเหมา
 *
 * @param {Object} c { ID?, Name, Active?, Note? } — มี ID = แก้ไข / ไม่มี = เพิ่มใหม่
 */
export async function saveContractor(ctx, c) {
  return ctx.withLock(async () => {
    await ctx.assertStaff('จัดการรายชื่อผู้รับเหมา');
    await ctx.ensureBase();
    c = c || {};

    const name = plainText(c.Name).trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('กรุณาระบุชื่อผู้รับเหมา');

    const list = ctx.ss.objects(SHEETS.CONTRACTOR);
    const id = plainText(c.ID).trim();
    const existing = id ? list.find(x => sameId(x.ID, id)) : null;
    if (id && !existing) throw new Error('ไม่พบผู้รับเหมารหัส ' + id + ' กรุณารีเฟรชหน้าจอ');

    // ชื่อซ้ำคือปัญหาเดิมที่ตารางนี้มีไว้แก้ (ข้อมูลเก่ามีบริษัทเดียวกันถึง 7 ชื่อ)
    // ไม่สนตัวพิมพ์และช่องว่าง เพราะ "T&N" กับ "t&n " คือเจ้าเดียวกัน
    const key = name.toLowerCase().replace(/\s+/g, '');
    const clash = list.find(x =>
      !sameId(x.ID, id) && plainText(x.Name).toLowerCase().replace(/\s+/g, '') === key);
    if (clash) throw new Error('มีผู้รับเหมาชื่อ "' + plainText(clash.Name) + '" อยู่แล้ว (รหัส ' + plainText(clash.ID) + ')');

    const now = ymdhms(new Date());
    const by = await ctx.currentUser();

    if (existing) {
      await ctx.assertAdmin();
      ctx.ss.writeByHeaders(SHEETS.CONTRACTOR, existing._row, {
        Name: name,
        Active: !(c.Active === false || c.Active === 'false'),
        Note: plainText(c.Note),
        UpdatedAt: now,
        UpdatedBy: by
      });
    } else {
      const row = {
        ID: nextContractorId(ctx), Name: name, Active: true, Note: plainText(c.Note),
        CreatedAt: now, UpdatedAt: now, UpdatedBy: by
      };
      const headers = ctx.ss.headers(SHEETS.CONTRACTOR);
      ctx.ss.appendRow(SHEETS.CONTRACTOR, headers.map(h => (row[h] !== undefined ? row[h] : '')));
    }

    await ctx.ss.flush();
    return getContractors(ctx);
  });
}

/**
 * Node ทั้งหมดที่ผู้ใช้คนนี้มอบหมายได้ พร้อมผู้รับเหมาที่ดูแลอยู่ตอนนี้
 *
 * หนึ่งแถวต่อหนึ่ง SiteCode (ตรวจข้อมูลจริงแล้ว Node กับ SiteCode ตรงกันหนึ่งต่อหนึ่ง)
 */
export async function getNodeAssignments(ctx) {
  await ctx.assertStaff('ดูการมอบหมายงาน');
  await ctx.ensureBase();

  const names = new Map(ctx.ss.objects(SHEETS.CONTRACTOR)
    .map(c => [String(c.ID).trim().toUpperCase(), plainText(c.Name)]));
  const owner = new Map(ctx.ss.objects(SHEETS.NODEASSIGN)
    .map(a => [normalizeSiteCode(a.SiteCode), String(a.ContractorID || '').trim()]));

  const nodes = new Map();
  for (const u of await unitsInScope(ctx)) {
    const site = normalizeSiteCode(u.SiteCode);
    if (!site) continue;
    if (!nodes.has(site)) {
      const cid = owner.get(site) || '';
      nodes.set(site, {
        SiteCode: plainText(u.SiteCode).trim(),
        NodeName: plainText(u.NodeName),
        Region: plainText(u.Region),
        Province: plainText(u.Province),
        Units: 0,
        ContractorID: cid,
        ContractorName: cid ? (names.get(cid.toUpperCase()) || '') : ''
      });
    }
    nodes.get(site).Units++;
  }

  return [...nodes.values()].sort((a, b) =>
    a.Region.localeCompare(b.Region, 'th', { numeric: true }) ||
    a.Province.localeCompare(b.Province, 'th') ||
    a.NodeName.localeCompare(b.NodeName, 'th'));
}

/**
 * มอบหมาย Node หลายแห่งให้ผู้รับเหมาเจ้าเดียวในครั้งเดียว
 * (เช่นเลือก Node ทั้งจังหวัดอ่างทองแล้วมอบให้เจ้าเดียว)
 *
 * @param {string[]} siteCodes    Node ที่จะมอบหมาย
 * @param {string}   contractorId รหัสผู้รับเหมา — ค่าว่าง = ยกเลิกการมอบหมาย
 */
export async function assignNodes(ctx, siteCodes, contractorId) {
  return ctx.withLock(async () => {
    await ctx.assertStaff('มอบหมายงาน');
    await ctx.assertModuleEdit('plan');
    await ctx.ensureBase();

    const wanted = [...new Set((Array.isArray(siteCodes) ? siteCodes : [])
      .map(normalizeSiteCode).filter(Boolean))];
    if (!wanted.length) throw new Error('กรุณาเลือก Node อย่างน้อย 1 แห่ง');

    // ทุก Node ต้องอยู่ในขอบเขตของคนกด — กันเจ้าหน้าที่ภาคหนึ่งไปมอบงานของอีกภาค
    // หาจากทะเบียนเครื่อง ไม่ใช่เชื่อรายการที่หน้าเว็บส่งมา
    const inScope = new Set((await unitsInScope(ctx)).map(u => normalizeSiteCode(u.SiteCode)));
    const outside = wanted.filter(s => !inScope.has(s));
    if (outside.length) {
      throw new Error('ไม่พบ Node หรือไม่มีสิทธิ์มอบหมาย: ' + outside.slice(0, 5).join(', ') +
                      (outside.length > 5 ? ' และอีก ' + (outside.length - 5) + ' แห่ง' : ''));
    }

    const cid = plainText(contractorId).trim();
    if (cid) {
      const c = ctx.ss.objects(SHEETS.CONTRACTOR).find(x => sameId(x.ID, cid));
      if (!c) throw new Error('ไม่พบผู้รับเหมารหัส ' + cid + ' กรุณารีเฟรชหน้าจอ');
      if (!isActive(c.Active)) throw new Error('ผู้รับเหมา "' + plainText(c.Name) + '" ถูกปิดใช้งานอยู่');
    }

    const now = ymdhms(new Date());
    const by = await ctx.currentUser();
    const headers = ctx.ss.headers(SHEETS.NODEASSIGN);
    const current = ctx.ss.objects(SHEETS.NODEASSIGN);

    // ลบจากแถวล่างขึ้นบน เพราะการลบทำให้แถวที่อยู่ข้างล่างเลื่อนขึ้น
    const toRemove = [];
    for (const site of wanted) {
      const row = current.find(a => normalizeSiteCode(a.SiteCode) === site);
      if (!cid) {
        if (row) toRemove.push(row._row);
      } else if (row) {
        ctx.ss.writeByHeaders(SHEETS.NODEASSIGN, row._row, { ContractorID: cid, UpdatedAt: now, UpdatedBy: by });
      } else {
        const rec = { SiteCode: site, ContractorID: cid, UpdatedAt: now, UpdatedBy: by };
        ctx.ss.appendRow(SHEETS.NODEASSIGN, headers.map(h => (rec[h] !== undefined ? rec[h] : '')));
      }
    }
    for (const r of toRemove.sort((a, b) => b - a)) await ctx.ss.deleteRow(SHEETS.NODEASSIGN, r);

    await ctx.ss.flush();
    return getNodeAssignments(ctx);
  });
}
