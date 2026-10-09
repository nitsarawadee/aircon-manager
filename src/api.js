import { Ctx } from './context.js';

import {
  getAirList, getConfig, saveAirUnit, moveAirUnit, replaceAirUnit, deleteAirUnit,
  getAirUnitImportFile, getAirUnitImportTemplate, planAirUnitImport, applyAirUnitImport
} from './modules/airlist.js';
import { getPlanYears, getCleaningPlan, getCleaningSummary, getPlanCalendar, getUpcomingCleanings, createCleaningPlan, deleteCleaningPlan, syncCleaningPlan, updateCleaningRound, updatePlanDatesByNode, updatePlanBulk } from './modules/plan.js';
import {
  getHistory, addHistoryRecord, deleteHistoryRecord,
  reportRepair, markCannotRepair, getRepairWorkCount
} from './modules/history.js';
import { getDashboardSummary } from './modules/dashboard.js';
import { getBudgetSummary, saveBudgetRecord } from './modules/budget.js';
import {
  getSystemStatus, setupFirstAdmin, login, logout, changeOwnPassword,
  getUsers, saveUser, deleteUser
} from './modules/users.js';
import {
  getCleaningFormNodes, getCleaningForms, saveCleaningForm, deleteCleaningForm,
  uploadNodeDocuments, getCleaningDocHtml, getCleaningBlankDocHtml, getCleaningBlankXlsx,
  saveCleaningPhoto, deleteCleaningPhoto, getCleaningPhotoIndex, getCleaningPhotos, getCleaningDocPdf,
  getCleaningAttachments, getCleaningAttachment
} from './modules/cleaningform.js';
import {
  getRepairForms, saveRepairForm, deleteRepairForm,
  getRepairDocHtml, getRepairBlankDocHtml, getRepairBlankXlsx, getRepairDocPdf,
  saveRepairPhoto, deleteRepairPhoto, getRepairPhotos
} from './modules/repairform.js';
import {
  getInstallForms, saveInstallForm, deleteInstallForm,
  getInstallDocHtml, getInstallBlankDocHtml, getInstallBlankXlsx, getInstallDocPdf,
  saveInstallPhoto, deleteInstallPhoto, getInstallPhotos
} from './modules/installform.js';
import { getContractors } from './modules/contractors.js';
import {
  getRepairLink, submitRepairLink, submitInstallLink, saveRepairLinkPhoto, getRepairLinkPdf,
  createRepairLink, getRepairLinks, revokeRepairLink
} from './modules/repairlink.js';
import { assignJob, getJobAssignments, getMyJobs, closeRepairSelf } from './modules/assign.js';
import { approveDoc, getApprovalCount } from './modules/approval.js';
import { getWarehouse, writeOffStock, setStockRemark } from './modules/warehouse.js';

/**
 * ============================================================================
 * ตัวจัดการคำสั่งทั้งหมด — ไม่ผูกกับแพลตฟอร์มใดเลย
 * ============================================================================
 *
 * ไฟล์นี้ไม่รู้จัก Cloudflare และไม่รู้จัก Node.js
 * รับเข้ามาแค่ "ข้อมูลที่ผู้ใช้ส่งมา" แล้วคืน "ผลลัพธ์กับรหัสสถานะ" ออกไป
 * ส่วนที่รู้จักแพลตฟอร์มจริงๆ อยู่ในโฟลเดอร์ platform/ ซึ่งบางมาก
 *
 * ออกแบบแบบนี้เพื่อให้ย้ายที่รันได้โดยไม่ต้องแก้ตรรกะ — ตอนนี้มีที่รันเดียวคือ platform/node.js
 * (เครื่องตัวเอง / server บริษัท / คลาวด์) · ทางเลือก Cloudflare Workers เดิมถอดออกแล้ว (ดูประวัติ git)
 *
 * แทน doGet() + api() ของ Apps Script เดิม
 *
 * โครงสร้าง URL:
 *   POST /api/public   คำสั่งที่ยังไม่ต้องล็อกอิน (เข้าสู่ระบบ, ตั้งค่าระบบครั้งแรก)
 *   POST /api/call     คำสั่งอื่นทั้งหมด ต้องแนบ session token มาด้วย
 *   ทางอื่นทั้งหมด      เสิร์ฟไฟล์หน้าเว็บจากโฟลเดอร์ web/
 *
 * เหตุผลที่ยังใช้รูปแบบ "ส่งชื่อฟังก์ชันมาเรียก" เหมือนเดิม แทนที่จะทำ REST:
 * หน้าเว็บเดิมมีจุดเรียก server ราว 45 จุด ทุกจุดวิ่งผ่าน call(ชื่อฟังก์ชัน, ...)
 * การคงรูปแบบเดิมไว้ทำให้แก้หน้าเว็บแค่ 2 ฟังก์ชัน แทนที่จะต้องแก้ทั้ง 45 จุด
 * ============================================================================
 */

