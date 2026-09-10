import { SHEETS } from '../schema.js';
import { formatDate, normalizeCode, normalizeRegion, ymd, ymdhms } from '../values.js';
import { addHistoryRaw, getHistory } from './history.js';
import { ensureCaseId, isRepairStatus, openCaseOf } from './repair-case.js';

/**
 * รายการเครื่องปรับอากาศ (Master Data)
 * พอร์ตมาจากส่วน "1. AIR LIST" ของ Code.gs เดิม
 *
 * หมายเหตุการพอร์ต: โค้ดเดิมเขียนข้อมูลด้วยการวางทั้งแถวตามลำดับใน AIRLIST_HEADERS
 * ซึ่งจะเขียนผิดช่องทันทีถ้าลำดับคอลัมน์จริงในชีตไม่ตรงกับในโค้ด
 * เวอร์ชันนี้เปลี่ยนมาเขียนโดยอ้างชื่อคอลัมน์แทน จึงปลอดภัยกับชีตที่เคย migrate มาแล้ว
 */

/**
 * แปลงสถานะใหม่ของเครื่อง เป็นชื่อเหตุการณ์ที่จะบันทึกลงประวัติ
 *
 * วงจรของเครื่องมีแค่นี้ ตั้งใจให้คำศัพท์น้อยที่สุดเท่าที่ยังสื่อความได้
 *
 *   ใช้งานปกติ ──แจ้งซ่อม──> รอซ่อม ──ซ่อม──> ใช้งานปกติ
 *        └──────ชำรุด / ปลดระวาง
 *
 * การกลับมา "ใช้งานปกติ" บันทึกเป็น "ซ่อม" เสมอ ไม่ว่าจะมาจากทางไหน
 * และไม่ว่าจะกดปิดงานในหน้างานซ่อม หรือไปแก้สถานะเองในหน้ารายการเครื่อง
 * เพราะสำหรับคนอ่านประวัติมันคือเหตุการณ์เดียวกัน คือเครื่องกลับมาใช้ได้แล้ว
 * ส่วนรายละเอียดว่าเปลี่ยนมาจากสถานะไหน ดูได้จากช่องรายละเอียดอยู่แล้ว
 *
 * เดิมเคยแยกเป็น "ซ่อมแล้ว" กับ "กลับมาใช้งาน" ตามสถานะเดิม
 * แต่เป็นความละเอียดที่ไม่คุ้มกับการมีคำศัพท์เพิ่มให้จำ จึงยุบรวมกลับมา
 */
export function statusChangeEvent(status) {
  const now = String(status || '').trim();

  // ชื่อเหตุการณ์ใช้ชื่อเดียวกับสถานะ เพื่อให้ไล่ประวัติแล้วเทียบกับสถานะได้ตรงๆ
  // ไม่ใช่ "แจ้งซ่อม" เพราะการแจ้งเกิดตอนที่เครื่องกลายเป็นชำรุด ไม่ใช่ตอนนี้
  if (now === 'รอซ่อม') return 'รอซ่อม';

  // เช็คขายออกก่อนรื้อถอน เพราะเป็นคนละขั้นของวงจรเดียวกัน
  // ถ้าเช็คกลับกัน การขายออกจะถูกบันทึกเป็นการรื้อถอนซ้ำอีกใบ
  if (/write\s*[-_]?\s*off/i.test(now)) return 'Write off';

  // เช็คปลดระวางก่อนชำรุด เพื่อให้ค่าเดิม "ชำรุด/ปลดระวาง" ที่ยังค้างอยู่
  // ถูกจัดเป็นปลดระวาง ไม่ใช่ชำรุด
  if (now.includes('ปลดระวาง') || now.includes('รื้อถอน')) return 'รื้อถอน/ปลดระวาง';
  if (now.includes('ชำรุด')) return 'ชำรุด';

  if (now === 'ใช้งานปกติ') return 'ซ่อมแล้ว';

  return 'อื่นๆ';
}

