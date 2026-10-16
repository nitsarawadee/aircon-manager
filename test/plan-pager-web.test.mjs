/**
 * ตารางแผนใช้แถบเปลี่ยนหน้าตัวเดียวกับทุกตาราง (renderTablePager — 16/10/2569)
 *
 * เดิมหน้าแผนมีก๊อปปี้ของตัวเอง (renderPlanPagination) แก้ที่หนึ่งแล้วอีกที่ไม่เปลี่ยนตาม
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'web', 'index.html'), 'utf8');

test('ไม่มีตัวแบ่งหน้าของแผนแยกแล้ว — ตารางแผนเรียก renderTablePager กับ clampPage', () => {
  assert.ok(!/function renderPlanPagination\(/.test(html), 'ยังมี renderPlanPagination ซ้ำอยู่');
  const src = html.match(/\n {4}function renderPlanTable\([^)]*\) \{[\s\S]*?\n {4}\}/);
  assert.ok(src, 'หา renderPlanTable ไม่เจอ');
  assert.match(src[0], /renderTablePager\('planPaginationBar', totalRows, planPage, 'goToPlanPage', PLAN_PAGE_SIZE\)/);
  assert.match(src[0], /planPage = clampPage\(planPage, totalRows, PLAN_PAGE_SIZE\)/);
});
