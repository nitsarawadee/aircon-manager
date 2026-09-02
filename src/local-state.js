import { readFile, writeFile, rename } from 'node:fs/promises';

/**
 * ตัวเก็บ session และคิวกันเขียนชนกัน สำหรับตอนรันบนเครื่องตัวเอง / server บริษัท
 *
 * ทำหน้าที่เดียวกับ AppState (Durable Object) ของฝั่ง Cloudflare เป๊ะๆ
 * มีเมธอดชื่อเดียวกัน รับค่าเหมือนกัน โค้ดส่วนอื่นจึงไม่รู้เลยว่ากำลังรันอยู่บนอะไร
 *
 * ต่างกันตรงที่ฝั่งนี้เก็บไว้ในหน่วยความจำของ process เดียว ซึ่งใช้ได้เพราะ
 * server ตัวเดียวรับงานทั้งหมด (ต่างจาก Cloudflare ที่กระจายไปหลายเครื่องทั่วโลก)
 *
 * ⚠️ ถ้าวันหลังต้องรันหลาย process พร้อมกัน (เช่นใช้ PM2 แบบ cluster หรือหลายเครื่อง)
 * ต้องเปลี่ยนมาใช้ Redis หรือฐานข้อมูลกลางแทน ไม่งั้นแต่ละ process จะมี session
 * และคิวเป็นของตัวเอง ผู้ใช้จะหลุดล็อกอินสลับไปมา และการล็อกจะกันข้อมูลชนกันไม่ได้จริง
 */

/** อายุของ session — ต่ออายุอัตโนมัติทุกครั้งที่มีการเรียก API ระหว่างที่ยังไม่หมดอายุ */
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 ชั่วโมง

/** เวลาที่ยอมรอคิวเขียนข้อมูลก่อนจะยอมแพ้ */
const LOCK_WAIT_MS = 25000;

/** เวลาสูงสุดที่ยอมให้ผู้ถือคิวถือไว้ ก่อนจะถือว่าค้างแล้วปล่อยให้คนถัดไป */
const LOCK_HOLD_MS = 30000;

export class LocalState {
  /**
   * @param {string} [sessionFile] ไฟล์สำหรับเก็บ session ข้ามการรีสตาร์ท
   *   ถ้าไม่ระบุ ผู้ใช้ทุกคนจะหลุดล็อกอินทุกครั้งที่รีสตาร์ท server
   */
  constructor(sessionFile) {
    this.sessionFile = sessionFile || null;
    this.sessions = new Map(); // token -> { username, expiresAt }

    this._locked = false;
    this._waiters = [];
    this._lockedAt = 0;

    this._saveTimer = null;
  }

  /* ============================ SESSION ============================ */

  /** อ่าน session ที่ค้างไว้จากรอบก่อน (เรียกครั้งเดียวตอน server เริ่มทำงาน) */
  async load() {
    if (!this.sessionFile) return;
    try {
      const raw = await readFile(this.sessionFile, 'utf8');
      const now = Date.now();
      for (const [token, rec] of Object.entries(JSON.parse(raw))) {
        if (rec && rec.expiresAt > now) this.sessions.set(token, rec);
      }
    } catch {
      // ยังไม่มีไฟล์ หรือไฟล์เสีย — เริ่มใหม่จากศูนย์ ไม่ใช่เรื่องผิดปกติ
    }
  }

  /**
   * บันทึก session ลงไฟล์แบบหน่วงเวลา
   * รวบการเขียนหลายครั้งติดกันให้เหลือครั้งเดียว จะได้ไม่เขียนดิสก์ทุก request
   */
  _scheduleSave() {
    if (!this.sessionFile || this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save().catch(() => { /* เขียนไม่ได้ก็ไม่ควรทำให้ระบบล่ม */ });
    }, 2000);
    // อย่าให้ตัวจับเวลานี้กัน process ไม่ให้ปิดตัวลงตอนสั่งหยุด server
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  async _save() {
    const now = Date.now();
    const out = {};
    for (const [token, rec] of this.sessions) {
      if (rec.expiresAt > now) out[token] = rec;
    }
    // เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อยเปลี่ยนชื่อทับ
    // กันไฟล์เสียถ้าไฟดับหรือปิดเครื่องกลางคัน
    const tmp = this.sessionFile + '.tmp';
    await writeFile(tmp, JSON.stringify(out), 'utf8');
    await rename(tmp, this.sessionFile);
  }

  /** สร้าง session ใหม่ผูกกับ username คืนค่า token */
  async createSession(username) {
    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
    this.sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
    this._scheduleSave();
    return token;
  }

  /**
   * อ่าน username ที่ผูกกับ token นี้ พร้อมต่ออายุ session ให้อัตโนมัติ
   * คืนค่าข้อความว่างถ้าไม่มี token หรือหมดอายุแล้ว
   */
  async touchSession(token) {
    if (!token) return '';
    const rec = this.sessions.get(token);
    if (!rec) return '';

    if (rec.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      this._scheduleSave();
      return '';
    }

    // ต่ออายุเฉพาะตอนที่เหลือน้อยกว่าครึ่งหนึ่งแล้ว ลดการเขียนไฟล์ลงมาก
    if (rec.expiresAt - Date.now() < SESSION_TTL_MS / 2) {
      rec.expiresAt = Date.now() + SESSION_TTL_MS;
      this._scheduleSave();
    }
    return rec.username;
  }

  /** ทำลาย session (ใช้ตอนออกจากระบบ) */
  async destroySession(token) {
    if (token && this.sessions.delete(token)) this._scheduleSave();
    return true;
  }

  /** ยกเลิก session ทั้งหมดของผู้ใช้คนหนึ่ง (ใช้ตอน Admin ปิดบัญชีหรือลบผู้ใช้) */
  async destroySessionsOf(username) {
    const target = String(username || '').trim().toLowerCase();
    if (!target) return 0;

    let n = 0;
    for (const [token, rec] of this.sessions) {
      if (String(rec.username || '').trim().toLowerCase() === target) {
        this.sessions.delete(token);
        n++;
      }
    }
    if (n) this._scheduleSave();
    return n;
  }

  /* ============================== LOCK ============================== */

  /**
   * เข้าคิวเพื่อเขียนข้อมูล — คืนค่า true เมื่อได้คิว, false ถ้ารอนานเกินกำหนด
   * ผู้เรียกจะค้างรอในคิวให้เลย ไม่ต้องวนถามซ้ำ
   */
  async acquireLock() {
    // ถ้าคนก่อนหน้าถือไว้นานผิดปกติ ถือว่าค้างแล้ว ปล่อยให้คิวเดินต่อ
    if (this._locked && Date.now() - this._lockedAt > LOCK_HOLD_MS) {
      this._locked = false;
      this._waiters = [];
    }

    if (!this._locked) {
      this._locked = true;
      this._lockedAt = Date.now();
      return true;
    }

    return new Promise(resolve => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          this._waiters = this._waiters.filter(w => w !== waiter);
          resolve(false);
        }, LOCK_WAIT_MS)
      };
      this._waiters.push(waiter);
    });
  }

  /** คืนคิวให้คนถัดไป */
  async releaseLock() {
    const next = this._waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      this._lockedAt = Date.now();
      next.resolve(true);
    } else {
      this._locked = false;
    }
    return true;
  }
}
