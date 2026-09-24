import { SHEETS, cleanFormColKind } from '../schema.js';
import { cleanFormValue, normalizeCode, normalizeRegion, plainText, ymdhms } from '../values.js';
import { addHistoryRaw, makeHistoryId, newestFirst, usedDocNumbers } from './history.js';
import { getAirList } from './airlist.js';
import { scheduleDocPdf, cancelDocPdf, settleDocPdfQueue } from './doc-pdf-queue.js';

/**
 * เอกสารบันทึกผลการติดตั้ง ตามแบบฟอร์มควบคุม ITEL-FM-NE-006
 *
 * ============================================================================
 * ต่างจากใบล้างและใบซ่อมตรงไหน
 * ============================================================================
 * โครงเหมือนใบล้าง — สองเครื่องต่อใบ เลขที่เอกสารใบละสองเลข หน้ารูปเครื่องละหน้า
 *
 * แต่มีสิ่งที่อีกสองใบไม่มี: **ใบนี้เขียนกลับไปที่ทะเบียนเครื่อง**
 * เพราะการติดตั้งคือจุดที่ตัวเครื่องจริงเปลี่ยน Serial/Asset/ยี่ห้อ/BTU ที่กรอก
 * ในใบนี้คือของเครื่องตัวใหม่ที่เพิ่งเอาไปติด ถ้าไม่เขียนกลับ ทะเบียนจะยังเป็น
 * ข้อมูลเครื่องเก่าหรือว่างอยู่ แล้วใบล้างกับใบซ่อมที่ออกทีหลังจะดึงข้อมูลผิดไปทั้งหมด
 * (ใบล้างกับใบซ่อม "อ่าน" จากทะเบียนอย่างเดียว ไม่เขียนกลับ เพราะไม่ได้เปลี่ยนตัวเครื่อง)
 *
 * ============================================================================
 * ไม่มีเคสงานเหมือนใบซ่อม
 * ============================================================================
 * งานติดตั้งไม่มีขั้นตอนแจ้ง-อนุมัติ-ปิดเคสแบบงานซ่อม จึงไม่มี CaseID
 * และไม่ต้องคืนสถานะเครื่อง ใบนี้แค่ลงประวัติ "ติดตั้ง" ไว้เป็นหลักฐาน
 */

const DOC_ASSETS = { fontHref: '/vendor/fonts.css', logoHref: '/assets/form-logo.png' };

/**
 * ชนิดเอกสารของโมดูลนี้ — ใช้บอกที่เก็บว่าไฟล์ของใบติดตั้งไปอยู่โฟลเดอร์ไหน
 * ไฟล์ PDF ไปที่ data/docs/install/ และรูปไปที่ data/photos/install/
 */
const KIND = 'install';

/** ประเภทเหตุการณ์ที่ใบนี้ลงในประวัติ */
const EVENT = 'ติดตั้ง';

export { settleDocPdfQueue };

/* ==================== อ่านรายการ ==================== */

/** แปลงแถวให้ส่งกลับหน้าเว็บได้ ตัดก้อน JSON ที่ตารางไม่ได้ใช้ออกเพื่อให้ response เบา */
const toSafe = (o, keepJson) => {
  const safe = { _row: o._row };
  for (const k of Object.keys(o)) {
    if (k === '_row') continue;
    if (!keepJson && k === 'ChecklistJSON') continue;
    safe[k] = cleanFormValue(o[k], cleanFormColKind(k));
  }
  return safe;
};

export async function getInstallForms(ctx, airCode) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) return [];
  await ctx.ensureBase();

  let list = ctx.ss.objects(SHEETS.INSTALLFORM).map(o => toSafe(o, false));

  if (airCode) {
    const nc = normalizeCode(airCode);
    list = list.filter(o =>
      normalizeCode(o.AirCode1) === nc || normalizeCode(o.AirCode2) === nc);
  }

  const info = await ctx.userInfo();
  if (info.role !== 'Admin') {
    list = list.filter(o => (info.regions || []).includes(normalizeRegion(o.Region)));
  }

  // เรียงที่หน้าเว็บไม่ได้ เพราะ _row ต้องติดไปกับข้อมูล — เรียงตรงนี้หลังแปลงแล้ว
  return list.sort(newestFirst('CreatedAt'));
}

/* ==================== บันทึก ==================== */

