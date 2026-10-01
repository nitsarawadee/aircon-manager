/**
 * ข้อความแจ้งเตือนมุมจอ
 *
 * ============================================================================
 * ปัญหาที่ชุดนี้แก้
 * ============================================================================
 * เจ้าของงานบอกว่า "เวลาแจ้งเตือนอะไรมาในเว็บอ่านไม่ทัน" ซึ่งของเดิมตั้งเวลาไว้
 * 3 วินาทีเท่ากันหมดทุกข้อความ ไม่ว่าจะเป็น "บันทึกสำเร็จ" 12 ตัวอักษร
 * หรือข้อความบอกสาเหตุที่ยาว 88 ตัวอักษรอย่าง
 * "นำเข้าสำเร็จ 15 รายการ แต่ไม่พบรหัสนี้ในแผน: AYA-WNI-AIR-1, ..."
 *
 * ผลคือข้อความที่สำคัญที่สุด กลายเป็นข้อความที่อ่านไม่ทันก่อนหาย
 *
 * ============================================================================
 * กติกาที่ล็อกไว้
 * ============================================================================
 * - ข้อความยาวต้องอยู่บนจอนานกว่าข้อความสั้น
 * - ข้อความที่เป็น error หายเองใน 7 วินาทีเท่ากันทุกอัน (เจ้าของงานขอ — เดิมค้างจนกว่าจะกดปิด)
 * - ยิงข้อความรัวๆ ต้องไม่ทำให้หน้าเว็บค้าง (เคยค้างมาแล้ว ดูหมายเหตุข้างล่าง)
 * - สิ่งที่ผู้ใช้พิมพ์มาต้องขึ้นเป็นตัวหนังสือ ไม่ใช่ HTML
 *
 * ============================================================================
 * ทำไมต้องมีตัวนับการอ่าน container.children
 * ============================================================================
 * ลูปตัดข้อความเก่าเคยเขียนว่า
 *     while (container.children.length >= TOAST_MAX) dismissToast(children[0]);
 * ซึ่ง dismissToast เล่นภาพจางก่อนแล้วค่อยลบจริงอีก 300ms ทีหลัง
 * จำนวนลูกใน container จึงไม่ลดภายในลูป กลายเป็นลูปไม่รู้จบที่ค้างทั้งหน้าเว็บ
 * (เจอจริงตอนทดสอบ แท็บค้างจนต้องปิดทิ้ง)
 *
 * ลูปไม่รู้จบเป็นการวนแบบ synchronous ตัวจับเวลาของ node:test จึงไม่มีโอกาส
 * ได้ทำงาน เทสต์จะค้างแทนที่จะฟ้อง ตรงนี้เลยนับจำนวนครั้งที่อ่าน children
 * แล้วโยน error ออกมาแทน เพื่อให้อาการนี้กลับมาเมื่อไหร่ได้เห็นเป็นเทสต์แดง
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');
const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

/** โค้ดของฟังก์ชันชื่อที่ระบุ ตามที่เขียนไว้จริงในหน้าเว็บ */
function sourceOf(name) {
  const re = new RegExp(String.raw`function ${name}\([^)]*\)[\s\S]*?\n    \}`);
  const src = js.match(re);
  assert.ok(src, `หาฟังก์ชัน ${name} ในหน้าเว็บไม่เจอ`);
  return src[0];
}

const maxSrc = js.match(/const TOAST_MAX = \d+;/);
assert.ok(maxSrc, 'หา TOAST_MAX ในหน้าเว็บไม่เจอ');

/* ==================== DOM ปลอมเท่าที่ showToast ใช้จริง ==================== */

function fakeEl(tag) {
  const el = {
    tagName: tag, className: '', title: '', innerHTML: '', textContent: '',
    style: {}, children: [], parent: null, offsetWidth: 1, onclick: null,
    listeners: {},
    classList: {
      add(...names) {
        const has = el.className.split(' ');
        for (const n of names) if (!has.includes(n)) el.className += ' ' + n;
      },
      remove(...names) {
        el.className = el.className.split(' ').filter(n => !names.includes(n)).join(' ');
      }
    },
    appendChild(child) { child.parent = el; el.children.push(child); return child; },
    append(...kids) { for (const k of kids) el.appendChild(k); },
    remove() {
      if (!el.parent) return;
      const i = el.parent.children.indexOf(el);
      if (i >= 0) el.parent.children.splice(i, 1);
      el.parent = null;
    },
    addEventListener(name, fn) { (el.listeners[name] = el.listeners[name] || []).push(fn); },
    querySelector(sel) {
      const want = sel.replace('.', '');
      const hit = node => sel.startsWith('.')
        ? node.className.split(' ').includes(want)
        : node.tagName === want;
      const walk = node => {
        for (const c of node.children) {
          if (hit(c)) return c;
          const deep = walk(c);
          if (deep) return deep;
        }
        return null;
      };
      return walk(el);
    },
    /** ข้อความที่ผู้ใช้เห็นจริง รวมลูกทุกชั้น */
    get text() {
      return el.textContent + el.children.map(c => c.text).join('');
    }
  };
  return el;
}

