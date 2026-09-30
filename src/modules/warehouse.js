import { SHEETS } from '../schema.js';
import { isRetiredStatus, partsOf, plainText, ymd, ymdhms } from '../values.js';

/**
 * คลังแอร์ — เครื่องเก่าที่ถูกถอดออกจากตำแหน่ง รอขาย/ทิ้ง (Write off)
 *
 * ============================================================================
 * ทำไมต้องมีตารางของตัวเอง ไม่ใช้ Node "คลัง" ในทะเบียน
 * ============================================================================
 * แถวในทะเบียน (air_units) คือ "ตำแหน่ง" เช่น ATG-PMK-AIR-1 ไม่ใช่ตัวเครื่อง
 * พอเปลี่ยนเครื่อง แถวเดิมกลายเป็นของเครื่องใหม่ เครื่องเก่าเหลือแค่ข้อความในประวัติ
 * ตารางนี้เก็บเครื่องเก่าเป็นรายการของมันเอง (Serial / Asset ครบ) ตามได้ว่ายังอยู่ในคลัง
 * หรือ Write off ไปแล้ว — โดยไม่ต้องมี Node ปลอมที่ไปโผล่ในแผนล้าง ปฏิทิน สิทธิ์ภูมิภาค และแดชบอร์ด
 *
 * ============================================================================
 * เครื่องเข้าคลังเมื่อไหร่
 * ============================================================================
 *   เปลี่ยนเครื่อง (replaceAirUnit)         เครื่องเก่าของตำแหน่งนั้น
 *   ย้ายเครื่องไปแทน (moveAirUnit)         เครื่องเดิมของตำแหน่งปลายทาง
 * ตำแหน่งที่ว่างอยู่แล้ว (ไม่มี Serial / Asset / ยี่ห้อ) ไม่มีเครื่องให้เก็บ
 *
 * สถานะในคลัง: "รื้อถอน/ปลดระวาง" (อยู่ในคลัง) → "Write off" (ขาย/ทิ้งแล้ว)
 * ตำแหน่งที่ "ซ่อมไม่ได้" แต่ยังไม่ได้เปลี่ยนเครื่อง เครื่องยังผูกกับตำแหน่ง — หน้าคลังแสดงแยก
 * จากทะเบียน (getWarehouse.retired) พอเปลี่ยนเครื่องแล้ว เครื่องตัวนั้นถึงย้ายเข้าตารางนี้
 */

export const STOCK_IN = 'รื้อถอน/ปลดระวาง';
export const STOCK_OUT = 'Write off';

/** ช่องของตัวเครื่องที่ติดไปกับเครื่องเข้าคลัง */
const MACHINE = [
  'Brand', 'BTU', 'ModelIndoor', 'ModelOutdoor',
  'IndoorAsset', 'IndoorSN', 'OutdoorAsset', 'OutdoorSN', 'InstallDate', 'WarrantyExpire'
];