export async function getAirList(ctx) {
  await ctx.requireAccess();
  if (!(await ctx.canView('airlist'))) return [];
  await ctx.ensureBase();

  let list = ctx.ss.objects(SHEETS.AIRLIST).map(o => ({
    ...o,
    InstallDate: formatDate(o.InstallDate),
    WarrantyExpire: formatDate(o.WarrantyExpire),
    UpdatedAt: formatDate(o.UpdatedAt)
  }));

  const info = await ctx.userInfo();
  if (info.role !== 'Admin') {
    list = list.filter(a => (info.regions || []).includes(normalizeRegion(a.Region)));
  }
  return list;
}

export async function getConfig(ctx) {
  await ctx.requireAccess();
  await ctx.ensureBase();

  const headers = ctx.ss.headers(SHEETS.CONFIG);
  const values = ctx.ss.values(SHEETS.CONFIG);
  const cols = {};

  headers.forEach((h, i) => {
    if (!h) return;
    const out = [];
    for (let r = 1; r < values.length; r++) {
      const v = (values[r] || [])[i];
      if (v !== '' && v !== null && v !== undefined) out.push(v);
    }
    cols[h] = out;
  });
  return cols;
}

/** เพิ่มแถวใหม่ลง AirList (ไม่ล็อก) — ใช้ภายในฟังก์ชันที่ล็อกไว้แล้วเท่านั้น */
async function insertAirUnitRaw(ctx, unit) {
  if (!unit.AirCode) throw new Error('กรุณาระบุรหัสเครื่อง (AirCode)');

  const code = normalizeCode(unit.AirCode);
  const exists = ctx.ss.objects(SHEETS.AIRLIST).some(o => normalizeCode(o.AirCode) === code);
  if (exists) throw new Error('มีรหัสเครื่อง ' + unit.AirCode + ' อยู่แล้วในระบบ');

  const payload = {
    ...unit,
    UpdatedAt: ymdhms(new Date()),
    UpdatedBy: await ctx.currentUser()
  };

  const headers = ctx.ss.headers(SHEETS.AIRLIST);
  const row = headers.map(h => (payload[h] !== undefined && h !== '' ? payload[h] : ''));
  ctx.ss.appendRow(SHEETS.AIRLIST, row);
}

/**
 * สถานะที่เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่ตั้งได้
 *
 * "รอซ่อม" ไม่ใช่แค่คำบอกสถานะ แต่แปลว่า "ค่าใช้จ่ายได้รับอนุมัติแล้ว"
 * ซึ่งเป็นการตัดสินใจของผู้ดูแลระบบ ไม่ใช่งานหน้างาน
 * RegionAdmin ยังแจ้งชำรุด แจ้งซ่อมไม่ได้ และปิดงานซ่อมได้ตามปกติทุกอย่าง
 *
 * ตรวจที่นี่ที่เดียวจึงคุมได้ทุกทาง เพราะทั้งปุ่มลัดในหน้างานซ่อมและฟอร์มแก้ไข
 * เครื่อง เข้ามาที่ saveAirUnit เหมือนกัน — การซ่อนปุ่มในหน้าเว็บอย่างเดียวไม่พอ
 * เพราะคนที่รู้วิธีก็ยิงคำสั่งตรงเข้ามาได้โดยไม่ผ่านหน้าเว็บเลย
 */
const ADMIN_ONLY_STATUS = new Set(['รอซ่อม']);

/** ตรวจว่าผู้ใช้คนนี้ตั้งสถานะนี้ได้หรือไม่ */
async function assertCanSetStatus(ctx, status) {
  const s = String(status || '').trim();
  if (!ADMIN_ONLY_STATUS.has(s)) return;

  const info = await ctx.userInfo();
  if (info.role !== 'Admin') {
    throw new Error(
      'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่เปลี่ยนสถานะเป็น "' + s + '" ได้ ' +
      'เพราะเป็นการยืนยันว่าอนุมัติค่าใช้จ่ายแล้ว'
    );
  }
}

