import { Spreadsheet } from './sheets.js';
import { getAccessToken } from './google-auth.js';
import { Repository } from './db/repository.js';
import {
  SHEETS, AIRLIST_HEADERS, HISTORY_HEADERS, USERS_HEADERS, CONFIG_HEADERS,
  CLEANFORM_HEADERS, CONFIG_DEFAULTS, MODULES, MODULE_LABELS_TH
} from './schema.js';
import { normalizeCode, normalizeRegion } from './values.js';

/**
 * ข้อมูลประจำ request หนึ่งครั้ง — รวมทุกอย่างที่ฟังก์ชันธุรกิจต้องใช้ไว้ที่เดียว
 *
 * ใน Apps Script เดิมข้อมูลพวกนี้เป็นตัวแปร global (_currentAuthToken,
 * _cachedSessionUser, _cachedUserInfo) ซึ่งใช้ได้เพราะ Apps Script รันสคริปต์ใหม่
 * ทุกครั้งที่มีการเรียก ตัวแปรจึงถูกล้างเองเสมอ
 *
 * แต่ Worker ตัวเดียวรับหลาย request พร้อมกัน ถ้ายังใช้ global อยู่
 * ข้อมูลผู้ใช้จะรั่วข้ามคนกัน (ผู้ใช้ A อาจเห็นข้อมูลของผู้ใช้ B)
 * จึงต้องเปลี่ยนมาเป็น object ที่ส่งต่อกันไปตามฟังก์ชันแทน
 */

/**
 * แคชโครงสร้างชีตในหน่วยความจำของ Worker
 * โครงสร้างแทบไม่เปลี่ยน แต่ตั้ง TTL ไว้สั้นๆ เผื่อกรณีมีคนสร้างชีตแผนปีใหม่
 * จากอีกเครื่องหนึ่ง จะได้เห็นภายในไม่กี่วินาที
 */
let metaCache = null;
const META_TTL_MS = 30000;

export class Ctx {
  /**
   * @param {Object} env   ค่าตั้งค่าและค่าลับ
   * @param {Object} state  ตัวเก็บ session และคิวกันเขียนชนกัน
   *   ฝั่ง Node เป็น LocalState / ฝั่ง Cloudflare เป็น Durable Object
   *   ทั้งสองตัวมีเมธอดชื่อเดียวกัน โค้ดตรงนี้จึงไม่ต้องรู้ว่ากำลังรันอยู่บนอะไร
   * @param {Object} [db]  ฐานข้อมูล SQLite ที่เปิดไว้แล้ว ส่งเข้ามาจาก platform/
   *   src/ ห้ามเปิดไฟล์เอง จึงต้องรับเข้ามาแบบนี้
   */
  constructor(env, state, db) {
    this.env = env;
    this.state = state;
    this.db = db || null;
    this.ss = null;            // ตัวอ่าน/เขียนข้อมูล (SQLite หรือ Google Sheets)
    this.token = '';           // session token ที่แนบมากับ request นี้
    this.username = '';        // username จาก session ที่ยังไม่หมดอายุ
    this._sessionUser = null;  // แถวผู้ใช้จากตาราง Users (false = ไม่พบ)
    this._userInfo = null;     // ผลของ userInfo() ที่คำนวณแล้ว
    this._baseReady = false;
  }

  /**
   * เชื่อมต่อแหล่งข้อมูล (ทำครั้งเดียวต่อ request)
   *
   * เลือกจากค่า DATA_SOURCE ใน .env — ทั้งสองตัวมีเมธอดชุดเดียวกัน
   * โมดูลธุรกิจจึงไม่รู้และไม่ต้องรู้ว่ากำลังอ่านจากไหน สลับได้โดยไม่ต้องแก้โค้ด
   */
  async connect() {
    if (this.ss) return this.ss;

    if (this.useSqlite) {
      if (!this.db) {
        throw new Error('ตั้ง DATA_SOURCE=sqlite ไว้ แต่ไม่ได้ส่งฐานข้อมูลเข้ามา (platform/ ต้องเปิดไฟล์แล้วส่งให้)');
      }
      this.ss = new Repository(this.db);
      return this.ss;
    }

    const token = await getAccessToken(this.env);
    this.ss = new Spreadsheet(this.env.SPREADSHEET_ID, token);

    if (metaCache && metaCache.at > Date.now() - META_TTL_MS) {
      this.ss._meta = metaCache.data;
    }
    return this.ss;
  }

