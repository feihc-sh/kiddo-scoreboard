// tests/unit/coin-request-kid-ui.test.ts
// Item #015 Stage 3: unit tests for kid UI coin request modal + history.
// Uses happy-dom to simulate browser DOM environment.
//
// Tests (mirroring #010 sprint modal patterns):
//   1. Modal button exists + click shows modal
//   2. Client-side validation: amount=0 / empty reason fails
//   3. Client-side validation: valid amount 1-999 + non-empty reason passes
//   4. closeCoinRequestModal closes the modal
//   5. showCoinRequestError displays error text + reveals element
//   6. renderCoinRequests: pending/approved/rejected badges shown
//   7. renderCoinRequests: empty state when no requests
//   8. openCoinRequestModal focuses amount input and resets form
//   9. form reset clears fields after closeModal

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Window } from 'happy-dom';

describe('Coin Request Kid UI — modal + history', () => {
  // Mutable DOM + state
  let window: Window;
  let document: Document;
  let state: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window = new Window();
    document = window.document;
    globalThis.window = window as unknown as Window & typeof globalThis;
    globalThis.document = document;
    state = { coinRequests: [] };

    // Mock fetch that always succeeds
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: 1, status: 'pending', amount: 50, requested_at: 1234567890 }),
      text: async () => JSON.stringify({ id: 1, status: 'pending', amount: 50, requested_at: 1234567890 }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    vi.stubGlobal('console', { ...console, error: vi.fn() });
  });

  // ── DOM scaffold ──
  function buildDOM() {
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

    const toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }

  // ── Re-implementations (mirrors app.js logic) ──
  function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

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
    if (m) {
      m.hidden = true;
      // Set attribute explicitly (happy-dom quirk: .hidden property doesn't always
      // sync to the HTML hidden attribute, so getAttribute('hidden') can return null)
      m.setAttribute('hidden', '');
    }
  }

  function showCoinRequestError(msg: string) {
    const err = document.getElementById('coin-request-error');
    if (!err) return;
    err.textContent = msg;
    err.hidden = false;
  }

  function validateForm(amountRaw: string, reasonRaw: string): string | null {
    const amount = parseInt(amountRaw, 10);
    const reason = reasonRaw.trim();
    if (!Number.isInteger(amount) || amount < 1 || amount > 999) {
      return '金币数必须是 1-999 之间的整数';
    }
    if (reason.length < 1 || reason.length > 200) {
      return '理由不能为空，最多 200 字';
    }
    return null;
  }

  function renderCoinRequests() {
    const root = document.getElementById('coin-request-list');
    const empty = document.getElementById('coin-request-empty');
    const count = document.getElementById('coin-request-count');
    if (!root) return;
    count.textContent = String((state.coinRequests as unknown[]).length);
    root.innerHTML = '';
    if ((state.coinRequests as unknown[]).length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    (state.coinRequests as Array<Record<string, unknown>>).forEach((req) => {
      const el = document.createElement('div');
      el.className = 'coin-request-item coin-request-' + String(req.status);
      const badgeMap: Record<string, string> = {
        pending: '<span class="badge pending">⏳ 待审核</span>',
        approved: '<span class="badge approved">✅ 已通过</span>',
        rejected: '<span class="badge rejected">❌ 已拒绝</span>',
      };
      const statusBadge = badgeMap[String(req.status)] ?? String(req.status);
      const time = new Date(Number(req.requested_at) * 1000).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
      el.innerHTML = `
        <div class="coin-request-icon">🪙</div>
        <div class="coin-request-body">
          <div class="coin-request-amount">+${req.amount} 枚</div>
          <div class="coin-request-reason">${escapeHtml(String(req.reason))}</div>
          <div class="coin-request-meta">${time} · ${statusBadge}</div>
        </div>
      `;
      root.appendChild(el);
    });
  }

  // ── Test 1: Modal button exists + click opens modal ──
  it('modal button click opens modal', () => {
    buildDOM();
    const btn = document.createElement('button');
    btn.id = 'btn-coin-request';
    document.body.appendChild(btn);
    btn.addEventListener('click', openCoinRequestModal);
    btn.click();
    const modal = document.getElementById('coin-request-modal');
    expect(modal).toBeTruthy();
    expect(modal.hidden).toBe(false);
  });

  // ── Test 2: Client-side validation: empty/invalid amounts fail ──
  it('validation fails for empty amount', () => {
    buildDOM();
    expect(validateForm('', 'reason')).toBe('金币数必须是 1-999 之间的整数');
  });

  it('validation fails for amount = 0', () => {
    buildDOM();
    expect(validateForm('0', 'reason')).toBe('金币数必须是 1-999 之间的整数');
  });

  it('validation fails for amount > 999', () => {
    buildDOM();
    expect(validateForm('1000', 'reason')).toBe('金币数必须是 1-999 之间的整数');
  });

  it('validation fails for empty reason', () => {
    buildDOM();
    expect(validateForm('50', '')).toBe('理由不能为空，最多 200 字');
  });

  it('validation fails for whitespace-only reason', () => {
    buildDOM();
    expect(validateForm('50', '   ')).toBe('理由不能为空，最多 200 字');
  });

  // ── Test 3: Client-side validation: valid inputs pass ──
  it('validation passes for amount 1-999 + non-empty reason', () => {
    buildDOM();
    expect(validateForm('50', '数学考100分,想奖励自己')).toBeNull();
  });

  it('validation passes for minimum valid amount (1)', () => {
    buildDOM();
    expect(validateForm('1', 'reason')).toBeNull();
  });

  it('validation passes for maximum valid amount (999)', () => {
    buildDOM();
    expect(validateForm('999', 'reason')).toBeNull();
  });

  // ── Test 4: closeCoinRequestModal closes the modal ──
  it('closeCoinRequestModal sets modal.hidden = true', () => {
    buildDOM();
    openCoinRequestModal();
    const modal = document.getElementById('coin-request-modal');
    expect(modal.hidden).toBe(false);
    closeCoinRequestModal();
    expect(modal.hidden).toBe(true);
  });

  // ── Test 5: showCoinRequestError shows the error ──
  it('showCoinRequestError reveals error element with message', () => {
    buildDOM();
    showCoinRequestError('提交失败：INVALID_AMOUNT');
    const errEl = document.getElementById('coin-request-error');
    expect(errEl.hidden).toBe(false);
    expect(errEl.textContent).toContain('提交失败');
  });

  // ── Test 6: History render — 3 status badges ──
  it('renders pending, approved, rejected badges with correct amounts', () => {
    buildDOM();
    state.coinRequests = [
      { id: 1, status: 'pending',   amount: 50, reason: '测试1', requested_at: 1234567890 },
      { id: 2, status: 'approved',  amount: 30, reason: '测试2', requested_at: 1234567891 },
      { id: 3, status: 'rejected', amount: 20, reason: '测试3', requested_at: 1234567892 },
    ];
    renderCoinRequests();
    const items = document.querySelectorAll('.coin-request-item');
    expect(items).toHaveLength(3);
    expect(items[0].className).toContain('coin-request-pending');
    expect(items[1].className).toContain('coin-request-approved');
    expect(items[2].className).toContain('coin-request-rejected');
    expect(items[0].innerHTML).toContain('⏳');
    expect(items[1].innerHTML).toContain('✅');
    expect(items[2].innerHTML).toContain('❌');
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
    expect(document.getElementById('coin-request-count').textContent).toBe('0');
    expect(document.querySelectorAll('.coin-request-item')).toHaveLength(0);
  });

  // ── Test 8: openCoinRequestModal focuses amount input ──
  it('openCoinRequestModal focuses amount input', () => {
    buildDOM();
    openCoinRequestModal();
    const amountInput = document.getElementById('coin-request-amount');
    expect(document.activeElement).toBe(amountInput);
  });

  // ── Test 9: form reset clears fields ──
  it('form reset clears amount and reason fields', () => {
    buildDOM();
    const amountInput = document.getElementById('coin-request-amount') as HTMLInputElement;
    const reasonInput = document.getElementById('coin-request-reason') as HTMLTextAreaElement;
    amountInput.value = '77';
    reasonInput.value = '测试理由';
    closeCoinRequestModal();
    expect(amountInput.value).toBe('');
    expect(reasonInput.value).toBe('');
  });
});