export async function saveAirUnit(ctx, unit) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    await ctx.ensureBase();

    const headers = ctx.ss.headers(SHEETS.AIRLIST);

    if (unit._row) {
      // ช่องรหัสเครื่องเป็น readonly ตอนแก้ข้อมูล ค่าที่ส่งมาจึงต้องตรงกับของเดิมเสมอ
      // ถ้าไม่ตรงแปลว่าลำดับแถวเลื่อนไปแล้ว ไม่ใช่ว่าผู้ใช้ตั้งใจเปลี่ยนรหัส
      ctx.assertRowIs(SHEETS.AIRLIST, unit._row, 'AirCode', unit.AirCode, 'เครื่องรหัส');

      // ตรวจสิทธิ์ทั้งภูมิภาคเดิมและภูมิภาคใหม่ กันไม่ให้ RegionAdmin แก้ข้อมูลนอกเขต
      // หรือย้ายข้อมูลออกนอกเขตตัวเอง
      const oldRegion = ctx.ss.cell(SHEETS.AIRLIST, unit._row, headers.indexOf('Region') + 1);
      await ctx.assertRegionAccess(oldRegion);
      await ctx.assertRegionAccess(unit.Region);

      // เก็บสถานะเดิมไว้ก่อนเขียนทับ เพื่อเทียบว่าสถานะเปลี่ยนไปหรือไม่
      const oldStatus = ctx.ss.cell(SHEETS.AIRLIST, unit._row, headers.indexOf('Status') + 1);

      // ตรวจสิทธิ์ก่อนเขียนอะไรทั้งสิ้น จะได้ไม่มีอะไรค้างอยู่ครึ่งทางตอนถูกปฏิเสธ
      const statusChanged = !!unit.Status && String(unit.Status) !== String(oldStatus || '');
      if (statusChanged) await assertCanSetStatus(ctx, unit.Status);

      const payload = { ...unit, UpdatedAt: ymdhms(new Date()), UpdatedBy: await ctx.currentUser() };
      delete payload._row;
      ctx.ss.writeByHeaders(SHEETS.AIRLIST, unit._row, payload);

      // บันทึกประวัติอัตโนมัติทุกครั้งที่สถานะของเครื่องเปลี่ยน (เช่น แจ้งซ่อม/ปลดระวาง)
      // เพื่อให้หน้าประวัติ/งานซ่อมเห็นเหตุการณ์นี้โดยผู้ใช้ไม่ต้องกดบันทึกเพิ่มอีกขั้น
      //
      // การเปลี่ยนสถานะที่นี่กับการกดปุ่มในหน้างานซ่อม ต้องให้ผลเหมือนกันทุกอย่าง
      // เพราะมันคือการกระทำเดียวกัน แค่เข้าคนละทาง ถ้าทางนี้ไม่ผูกเลขเคส
      // การแก้สถานะจากฟอร์มจะทำให้ใบนั้นหลุดออกจากเคส แล้วเรื่องเดียวจะเล่าไม่ครบ
      if (statusChanged) {
        const rows = ctx.ss.objects(SHEETS.HISTORY);
        const open = openCaseOf(rows, unit.AirCode);

        // เข้าสู่ขั้นของงานซ่อม = อยู่ในเคส (เคสเดิมถ้ามี ไม่มีก็เปิดใหม่)
        // ออกจากงานซ่อมกลับมาใช้งานปกติ = ปิดเคสที่ค้างอยู่ ถ้าไม่มีเคสค้างก็ไม่ต้องผูก
        let caseId = '';
        if (isRepairStatus(unit.Status)) caseId = ensureCaseId(rows, unit.AirCode);
        else if (open) caseId = open.caseId;

        await addHistoryRaw(ctx, {
          CaseID: caseId,
          AirCode: unit.AirCode,
          Date: ymd(new Date()),
          EventType: statusChangeEvent(unit.Status),
          Detail: `เปลี่ยนสถานะจาก "${oldStatus || '-'}" เป็น "${unit.Status}"` +
                  (unit.Note ? ` — หมายเหตุ: ${unit.Note}` : ''),
          Cost: '',
          Technician: ''
        });
      }
    } else {
      await ctx.assertRegionAccess(unit.Region);
      await insertAirUnitRaw(ctx, unit);
      // บันทึกประวัติ "ติดตั้ง" อัตโนมัติทุกครั้งที่เพิ่มเครื่องใหม่เข้าระบบ
      await addHistoryRaw(ctx, {
        AirCode: unit.AirCode,
        Date: unit.InstallDate || ymd(new Date()),
        EventType: 'ติดตั้ง',
        Detail: `ติดตั้งเครื่องใหม่ที่ Node "${unit.NodeName || '-'}" (${unit.SiteCode || '-'})`,
        Cost: '',
        Technician: ''
      });
    }

    await ctx.ss.flush();
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}