/** คำสั่งที่เรียกได้หลังล็อกอินแล้วเท่านั้น (ฟังก์ชันที่ไม่อยู่ในนี้เรียกผ่าน API ไม่ได้) */
const API_FUNCTIONS = {
  getCurrentUserInfo: ctx => ctx.userInfo(),

  getAirList,
  getConfig,
  saveAirUnit,
  deleteAirUnit,
  getAirUnitImportFile,
  getAirUnitImportTemplate,
  planAirUnitImport,
  applyAirUnitImport,
  moveAirUnit,
  replaceAirUnit,

  getHistory,
  addHistoryRecord,
  deleteHistoryRecord,
  // ขั้นของเคสงานซ่อม เรียงตามลำดับที่เกิดจริง
  reportRepair,
  markCannotRepair,
  // ตัวเลขบนเมนูงานซ่อมและติดตั้ง
  getRepairWorkCount,

  getPlanYears,
  getCleaningPlan,
  getCleaningSummary,
  getPlanCalendar,
  getUpcomingCleanings,
  createCleaningPlan,
  deleteCleaningPlan,
  // อัปเดตแผนที่สร้างแล้วตามรายการเครื่อง (ดูผลก่อน แล้วค่อยยืนยัน)
  syncCleaningPlan,
  updateCleaningRound,
  updatePlanBulk,
  updatePlanDatesByNode,

  getDashboardSummary,
  getBudgetSummary,
  saveBudgetRecord,

  getUsers,
  saveUser,
  deleteUser,

  // รายชื่อผู้รับเหมา (ตัวเลือกในแผนล้างและหน้าจัดการผู้ใช้)
  getContractors,

  changeOwnPassword,
  logout,

  getCleaningFormNodes,
  getCleaningForms,
  saveCleaningForm,
  deleteCleaningForm,
  getCleaningDocHtml,
  getCleaningBlankDocHtml,
  getCleaningBlankXlsx,
  saveCleaningPhoto,
  deleteCleaningPhoto,
  getCleaningPhotoIndex,
  getCleaningPhotos,
  getCleaningDocPdf,
  getCleaningAttachments,
  getCleaningAttachment,
  uploadNodeDocuments,

  // เอกสารซ่อม ITEL-FM-NE-005
  getRepairForms,
  saveRepairForm,
  deleteRepairForm,
  getRepairDocHtml,
  getRepairBlankDocHtml,
  getRepairBlankXlsx,
  getRepairDocPdf,
  saveRepairPhoto,
  deleteRepairPhoto,
  getRepairPhotos,
  // ลิงก์ให้คนนอกกรอกเอกสารซ่อม (ฝั่งเจ้าหน้าที่ — ตัวที่คนถือลิงก์ใช้อยู่ใน PUBLIC_FUNCTIONS)
  createRepairLink,
  getRepairLinks,
  revokeRepairLink,
  // มอบหมายงานซ่อม/ติดตั้งให้ผู้รับเหมาประจำ + วันนัด (ฝั่งผู้รับเหมาอ่านด้วย getMyJobs)
  assignJob,
  getJobAssignments,
  getMyJobs,
  // ซ่อมเอง (Infrastructure) — ปิดเคสโดยไม่ออกใบซ่อม
  closeRepairSelf,

  // เอกสารติดตั้ง ITEL-FM-NE-006
  getInstallForms,
  saveInstallForm,
  deleteInstallForm,
  getInstallDocHtml,
  getInstallBlankDocHtml,
  getInstallBlankXlsx,
  getInstallDocPdf,
  saveInstallPhoto,
  deleteInstallPhoto,
  getInstallPhotos,

  // ขั้นอนุมัติเอกสาร (ใบล้าง / ซ่อม / ติดตั้ง) — ตรวจบทบาทกับภูมิภาคที่ approval.js
  approveDoc,
  // ตัวเลขบนเมนูเอกสารรออนุมัติ
  getApprovalCount,

  // คลังแอร์ — เครื่องเก่าที่ถอดออกจากตำแหน่ง
  getWarehouse,
  writeOffStock,
  setStockRemark
};