/** เลขที่รายการคลัง — WH + ปี 2 หลัก + เดือน + ลำดับในเดือน (แบบเดียวกับเลขเอกสาร/เลขเคส) */
function nextStockId(ctx) {
  const { y, m } = partsOf(new Date());
  const stem = 'WH' + String(y).slice(-2) + String(m).padStart(2, '0') + '-';
  let max = 0;
  for (const r of ctx.ss.objects(SHEETS.WAREHOUSE)) {
    const id = plainText(r.ID);
    if (!id.startsWith(stem)) continue;
    const n = Number(id.slice(stem.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return stem + String(max + 1).padStart(2, '0');
}

/**
 * เก็บเครื่องที่ถูกถอดออกจากตำแหน่งเข้าคลัง — เรียกในล็อก ก่อนเขียนเครื่องใหม่ทับตำแหน่ง
 *
 * @param {Object} unit   แถวทะเบียนของตำแหน่งนั้น "ก่อน" เปลี่ยน (มีข้อมูลเครื่องเก่า)
 * @param {string} reason เหตุที่เข้าคลัง เช่น "เปลี่ยนเครื่อง"
 * @returns {string} เลขที่รายการคลัง ('' = ตำแหน่งว่าง ไม่มีเครื่องให้เก็บ)
 */
export async function stockOldMachine(ctx, unit, reason, caseId = '') {
  const hasMachine = ['Brand', 'IndoorSN', 'OutdoorSN', 'IndoorAsset', 'OutdoorAsset']
    .some(f => plainText(unit[f]).trim());
  if (!hasMachine) return '';

  const row = {
    ID: nextStockId(ctx),
    AirCode: plainText(unit.AirCode),
    NodeName: plainText(unit.NodeName),
    SiteCode: plainText(unit.SiteCode),
    Region: plainText(unit.Region),
    Province: plainText(unit.Province),
    // ตำแหน่งที่ Write off อยู่แล้วตอนเปลี่ยน = เครื่องนั้น Write off แล้ว ไม่ต้องทำซ้ำในคลัง
    Status: plainText(unit.Status).trim() === STOCK_OUT ? STOCK_OUT : STOCK_IN,
    InDate: ymd(new Date()),
    InReason: plainText(reason),
    CaseID: plainText(caseId),
    // อาการเสียของเครื่องตัวนี้ ติดไปกับเครื่อง (ตำแหน่งถูกล้างหมายเหตุตอนเปลี่ยนเครื่อง)
    Note: plainText(unit.Note),
    CreatedAt: ymdhms(new Date()),
    CreatedBy: await ctx.currentUser()
  };
  for (const f of MACHINE) row[f] = unit[f] === undefined || unit[f] === null ? '' : unit[f];

  const headers = ctx.ss.headers(SHEETS.WAREHOUSE);
  ctx.ss.appendRow(SHEETS.WAREHOUSE, headers.map(h => (row[h] !== undefined ? row[h] : '')));
  return row.ID;
}

/**
 * หน้าคลังแอร์
 * @returns {{stock: Array, retired: Array}}
 *   stock   เครื่องในคลัง (ถอดออกจากตำแหน่งแล้ว) ใหม่ก่อน
 *   retired ตำแหน่งในทะเบียนที่สถานะเลิกใช้ แต่ยังไม่ได้เปลี่ยนเครื่อง (เช่น ซ่อมไม่ได้ รอเครื่องใหม่)
 */
export async function getWarehouse(ctx) {
  await ctx.requireAccess();
  // คลังแอร์เห็นเฉพาะ Infrastructure (เจ้าของงานกำหนด)
  await ctx.assertAdmin();
  await ctx.ensureBase();
  const inScope = await ctx.scopeFilter();

  const clean = o => {
    const out = { _row: o._row };
    for (const k of Object.keys(o)) if (k !== '_row') out[k] = o[k] === null || o[k] === undefined ? '' : o[k];
    return out;
  };
  const stock = ctx.ss.objects(SHEETS.WAREHOUSE).filter(inScope).map(clean)
    .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
  const retired = ctx.ss.objects(SHEETS.AIRLIST)
    .filter(u => isRetiredStatus(u.Status)).filter(inScope).map(clean)
    .sort((a, b) => String(a.AirCode).localeCompare(String(b.AirCode)));
  return { stock, retired };
}

/** Write off เครื่องในคลัง (ขาย/ทิ้งแล้ว) — เฉพาะ Infrastructure เหมือนการเห็นคลัง */
export async function writeOffStock(ctx, id) {
  return ctx.withLock(async () => {
    await ctx.assertAdmin();
    await ctx.ensureBase();
    const want = plainText(id).trim();
    const row = ctx.ss.objects(SHEETS.WAREHOUSE).find(r => plainText(r.ID) === want);
    if (!row) throw new Error('ไม่พบรายการ ' + want + ' ในคลัง (อาจถูกลบไปแล้ว)');
    await ctx.assertRegionAccess(row.Region);
    if (plainText(row.Status).trim() === STOCK_OUT) throw new Error('รายการ ' + want + ' Write off ไปแล้ว');

    ctx.ss.writeByHeaders(SHEETS.WAREHOUSE, row._row, {
      Status: STOCK_OUT,
      WriteOffDate: ymd(new Date()),
      WriteOffBy: await ctx.currentUser()
    });
    await ctx.ss.flush();
    return getWarehouse(ctx);
  });
}