  /** ใช้ SQLite อยู่หรือเปล่า (ค่าเริ่มต้นคือใช้ ต้องระบุ sheets ชัดเจนถึงจะกลับไปใช้ Google) */
  get useSqlite() {
    return String(this.env.DATA_SOURCE || 'sqlite').toLowerCase() !== 'sheets';
  }

  /** จำโครงสร้างชีตล่าสุดไว้ใช้ซ้ำใน request ถัดไป */
  cacheMeta() {
    if (this.ss && this.ss._meta) metaCache = { data: this.ss._meta, at: Date.now() };
  }

  /** ทิ้งแคชโครงสร้าง — เรียกทุกครั้งที่มีการสร้างชีตใหม่ */
  static invalidateMeta() {
    metaCache = null;
  }

  /* ==================== ตรวจ/ซ่อมโครงสร้างชีตพื้นฐาน ==================== */

  /**
   * ตรวจว่าชีตพื้นฐานครบและคอลัมน์ตรงตามที่โค้ดต้องการ
   * เทียบเท่า ensureBaseSheets_() ของเดิม
   *
   * ต่างจากเดิมตรงที่ไม่ต้องแคชผลไว้ 6 ชั่วโมงอีกแล้ว เพราะการตรวจใช้ข้อมูล
   * หัวตารางที่โหลดมาพร้อมกับข้อมูลจริงอยู่แล้ว จึงไม่มีค่าใช้จ่ายเพิ่ม
   * (ในเวอร์ชัน Apps Script การตรวจนี้ต้องอ่าน/เขียนชีตราว 25 ครั้งทุกคลิก
   *  ซึ่งเป็นสาเหตุหลักที่ระบบเดิมช้า)
   */
  async ensureBase() {
    if (this._baseReady) return;
    const ss = await this.connect();

    const specs = [
      [SHEETS.AIRLIST, AIRLIST_HEADERS],
      [SHEETS.HISTORY, HISTORY_HEADERS],
      [SHEETS.CONFIG, CONFIG_HEADERS],
      [SHEETS.USERS, USERS_HEADERS],
      [SHEETS.CLEANFORM, CLEANFORM_HEADERS]
    ];

    let created = false;
    for (const [name, headers] of specs) {
      if (await ss.ensureSheet(name, headers)) created = true;
    }
    if (created) Ctx.invalidateMeta();

    await ss.load(specs.map(s => s[0]));
    for (const [name, headers] of specs) {
      await ss.ensureColumns(name, headers);
    }
    this._ensureConfigDefaults();

    this._baseReady = true;
  }

  /**
   * เติมค่าตั้งต้นที่ยังขาดลงในแต่ละคอลัมน์ของชีต Config
   * ทำงานได้ทั้งตอนสร้างชีตใหม่และตอน migrate ชีตเดิม
   * จะไม่ลบหรือแก้ค่าที่ผู้ใช้เคยเพิ่มเองไว้ก่อนหน้า เติมเฉพาะค่าที่ยังไม่มีเท่านั้น
   */
  _ensureConfigDefaults() {
    const ss = this.ss;
    const headers = ss.headers(SHEETS.CONFIG);
    const values = ss.values(SHEETS.CONFIG);

    Object.keys(CONFIG_DEFAULTS).forEach(colName => {
      const colIdx = headers.indexOf(colName);
      if (colIdx === -1) return;

      const existing = [];
      for (let i = 1; i < values.length; i++) {
        const v = (values[i] || [])[colIdx];
        if (v !== '' && v !== null && v !== undefined) existing.push(String(v));
      }

      const missing = CONFIG_DEFAULTS[colName].filter(v => !existing.includes(String(v)));
      if (missing.length === 0) return;

      // เขียนทีเดียวทั้งก้อน แทนการเขียนทีละช่อง
      ss.setValues(SHEETS.CONFIG, existing.length + 2, colIdx + 1, missing.map(v => [v]));
    });
  }

