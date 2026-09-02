import { handleApi, isApiPath } from '../src/api.js';

export { AppState } from './app-state.js';

/**
 * ============================================================================
 * รันระบบบน Cloudflare Workers
 * ============================================================================
 *
 * วิธี deploy:  npx wrangler deploy
 *
 * ไฟล์นี้คือ "ส่วนที่รู้จัก Cloudflare" ซึ่งมีอยู่แค่ไฟล์เดียวเหมือนกับฝั่ง Node
 * ตรรกะของระบบทั้งหมดอยู่ใน src/ ซึ่งใช้ร่วมกันทั้งสองแบบโดยไม่ต้องแก้อะไร
 *
 * ต่างจากฝั่ง Node ตรงที่:
 *   - ไฟล์หน้าเว็บถูกเสิร์ฟจาก CDN ของ Cloudflare ไม่ผ่านโค้ดนี้เลย
 *   - session และคิวกันเขียนชนกันใช้ Durable Object แทนหน่วยความจำของ process
 *     (เพราะ Worker กระจายรันอยู่หลายเครื่องทั่วโลก ไม่มีหน่วยความจำร่วมกัน)
 * ============================================================================
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!isApiPath(url.pathname)) {
      return env.ASSETS.fetch(request);
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'ต้องเรียกด้วยวิธี POST เท่านั้น' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'ข้อมูลที่ส่งมาไม่ใช่ JSON ที่ถูกต้อง' }, 400);
    }

    // Durable Object ตัวเดียวของทั้งระบบ ใช้เก็บ session และเป็นคิวกันเขียนชนกัน
    const state = env.APP_STATE.get(env.APP_STATE.idFromName('global'));

    const { status, payload } = await handleApi({ pathname: url.pathname, body, env, state });
    return json(payload, status);
  }
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