/**
 * ย้ายเครื่องปรับอากาศจาก Node เดิมไปยัง Node ปลายทาง
 * อัปเดตตำแหน่งใน AirList และบันทึกประวัติ EventType 'ย้าย' ให้อัตโนมัติ
 */
export async function moveAirUnit(ctx, row, dest, note, expectCode) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    if (!dest || !dest.NodeName) throw new Error('กรุณาระบุ Node ปลายทาง');
    await ctx.ensureBase();
    ctx.assertRowIs(SHEETS.AIRLIST, row, 'AirCode', expectCode, 'เครื่องรหัส');

    const headers = ctx.ss.headers(SHEETS.AIRLIST);
    const unit = {};
    headers.forEach((h, i) => { if (h) unit[h] = ctx.ss.cell(SHEETS.AIRLIST, row, i + 1); });

    await ctx.assertRegionAccess(unit.Region);
    if (dest.Region) await ctx.assertRegionAccess(dest.Region);

    const oldNode = unit.NodeName || '-';
    const oldSite = unit.SiteCode || '-';

    const payload = {
      NodeName: dest.NodeName,
      SiteCode: dest.SiteCode || '',
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: await ctx.currentUser()
    };
    if (dest.Region) payload.Region = dest.Region;
    if (dest.Province) payload.Province = dest.Province;
    ctx.ss.writeByHeaders(SHEETS.AIRLIST, row, payload);

    await addHistoryRaw(ctx, {
      AirCode: unit.AirCode,
      Date: ymd(new Date()),
      EventType: 'ย้าย',
      Detail: `ย้ายจาก Node "${oldNode}" (${oldSite}) ไปยัง Node "${dest.NodeName}" (${dest.SiteCode || '-'})` +
              (note ? ` — หมายเหตุ: ${note}` : ''),
      Cost: '',
      Technician: ''
    });

    await ctx.ss.flush();
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}

/**
 * ช่องที่เป็นของ "ตัวเครื่อง" — เปลี่ยนไปตามเครื่องใหม่ตอนเปลี่ยนเครื่อง
 *
 * ที่ไม่อยู่ในรายการนี้คือของ "ตำแหน่ง" ได้แก่ รหัสเครื่อง Node SiteCode
 * ภูมิภาค จังหวัด ประเภทสถานที่ พิกัด ที่อยู่ — ต้องคงเดิมทุกครั้ง
 */
const MACHINE_FIELDS = [
  'Brand', 'BTU', 'ModelIndoor', 'ModelOutdoor',
  'IndoorAsset', 'IndoorSN', 'OutdoorAsset', 'OutdoorSN',
  'InstallDate', 'WarrantyExpire', 'CleaningPricePerRound'
];

/**
 * บรรยายตัวเครื่องหนึ่งตัวแบบสั้น ใช้เขียนลงประวัติ
 *
 * ข้อความนี้เป็นที่เดียวที่เก็บสเปกของเครื่องที่ถูกยกออกไปแล้ว หลังเปลี่ยนเครื่อง
 * ช่องในตารางเครื่องจะเป็นของเครื่องใหม่ทั้งหมด จึงต้องใส่ให้ครบทุกช่องที่ระบุตัวได้
 * (ยี่ห้อ ขนาด รุ่น S/N ทะเบียนทรัพย์สิน วันติดตั้ง) ไม่ใช่แค่พอให้รู้ว่าเปลี่ยนแล้ว
 *
 * วันที่เขียนเป็น วว/ดด/ปปปป เพราะข้อความนี้มีไว้ให้คนอ่าน ไม่ได้เอาไปคำนวณต่อ
 */
