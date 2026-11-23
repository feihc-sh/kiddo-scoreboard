// tests/unit/achievement-records-modal.test.ts
// 孩子侧成就详情弹窗的「完成记录」区 (spec §7c, migration 0022).
//
// 三层断言 (与仓库既有的「读真实源码 + 断言契约」风格一致 ——
// admin-panel.test.ts / coin-bag-modal.test.ts):
//   1. HTML 结构 —— 记录区的 DOM 骨架 + 空状态文案
//   2. CSS —— 记录列表有样式类
//   3. JS 接线 —— renderModalRecords 存在, 在 openModal 里被调用,
//      且渲染前对 note 做 escapeHtml (XSS)
//
// 渲染逻辑本身由 e2e 覆盖 (tests/e2e/achievement-records.spec.ts) ——
// 这里守住「结构 + 接线」, 防止 refactor 时把记录区悄悄删掉。
//
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'achievements.html');
const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'achievements.css');
const JS_PATH = path.join(__dirname, '..', '..', 'public', 'achievements.js');

describe('成就详情弹窗 —— 完成记录区 (spec §7c)', () => {
  let html: string;
  let css: string;
  let js: string;

  /**
   * 把整页 HTML 塞进 document —— 但先剥掉 <link> / <script> 标签。
   *
   * 整页里有 Google Fonts 的 <link> 和 module <script>, happy-dom 会去
   * 真发 fetch 请求 (噪声 + 慢)。这两个标签跟本测试要断言的 DOM 骨架
   * 无关, 剥掉最省事 —— 不用去猜 HTML 的缩进做脆弱的字符串切片。
   */
  function mountPage(): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = html
      .replace(/<link\b[^>]*>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    document.body.appendChild(host);
    return host;
  }

  beforeEach(() => {
    html = fs.readFileSync(HTML_PATH, 'utf8');
    css = fs.readFileSync(CSS_PATH, 'utf8');
    js = fs.readFileSync(JS_PATH, 'utf8');
    document.body.innerHTML = '';
  });

  // -------------------------------------------------------------------------
  // 1. HTML 结构
  // -------------------------------------------------------------------------
  it('the modal declares the 完成记录 block with a list and an empty state', () => {
    expect(html).toContain('id="modal-records"');
    expect(html).toContain('id="modal-records-list"');
    expect(html).toContain('id="modal-records-empty"');
  });

  it('the empty-state copy is the warm, non-judgemental wording', () => {
    expect(html).toContain('还没有记录，解锁后这里会写下每次成就时刻');
  });

  it('the records block sits inside the modal body (below the status area)', () => {
    mountPage();
    const modalBody = document.querySelector('#detail-modal .modal-body');
    expect(modalBody).not.toBeNull();

    const status = modalBody!.querySelector('.modal-status');
    const records = modalBody!.querySelector('#modal-records');
    expect(status).not.toBeNull();
    expect(records).not.toBeNull();

    // 顺序: 状态区在前, 记录区在后 (DOM 顺序 = 视觉顺序)。
    const children = Array.from(modalBody!.children);
    expect(children.indexOf(records!)).toBeGreaterThan(children.indexOf(status!));
  });

  // -------------------------------------------------------------------------
  // 2. CSS
  // -------------------------------------------------------------------------
  it('the records list has its own style classes', () => {
    expect(css).toMatch(/\.modal-records\s*\{/);
    expect(css).toMatch(/\.modal-records-list\s*\{/);
    expect(css).toMatch(/\.modal-record\s*\{/);
    expect(css).toMatch(/\.modal-record-date\s*\{/);
    expect(css).toMatch(/\.modal-record-note\s*\{/);
  });

  // -------------------------------------------------------------------------
  // 3. JS 接线
  // -------------------------------------------------------------------------
  it('achievements.js has a renderModalRecords function', () => {
    expect(js).toContain('function renderModalRecords');
  });

  it('openModal calls renderModalRecords with the item records', () => {
    const fn = js.slice(js.indexOf('function openModal'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('renderModalRecords(item.records)');
  });

  it('renderModalRecords escapes the note text before inserting HTML (XSS)', () => {
    const fn = js.slice(js.indexOf('function renderModalRecords'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('escapeHtml(r.note)');
    expect(body).toContain('escapeHtml(r.completed_on)');
  });

  it('renderModalRecords shows the empty state when there are no records', () => {
    const fn = js.slice(js.indexOf('function renderModalRecords'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // 空数组 → 空状态可见, 列表为空。
    expect(body).toContain('els.modalRecordsEmpty.hidden = list.length > 0;');
  });

  it('renderModalRecords falls back to "—" for missing date / note', () => {
    const fn = js.slice(js.indexOf('function renderModalRecords'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // PM 没记的那一项显示 '—' —— 不编造内容, 也不把整条记录藏掉。
    expect(body).toContain("'—'");
  });
});