/**
 * ออกเลขที่เอกสารของเครื่องแต่ละตัว
 *
 * เครื่องหนึ่งตัวได้หนึ่งเลข แม้อยู่ในใบเดียวกัน เพราะการติดตั้งของแต่ละเครื่อง
 * เป็นคนละงานในสายตาของทะเบียนและประวัติ (กติกาเดียวกับใบล้าง)
 *
 * ต้องส่งเลขที่เพิ่งออกกลับเข้าไปด้วย เพราะตัวออกเลขนับจากแถวที่เขียนลงไปแล้ว
 * เท่านั้น ถ้าไม่ส่ง เครื่องสองตัวในใบเดียวกันจะได้เลขซ้ำกัน
 */
function assignDocNumbers(ctx, view, date, target = view) {
  const issued = [];

  for (const slot of [1, 2]) {
    const col = slot === 2 ? 'DocNo2' : 'DocNo';
    if (!plainText(view['AirCode' + slot]).trim()) continue;

    const have = plainText(view[col]).trim();
    if (have) { issued.push(have); continue; }

    const next = makeHistoryId(EVENT, date, [...usedDocNumbers(ctx), ...issued]);
    target[col] = next;
    issued.push(next);
  }

  return issued;
}

/** ข้อมูลเครื่องจากทะเบียน เอาไว้เติมช่องที่หน้าเว็บไม่ได้ส่งมา */
async function unitOf(ctx, airCode) {
  const nc = normalizeCode(airCode);
  const found = (await getAirList(ctx)).find(u => normalizeCode(u.AirCode) === nc);
  if (!found) throw new Error('ไม่พบเครื่องรหัส ' + plainText(airCode) + ' ในทะเบียนเครื่อง');
  return found;
}

/** ค่าที่กรอกมาจริง ถ้าเว้นว่างให้ใช้ของเดิมในทะเบียนแทน */
const pick = (typed, fallback) => {
  const t = plainText(typed).trim();
  return t || plainText(fallback);
};

/**
 * บันทึกเอกสารติดตั้งหนึ่งใบ
 *
 * ติดตั้งได้ทีละ 1–2 เครื่องต่อใบ ตามช่องที่แบบฟอร์มกระดาษมีให้
 */