  /* ========================= ผู้ใช้และสิทธิ์ ========================= */

  /** แถวข้อมูลผู้ใช้ของ session ปัจจุบัน หรือ false ถ้าไม่ได้ล็อกอิน */
  async sessionUser() {
    if (this._sessionUser !== null) return this._sessionUser;
    if (!this.username) { this._sessionUser = false; return false; }

    await this.ensureBase();
    const list = this.ss.objects(SHEETS.USERS);
    const want = this.username.toLowerCase();
    this._sessionUser = list.find(u => String(u.Username || '').trim().toLowerCase() === want) || false;
    return this._sessionUser;
  }

  /** ชื่อผู้ใช้ปัจจุบัน ใช้บันทึกลงคอลัมน์ UpdatedBy / RecordedBy ทั่วทั้งระบบ */
  async currentUser() {
    const u = await this.sessionUser();
    if (!u) return '';
    return u.Username || u.Email || '';
  }

  /**
   * ข้อมูลสิทธิ์ของผู้ใช้ปัจจุบัน { email, username, name, role, regions, permissions }
   * role: 'Admin' (ทุกภูมิภาค + จัดการผู้ใช้ได้) | 'RegionAdmin' (เฉพาะภูมิภาคที่ได้รับมอบหมาย) | 'NoAccess'
   */
  async userInfo() {
    if (this._userInfo) return this._userInfo;
    const u = await this.sessionUser();

    if (!u) {
      this._userInfo = { email: '', username: '', name: '', role: 'NoAccess', regions: [], permissions: {} };
      return this._userInfo;
    }

    const active = u.Active !== false && String(u.Active).toUpperCase() !== 'FALSE';
    if (!active) {
      this._userInfo = {
        email: u.Email || '', username: u.Username || '', name: u.Name || '',
        role: 'NoAccess', regions: [], permissions: {}
      };
      return this._userInfo;
    }

    const regions = u.Regions ? String(u.Regions).split(',').map(normalizeRegion).filter(Boolean) : [];
    const role = String(u.Role || '').trim().toLowerCase() === 'admin' ? 'Admin' : 'RegionAdmin';

    this._userInfo = {
      email: u.Email || '',
      username: u.Username || '',
      name: u.Name || '',
      role,
      regions,
      permissions: role === 'Admin' ? allEditPermissions() : parsePermissions(u.Permissions)
    };
    return this._userInfo;
  }

  async requireAccess() {
    const info = await this.userInfo();
    if (info.role === 'NoAccess') {
      const who = info.username || info.email || 'ไม่ทราบผู้ใช้';
      throw new Error(
        'บัญชีของคุณ (' + who + ') ยังไม่ได้รับสิทธิ์เข้าใช้งานระบบ หรือเซสชันหมดอายุแล้ว ' +
        'กรุณาเข้าสู่ระบบใหม่อีกครั้ง หรือติดต่อผู้ดูแลระบบ'
      );
    }
  }

  /** ดูข้อมูลของโมดูลนี้ได้หรือไม่ (Admin ดูได้เสมอ) */
  async canView(module) {
    const info = await this.userInfo();
    if (info.role === 'Admin') return true;
    return !!(info.permissions && info.permissions[module] && info.permissions[module] !== 'none');
  }

  /** แก้ไขข้อมูลของโมดูลนี้ได้หรือไม่ (Admin แก้ไขได้เสมอ) */
  async canEdit(module) {
    const info = await this.userInfo();
    if (info.role === 'Admin') return true;
    return !!(info.permissions && info.permissions[module] === 'edit');
  }

  /** เรียกที่ต้นฟังก์ชันที่เขียนข้อมูล เพื่อบล็อกทันทีถ้าไม่มีสิทธิ์แก้ไข */
  async assertModuleEdit(module) {
    await this.requireAccess();
    if (!(await this.canEdit(module))) {
      throw new Error('คุณไม่มีสิทธิ์แก้ไขข้อมูลส่วน "' + (MODULE_LABELS_TH[module] || module) + '"');
    }
  }