/**
 * สร้างขอบเขตที่มีฟังก์ชันจริงจากหน้าเว็บ พร้อม DOM ปลอม
 * ตัวจับเวลาไม่เดินจริง เก็บไว้ให้เรียกเองเพื่อไม่ต้องรอเวลาในเทสต์
 */
function makeScope() {
  const container = fakeEl('div');
  const kids = container.children;
  let reads = 0;

  Object.defineProperty(container, 'children', {
    get() {
      if (++reads > 500) throw new Error('showToast วนไม่รู้จบ — ลูปตัดข้อความเก่าไม่ยอมจบ');
      return kids;
    }
  });

  const timers = new Map();
  let nextId = 1;

  const doc = {
    getElementById: id => (id === 'toastContainer' ? container : null),
    createElement: tag => fakeEl(tag)
  };

  const scope = new Function(
    'document', 'setTimeout', 'clearTimeout', 'getComputedStyle', 'requestAnimationFrame',
    maxSrc[0] + '\n' + sourceOf('toastMs') + '\n' + sourceOf('dismissToast') + '\n' + sourceOf('showToast') +
    '\nreturn { toastMs, showToast, dismissToast, TOAST_MAX };'
  )(
    doc,
    (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    id => timers.delete(id),
    () => ({ transform: 'matrix(0.5, 0, 0, 1, 0, 0)' }),
    fn => fn()
  );

  return { ...scope, container, kids, timers, resetReads: () => { reads = 0; } };
}

/* ==================== เวลาต้องยาวตามข้อความ ==================== */

test('ข้อความยาวต้องอยู่บนจอนานกว่าข้อความสั้น', () => {
  const { toastMs } = makeScope();

  const สั้น = toastMs('บันทึกสำเร็จ');
  const ยาว = toastMs('นำเข้าสำเร็จ 15 รายการ แต่ไม่พบรหัสนี้ในแผน: AYA-WNI-AIR-1, BKK-MBI-AIR-2, CNX-SKN-AIR-1');

  assert.ok(ยาว > สั้น, 'ข้อความยาวต้องได้เวลามากกว่า');
  assert.ok(ยาว > 8000, 'ข้อความ 88 ตัวอักษรต้องได้เกิน 8 วินาที ไม่ใช่ 3 วินาทีเท่าเดิม');
});

test('ข้อความสั้นที่สุดก็ต้องได้เวลามากกว่าของเดิม 3 วินาที', () => {
  const { toastMs } = makeScope();
  assert.ok(toastMs('') >= 4000);
  assert.ok(toastMs('ลบแล้ว') >= 4000);
});

test('ข้อความยาวผิดปกติต้องไม่ค้างอยู่เป็นนาที', () => {
  const { toastMs } = makeScope();
  assert.ok(toastMs('ก'.repeat(5000)) <= 14000, 'ต้องมีเพดาน');
});

test('ค่าว่างหรือไม่มีค่า ต้องไม่ทำให้พัง', () => {
  const { toastMs } = makeScope();
  assert.equal(typeof toastMs(null), 'number');
  assert.equal(typeof toastMs(undefined), 'number');
});

/* ==================== error หายเองใน 7 วินาที ==================== */

// เดิม error ค้างจนกว่าจะกดปิด — เจ้าของงานขอให้หายเอง 7 วินาทีเท่ากันทุกอัน
test('ข้อความที่เป็น error หายเองใน 7 วินาที ไม่ว่าสั้นหรือยาว และมีแถบนับถอยหลัง', () => {
  const { showToast, kids, timers } = makeScope();

  showToast('บันทึกไม่สำเร็จ', 'error');
  showToast('บันทึกไม่สำเร็จ: เครื่องนี้มีเอกสารของรอบนี้อยู่แล้ว กรุณาตรวจสอบเลขที่เอกสารในหน้าแบบฟอร์มเอกสารอีกครั้ง', 'error');

  assert.equal(kids.length, 2);
  assert.deepEqual([...timers.values()].map(t => t.ms).filter(ms => ms > 1000), [7000, 7000]);
  assert.ok(kids[0].querySelector('.toast-bar'), 'error ต้องมีแถบนับถอยหลัง');
});

test('ข้อความสำเร็จต้องยังหายเองได้ และมีแถบบอกเวลาที่เหลือ', () => {
  const { showToast, kids, timers } = makeScope();

  showToast('บันทึกสำเร็จ');

  assert.equal(timers.size, 1, 'ต้องมีตัวจับเวลา');
  assert.ok(kids[0].querySelector('.toast-bar'), 'ต้องมีแถบนับถอยหลัง');
});

test('ทุกข้อความต้องมีปุ่มปิดให้กดเสมอ', () => {
  const { showToast, kids } = makeScope();

  for (const type of ['success', 'error', 'info']) {
    showToast('ทดสอบ ' + type, type);
    const btn = kids[kids.length - 1].querySelector('button');
    assert.ok(btn, type + ' ต้องมีปุ่มปิด');
    assert.equal(typeof btn.onclick, 'function');
  }
});

test('กดปุ่มปิดแล้วต้องเลิกนับเวลาและเริ่มเอาออกจากหน้า', () => {
  const { showToast, kids, timers } = makeScope();

  showToast('บันทึกสำเร็จ');
  const toast = kids[0];
  assert.equal(timers.size, 1);

  toast.querySelector('button').onclick();

  assert.ok(toast._gone, 'ต้องถูกทำเครื่องหมายว่าปิดแล้ว');
  assert.ok(!toast.className.includes('toast-enter-active'));
  assert.ok(toast.className.includes('toast-exit'));
});

test('กดปุ่มปิดซ้ำต้องไม่ทำอะไรเพิ่ม', () => {
  const { showToast, kids, dismissToast } = makeScope();

  showToast('บันทึกสำเร็จ');
  const toast = kids[0];
  dismissToast(toast);
  dismissToast(toast);
  dismissToast(toast);

  assert.equal((toast.className.match(/toast-exit/g) || []).length, 1);
});

/* ==================== ยิงรัวๆ ต้องไม่ค้าง ==================== */

test('ยิงข้อความรัวๆ ต้องไม่ทำให้หน้าเว็บค้าง', () => {
  // ข้อนี้คือข้อที่สำคัญที่สุดในไฟล์ — อาการเดิมคือแท็บค้างจนต้องปิดทิ้ง
  const { showToast, kids } = makeScope();

  for (let i = 1; i <= 30; i++) showToast('ข้อความที่ ' + i, 'error');

  assert.ok(kids.length <= 4, 'ค้างบนจอได้ไม่เกิน 4 ข้อความ แต่ได้ ' + kids.length);
});

test('ข้อความที่ค้างบนจอต้องเป็นตัวใหม่สุด ไม่ใช่ตัวเก่าสุด', () => {
  const { showToast, kids } = makeScope();

  for (let i = 1; i <= 8; i++) showToast('ข้อความที่ ' + i, 'error');

  assert.deepEqual(
    kids.map(k => k.text),
    ['ข้อความที่ 5', 'ข้อความที่ 6', 'ข้อความที่ 7', 'ข้อความที่ 8']
  );
});

test('ตัวที่ถูกตัดทิ้งต้องไม่เหลือตัวจับเวลาค้างไว้', () => {
  // ถ้าไม่เคลียร์ ตัวจับเวลาของกล่องที่ถูกลบไปแล้วจะยังเดินอยู่เป็นสิบตัว
  const { showToast, timers } = makeScope();

  for (let i = 1; i <= 20; i++) showToast('ข้อความที่ ' + i);

  assert.ok(timers.size <= 4, 'ตัวจับเวลาที่ยังเหลือต้องไม่เกินจำนวนกล่องบนจอ แต่มี ' + timers.size);
});

/* ==================== สิ่งที่ผู้ใช้พิมพ์ต้องไม่กลายเป็น HTML ==================== */

test('แท็กที่ผู้ใช้พิมพ์มาต้องขึ้นเป็นตัวหนังสือ ไม่ใช่ HTML', () => {
  // หลายจุดเอาสิ่งที่ผู้ใช้พิมพ์มาต่อในข้อความ เช่น
  //   showToast('ไม่พบเครื่องรหัส "' + typed + '" กรุณาเลือกจากรายการ', 'error')
  // ของเดิมยัดทั้งก้อนเข้า innerHTML แท็กที่พิมพ์ใส่จึงทำงานได้จริง
  const { showToast, kids } = makeScope();
  const พิมพ์มา = '<img src=x onerror=alert(1)>';

  showToast('ไม่พบเครื่องรหัส "' + พิมพ์มา + '" กรุณาเลือกจากรายการ', 'error');

  const toast = kids[0];
  assert.equal(toast.querySelector('img'), null, 'ต้องไม่มีแท็กงอกขึ้นมาจริง');
  assert.ok(toast.text.includes(พิมพ์มา), 'ต้องยังเห็นข้อความตามที่พิมพ์มา');
});

test('ข้อความว่างหรือไม่มีค่า ต้องไม่ทำให้ตกเป็นคำว่า undefined', () => {
  const { showToast, kids } = makeScope();

  showToast(null);
  showToast(undefined);

  assert.equal(kids[0].text, '');
  assert.equal(kids[1].text, '');
});
