/**
 * สะพานเชื่อมไปยัง Apps Script ที่เหลือไว้ทำ PDF และ Google Drive อย่างเดียว
 *
 * ============================================================================
 * ทำไมงานส่วนนี้ยังอยู่ที่ Apps Script
 * ============================================================================
 * ฟอร์มล้างแอร์สร้าง PDF ด้วยวิธีที่ผูกกับ Google โดยตรง คือวาดตารางลงชีตแม่แบบ
 * แล้วสั่ง Google export ชีตนั้นเป็น PDF ข้อดีคือหน้าตาตรงกับฟอร์มกระดาษเป๊ะ
 * และการันตีว่าได้ 1 หน้าเสมอ ซึ่งเขียนใหม่ด้วยไลบรารี PDF ทั่วไปทำได้ยากมาก
 * (โดยเฉพาะฟอนต์ไทยและการย่อให้พอดีหน้า)
 * ============================================================================
 *
 * ============================================================================
 * ข้อจำกัดสำคัญ: Apps Script รับงานพร้อมกันได้น้อยมาก
 * ============================================================================
 * การสร้าง PDF หนึ่งไฟล์ใช้เวลาราว 7-8 วินาที (คัดลอกชีต เติมข้อมูล สั่ง export ลบชีต)
 * ถ้ามีคำขอที่สองเข้ามาระหว่างที่ตัวแรกยังทำงานอยู่ Apps Script จะไปต่อได้
 * แต่พอถึงคำขอที่สาม มันจะค้างยาวแล้วตอบกลับมาเป็น "หน้าเว็บแจ้ง error"
 * แทนที่จะเป็นข้อมูล JSON ตามปกติ (ทดสอบแล้วเจอจริง รอ 35 วินาทีแล้วได้หน้า "ไม่พบเพจ")
 *
 * ไฟล์นี้จึงจัดคิวให้คำขอวิ่งทีละงาน และลองใหม่ให้อัตโนมัติเมื่อเจออาการค้าง
 * ผู้ใช้อาจต้องรอนานขึ้นเล็กน้อยตอนมีคนใช้พร้อมกัน แต่จะไม่เจอ error แบบเดิมอีก
 * ============================================================================
 */

/**
 * เวลาสูงสุดที่ยอมรอ Apps Script ต่อหนึ่งคำขอ
 * ปกติสร้างเสร็จใน 7-8 วินาที เผื่อไว้เยอะเพราะ Google ตอบไม่คงที่
 */
const TIMEOUT_MS = 120000;

/**
 * ⚠️ ตั้งใจไม่ลองใหม่อัตโนมัติ
 *
 * เคยใส่ระบบลองใหม่ไว้แล้วพบว่า "ทำให้แย่ลง" ไม่ใช่ดีขึ้น
 * เพราะตอนที่ฝั่งเราหมดเวลารอ งานเดิมยังทำงานค้างอยู่ที่ Google
 * การยิงซ้ำจึงไปเพิ่มงานทับของเดิม กลายเป็นยิ่งยิงยิ่งตัน
 * (ทดสอบจริงแล้ว: ยิง 4 คำขอพร้อมกันโดยมีระบบลองใหม่ ใช้เวลารวม 414 วินาที
 *  และล้มเหลว 2 งาน ทั้งที่ยิงทีละงานเฉยๆ ใช้เวลาแค่ 8 วินาทีต่องาน)
 *
 * ถ้าคิวตัน ให้บอกผู้ใช้ตรงๆ แล้วให้เขาตัดสินใจกดใหม่เองดีกว่า
 */

/**
 * คิวงาน — บังคับให้คุยกับ Apps Script ทีละคำขอเท่านั้น
 *
 * หมายเหตุ: คิวนี้ใช้ได้ผลเมื่อรันเป็น process เดียว (บนเครื่องหรือ server บริษัท)
 * ถ้าวันหลังย้ายไป Cloudflare ซึ่งกระจายรันหลายเครื่อง ต้องเปลี่ยนไปใช้
 * Durable Object เป็นคิวกลางแทน ไม่งั้นแต่ละเครื่องจะมีคิวเป็นของตัวเอง
 */
let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);
  // กันไม่ให้งานที่ล้มเหลวทำให้คิวทั้งเส้นพังตามไปด้วย
  queue = run.then(() => undefined, () => undefined);
  return run;
}

/** ดึงข้อความ error ที่อ่านรู้เรื่องออกมาจากหน้า HTML ที่ Google ตอบกลับ */
function readHtmlError(html) {
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return (title || text.slice(0, 120) || 'ไม่ทราบสาเหตุ').trim();
}

/** เรียกใช้บริการ PDF ฝั่ง Apps Script หนึ่งครั้ง (ยังไม่จัดการเรื่องคิวหรือลองใหม่) */
async function callOnce(env, action, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(env.PDF_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.PDF_SERVICE_SECRET || '', action, payload }),
      // Apps Script ตอบกลับด้วยการ redirect ไปโดเมน googleusercontent เสมอ
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') {
      throw new Error(
        'รอบริการสร้าง PDF นานเกิน 2 นาทีแล้วยังไม่ตอบกลับ — ' +
        'ข้อมูลถูกบันทึกไว้แล้ว ลองกดสร้าง PDF ใหม่อีกครั้งภายหลัง'
      );
    }
    throw new Error('ติดต่อบริการสร้าง PDF ไม่ได้: ' + String((e && e.message) || e));
  }
  clearTimeout(timer);

  const text = await res.text();

  // ตอบกลับเป็นหน้าเว็บ ไม่ใช่ข้อมูล — เกือบทุกครั้งคือ Google กำลังจำกัดการใช้งาน
  if (text.trim().startsWith('<')) {
    throw new Error(
      'ตอนนี้ Google ยังสร้าง PDF ให้ไม่ได้ (' + readHtmlError(text) + ') ' +
      'มักเกิดจากสร้างไฟล์ถี่เกินไปในช่วงสั้นๆ — ข้อมูลถูกบันทึกไว้แล้ว ' +
      'ลองกดสร้าง PDF ใหม่อีกครั้งในอีกสักพัก'
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('บริการสร้าง PDF ตอบกลับมาในรูปแบบที่อ่านไม่ได้');
  }

  if (!data.ok) {
    // เป็น error จากตัวสคริปต์เอง เช่นรหัสลับไม่ตรง — ลองใหม่ก็ไม่ช่วย
    throw new Error(data.error || 'สร้าง PDF ไม่สำเร็จ');
  }
  return data.result;
}

/** เรียกใช้บริการ PDF โดยเข้าคิวและลองใหม่ให้อัตโนมัติเมื่อเจออาการค้าง */
async function callPdfService(env, action, payload) {
  if (!env.PDF_SERVICE_URL) {
    throw new Error(
      'ยังไม่ได้ตั้งค่าบริการสร้าง PDF (PDF_SERVICE_URL) — ' +
      'ข้อมูลถูกบันทึกแล้ว แต่ยังสร้างไฟล์ PDF ไม่ได้'
    );
  }

  return enqueue(() => callOnce(env, action, payload));
}

/** สร้าง PDF ของฟอร์มล้างแอร์ คืนค่า { url, fileId } */
export async function buildCleaningPdf(env, record) {
  return callPdfService(env, 'buildPdf', record);
}

/** อัปโหลดไฟล์เอกสารแนบเข้าโฟลเดอร์ของ Node */
export async function uploadNodeDocs(env, payload) {
  return callPdfService(env, 'uploadDocs', payload);
}