export async function saveInstallForm(ctx, record) {
  await ctx.assertModuleEdit('cleaningform');

  const codes = [1, 2]
    .map(slot => plainText(record['AirCode' + slot]).trim())
    .filter(Boolean);

  if (!codes.length) throw new Error('กรุณาเลือกเครื่องปรับอากาศอย่างน้อย 1 เครื่อง');
  if (codes.length === 2 && normalizeCode(codes[0]) === normalizeCode(codes[1])) {
    throw new Error('เครื่องที่ 1 กับเครื่องที่ 2 ซ้ำกัน');
  }
  if (!plainText(record.Date).trim()) throw new Error('กรุณาระบุวันที่ติดตั้ง');

  // ดึงข้อมูลทะเบียนของทุกเครื่องก่อน เพื่อให้สิทธิ์ภูมิภาคถูกตรวจครบทุกตัว
  // ก่อนที่จะเริ่มเขียนอะไรลงไป ไม่ใช่เขียนตัวแรกเสร็จแล้วค่อยพบว่าตัวที่สองไม่มีสิทธิ์
  const units = {};
  for (const slot of [1, 2]) {
    const code = plainText(record['AirCode' + slot]).trim();
    if (!code) continue;
    const unit = await unitOf(ctx, code);
    await ctx.assertRegionAccess(unit.Region);
    units[slot] = unit;
  }

  const first = units[1] || units[2];

  const saved = await ctx.withLock(async () => {
    await ctx.ensureBase();

    const row = {
      ID: 'IF' + Date.now(),
      Date: plainText(record.Date),
      NodeName: first.NodeName,
      SiteCode: first.SiteCode,
      Region: first.Region,
      Province: first.Province,
      LocationType: first.LocationType,
      AirCode1: units[1] ? units[1].AirCode : '',
      AirCode2: units[2] ? units[2].AirCode : '',
      TimeStart: plainText(record.TimeStart),
      TimeEnd: plainText(record.TimeEnd),
      TotalTime: plainText(record.TotalTime),
      ChecklistJSON: JSON.stringify(record.Checklist || []),
      AcceptResult1: plainText(record.AcceptResult1),
      AcceptResult2: plainText(record.AcceptResult2),
      AdditionalNote: plainText(record.AdditionalNote),
      CompanyName: plainText(record.CompanyName),
      TechnicianName: plainText(record.TechnicianName),
      SupervisorName: plainText(record.SupervisorName),
      Cost: record.Cost === '' || record.Cost === undefined ? '' : Number(record.Cost) || '',
      CreatedAt: ymdhms(new Date()),
      RecordedBy: await ctx.currentUser()
    };

    // ข้อมูลเครื่องที่ติดตั้งจริง — ที่กรอกมาคือของตัวใหม่ ไม่ใช่ของในทะเบียน
    // ⚠️ ทะเบียนเก็บชื่อคอลัมน์ว่า IndoorSN/OutdoorSN แต่แบบฟอร์มเขียนว่า Serial
    // ต้องแปลงชื่อตรงนี้ ไม่งั้นช่อง Serial บนเอกสารจะว่างทั้งที่ทะเบียนมีข้อมูลอยู่
    for (const slot of [1, 2]) {
      const unit = units[slot];
      const p = 'Unit' + slot + '_';
      row[p + 'Brand'] = unit ? pick(record[p + 'Brand'], unit.Brand) : '';
      row[p + 'BTU'] = unit ? pick(record[p + 'BTU'], unit.BTU) : '';
      row[p + 'IndoorSerial'] = unit ? pick(record[p + 'IndoorSerial'], unit.IndoorSN) : '';
      row[p + 'IndoorAsset'] = unit ? pick(record[p + 'IndoorAsset'], unit.IndoorAsset) : '';
      row[p + 'OutdoorSerial'] = unit ? pick(record[p + 'OutdoorSerial'], unit.OutdoorSN) : '';
      row[p + 'OutdoorAsset'] = unit ? pick(record[p + 'OutdoorAsset'], unit.OutdoorAsset) : '';
    }

    // ออกเลขในล็อกเสมอ เพื่อไม่ให้สองคนที่บันทึกพร้อมกันได้เลขเดียวกัน
    assignDocNumbers(ctx, row, row.Date);

    const headers = ctx.ss.headers(SHEETS.INSTALLFORM);
    ctx.ss.appendRow(SHEETS.INSTALLFORM, headers.map(h => (row[h] !== undefined ? row[h] : '')));

    // ลงประวัติ "ติดตั้ง" ของเครื่องแต่ละตัว พร้อมอัปเดตทะเบียนให้เป็นเครื่องตัวใหม่
    for (const slot of [1, 2]) {
      const unit = units[slot];
      if (!unit) continue;

      const p = 'Unit' + slot + '_';
      const docNo = plainText(row[slot === 2 ? 'DocNo2' : 'DocNo']);
      const accept = plainText(row['AcceptResult' + slot]).trim();

      await addHistoryRaw(ctx, {
        AirCode: unit.AirCode,
        Date: row.Date,
        EventType: EVENT,
        Detail: ['ติดตั้งเครื่องใหม่', accept && 'ผลตรวจรับ: ' + accept].filter(Boolean).join(' — '),
        Cost: '',
        Technician: row.TechnicianName,
        Note: 'เอกสาร ' + docNo
      });

      // ============================================================================
      // เขียนข้อมูลเครื่องตัวใหม่กลับเข้าทะเบียน
      // ============================================================================
      // จุดที่ต่างจากอีกสองเอกสารโดยสิ้นเชิง — ติดตั้งคือการเปลี่ยนตัวเครื่องจริง
      // ทะเบียนต้องตามให้ทัน ไม่งั้นเอกสารล้าง/ซ่อมที่ออกทีหลังจะดึง Serial
      // ของเครื่องเก่าที่ถูกถอดไปแล้วมาใช้ โดยไม่มีอะไรฟ้อง
      //
      // เขียนเฉพาะช่องที่มีค่าจริง เพื่อไม่ให้ช่องที่ช่างเว้นว่างไปลบข้อมูลเดิมทิ้ง
      const airRow = ctx.ss.objects(SHEETS.AIRLIST)
        .find(a => normalizeCode(a.AirCode) === normalizeCode(unit.AirCode));
      if (!airRow) continue;

      const update = {
        Brand: row[p + 'Brand'],
        BTU: row[p + 'BTU'],
        IndoorSN: row[p + 'IndoorSerial'],
        IndoorAsset: row[p + 'IndoorAsset'],
        OutdoorSN: row[p + 'OutdoorSerial'],
        OutdoorAsset: row[p + 'OutdoorAsset'],
        InstallDate: row.Date,
        UpdatedAt: ymdhms(new Date()),
        UpdatedBy: row.RecordedBy
      };
      for (const k of Object.keys(update)) {
        if (plainText(update[k]).trim() === '') delete update[k];
      }

      // ติดตั้งเสร็จแล้วเครื่องต้องพร้อมใช้งาน ยกเว้นตรวจรับไม่ผ่าน
      // ซึ่งแปลว่ายังมีอะไรต้องแก้ ปล่อยให้เป็นสถานะเดิมไว้ให้คนตามต่อ
      if (accept === 'ผ่าน') update.Status = 'ใช้งานปกติ';

      ctx.ss.writeByHeaders(SHEETS.AIRLIST, airRow._row, update);
    }

    await ctx.ss.flush();
    return {
      docNo: plainText(row.DocNo),
      docNo2: plainText(row.DocNo2),
      forms: await getInstallForms(ctx)
    };
  });

  // เก็บสำเนา PDF ไว้บนเซิร์ฟเวอร์ (นอกล็อก เพราะต้องรอเบราว์เซอร์แปลงไฟล์)
  await storeInstallPdf(ctx, saved.docNo);
  return saved;
}