  async assertRegionAccess(region) {
    const info = await this.userInfo();
    if (info.role === 'Admin') return;
    if (info.role === 'RegionAdmin' && (info.regions || []).includes(normalizeRegion(region))) return;
    throw new Error('คุณไม่มีสิทธิ์จัดการข้อมูลในภูมิภาค "' + (region || '-') + '"');
  }

  async assertAdmin() {
    const info = await this.userInfo();
    if (info.role !== 'Admin') {
      throw new Error('เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่จัดการผู้ใช้งานส่วนนี้ได้');
    }
  }

  /**
   * เซตของ AirCode ทั้งหมดที่ผู้ใช้ (RegionAdmin) คนนี้เข้าถึงได้
   * ใช้กรองหน้า History/Plan ซึ่งไม่มีคอลัมน์ Region อยู่ในตัวเอง
   */
  async allowedAirCodes() {
    const info = await this.userInfo();
    await this.ss.load(SHEETS.AIRLIST);
    const list = this.ss.objects(SHEETS.AIRLIST);
    const allowedRegions = info.regions || [];
    return new Set(
      list.filter(a => allowedRegions.includes(normalizeRegion(a.Region)))
          .map(a => normalizeCode(a.AirCode))
    );
  }

  /** ตรวจสิทธิ์ภูมิภาคของแถวในแผน/ประวัติ โดยอ้างอิงจาก Region ของ AirCode นั้นใน AirList */
  async assertAirCodeAccess(airCode) {
    const info = await this.userInfo();
    if (info.role === 'Admin') return;
    const allowed = await this.allowedAirCodes();
    if (!allowed.has(normalizeCode(airCode))) {
      throw new Error('คุณไม่มีสิทธิ์จัดการแผนล้างแอร์ของเครื่อง ' + airCode);
    }
  }

  /* ============================== LOCK ============================== */

  /**
   * ห่อการทำงานที่ "เขียน" ข้อมูลด้วย lock เพื่อป้องกันข้อมูลชนกัน
   * เมื่อมีผู้ใช้หลายคนกดบันทึกพร้อมกัน — และเช็คสิทธิ์เข้าใช้งานก่อนทุกครั้ง
   */
  async withLock(fn) {
    await this.requireAccess();
    return this.withLockNoAuth(fn);
  }

  /**
   * เหมือน withLock แต่ไม่เช็คสิทธิ์ก่อน
   * ใช้เฉพาะงานที่ต้องทำได้ก่อนล็อกอิน เช่น การตั้งค่าผู้ดูแลระบบคนแรก
   */
  async withLockNoAuth(fn) {
    const ok = await this.state.acquireLock();
    if (!ok) {
      throw new Error('ระบบมีผู้ใช้งานอื่นกำลังบันทึกข้อมูลอยู่ในขณะนี้ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
    }
    try {
      return await fn();
    } finally {
      await this.state.releaseLock();
    }
  }
}

/** สิทธิ์ "edit" ทุกโมดูล ใช้กับ Admin */
export function allEditPermissions() {
  const perms = {};
  MODULES.forEach(m => (perms[m] = 'edit'));
  return perms;
}

/**
 * แปลงค่าคอลัมน์ Permissions (เช่น "airlist:edit,plan:view,history:none") เป็น object รายโมดูล
 * - คอลัมน์ว่างทั้งหมด (ยังไม่เคยตั้งค่า) = ผู้ใช้เดิมก่อนมีระบบนี้ -> ให้ "edit" ทุกโมดูล
 *   (คงพฤติกรรมเดิม ไม่ทำให้สิทธิ์ที่เคยมีหายไปทันที)
 * - ถ้าตั้งค่าแล้ว โมดูลที่ไม่ได้ระบุถือว่า "none" (ปลอดภัยไว้ก่อน)
 */
export function parsePermissions(raw) {
  const str = String(raw || '').trim();
  if (!str) return allEditPermissions();

  const map = {};
  str.split(',').forEach(pair => {
    const parts = pair.split(':');
    const key = (parts[0] || '').trim();
    const level = (parts[1] || '').trim().toLowerCase();
    if (key) map[key] = (level === 'edit' || level === 'view' || level === 'none') ? level : 'view';
  });

  const perms = {};
  MODULES.forEach(m => (perms[m] = map[m] || 'none'));
  return perms;
}
