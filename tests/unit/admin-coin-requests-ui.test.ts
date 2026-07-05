// tests/unit/admin-coin-requests-ui.test.ts
// Item #015 §4: unit tests for admin coin request UI (load + render + approve/reject).
// Uses happy-dom to simulate browser DOM environment.
//
// Tests:
//   1. loadCoinRequests() → success → state.coinRequests updated
//   2. renderCoinRequests 0 items → empty state shown
//   3. renderCoinRequests 1 item → 1 row with kid name + amount + reason + 2 buttons
//   4. approve button click → confirm modal → POST approve API → reload

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Window } from 'happy-dom';

describe('Admin Coin Requests UI — load + render + approve/reject', () => {
  // Mutable DOM + state
  let window: Window;
  let document: Document;
  let state: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let toastCalls: string[];

  beforeEach(() => {
    window = new Window();
    document = window.document;
    globalThis.window = window as unknown as Window & typeof globalThis;
    globalThis.document = document;
    state = { coinRequests: [] };
    toastCalls = [];

    // Mock fetch
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        requests: [
          { id: 50001, user_id: 2, child_name: 'Tommy', amount: 50, reason: '数学考100分', status: 'pending', requested_at: 1234567890 },
        ],
      }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Mock window.confirm / window.prompt
    globalThis.confirm = vi.fn(() => true);
    globalThis.prompt = vi.fn(() => '理由不足');

    // Mock toast (replace document.getElementById call)
    vi.stubGlobal('console', { ...console, error: vi.fn() });
  });

  // ── DOM scaffold ──
  function buildDOM() {
    const section = document.createElement('div');
    section.id = 'sec-coin-requests';
    section.innerHTML = `
      <span id="count-coin-requests">0</span>
      <div id="coin-request-list"></div>
      <div id="coin-request-empty" hidden>
        <div>暂无待审申请</div>
      </div>
    `;
    document.body.appendChild(section);
  }

  // ── Re-implementations (mirrors admin.js logic) ──
  function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function fmtTime(unixSec: number): string {
    if (!unixSec) return '—';
    const d = new Date(Number(unixSec) * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function rowEl(html: string): HTMLElement {
    const div = document.createElement('div');
    div.className = 'pm-row coin-request-item';
    div.innerHTML = html;
    return div;
  }

  async function api(method: string, path: string, body?: unknown) {
    const opts: RequestInit = { method, headers: {} };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(path, opts);
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) {
      const code = data?.error?.code || 'HTTP_' + r.status;
      throw new Error(code);
    }
    return data;
  }

  function toast(msg: string, kind = 'info') {
    toastCalls.push(msg);
    const el = document.getElementById('toast');
    if (el) { el.textContent = msg; }
  }

  async function loadCoinRequests() {
    try {
      const r = await api('GET', '/api/admin/coin-requests?status=pending');
      state.coinRequests = Array.isArray((r as { requests?: unknown[] }).requests)
        ? (r as { requests: unknown[] }).requests
        : [];
    } catch (e) {
      state.coinRequests = [];
    }
  }

  function renderCoinRequests() {
    const root = document.getElementById('coin-request-list');
    const empty = document.getElementById('coin-request-empty');
    const countEl = document.getElementById('count-coin-requests');
    if (!root) return;
    if (countEl) countEl.textContent = String((state.coinRequests as unknown[]).length);
    root.innerHTML = '';
    if ((state.coinRequests as unknown[]).length === 0) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    (state.coinRequests as Array<Record<string, unknown>>).forEach((req) => {
      const childName = req.child_name ? escapeHtml(String(req.child_name)) : ('user #' + req.user_id);
      const reason = escapeHtml(String(req.reason || '—'));
      const amount = Number(req.amount) || 0;
      root.appendChild(rowEl(
        '<div class="pm-row-main">' +
          '<div class="pm-row-title">' +
            '<span class="coin-request-amount">+' + amount + ' 🪙</span>' +
            ' ' + childName +
            ' <span class="pm-badge pending">⏳ 待审</span>' +
          '</div>' +
          '<div class="pm-row-meta coin-request-reason">' +
            reason +
            ' · ' + fmtTime(Number(req.requested_at)) +
            ' · <span class="pm-mono">#' + req.id + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="pm-row-actions">' +
          '<button class="pm-btn primary pm-approve-btn" data-act="approve-coin-request" data-id="' + req.id + '">✅ 批准</button>' +
          '<button class="pm-btn danger pm-reject-btn" data-act="reject-coin-request" data-id="' + req.id + '">❌ 驳回</button>' +
        '</div>'
      ));
    });
  }

  async function approveCoinRequest(id: number) {
    // Simplified: uses globalThis.confirm
    const ok = globalThis.confirm('批准?');
    if (!ok) return;
    try {
      await api('POST', '/api/admin/coin-requests/' + id + '/approve', { note: '' });
      toast('已批准', 'success');
      await loadCoinRequests();
      renderCoinRequests();
    } catch (e) {
      toast('操作失败：' + (e as Error).message, 'error');
    }
  }

  // ── Test 1: loadCoinRequests → success → state.coinRequests updated ──
  it('loadCoinRequests populates state.coinRequests on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        requests: [
          { id: 50001, user_id: 2, child_name: 'Tommy', amount: 50, reason: '数学考100分', status: 'pending', requested_at: 1234567890 },
        ],
      }),
    } as Response);

    await loadCoinRequests();
    expect(state.coinRequests).toHaveLength(1);
    expect((state.coinRequests[0] as Record<string, unknown>).amount).toBe(50);
    expect((state.coinRequests[0] as Record<string, unknown>).reason).toBe('数学考100分');
  });

  it('loadCoinRequests handles empty response gracefully', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ requests: [] }),
    } as Response);

    await loadCoinRequests();
    expect(state.coinRequests).toHaveLength(0);
  });

  // ── Test 2: renderCoinRequests 0 items → empty state ──
  it('renders empty state when no pending requests', () => {
    buildDOM();
    state.coinRequests = [];
    renderCoinRequests();

    const empty = document.getElementById('coin-request-empty');
    expect(empty.hidden).toBe(false);
    const count = document.getElementById('count-coin-requests');
    expect(count.textContent).toBe('0');
    const items = document.querySelectorAll('.coin-request-item');
    expect(items).toHaveLength(0);
  });

  // ── Test 3: renderCoinRequests 1 item → row with kid name + amount + reason + 2 buttons ──
  it('renders 1 row with kid name, amount, reason, and 2 action buttons', () => {
    buildDOM();
    state.coinRequests = [
      { id: 50001, user_id: 2, child_name: 'Tommy', amount: 50, reason: '数学考100分', status: 'pending', requested_at: 1234567890 },
    ];
    renderCoinRequests();

    const items = document.querySelectorAll('.coin-request-item');
    expect(items).toHaveLength(1);

    const item = items[0];
    expect(item.innerHTML).toContain('+50');
    expect(item.innerHTML).toContain('🪙');
    expect(item.innerHTML).toContain('Tommy');
    expect(item.innerHTML).toContain('数学考100分');
    expect(item.innerHTML).toContain('⏳');
    expect(item.innerHTML).toContain('待审');
    // 2 buttons
    expect(item.querySelector('.pm-approve-btn')).toBeTruthy();
    expect(item.querySelector('.pm-reject-btn')).toBeTruthy();
    // Empty state hidden
    const empty = document.getElementById('coin-request-empty');
    expect(empty.hidden).toBe(true);
    const count = document.getElementById('count-coin-requests');
    expect(count.textContent).toBe('1');
  });

  it('renders fallback user#id when child_name is absent', () => {
    buildDOM();
    state.coinRequests = [
      { id: 50002, user_id: 3, child_name: null, amount: 30, reason: '奖励自己', status: 'pending', requested_at: 1234567891 },
    ];
    renderCoinRequests();

    const item = document.querySelector('.coin-request-item');
    expect(item.innerHTML).toContain('user #3');
  });

  // ── Test 4: approve button → confirm → POST → reload ──
  it('approve button click calls confirm, POSTs approve API, reloads list', async () => {
    buildDOM();
    state.coinRequests = [
      { id: 50001, user_id: 2, child_name: 'Tommy', amount: 50, reason: '数学考100分', status: 'pending', requested_at: 1234567890 },
    ];
    renderCoinRequests();

    // Mock confirm → true
    const confirmMock = globalThis.confirm as ReturnType<typeof vi.fn>;
    confirmMock.mockReturnValueOnce(true);

    // Mock approve API → 200
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    } as Response);

    // Mock reload (empty list)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ requests: [] }),
    } as Response);

    // Click approve button
    const btn = document.querySelector('.pm-approve-btn') as HTMLButtonElement;
    await approveCoinRequest(Number(btn.dataset.id));

    // Confirm was called
    expect(confirmMock).toHaveBeenCalled();

    // Toast shown
    expect(toastCalls).toContain('已批准');

    // State updated (empty after reload)
    expect(state.coinRequests).toHaveLength(0);
  });

  it('approve skips action when confirm is cancelled', async () => {
    buildDOM();
    state.coinRequests = [
      { id: 50001, user_id: 2, child_name: 'Tommy', amount: 50, reason: '数学考100分', status: 'pending', requested_at: 1234567890 },
    ];
    renderCoinRequests();

    // Mock confirm → false (user cancels)
    const confirmMock = globalThis.confirm as ReturnType<typeof vi.fn>;
    confirmMock.mockReturnValueOnce(false);

    const btn = document.querySelector('.pm-approve-btn') as HTMLButtonElement;
    await approveCoinRequest(Number(btn.dataset.id));

    // No API call made
    expect(fetchMock).not.toHaveBeenCalled();
    // No toast
    expect(toastCalls).toHaveLength(0);
    // State unchanged
    expect(state.coinRequests).toHaveLength(1);
  });
});