function describeMachine(u) {
  const parts = [];
  const spec = [u.Brand, u.BTU ? Number(u.BTU).toLocaleString() + ' BTU' : ''].filter(Boolean).join(' ');
  if (spec) parts.push(spec);

  const model = [u.ModelIndoor, u.ModelOutdoor].filter(Boolean).join(' / ');
  if (model) parts.push('รุ่น ' + model);

  const sn = [u.IndoorSN, u.OutdoorSN].filter(Boolean).join(' / ');
  if (sn) parts.push('S/N ' + sn);

  const asset = [u.IndoorAsset, u.OutdoorAsset].filter(Boolean).join(' / ');
  if (asset) parts.push('ทะเบียน ' + asset);

  if (u.InstallDate) {
    const iso = formatDate(u.InstallDate);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    parts.push('ติดตั้ง ' + (m ? m[3] + '/' + m[2] + '/' + m[1] : iso));
  }
  return parts.join(' · ') || 'ไม่ระบุข้อมูลเครื่อง';
}

/**
 * เปลี่ยนตัวเครื่องของตำแหน่งเดิม — ใช้เมื่อเครื่องเก่าชำรุดซ่อมไม่ได้
 *
 * ============================================================================
 * ทำไมไม่สร้างแถวใหม่ (เดิมทำแบบนั้น และผิด)
 * ============================================================================
 * รหัสเครื่องคือชื่อของ "ตำแหน่ง" ไม่ใช่ชื่อของตัวเครื่อง — AYA-BPC-AIR-1
 * หมายถึงแอร์ตัวที่ 1 ของ Node บ้านภาชี เปลี่ยนตัวเครื่องไปกี่รอบก็ยังเป็นตัวที่ 1
 * ของ Node นั้น
 *
 * เวอร์ชันเดิมปลดระวางรหัสเดิมแล้วสร้างแถวใหม่ ซึ่งบังคับให้ต้องตั้งรหัสใหม่
 * เพราะรหัสห้ามซ้ำ ผลคือตำแหน่งเดิมหายไปจากรายการที่ใช้งานอยู่ ทั้งที่หน้างาน
 * ยังมีแอร์ตัวนั้นอยู่ และรายการเครื่องจะบวมด้วยแถวรื้อถอนทุกครั้งที่เปลี่ยนเครื่อง
 *
 * เวอร์ชันนี้แก้แถวเดิมในที่เดิม เปลี่ยนเฉพาะข้อมูลของตัวเครื่อง (S/N ทะเบียน
 * ยี่ห้อ BTU วันติดตั้ง) แล้วบันทึกประวัติหนึ่งใบที่เก็บสเปกของเครื่องเก่าไว้
 * ประวัติการล้าง/ซ่อมทั้งหมดยังผูกกับตำแหน่งเดิมและตามย้อนได้ว่ารายการไหน
 * เกิดกับเครื่องตัวไหน โดยดูว่าอยู่ก่อนหรือหลังใบ "เปลี่ยนเครื่อง"
 *
 * สถานะรื้อถอน/ปลดระวางเก็บไว้ใช้กับกรณีที่เลิกใช้ตำแหน่งนั้นจริง
 * ซึ่งเป็นเหตุการณ์คนละอันกับการเปลี่ยนตัวเครื่อง
 */