/* ==================== ลบ ==================== */

export async function deleteInstallForm(ctx, row, expectId) {
  return ctx.withLock(async () => {
    await ctx.assertModuleEdit('cleaningform');
    await ctx.ensureBase();

    // เลขแถวคือ "ลำดับที่เท่าไหร่ในตาราง" ไม่ใช่ id ถาวร มีคนลบใบข้างบนไป
    // ระหว่างที่อีกคนเปิดหน้าค้างไว้ คำสั่งนี้จะไปโดนเอกสารใบถัดไปแทน
    ctx.assertRowIs(SHEETS.INSTALLFORM, row, 'ID', expectId, 'เอกสารเลขที่');

    const headers = ctx.ss.headers(SHEETS.INSTALLFORM);
    const region = ctx.ss.cell(SHEETS.INSTALLFORM, row, headers.indexOf('Region') + 1);
    await ctx.assertRegionAccess(region);

    // จำเลขที่ไว้ก่อนลบแถว เพื่อตามไปลบรูปและไฟล์ของใบนี้ด้วย
    const docNo = plainText(ctx.ss.cell(SHEETS.INSTALLFORM, row, headers.indexOf('DocNo') + 1)) ||
                  plainText(ctx.ss.cell(SHEETS.INSTALLFORM, row, headers.indexOf('ID') + 1));

    await ctx.ss.deleteRow(SHEETS.INSTALLFORM, row);
    await ctx.ss.flush();

    // ลบไฟล์หลังลบแถวสำเร็จแล้วเท่านั้น และห้ามให้การลบไฟล์ล้มแล้วทำให้ทั้งคำสั่งพัง
    if (ctx.photos && docNo) {
      try { ctx.photos.removeAll(KIND, docNo); } catch { /* รูปค้างดีกว่าผู้ใช้สับสน */ }
    }
    if (ctx.docs && docNo) {
      // ยกเลิกงานสร้างไฟล์ที่ค้างอยู่ก่อน ไม่งั้นไฟล์จะถูกสร้างกลับมาหลังลบไปแล้ว
      cancelDocPdf(docNo);
      try { ctx.docs.remove(KIND, docNo); } catch { /* ไฟล์ค้างดีกว่าผู้ใช้สับสน */ }
    }

    return getInstallForms(ctx);
  });
}

/* ==================== รูปถ่าย ==================== */