/** คำสั่งที่เรียกได้ก่อนล็อกอิน */
const PUBLIC_FUNCTIONS = {
  getSystemStatus,
  login,
  setupFirstAdmin,

  // ลิงก์กรอกเอกสารซ่อม — ไม่ต้องล็อกอิน แต่ต้องมีรหัสในลิงก์ทุกคำสั่ง
  // รหัสนั้นเปิดได้แค่งานซ่อมงานเดียวที่ผูกไว้ (ดูหัวไฟล์ modules/repairlink.js)
  getRepairLink,
  submitRepairLink,
  submitInstallLink,
  saveRepairLinkPhoto,
  getRepairLinkPdf
};

/** เส้นทางนี้เป็นคำสั่งของ API หรือไม่ (ที่เหลือคือไฟล์หน้าเว็บ) */
export function isApiPath(pathname) {
  return pathname === '/api/call' || pathname === '/api/public';
}

/**
 * ทำงานตามคำสั่งที่ผู้ใช้ส่งมา
 *
 * @param {Object}  opts
 * @param {string}  opts.pathname  เส้นทางที่เรียกมา
 * @param {Object}  opts.body      ข้อมูล JSON ที่ส่งมา { token, fn, args }
 * @param {Object}  opts.env       ค่าตั้งค่าและค่าลับ
 * @param {Object}  opts.state     ตัวเก็บ session และคิวกันเขียนชนกัน
 * @param {Object}  [opts.db]      ฐานข้อมูล SQLite ที่เปิดไว้แล้ว (ฝั่ง Node เท่านั้น)
 * @returns {Promise<{status: number, payload: Object}>}
 */
export async function handleApi({ pathname, body, env, state, db, services }) {
  const isPublic = pathname === '/api/public';
  const fnName = String((body && body.fn) || '');
  const args = Array.isArray(body && body.args) ? body.args : [];

  const table = isPublic ? PUBLIC_FUNCTIONS : API_FUNCTIONS;
  if (!Object.prototype.hasOwnProperty.call(table, fnName)) {
    return { status: 404, payload: { ok: false, error: 'ไม่พบคำสั่งที่เรียกใช้: ' + fnName } };
  }
  const fn = table[fnName];

  const ctx = new Ctx(env, state, db, services);

  try {
    if (!isPublic) {
      ctx.token = String((body && body.token) || '');
      ctx.username = await state.touchSession(ctx.token);

      // getCurrentUserInfo ต้องเรียกได้แม้ token หมดอายุ เพื่อให้หน้าเว็บเช็คสถานะได้
      if (!ctx.username && fnName !== 'getCurrentUserInfo') {
        return { status: 401, payload: { ok: false, error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง' } };
      }
    }

    const result = await fn(ctx, ...args);

    // คำสั่งที่แค่อ่านข้อมูลก็อาจมีงานเขียนค้างอยู่ได้ เช่นการเติมคอลัมน์ที่ขาด
    // หรือเติมค่าตั้งต้นในชีต Config ซึ่ง ensureBase() เข้าคิวไว้
    // ถ้าไม่ส่งตรงนี้ การซ่อมโครงสร้างชีตจะไม่เกิดขึ้นจริงสักที
    if (ctx.ss && ctx.ss.dirty) await ctx.ss.flush();

    return { status: 200, payload: { ok: true, result: result === undefined ? null : result } };
  } catch (err) {
    const message = String((err && err.message) || err || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
    // บันทึกรายละเอียดไว้ดูใน log โดยไม่ส่ง stack trace ออกไปหน้าเว็บ
    console.error('[' + fnName + ']', err && err.stack ? err.stack : message);
    return { status: 400, payload: { ok: false, error: message } };
  }
}
