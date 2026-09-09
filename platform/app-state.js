import { DurableObject } from 'cloudflare:workers';

/**
 * Durable Object ที่ทำหน้าที่แทนบริการ 2 อย่างของ Apps Script ที่หายไปตอนย้ายออกมา
 *
 *   1) CacheService  -> เก็บ session token ของผู้ใช้ที่ล็อกอินอยู่
 *   2) LockService   -> กันผู้ใช้หลายคนเขียนข้อมูลชนกัน (race condition)
 *
 * ทำไมต้องใช้ Durable Object ไม่ใช้ KV:
 *   KV บนแพลนฟรีเขียนได้แค่ 1,000 ครั้ง/วัน แต่ระบบนี้ต้องต่ออายุ session
 *   ทุกครั้งที่เรียก API (= เขียน 1 ครั้ง) ผู้ใช้ไม่กี่สิบคนก็เกินโควตาแล้ว
 *   อีกอย่างคือ KV ไม่มีคำสั่ง "อ่านแล้วเขียนแบบอะตอมมิก" จึงทำ lock ที่เชื่อถือได้ไม่ได้
 *   ส่วน Durable Object รับประกันว่าคำสั่งของ object เดียวกันทำงานทีละคำสั่งเสมอ
 */

/** อายุของ session — ต่ออายุอัตโนมัติทุกครั้งที่มีการเรียก API ระหว่างที่ยังไม่หมดอายุ */
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 ชั่วโมง

/** เวลาที่ยอมรอคิวเขียนข้อมูลก่อนจะยอมแพ้ (เท่ากับ tryLock(25000) ของเดิม) */
const LOCK_WAIT_MS = 25000;

/** เวลาสูงสุดที่ยอมให้ผู้ถือคิวถือไว้ ก่อนจะถือว่าค้างแล้วปล่อยให้คนถัดไป */
/**
 * ถือล็อกได้นานสุดก่อนถือว่า "ค้าง" แล้วยกให้คนถัดไป
 *
 * ⚠️ ค่านี้ต้องยาวกว่างานที่ยาวที่สุดที่ทำอยู่ในล็อกเสมอ
 *
 * การยกล็อกให้คนถัดไปไม่ได้หยุดคนแรก เขายังเขียนต่ออยู่ ถ้าตั้งค่านี้สั้นเกิน
 * จะมีคนเขียนพร้อมกันสองคน ต่างคนต่างถือสำเนาข้อมูลคนละเวลา ใครบันทึกทีหลัง
 * ทับของคนแรกโดยไม่มีอะไรฟ้อง — เคยเกิดจริงตอนที่สร้าง PDF อยู่ในล็อก
 * (PDF รอได้ 2 นาที แต่ค่านี้เคยตั้งไว้ 30 วินาที)
 *
 * ตอนนี้ในล็อกมีแต่งานฐานข้อมูลซึ่งเสร็จในหลักมิลลิวินาที ตั้ง 5 นาทีจึงเผื่อ
 * ไว้มากพอที่จะไม่มีทางยกล็อกผิดจังหวะ และยังกู้คืนได้ถ้าวันหนึ่งมีโค้ดค้างจริง
 */
const LOCK_HOLD_MS = 5 * 60 * 1000;

export class AppState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // คิวรอเขียนข้อมูล เก็บในหน่วยความจำพอ ไม่ต้องเก็บถาวร
    // ถ้า Durable Object ถูกรีสตาร์ท คิวจะว่างเปล่า ซึ่งเป็นพฤติกรรมเดียวกับ
    // LockService ของ Apps Script (ล็อกไม่ได้อยู่ข้ามการรีสตาร์ทอยู่แล้ว)
    this._locked = false;
    this._waiters = [];
    this._lockedAt = 0;
  }

  /* ============================ SESSION ============================ */

  /** สร้าง session ใหม่ผูกกับ username คืนค่า token */
  async createSession(username) {
    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
    await this.ctx.storage.put('sess:' + token, {
      username,
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    return token;
  }

  /**
   * อ่าน username ที่ผูกกับ token นี้ พร้อมต่ออายุ session ให้อัตโนมัติ
   * คืนค่าข้อความว่างถ้าไม่มี token หรือหมดอายุแล้ว
   */
  async touchSession(token) {
    if (!token) return '';
    const key = 'sess:' + token;
    const rec = await this.ctx.storage.get(key);
    if (!rec) return '';

    if (rec.expiresAt <= Date.now()) {
      await this.ctx.storage.delete(key);
      return '';
    }

    // ต่ออายุเฉพาะตอนที่เหลือน้อยกว่าครึ่งหนึ่งแล้ว
    // ลดจำนวนการเขียนลงมาก โดยที่ผู้ใช้ยังไม่หลุดระหว่างใช้งานต่อเนื่อง
    const remaining = rec.expiresAt - Date.now();
    if (remaining < SESSION_TTL_MS / 2) {
      rec.expiresAt = Date.now() + SESSION_TTL_MS;
      await this.ctx.storage.put(key, rec);
    }
    return rec.username;
  }

  /** ทำลาย session (ใช้ตอนออกจากระบบ) */
  async destroySession(token) {
    if (token) await this.ctx.storage.delete('sess:' + token);
    return true;
  }

  /** ยกเลิก session ทั้งหมดของผู้ใช้คนหนึ่ง (ใช้ตอน Admin ปิดบัญชีหรือลบผู้ใช้) */
  async destroySessionsOf(username) {
    const target = String(username || '').trim().toLowerCase();
    if (!target) return 0;
    const all = await this.ctx.storage.list({ prefix: 'sess:' });
    const doomed = [];
    for (const [key, rec] of all) {
      if (String(rec.username || '').trim().toLowerCase() === target) doomed.push(key);
    }
    if (doomed.length) await this.ctx.storage.delete(doomed);
    return doomed.length;
  }

  /* ============================== LOCK ============================== */

  /**
   * เข้าคิวเพื่อเขียนข้อมูล — คืนค่า true เมื่อได้คิว, false ถ้ารอนานเกินกำหนด
   *
   * ต่างจากการ "ลองแล้วรีบตอบ" ตรงที่ฟังก์ชันนี้จะค้างรอในคิวให้เลย
   * ผู้เรียกจึงไม่ต้องวนถามซ้ำ (ซึ่งจะเปลืองทั้งเวลาและจำนวน request)
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