/** หาใบเอกสารจากเลขแถว พร้อมตรวจสิทธิ์ภูมิภาค */
async function formForPhotos(ctx, row) {
  await ctx.ensureBase();
  const form = ctx.ss.objects(SHEETS.INSTALLFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await ctx.assertRegionAccess(form.Region);

  const docNo = plainText(form.DocNo) || plainText(form.ID);
  if (!docNo) throw new Error('เอกสารใบนี้ยังไม่มีเลขที่ จึงเก็บรูปไม่ได้');
  return { form, docNo };
}

function requirePhotoStore(ctx) {
  if (!ctx.photos) throw new Error('ระบบที่รันอยู่ตอนนี้ไม่รองรับการเก็บรูป (ไม่มีที่เก็บไฟล์)');
  return ctx.photos;
}

/** ช่องเครื่องที่รูปจะไปอยู่ — ใบติดตั้งมีสองเครื่อง จึงต้องระบุมาให้ชัด */
function slotOf(form, payload) {
  const slot = Number((payload && payload.slot) || 1);
  if (slot !== 1 && slot !== 2) throw new Error('เครื่องที่ ' + slot + ' ไม่มีในเอกสารใบนี้');
  if (!plainText(form['AirCode' + slot]).trim()) {
    throw new Error('เอกสารใบนี้ไม่มีเครื่องที่ ' + slot);
  }
  return slot;
}

/** รอผลของงานที่แก้รูป แล้วนัดสร้างไฟล์ PDF ใหม่ให้ตรงกับรูปล่าสุด */
async function withFreshPdf(ctx, work) {
  const { docNo, ...out } = await work;
  scheduleDocPdf(ctx, docNo, () => storeInstallPdf(ctx, docNo));
  return out;
}

export async function saveInstallPhoto(ctx, payload) {
  return withFreshPdf(ctx, ctx.withLock(async () => {
    await ctx.assertModuleEdit('cleaningform');
    const store = requirePhotoStore(ctx);

    const { form, docNo } = await formForPhotos(ctx, payload && payload.row);
    const saved = store.save(KIND, docNo, slotOf(form, payload), payload.index, payload.dataUrl);
    return { ok: true, docNo, bytes: saved.bytes, photos: Object.keys(store.readAll(KIND, docNo)) };
  }));
}

export async function deleteInstallPhoto(ctx, payload) {
  return withFreshPdf(ctx, ctx.withLock(async () => {
    await ctx.assertModuleEdit('cleaningform');
    const store = requirePhotoStore(ctx);

    const { form, docNo } = await formForPhotos(ctx, payload && payload.row);
    store.remove(KIND, docNo, slotOf(form, payload), Number(payload.index));
    return { ok: true, docNo, photos: Object.keys(store.readAll(KIND, docNo)) };
  }));
}

/** รูปทั้งหมดของใบหนึ่ง พร้อมตัวรูปจริง สำหรับหน้าแก้รูป */
export async function getInstallPhotos(ctx, row) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) return {};
  if (!ctx.photos) return {};

  const { docNo } = await formForPhotos(ctx, row);
  return { docNo, photos: ctx.photos.readAll(KIND, docNo) };
}

/* ==================== เอกสาร ==================== */

/** หน้าเอกสารสำหรับเปิดดูและสั่งปริ้น */
export async function getInstallDocHtml(ctx, row) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');
  await ctx.ensureBase();

  const form = ctx.ss.objects(SHEETS.INSTALLFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await ctx.assertRegionAccess(form.Region);

  const { buildInstallDocHtml } = await import('./install-doc.js');
  const docNo = plainText(form.DocNo) || plainText(form.ID);
  const photos = ctx.photos ? ctx.photos.readAll(KIND, docNo) : {};
  // toolbar ใส่เฉพาะตอนเปิดดูบนจอ ตอนแปลงเป็นไฟล์ PDF ไม่ใส่
  return buildInstallDocHtml(form, { ...DOC_ASSETS, photos, toolbar: true });
}

/** ฟอร์มเปล่าสำหรับปริ้นไปเขียนมือหน้างาน */
export async function getInstallBlankDocHtml(ctx, record) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) throw new Error('ไม่มีสิทธิ์เข้าถึงเมนูนี้');

  const payload = { ...(record || {}) };
  payload.DocNo = '(ฟอร์มเปล่า — ยังไม่ได้บันทึก)';
  payload.ChecklistJSON = JSON.stringify(payload.Checklist || []);

  const { buildInstallDocHtml } = await import('./install-doc.js');
  return buildInstallDocHtml(payload, DOC_ASSETS);
}

/**
 * แปลงก้อนไบต์เป็นข้อความ base64
 *
 * ทำทีละ 8KB ไม่ใช่ส่งทั้งก้อนเข้า String.fromCharCode ทีเดียว เพราะการกระจาย
 * อาร์เรย์เป็นพารามิเตอร์หลักหมื่นตัวทำให้ call stack ล้นบนเครื่องบางเครื่อง
 */
function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(out);
}

