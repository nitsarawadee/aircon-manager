import { Repository } from './db/repository.js';
import {
  SHEETS, AIRLIST_HEADERS, HISTORY_HEADERS, USERS_HEADERS, CONFIG_HEADERS,
  CLEANFORM_HEADERS, REPAIRFORM_HEADERS, INSTALLFORM_HEADERS,
  CONTRACTOR_HEADERS, REPAIRLINK_HEADERS, APPROVAL_HEADERS, WAREHOUSE_HEADERS, ASSIGN_HEADERS,
  CONFIG_DEFAULTS, MODULES, MODULE_LABELS_TH, PERMISSION_INHERITS, CONTRACTOR_PERMISSIONS,
  ROLE_TITLES, REGIONAL_ROLES
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

export class Ctx {
  /**
   * @param {Object} env   ค่าตั้งค่าและค่าลับ
   * @param {Object} state  ตัวเก็บ session และคิวกันเขียนชนกัน
   *   ฝั่ง Node เป็น LocalState / ฝั่ง Cloudflare เป็น Durable Object
   *   ทั้งสองตัวมีเมธอดชื่อเดียวกัน โค้ดตรงนี้จึงไม่ต้องรู้ว่ากำลังรันอยู่บนอะไร
   * @param {Object} [db]  ฐานข้อมูล SQLite ที่เปิดไว้แล้ว ส่งเข้ามาจาก platform/
   *   src/ ห้ามเปิดไฟล์เอง จึงต้องรับเข้ามาแบบนี้
   * @param {Object} [services]  เครื่องมือที่ชั้น platform ส่งเข้ามาให้ใช้
   *   src/ ห้ามแตะระบบไฟล์หรือสั่งโปรแกรมอื่นเอง จึงรับเข้ามาเป็นชุดฟังก์ชันแบบนี้
   *   ไม่ส่งมาสักตัวก็ยังทำงานได้ แค่ฟีเจอร์ที่ต้องใช้ตัวนั้นใช้ไม่ได้
   *   (เช่นตอนรันบน Cloudflare ที่ไม่มีดิสก์ให้เขียน)
   *
   *   - `photos`       ที่เก็บรูปถ่ายประกอบเอกสาร
   *   - `pdf`          ตัวแปลงหน้าเอกสารเป็นไฟล์ PDF
   *   - `docs`         ที่เก็บไฟล์ PDF บนดิสก์
   *   - `attachments`  ที่เก็บไฟล์เอกสารที่ช่างถ่ายส่งกลับมา
   *   - `backup`       สำรองฐานข้อมูลทันที ใช้ก่อนงานที่เขียนทีละมากๆ
   *   - `forms`        ไฟล์แบบฟอร์มแม่แบบ (.xlsx) ที่เอาไปเติมข้อมูลให้ผู้ใช้โหลด
   *
   *   รับเป็นอ็อบเจกต์เดียวไม่ใช่พารามิเตอร์เรียงกัน เพราะรายการนี้ยาวขึ้นเรื่อยๆ
   *   และการเรียงผิดตำแหน่งเป็นความผิดพลาดที่ไม่มีอะไรฟ้อง
   */
  constructor(env, state, db, services = {}) {
    this.env = env;
    this.state = state;
    this.db = db || null;
    this.photos = services.photos || null;
    this.pdf = services.pdf || null;
    this.docs = services.docs || null;
    this.attachments = services.attachments || null;
    this.backup = services.backup || null;
    this.forms = services.forms || null;
    this.ss = null;            // ตัวอ่าน/เขียนข้อมูล (SQLite)
    this.token = '';           // session token ที่แนบมากับ request นี้
    this.username = '';        // username จาก session ที่ยังไม่หมดอายุ
    this._sessionUser = null;  // แถวผู้ใช้จากตาราง Users (false = ไม่พบ)
    this._userInfo = null;     // ผลของ userInfo() ที่คำนวณแล้ว
    this._baseReady = false;
  }

  /**
   * เชื่อมต่อแหล่งข้อมูล (ทำครั้งเดียวต่อ request)
   *
   * ฐานข้อมูลถูกเปิดที่ชั้น platform แล้วส่งเข้ามา เพราะ src/ ห้ามแตะไฟล์เอง
   */
  async connect() {
    if (this.ss) return this.ss;

    if (!this.db) {
      throw new Error('ไม่ได้ส่งฐานข้อมูลเข้ามา (platform/ ต้องเปิดไฟล์แล้วส่งให้)');
    }
    this.ss = new Repository(this.db);
    return this.ss;
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
      [SHEETS.CLEANFORM, CLEANFORM_HEADERS],
      [SHEETS.REPAIRFORM, REPAIRFORM_HEADERS],
      [SHEETS.INSTALLFORM, INSTALLFORM_HEADERS],
      [SHEETS.CONTRACTOR, CONTRACTOR_HEADERS],
      [SHEETS.REPAIRLINK, REPAIRLINK_HEADERS],
      [SHEETS.APPROVAL, APPROVAL_HEADERS],
      [SHEETS.WAREHOUSE, WAREHOUSE_HEADERS],
      [SHEETS.ASSIGN, ASSIGN_HEADERS]
    ];

    for (const [name, headers] of specs) {
      await ss.ensureSheet(name, headers);
    }

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
   * role: 'Admin' (ทุกภูมิภาค + จัดการผู้ใช้ได้) | 'RegionAdmin' (เฉพาะภูมิภาคที่ได้รับมอบหมาย)
   *     | 'Contractor' (เฉพาะ Node ที่ได้รับมอบหมาย) | 'NoAccess'
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

    // ผู้รับเหมาเช็คก่อนบทบาทอื่นเสมอ บัญชีที่ผูกกับผู้รับเหมาไว้ จะไม่มีทางได้
    // สิทธิ์เจ้าหน้าที่ แม้ช่อง Role จะเขียนว่า Admin (เช่นแก้ฐานข้อมูลตรงแล้วพิมพ์ผิด)
    // ถ้าผิดพลาด ขอให้ผิดไปทางเห็นน้อยกว่า ไม่ใช่เห็นทั้งบริษัท
    const contractorId = String(u.ContractorID || '').trim();
    if (contractorId || String(u.Role || '').trim().toLowerCase() === 'contractor') {
      this._userInfo = await this._contractorInfo(u, contractorId);
      return this._userInfo;
    }

    const regions = u.Regions ? String(u.Regions).split(',').map(normalizeRegion).filter(Boolean) : [];
    const role = String(u.Role || '').trim().toLowerCase() === 'admin' ? 'Admin' : 'RegionAdmin';
    // Staff / Supervisor ทำงานเป็น RegionAdmin ทุกอย่าง ต่างกันแค่ชื่อที่โชว์ (ดู ROLE_TITLES)
    const stored = REGIONAL_ROLES.find(r => r.toLowerCase() === String(u.Role || '').trim().toLowerCase());

    this._userInfo = {
      email: u.Email || '',
      username: u.Username || '',
      name: u.Name || '',
      role,
      title: role === 'Admin' ? ROLE_TITLES.Admin : ROLE_TITLES[stored || 'RegionAdmin'],
      // ค่าบทบาทที่เก็บจริง — ใช้เฉพาะเรื่องที่ Staff / Supervisor / Regional ต่างกันจริง
      // คือขั้นอนุมัติเอกสาร (ดู modules/approval.js) ตรวจสิทธิ์อื่นทั้งหมดใช้ role
      roleKey: role === 'Admin' ? 'Admin' : (stored || 'RegionAdmin'),
      regions,
      permissions: role === 'Admin' ? allEditPermissions() : parsePermissions(u.Permissions)
    };
    return this._userInfo;
  }

  /**
   * ข้อมูลสิทธิ์ของบัญชีผู้รับเหมา
   *
   * ============================================================================
   * ผู้รับเหมาเห็นอะไร
   * ============================================================================
   * งานมาจากช่อง "ผู้รับเหมา" ของแต่ละรอบในแผนล้าง (R1/R2/R3_ContractorID)
   * เจ้าหน้าที่เลือกผู้รับเหมาให้รอบไหน รอบนั้นคืองานของผู้รับเหมาเจ้านั้น
   *
   * - jobs     รอบที่มอบหมาย ในรูป "ปี|รอบ|รหัสเครื่อง" ใช้ตัดสินว่าเปิด/กรอกงานไหนได้
   * - airCodes เครื่องที่มีงานของเจ้านี้อย่างน้อยหนึ่งรอบ ใช้เป็นขอบเขตของเครื่อง
   *
   * อ่านใหม่ทุก request จึงมีผลทันทีที่เจ้าหน้าที่เปลี่ยนผู้รับเหมาในแผน
   * ไม่ต้องรอให้ผู้รับเหมาล็อกอินใหม่
   *
   * ไม่มีรหัสผู้รับเหมา / หาไม่เจอ / ถูกปิดใช้งาน = เข้าระบบไม่ได้เลย
   * (ไม่ถอยไปเป็นเจ้าหน้าที่ เพราะนั่นคือการเห็นมากขึ้น)
   */
  async _contractorInfo(u, contractorId) {
    const base = {
      email: u.Email || '', username: u.Username || '', name: u.Name || '',
      regions: []
    };
    const want = contractorId.toUpperCase();
    const c = contractorId && this.ss.objects(SHEETS.CONTRACTOR)
      .find(x => String(x.ID || '').trim().toUpperCase() === want);
    const active = c && c.Active !== false && String(c.Active).toUpperCase() !== 'FALSE';
    if (!active) return { ...base, role: 'NoAccess', permissions: {} };

    const jobs = new Set();
    const airCodes = new Set();
    const planNames = (await this.ss.sheetNames()).filter(n => /^Plan_\d{4}$/.test(n));
    await this.ss.load(planNames);
    for (const name of planNames) {
      const year = name.slice(5);
      for (const p of this.ss.objects(name)) {
        const code = normalizeCode(p.AirCode);
        if (!code) continue;
        for (const r of [1, 2, 3]) {
          if (String(p['R' + r + '_ContractorID'] || '').trim().toUpperCase() !== want) continue;
          jobs.add(jobKey(year, r, code));
          airCodes.add(code);
        }
      }
    }
    // งานซ่อม/ติดตั้งที่มอบหมายให้เจ้านี้ (modules/assign.js) — เห็นเครื่องนั้นด้วย ทั้งงานที่ยังเปิด
    // และที่ทำเสร็จแล้ว (ต้องเปิดดูเอกสารที่ตัวเองกรอกไปได้) ส่วนสิทธิ์ "กรอก" ตรวจแยกที่ assertOwnAssigned
    for (const a of this.ss.objects(SHEETS.ASSIGN)) {
      if (String(a.ContractorID || '').trim().toUpperCase() !== want) continue;
      const code = normalizeCode(a.AirCode);
      if (code) airCodes.add(code);
    }

    return {
      ...base,
      role: 'Contractor',
      title: ROLE_TITLES.Contractor,
      roleKey: 'Contractor',
      contractorId: String(c.ID).trim(),
      contractorName: String(c.Name || '').trim(),
      // ส่งเป็นอาร์เรย์ เพราะ Set แปลงเป็น JSON ไม่ได้ (ค่านี้ไปถึงหน้าเว็บด้วย)
      jobs: [...jobs],
      airCodes: [...airCodes],
      permissions: contractorPermissions()
    };
  }

  /**
   * งานรอบนี้ของเครื่องนี้ เป็นของผู้ใช้คนนี้หรือไม่
   * เจ้าหน้าที่ตอบ true เสมอ (ขอบเขตของเจ้าหน้าที่ตรวจด้วย scopeFilter อยู่แล้ว)
   */
  async ownsJob(year, round, airCode) {
    const info = await this.userInfo();
    if (info.role !== 'Contractor') return info.role === 'Admin' || info.role === 'RegionAdmin';
    return (info.jobs || []).includes(jobKey(year, round, normalizeCode(airCode)));
  }

  /**
   * ตัวตรวจว่าแถวข้อมูลแถวหนึ่งอยู่ในขอบเขตที่ผู้ใช้คนนี้เข้าถึงได้หรือไม่
   *
   * ใช้ได้ทั้งแถวเครื่อง (AirCode) และแถวเอกสาร (AirCode1/AirCode2)
   *   Admin       ทุกแถว
   *   RegionAdmin แถวที่ Region อยู่ในภูมิภาคที่ดูแล
   *   Contractor  แถวของเครื่องที่มีงานมอบหมายให้เจ้านี้ในแผนล้าง
   *   อื่นๆ       ไม่มีสักแถว
   *
   * ⚠️ สำหรับผู้รับเหมา นี่คือขอบเขต "เครื่อง" ไม่ใช่ขอบเขต "งาน" — เครื่องเดียวกัน
   * อาจมีรอบอื่นที่เป็นของเจ้าอื่น งานที่ผูกกับรอบ (ใบล้าง) ต้องตรวจด้วย ownsJob เพิ่ม
   *
   * ทุกหน้าที่กรองข้อมูลต้องใช้ตัวนี้ตัวเดียว ถ้าแต่ละหน้าเขียนเงื่อนไขเอง
   * พอเพิ่มบทบาทใหม่ หน้าที่ลืมแก้จะปล่อยข้อมูลรั่วโดยไม่มีอะไรฟ้อง
   */
  async scopeFilter() {
    const info = await this.userInfo();
    if (info.role === 'Admin') return () => true;
    if (info.role === 'RegionAdmin') {
      const regions = new Set(info.regions || []);
      return row => regions.has(normalizeRegion((row || {}).Region));
    }
    if (info.role === 'Contractor') {
      const codes = new Set(info.airCodes || []);
      return row => {
        const r = row || {};
        return [r.AirCode, r.AirCode1, r.AirCode2].some(c => c && codes.has(normalizeCode(c)));
      };
    }
    return () => false;
  }

  /** หยุดทันทีถ้าแถวนี้อยู่นอกขอบเขตของผู้ใช้ */
  async assertInScope(row, label) {
    const inScope = await this.scopeFilter();
    if (!inScope(row)) {
      throw new Error('คุณไม่มีสิทธิ์เข้าถึง' + (label || 'ข้อมูลรายการนี้'));
    }
  }

  /**
   * งานที่ต้องเป็นเจ้าหน้าที่ INTERLINK เท่านั้น (ผู้รับเหมาทำไม่ได้แม้มีสิทธิ์แก้ไขเมนูนั้น)
   * เช่นลบเอกสาร — ลบแล้วรูปถ่ายและไฟล์แนบหายตามไปด้วย กู้คืนไม่ได้
   */
  async assertStaff(action) {
    await this.requireAccess();
    const info = await this.userInfo();
    if (info.role !== 'Admin' && info.role !== 'RegionAdmin') {
      throw new Error('บัญชี Subcontract (ผู้รับเหมา)' + (action || 'ทำรายการนี้') + 'ไม่ได้ กรุณาติดต่อเจ้าหน้าที่');
    }
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

  /**
   * ตรวจว่าแถวที่หน้าเว็บสั่งให้แก้/ลบ ยังเป็นรายการเดิมอยู่จริง
   *
   * _row คือ "ลำดับที่เท่าไหร่ในตาราง" ไม่ใช่ id ถาวร (อ่านหัวไฟล์ db/repository.js)
   * ถ้ามีคนลบแถวที่อยู่ก่อนหน้าไป ระหว่างที่อีกคนเปิดหน้าเดิมค้างไว้ ลำดับจะเลื่อนขึ้นทั้งหมด
   * คำสั่งลบที่ส่งตามมาจะไปโดนรายการถัดไปแทน โดยไม่มีอะไรฟ้องเลยสักอย่าง
   * ร้ายกว่านั้นคือประวัติที่บันทึกไว้จะเขียนรหัสเครื่องผิดตัวไปด้วย
   *
   * หน้าเว็บรู้อยู่แล้วว่ากำลังทำอะไรกับรายการไหน จึงส่งค่าที่ใช้ระบุตัวมาให้ตรวจซ้ำ
   * ไม่ตรงเมื่อไหร่แปลว่าข้อมูลในมือเก่าไปแล้ว ต้องหยุดและให้โหลดใหม่
   * ยอมให้เสียเที่ยวดีกว่าลบผิดตัวแล้วไม่มีใครรู้
   *
   * @param {string} sheet    ชื่อชีต/ตาราง
   * @param {number} row      ลำดับแถวที่หน้าเว็บส่งมา
   * @param {string} keyCol   ชื่อคอลัมน์ที่ใช้ระบุตัวรายการ (เช่น AirCode, ID)
   * @param {string} expected ค่าที่หน้าเว็บเชื่อว่าอยู่ในแถวนั้น
   * @param {string} label    คำเรียกรายการ ใช้ประกอบข้อความแจ้งเตือน
   */
  assertRowIs(sheet, row, keyCol, expected, label) {
    // ไม่ได้ส่งค่ามา = หน้าเว็บรุ่นเก่าที่ยังไม่รู้จักการตรวจนี้ ปล่อยผ่านไม่ได้
    // เพราะจุดประสงค์ทั้งหมดคือกันการเขียนทับผิดแถว
    const want = String(expected == null ? '' : expected).trim();
    if (!want) throw new Error('คำสั่งไม่สมบูรณ์ กรุณารีเฟรชหน้าจอแล้วลองใหม่');

    const headers = this.ss.headers(sheet);
    const col = headers.indexOf(keyCol);
    if (col < 0) throw new Error('ไม่พบคอลัมน์ ' + keyCol + ' ในตาราง ' + sheet);

    const actual = String(this.ss.cell(sheet, row, col + 1) || '').trim();
    if (actual.toUpperCase() !== want.toUpperCase()) {
      throw new Error(
        'ข้อมูลในระบบถูกเปลี่ยนไปแล้วตั้งแต่คุณเปิดหน้านี้ ' +
        'ระบบจึงหยุดไว้เพื่อไม่ให้แก้ผิดรายการ — กรุณารีเฟรชหน้าจอแล้วทำใหม่อีกครั้ง ' +
        '(ต้องการ' + (label || 'รายการ') + ' "' + want + '" แต่ตำแหน่งนั้นเป็น "' + (actual || '-') + '")'
      );
    }
  }

  async assertAdmin() {
    const info = await this.userInfo();
    if (info.role !== 'Admin') {
      throw new Error('เฉพาะบทบาท Infrastructure (ผู้ดูแลระบบ) เท่านั้นที่ทำรายการนี้ได้');
    }
  }

  /**
   * เซตของ AirCode ทั้งหมดที่ผู้ใช้คนนี้เข้าถึงได้
   * ใช้กรองหน้า History/Plan ซึ่งไม่มีคอลัมน์ Region/SiteCode อยู่ในตัวเอง
   */
  async allowedAirCodes() {
    await this.ss.load(SHEETS.AIRLIST);
    const inScope = await this.scopeFilter();
    return new Set(
      this.ss.objects(SHEETS.AIRLIST).filter(inScope).map(a => normalizeCode(a.AirCode))
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

/** สิทธิ์ตายตัวของผู้รับเหมา ครบทุกโมดูล — โมดูลที่ไม่ได้ระบุเป็น "none" */
export function contractorPermissions() {
  const perms = {};
  MODULES.forEach(m => (perms[m] = CONTRACTOR_PERMISSIONS[m] || 'none'));
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
  MODULES.forEach(m => {
    if (map[m]) { perms[m] = map[m]; return; }
    // สิทธิ์ที่เพิ่มภายหลังแต่ผู้ใช้ยังไม่เคยตั้ง ใช้ค่าของสิทธิ์เดิมที่มันแยกออกมา
    // (ดูเหตุผลที่ PERMISSION_INHERITS ใน schema.js)
    const from = PERMISSION_INHERITS[m];
    perms[m] = (from && map[from]) || 'none';
  });
  return perms;
}

/** กุญแจของงานหนึ่งรอบ: "ปี|รอบ|รหัสเครื่อง" (รหัสต้อง normalize มาแล้ว) */
export function jobKey(year, round, airCode) {
  return String(year).trim() + '|' + String(round).trim() + '|' + airCode;
}
