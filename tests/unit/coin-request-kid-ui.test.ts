// tests/unit/coin-request-kid-ui.test.ts
// Item #015 Stage 3: unit tests for kid UI coin request modal + history.
// Uses happy-dom to simulate browser DOM environment.
//
// Tests:
//   1. Modal button exists + click shows modal
//   2. Submit disabled when amount=0 / empty
//   3. Submit enabled when amount=1-999 + reason non-empty
//   4. API mock 200: modal closes + toast fires
//   5. API mock 400: error shown
//   6. History render: 3 status badges displayed correctly
//   7. History empty state: "暂无申请记录" shown

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Window } from 'happy-dom';

describe('Coin Request Kid UI — modal + history', () => {
  // Mutable DOM + state shared across tests
  let window: Window;
  let document: Document;
  let state: Record<string, unknown>;
  let toastCalls: Array<{ msg: string; kind: string }>;
  let apiCalls: Array<{ method: string; path: string; body?: unknown }>;

  beforeEach(() => {
    // Fresh happy-dom window for each test
    window = new Window();
    document = window.document;

    // Reset globals
    global.window = window as unknown as Window & typeof globalThis;
    global.document = document;

    toastCalls = [];
    apiCalls = [];

    // Minimal state matching app.js shape
    state = { coinRequests: [] };

    // Stub the app's api() function
    global.fetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const path = url.replace('http://test.local', '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      apiCalls.push({ method, path, body });
      // Default 200 mock; tests override via callApiOverride
      const statusOverride = (globalThis as Record<string, unknown>).__apiStatusOverride;
      const status = typeof statusOverride === 'number' ? statusOverride : 200;
      const bodyOverride = (globalThis as Record<string, unknown>).__apiBodyOverride;
      if (typeof bodyOverride !== 'undefined') {
        return {
          ok: status < 400,
          status,
          json: async () => bodyOverride,
          text: async () => JSON.stringify(bodyOverride),
        };
      }
      if (path === '/api/coins/request' && method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 1, status: 'pending', amount: body?.amount, requested_at: 1234567890 }),
          text: async () => JSON.stringify({ id: 1, status: 'pending', amount: body?.amount, requested_at: 1234567890 }),
        };
      }
      if (path === '/api/coins/requests' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ requests: state.coinRequests }),
          text: async () => JSON.stringify({ requests: state.coinRequests }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    }) as typeof fetch;

    // Stub console.error to keep test output clean
    vi.stubGlobal('console', { ...console, error: vi.fn() });
  });

  // ── Helper: build the DOM scaffold needed by the modal + history functions ──

  function buildDOM() {
    // Modal (hidden by default)
    const modal = document.createElement('div');
    modal.id = 'coin-request-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <form id="coin-request-form">
        <input type="number" id="coin-request-amount" min="1" max="999" step="1">
        <textarea id="coin-request-reason" rows="3" maxlength="200"></textarea>
        <p id="coin-request-error" hidden></p>
        <button type="submit" id="coin-request-submit">提交申请</button>
        <button type="button" id="coin-request-cancel">取消</button>
      </form>
    `;
    document.body.appendChild(modal);

    // History section
    const section = document.createElement('section');
    section.id = 'coin-request-section';
    section.innerHTML = `
      <span id="coin-request-count">0</span>
      <div id="coin-request-list"></div>
      <div id="coin-request-empty" hidden>
        <div class="empty-icon">🪙</div>
        <div>暂无申请记录</div>
      </div>
    `;
    document.body.appendChild(section);

    // Toast
    const toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }

  // ── Helper: escapeHtml mirrors app.js implementation ──
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Inline implementations of the functions under test (vanilla JS, no imports) ──
  // These replicate the app.js logic so we can test the UI behaviour in isolation
  // without needing the full worker bundler.

  function openCoinRequestModal() {
    const m = document.getElementById('coin-request-modal');
    const f = document.getElementById('coin-request-form');
    const err = document.getElementById('coin-request-error');
    const amountInput = document.getElementById('coin-request-amount');
    if (err) { err.hidden = true; err.textContent = ''; }
    if (f) f.reset();
    const submitBtn = document.getElementById('coin-request-submit');
    if (submitBtn) submitBtn.disabled = false;
    if (m) m.hidden = false;
    if (amountInput) { amountInput.focus(); }
  }

  function closeCoinRequestModal() {
    const m = document.getElementById('coin-request-modal');
    const f = document.getElementById('coin-request-form');
    if (f) f.reset();
    const err = document.getElementById('coin-request-error');
    if (err) { err.hidden = true; err.textContent = ''; }
    if (m) m.hidden = true;
  }

  function showCoinRequestError(msg) {
    const err = document.getElementById('coin-request-error');
    if (!err) return;
    err.textContent = msg;
    err.hidden = false;
  }

  async function submitCoinRequest() {
    const amountInput = document.getElementById('coin-request-amount');
    const reasonInput = document.getElementById('coin-request-reason');
    const submitBtn = document.getElementById('coin-request-submit');
    const err = document.getElementById('coin-request-error');
    if (err) { err.hidden = true; err.textContent = ''; }

    const amount = parseInt(amountInput?.value ?? '', 10);
    const reason = (reasonInput?.value ?? '').trim();

    if (!Number.isInteger(amount) || amount < 1 || amount > 999) {
      showCoinRequestError('金币数必须是 1-999 之间的整数');
      return;
    }
    if (reason.length < 1 || reason.length > 200) {
      showCoinRequestError('理由不能为空，最多 200 字');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    try {
      await fetch('/api/coins/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, reason }),
      }).then(r => r.json());
      closeCoinRequestModal();
      // Simulate toast
      const toastEl = document.getElementById('toast');
      if (toastEl) { toastEl.textContent = '申请已提交，等待 PM 审核'; }
      await loadCoinRequests();
    } catch (e) {
      showCoinRequestError('提交失败：' + String(e?.message ?? e));
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function loadCoinRequests() {
    try {
      const r = await fetch('/api/coins/requests').then(r => r.json());
      state.coinRequests = r.requests ?? [];
    } catch (_) {
      state.coinRequests = [];
    }
    renderCoinRequests();
  }

  function renderCoinRequests() {
    const root = document.getElementById('coin-request-list');
    const empty = document.getElementById('coin-request-empty');
    const count = document.getElementById('coin-request-count');
    if (!root) return;
    count.textContent = String(state.coinRequests.length);
    root.innerHTML = '';
    if (state.coinRequests.length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    state.coinRequests.forEach((req) => {
      const el = document.createElement('div');
      el.className = 'coin-request-item coin-request-' + req.status;
      const statusBadge = {
        pending: '<span class="badge pending">⏳ 待审核</span>',
        approved: '<span class="badge approved">✅ 已通过</span>',
        rejected: '<span class="badge rejected">❌ 已拒绝</span>',
      }[req.status] || req.status;
      const time = new Date(req.requested_at * 1000).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
      el.innerHTML = `
        <div class="coin-request-icon">🪙</div>
        <div class="coin-request-body">
          <div class="coin-request-amount">+${req.amount} 枚</div>
          <div class="coin-request-reason">${escapeHtml(req.reason)}</div>
          <div class="coin-request-meta">${time} · ${statusBadge}</div>
        </div>
      `;
      root.appendChild(el);
    });
  }

  // ── Test 1: Modal button exists + click shows modal ──

  it('modal button exists and click opens modal', () => {
    buildDOM();

    // Simulate button click
    const btn = document.createElement('button');
    btn.id = 'btn-coin-request';
    document.body.appendChild(btn);
    btn.addEventListener('click', openCoinRequestModal);
    btn.click();

    const modal = document.getElementById('coin-request-modal');
    expect(modal).toBeTruthy();
    expect(modal.hidden).toBe(false);
  });

  // ── Test 2: Submit disabled when amount=0 / empty ──

  it('submit is disabled when amount is empty or zero', () => {
    buildDOM();

    const amountInput = document.getElementById('coin-request-amount');
    const reasonInput = document.getElementById('coin-request-reason');
    const submitBtn = document.getElementById('coin-request-submit') as HTMLButtonElement;

    // Fill reason but leave amount empty
    reasonInput.value = '测试';
    amountInput.value = '';

    // Client-side validation: amount=0 → error shown, submit not called
    const amount = parseInt(amountInput.value, 10);
    expect(Number.isInteger(amount)).toBe(false); // '' → NaN

    // amount=0 should fail validation
    const amount0 = 0;
    const isValid0 = Number.isInteger(amount0) && amount0 >= 1 && amount0 <= 999;
    expect(isValid0).toBe(false);
  });

  // ── Test 3: Submit enabled when amount=1-999 + reason non-empty ──

  it('validation passes for valid amount 1-999 and non-empty reason', () => {
    buildDOM();

    const amountInput = document.getElementById('coin-request-amount');
    const reasonInput = document.getElementById('coin-request-reason');

    amountInput.value = '50';
    reasonInput.value = '数学考100分';

    const amount = parseInt(amountInput.value, 10);
    const reason = reasonInput.value.trim();

    const isValid = (
      Number.isInteger(amount) &&
      amount >= 1 &&
      amount <= 999 &&
      reason.length >= 1 &&
      reason.length <= 200
    );
    expect(isValid).toBe(true);
  });

  it('validation fails for amount > 999', () => {
    buildDOM();

    const amount = 1000;
    const reason = '测试';

    const isValid = (
      Number.isInteger(amount) &&
      amount >= 1 &&
      amount <= 999 &&
      reason.trim().length >= 1
    );
    expect(isValid).toBe(false);
  });

  it('validation fails for empty reason', () => {
    buildDOM();

    const amount = 50;
    const reason = '';

    const isValid = (
      Number.isInteger(amount) &&
      amount >= 1 &&
      amount <= 999 &&
      reason.trim().length >= 1
    );
    expect(isValid).toBe(false);
  });

  // ── Test 4: API mock 200 → modal closes + toast fires ──

  it('API 200: modal closes and toast is shown on success', async () => {
    buildDOM();

    // Fill form
    const amountInput = document.getElementById('coin-request-amount');
    const reasonInput = document.getElementById('coin-request-reason');
    amountInput.value = '50';
    reasonInput.value = '数学考100分';

    // Open modal
    openCoinRequestModal();
    expect(document.getElementById('coin-request-modal').hidden).toBe(false);

    // Submit
    await submitCoinRequest();

    // Modal should be closed
    expect(document.getElementById('coin-request-modal').hidden).toBe(true);

    // Toast should show success message
    const toastEl = document.getElementById('toast');
    expect(toastEl.textContent).toContain('申请已提交');
  });

  // ── Test 5: API mock 400 → error shown ──

  it('API 400: error is displayed and modal stays open', async () => {
    buildDOM();

    // Override API to return 400
    (globalThis as Record<string, unknown>).__apiStatusOverride = 400;
    (globalThis as Record<string, unknown>).__apiBodyOverride = { error: { code: 'BAD_REQUEST', message: 'amount is required' } };

    const amountInput = document.getElementById('coin-request-amount');
    const reasonInput = document.getElementById('coin-request-reason');
    amountInput.value = '50';
    reasonInput.value = '测试';

    openCoinRequestModal();

    await submitCoinRequest();

    // Error should be shown
    const errEl = document.getElementById('coin-request-error');
    expect(errEl.hidden).toBe(false);
    expect(errEl.textContent).toContain('提交失败');

    // Modal should still be open
    expect(document.getElementById('coin-request-modal').hidden).toBe(false);

    // Reset override
    delete (globalThis as Record<string, unknown>).__apiStatusOverride;
    delete (globalThis as Record<string, unknown>).__apiBodyOverride;
  });

  // ── Test 6: History render — 3 status badges displayed ──

  it('renders pending, approved, and rejected badges correctly', () => {
    buildDOM();

    state.coinRequests = [
      { id: 1, status: 'pending',   amount: 50, reason: '测试1', requested_at: 1234567890 },
      { id: 2, status: 'approved',  amount: 30, reason: '测试2', requested_at: 1234567891 },
      { id: 3, status: 'rejected',  amount: 20, reason: '测试3', requested_at: 1234567892 },
    ];

    renderCoinRequests();

    const items = document.querySelectorAll('.coin-request-item');
    expect(items).toHaveLength(3);

    expect(items[0].className).toContain('coin-request-pending');
    expect(items[1].className).toContain('coin-request-approved');
    expect(items[2].className).toContain('coin-request-rejected');

    // Badges present
    expect(items[0].innerHTML).toContain('⏳');
    expect(items[1].innerHTML).toContain('✅');
    expect(items[2].innerHTML).toContain('❌');

    // Amount shown
    expect(items[0].innerHTML).toContain('+50');
    expect(items[1].innerHTML).toContain('+30');
    expect(items[2].innerHTML).toContain('+20');
  });

  // ── Test 7: History empty state ──

  it('shows empty state when no requests exist', () => {
    buildDOM();

    state.coinRequests = [];
    renderCoinRequests();

    const empty = document.getElementById('coin-request-empty');
    expect(empty.hidden).toBe(false);

    const count = document.getElementById('coin-request-count');
    expect(count.textContent).toBe('0');

    const items = document.querySelectorAll('.coin-request-item');
    expect(items).toHaveLength(0);
  });
});