/** ฟอร์มเปล่าแบบ Excel ที่เติมข้อมูล Node กับเครื่องให้แล้ว (วางรูปลงไปได้) */
export async function getInstallBlankXlsx(ctx, record) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) throw new Error('ไม่มีสิทธิ์เข้าถึงเมนูนี้');
  if (!ctx.forms) throw new Error('เครื่องที่รันระบบอยู่ไม่มีไฟล์แบบฟอร์มแม่แบบ');

  const { buildInstallXlsx, installXlsxFileName } = await import('./install-xlsx.js');
  const bytes = await buildInstallXlsx(ctx.forms.read('install'), record || {});

  return {
    base64: toBase64(bytes),
    fileName: installXlsxFileName(record),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
}

/** แปลงใบหนึ่งเป็นไฟล์ PDF (ยังไม่เก็บ ยังไม่ส่งให้ใคร) */
async function renderPdf(ctx, form) {
  const docNo = plainText(form.DocNo) || plainText(form.ID);
  const base = ctx.pdf.baseUrl || '';

  const { buildInstallDocHtml } = await import('./install-doc.js');
  const html = buildInstallDocHtml(form, {
    // ที่อยู่เต็ม เพราะเบราว์เซอร์เปิดหน้านี้จากไฟล์ชั่วคราว ไม่ได้เปิดผ่านเซิร์ฟเวอร์
    fontHref: base + DOC_ASSETS.fontHref,
    logoHref: base + DOC_ASSETS.logoHref,
    photos: ctx.photos ? ctx.photos.readAll(KIND, docNo) : {}
  });

  return { docNo, base64: await ctx.pdf.render(html) };
}

/**
 * เก็บสำเนา PDF ไว้บนเซิร์ฟเวอร์ — ห้ามพัง
 *
 * ตัวจริงของข้อมูลอยู่ในฐานข้อมูล ไฟล์นี้เป็นสำเนาที่สร้างใหม่ได้เสมอ
 * ถ้าเครื่องไม่มีเบราว์เซอร์ หรือดิสก์เต็ม ต้องไม่ทำให้การบันทึกที่ลงไปแล้ว
 * กลายเป็น "ล้มเหลว" ในสายตาผู้ใช้ แล้วเขากดบันทึกซ้ำจนข้อมูลซ้ำ
 */
async function storeInstallPdf(ctx, docNo) {
  const name = plainText(docNo).trim();
  if (!ctx.pdf || !ctx.docs || !name) return false;

  try {
    const form = ctx.ss.objects(SHEETS.INSTALLFORM)
      .find(f => (plainText(f.DocNo) || plainText(f.ID)) === name);
    if (!form) return false;

    const { base64 } = await renderPdf(ctx, form);
    ctx.docs.save(KIND, name, plainText(form.Date), base64);
    return true;
  } catch (err) {
    console.error('[เก็บไฟล์ PDF ติดตั้ง ' + name + ']', err && err.message ? err.message : err);
    return false;
  }
}

/** แปลงเป็นไฟล์ PDF ให้ดาวน์โหลด และเก็บสำเนาไว้บนเซิร์ฟเวอร์ไปด้วย */
export async function getInstallDocPdf(ctx, row, expectId) {
  await ctx.requireAccess();
  if (!(await ctx.canView('cleaningform'))) throw new Error('คุณไม่มีสิทธิ์ดูเอกสารส่วนนี้');
  if (!ctx.pdf) {
    throw new Error(
      'เครื่องที่รันระบบอยู่ไม่มีเบราว์เซอร์สำหรับแปลงเป็นไฟล์ PDF — ' +
      'กด "เปิดเอกสาร" แล้วสั่งปริ้นเองได้ผลเหมือนกัน'
    );
  }

  await ctx.ensureBase();

  // ตรวจว่าแถวนั้นยังเป็นใบเดิมอยู่จริง ก่อนสร้างไฟล์
  ctx.assertRowIs(SHEETS.INSTALLFORM, row, 'ID', expectId, 'เอกสารเลขที่');

  const form = ctx.ss.objects(SHEETS.INSTALLFORM).find(f => f._row === Number(row));
  if (!form) throw new Error('ไม่พบเอกสารใบนี้');
  await ctx.assertRegionAccess(form.Region);

  const { docNo, base64 } = await renderPdf(ctx, form);

  if (ctx.docs) {
    try { ctx.docs.save(KIND, docNo, plainText(form.Date), base64); }
    catch (err) { console.error('[เก็บไฟล์ PDF ติดตั้ง ' + docNo + ']', err && err.message ? err.message : err); }
  }

  return { fileName: docNo + '.pdf', mime: 'application/pdf', base64 };
}