export async function replaceAirUnit(ctx, row, newUnit, expectCode) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    await ctx.ensureBase();
    ctx.assertRowIs(SHEETS.AIRLIST, row, 'AirCode', expectCode, 'เครื่องรหัส');

    const headers = ctx.ss.headers(SHEETS.AIRLIST);
    const oldUnit = {};
    headers.forEach((h, i) => { if (h) oldUnit[h] = ctx.ss.cell(SHEETS.AIRLIST, row, i + 1); });

    await ctx.assertRegionAccess(oldUnit.Region);

    // ต้องระบุตัวระบุของเครื่องใหม่มาอย่างน้อยหนึ่งอย่าง ไม่งั้นใบประวัติจะไม่มี
    // ความหมาย — บอกว่าเปลี่ยนเครื่องแล้วแต่ไม่มีอะไรบอกว่าเปลี่ยนเป็นตัวไหน
    const hasId = ['IndoorSN', 'OutdoorSN', 'IndoorAsset', 'OutdoorAsset']
      .some(k => String(newUnit[k] == null ? '' : newUnit[k]).trim());
    if (!hasId) {
      throw new Error('กรุณาระบุ S/N หรือเลขทะเบียนทรัพย์สินของเครื่องใหม่อย่างน้อยหนึ่งช่อง');
    }

    // เขียนเฉพาะช่องของตัวเครื่อง ช่องของตำแหน่งไม่ถูกแตะแม้แต่ช่องเดียว
    //
    // ล้างหมายเหตุด้วย เพราะหมายเหตุเกือบทั้งหมดคืออาการเสียของเครื่องตัวเก่า
    // ซึ่งจบไปพร้อมกับเครื่องนั้นแล้ว ถ้าปล่อยค้างไว้ หน้าเครื่องจะยังโชว์อาการเสีย
    // ของเครื่องที่ถูกยกออกไปแล้ว (อาการเดียวกับที่เคยแก้ตอนปิดงานซ่อม)
    // ข้อความเดิมไม่หายไปเฉยๆ แต่ถูกเก็บลงประวัติในบรรทัดถัดไป
    const prevNote = String(oldUnit.Note || '').trim();
    const payload = {
      Status: 'ใช้งานปกติ',
      Note: '',
      UpdatedAt: ymdhms(new Date()),
      UpdatedBy: await ctx.currentUser()
    };
    for (const f of MACHINE_FIELDS) {
      if (newUnit[f] !== undefined) payload[f] = newUnit[f];
    }
    ctx.ss.writeByHeaders(SHEETS.AIRLIST, row, payload);

    // เปลี่ยนเครื่องหลังจากที่ซ่อมไม่ได้ = ขั้นสุดท้ายของเคสงานซ่อมที่ค้างอยู่
    // ใบนี้จึงต้องถือเลขเคสเดิม เพื่อให้เรื่องทั้งเรื่องอ่านต่อกันได้ และเคสถึงจะปิด
    const openCase = openCaseOf(ctx.ss.objects(SHEETS.HISTORY), oldUnit.AirCode);

    await addHistoryRaw(ctx, {
      CaseID: openCase ? openCase.caseId : '',
      AirCode: oldUnit.AirCode,
      Date: newUnit.InstallDate || ymd(new Date()),
      EventType: 'เปลี่ยนเครื่อง',
      Detail: 'เปลี่ยนตัวเครื่องใหม่ที่ตำแหน่งเดิม' +
              ' — เครื่องเดิม: ' + describeMachine(oldUnit) +
              ' → เครื่องใหม่: ' + describeMachine({ ...oldUnit, ...payload }) +
              (prevNote ? ' | หมายเหตุเดิมของเครื่องเก่า: ' + prevNote : ''),
      Cost: newUnit.ReplaceCost || '',
      Technician: newUnit.Technician || ''
    });

    await ctx.ss.flush();
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}

export async function deleteAirUnit(ctx, row, expectCode) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('airlist');
    await ctx.ensureBase();
    ctx.assertRowIs(SHEETS.AIRLIST, row, 'AirCode', expectCode, 'เครื่องรหัส');

    const headers = ctx.ss.headers(SHEETS.AIRLIST);
    const unit = {};
    headers.forEach((h, i) => { if (h) unit[h] = ctx.ss.cell(SHEETS.AIRLIST, row, i + 1); });
    await ctx.assertRegionAccess(unit.Region);

    // บันทึกประวัติไว้ก่อนลบ กันไม่ให้การลบเครื่องออกจากระบบเงียบหายไปโดยไม่มีร่องรอย
    await addHistoryRaw(ctx, {
      AirCode: unit.AirCode,
      Date: ymd(new Date()),
      EventType: 'อื่นๆ',
      Detail: `ลบข้อมูลเครื่อง "${unit.AirCode}" (Node: ${unit.NodeName || '-'}) ออกจากระบบ`,
      Cost: '',
      Technician: ''
    });

    await ctx.ss.deleteRow(SHEETS.AIRLIST, row);
    await ctx.ss.flush();
    return { air: await getAirList(ctx), history: await getHistory(ctx) };
  });
}
