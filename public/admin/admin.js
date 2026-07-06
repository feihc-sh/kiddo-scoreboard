// public/admin/admin.js — kiddo-scoreboard PM admin dashboard
// Vanilla JS, no framework. Calls real backend APIs (M1-M7 + admin).
// Single page with all sections visible (collapsible <details>).

// Single source of truth for fallback task icon. See /shared/emoji-presets.js.
// (If the shared script fails to load, we fall back to the hardcoded literal
//  so the UI is never blank — matches the previous behaviour exactly.)
const DEFAULT_TASK_ICON = (typeof window !== 'undefined' && window.DEFAULT_TASK_ICON) || '⭐';

const API = '';                  // same origin
const CHILD_USER_ID = 2;         // kiddo user (hardcoded; matches seeds/local.sql)

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- State ----------
const state = {
  user: null,            // { id, name, role }
  balance: { game_time: 0, pocket_money: 0, coins: 0 },
  pendingEvents: [],     // ScoreEvent[] (status=pending)
  allEvents: [],         // ScoreEvent[] (all statuses, latest)
  eventFilter: 'all',
  tasks: [],             // Task[] (include_inactive=true)
  editingTaskId: null,   // task id currently being edited (null = none)
  audit: [],             // AuditLogEntry[]
  auditFilter: '',
  completions: [],       // TaskCompletionListItem[]
  completionDate: '',    // '' = today (server default)
  completionStatus: 'active',
  // Stage 4 (NIGHTLY-TODO #009): hard-delete snapshot markers. Key is
  // `${record_type}:${original_id}` so the same id space can carry both
  // score_event and task_completion entries without collision.
  deletedRecords: {},    // { 'score_event:42': { deleted_at, deleted_by, ... } }
  // M4 §6.5: PM 待发商品列表 (kind=custom redemptions status='pending')
  pendingRedemptions: [],  // AdminRedemption[]
  // Item #011 §4: running records list (all records, active + revoked)
  runningRecords: [],
  runningFilter: 'all',   // 'all' | 'active' | 'revoked'
};

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast toast-' + kind + ' toast-show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast-show'), 2400);
}

// ---------- API helper ----------
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(API + path, opts);
  const text = await r.text();
  const data = text ? safeJson(text) : null;
  if (!r.ok) {
    if (r.status === 401) {
      // Not authenticated — bounce to login page.
      window.location.href = '/admin/login';
      return Promise.reject(new Error('UNAUTHORIZED'));
    }
    const code = data?.error?.code || 'HTTP_' + r.status;
    throw new Error(code);
  }
  return data;
}
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
function fmtTime(unixSec) {
  if (!unixSec) return '—';
  const d = new Date(Number(unixSec) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function statusLabel(s) {
  return ({
    pending:  '⏳ 待审',
    approved: '✅ 已通过',
    rejected: '❌ 已拒',
    revoked:  '↩️ 已撤销',
  })[s] || s;
}
// Item #015 M1: align with kid UI submit-modal option icons (⚡/⚙️/🪙)
// for visual consistency across kid + admin.
const ACCOUNT_ICON = { game_time: '⚡', pocket_money: '💰', coins: '🪙' };
const ACCOUNT_UNIT = { game_time: '分钟', pocket_money: '元', coins: '枚' };
function accountIcon(t) { return ACCOUNT_ICON[t] || '💰'; }
function accountUnit(t) { return ACCOUNT_UNIT[t] || ''; }
function actorLabel(a) {
  return ({ pm: '🧑‍💼 PM', child: '🧒 child', system: '⚙️ system' })[a] || a;
}
function categoryLabel(c) {
  return ({ habit: '习惯', study: '学习', chore: '家务', custom: '自定义' })[c] || c;
}

// ---------- Data loaders ----------
async function loadMe() {
  state.user = await api('GET', '/api/admin/auth/me');
}
async function loadBalance() {
  state.balance = await api('GET', `/api/public/balance?user_id=${CHILD_USER_ID}`);
}
async function loadPendingEvents() {
  const r = await api('GET',
    `/api/public/events?user_id=${CHILD_USER_ID}&status=pending&limit=100`);
  state.pendingEvents = r.events;
}
async function loadAllEvents() {
  // No "list all events" admin endpoint; fetch each status in parallel.
  const statuses = ['pending', 'approved', 'rejected', 'revoked'];
  const results = await Promise.all(statuses.map((s) =>
    api('GET', `/api/public/events?user_id=${CHILD_USER_ID}&status=${s}&limit=100`)
      .then((r) => r.events)
      .catch(() => []),
  ));
  state.allEvents = results.flat().sort((a, b) => b.created_at - a.created_at);
}
async function loadTasks() {
  const r = await api('GET', '/api/admin/tasks?include_inactive=true');
  state.tasks = r.tasks;
}
async function loadAudit() {
  const qs = new URLSearchParams({ limit: '100' });
  if (state.auditFilter) qs.set('actor', state.auditFilter);
  const r = await api('GET', '/api/admin/audit-log?' + qs.toString());
  state.audit = r.entries;
}
async function loadCompletions() {
  const qs = new URLSearchParams({ user_id: String(CHILD_USER_ID) });
  if (state.completionDate) qs.set('date', state.completionDate);
  qs.set('status', state.completionStatus);
  const r = await api('GET', '/api/admin/task-completions?' + qs.toString());
  state.completions = r.completions;
}
async function loadPendingRedemptions() {
  // M4 §6.5: 列 kind=custom 待发商品 (status='pending')。Best-effort:
  // 端点缺失或失败时, render 拿空 list 即可, section 显示 empty state。
  try {
    const r = await api('GET', '/api/admin/shop/fulfill?status=pending');
    state.pendingRedemptions = Array.isArray(r.redemptions) ? r.redemptions : [];
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') throw e;  // bounce to login
    state.pendingRedemptions = [];
  }
}
// Item #011 §4: load all running records (active + revoked)
async function loadRunningRecords() {
  try {
    const r = await api('GET', '/api/admin/running/records');
    state.runningRecords = Array.isArray(r.records) ? r.records : [];
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') throw e;
    state.runningRecords = [];
  }
}
async function loadDeletedRecords() {
  // Best-effort: if the endpoint is missing or the call fails, we just
  // render with no markers. The grey-out is a UX nicety, not a contract.
  try {
    const r = await api('GET', '/api/admin/deleted-records');
    const map = {};
    (r.records || []).forEach((d) => {
      map[`${d.record_type}:${d.original_id}`] = d;
    });
    state.deletedRecords = map;
  } catch (_) {
    // swallow — keep whatever we had
  }
}
function deletedMarker(recordType, originalId) {
  const d = state.deletedRecords[`${recordType}:${originalId}`];
  if (!d) return '';
  // Use the PM user's name when available; fall back to a generic label.
  const byName = state.user?.name || 'PM';
  return ` <span class="pm-row-deleted-marker">🗑 删于 ${fmtTime(d.deleted_at)} by ${escapeHtml(byName)}</span>`;
}

async function refreshAll() {
  try {
    await Promise.all([
      loadBalance(),
      loadPendingEvents(),
      loadAllEvents(),
      loadTasks(),
      loadAudit(),
      loadCompletions(),
      loadDeletedRecords(),
      loadPendingRedemptions(),
      loadRunningRecords(),
    ]);
    renderAll();
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return;  // already redirecting
    toast('加载失败：' + e.message, 'error');
  }
}

// ---------- Render: shell ----------
function renderAll() {
  renderHeader();
  renderPending();
  renderAllEvents();
  renderTasks();
  renderAudit();
  renderCompletions();
  renderPendingRedemptions();
  renderRunningRecords();
}

// ---------- H. Shop pending fulfill (M4 §6.5) ----------
function renderPendingRedemptions() {
  const root = $('#shop-pending-list');
  const empty = $('#shop-pending-empty');
  if (!root) return;
  $('#count-shop-pending').textContent = state.pendingRedemptions.length;
  root.innerHTML = '';
  if (state.pendingRedemptions.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  state.pendingRedemptions.forEach((r) => {
    const icon = r.item_icon || '🎁';
    const name = escapeHtml(r.item_name || `item#${r.item_id}`);
    const child = r.child_name ? escapeHtml(r.child_name) : `user #${r.user_id}`;
    root.appendChild(rowEl(`
      <div class="pm-row-main">
        <div class="pm-row-title">
          ${icon} ${name}
          <span class="pm-badge pending">待发</span>
        </div>
        <div class="pm-row-meta">
          ${child} 兑换 · ${r.cost_coins} 🪙 · week_of ${escapeHtml(r.week_of || '—')}
          · <span class="pm-mono">#${r.id}</span>
          · ${fmtTime(r.redeemed_at)}
        </div>
      </div>
      <div class="pm-row-actions">
        <button class="pm-btn primary"
                data-act="fulfill-redemption"
                data-id="${r.id}">✓ 已发</button>
      </div>
    `));
  });
}

async function fulfillRedemption(id) {
  if (!Number.isInteger(id) || id <= 0) return;
  const ok = window.confirm(`确定已发货 #${id}? 此操作不可撤销。`);
  if (!ok) return;
  try {
    await api('POST', `/api/admin/shop/fulfill/${id}`);
    toast('✅ 已发货', 'success');
    // Reload list (fulfilled ones disappear)
    await loadPendingRedemptions();
    renderPendingRedemptions();
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return;
    const msg = e.message === 'INVALID_STATUS' ? '该兑换已发货或被撤销' : '发货失败: ' + e.message;
    toast(msg, 'error');
  }
}

// Item #011 §4: Running records list + revoke
function renderRunningRecords() {
  const root = $('#running-list');
  const empty = $('#running-empty');
  if (!root) return;
  $('#count-running').textContent = state.runningRecords.length;
  root.innerHTML = '';
  const filtered = state.runningFilter === 'all'
    ? state.runningRecords
    : state.runningRecords.filter(function(r) {
        return state.runningFilter === 'revoked'
          ? r.revoked_at !== null
          : r.revoked_at === null;
      });
  if (filtered.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  filtered.forEach(function(r) {
    const isRevoked = r.revoked_at !== null;
    const childName = escapeHtml(r.child_name || ('user #' + r.child_id));
    const mapName = escapeHtml(r.map_name || ('map #' + r.map_id));
    const pointsLabel = (r.awarded_coins && r.awarded_coins > 0)
      ? ' +' + r.awarded_coins + ' 枚'
      : '';
    const revokedLabel = isRevoked
      ? ' <span class="pm-badge revoked">↩ 已撤销</span>'
      : '';
    const revokedMeta = isRevoked
      ? ' · ' + fmtTime(r.revoked_at) + ' by ' + escapeHtml(r.revoked_by_name || 'PM')
      : '';
    root.appendChild(rowEl(
      '<div class="pm-row-main">' +
        '<div class="pm-row-title">' +
          '🏃 ' + escapeHtml(r.km) + ' km · ' + mapName +
          '<span class="pm-badge ' + (isRevoked ? 'revoked' : 'approved') + '">' +
            (isRevoked ? '↩ 已撤销' : '✅ active') +
          '</span>' +
        '</div>' +
        '<div class="pm-row-meta">' +
          childName +
          ' · ' + fmtTime(r.created_at) +
          pointsLabel +
          revokedMeta +
          ' · <span class="pm-mono">#' + r.id + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="pm-row-actions">' +
        (!isRevoked
          ? '<button class="pm-btn warn" data-act="revoke-running" data-id="' + r.id + '">↩ 撤销</button>'
          : '') +
      '</div>'
    ));
  });
}

async function revokeRunningRecordAction(id) {
  if (!Number.isInteger(id) || id <= 0) return;
  if (inFlight.has('rr-' + id)) return;
  inFlight.add('rr-' + id);
  var ok = window.confirm(
    '确定要撤销这条跑步记录?\n\n' +
    '• 积分将扣回 (如有)\n' +
    '• 累计公里数将回退\n' +
    '此操作不可撤销。'
  );
  if (!ok) { inFlight.delete('rr-' + id); return; }
  try {
    await api('POST', '/api/admin/running/records/' + id + '/revoke', { confirm: true });
    toast('已撤销', 'success');
    await loadRunningRecords();
    renderRunningRecords();
  } catch (e) {
    if (e.message === 'ALREADY_REVOKED') {
      toast('这条记录已经被撤销了', 'error');
    } else if (e.message !== 'UNAUTHORIZED') {
      toast('撤销失败: ' + e.message, 'error');
    }
  } finally {
    inFlight.delete('rr-' + id);
  }
}

function renderHeader() {
  const u = state.user;
  $('#pm-user').textContent = u ? `${actorLabel(u.role)} · ${u.name || '(未命名)'}` : '未登录';
  const b = state.balance;
  $('#pm-balance').textContent =
    `kiddo: ⚡ ${b.game_time} 分钟 · 💰 ${b.pocket_money} 元 · 🪙 ${b.coins} 枚`;
}

// ---------- A. Pending ----------
function renderPending() {
  const root = $('#pending-list');
  const empty = $('#pending-empty');
  $('#count-pending').textContent = state.pendingEvents.length;
  root.innerHTML = '';
  if (state.pendingEvents.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;
  state.pendingEvents.forEach((ev) => {
    const sign = ev.change_value > 0 ? '+' : '';
    root.appendChild(rowEl(`
      <div class="pm-row-main">
        <div class="pm-row-title">
          ${accountIcon(ev.type)} ${sign}${ev.change_value} ${accountUnit(ev.type)}
        </div>
        <div class="pm-row-meta">
          ${escapeHtml(ev.reason)} · <span class="pm-mono">#${ev.id}</span>
          · ${fmtTime(ev.created_at)}
        </div>
      </div>
      <div class="pm-row-actions">
        <button class="pm-btn primary" data-act="approve" data-id="${ev.id}">通过</button>
        <button class="pm-btn danger"  data-act="reject"  data-id="${ev.id}">拒绝</button>
      </div>
    `));
  });
}

// ---------- B. All events ----------
function renderAllEvents() {
  const list = state.eventFilter === 'all'
    ? state.allEvents
    : state.allEvents.filter((e) => e.status === state.eventFilter);
  const root = $('#all-events-list');
  const empty = $('#all-events-empty');
  $('#count-all-events').textContent = state.allEvents.length;
  root.innerHTML = '';
  if (list.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;
  list.forEach((ev) => {
    const sign = ev.change_value > 0 ? '+' : '';
    const canRevoke = ev.status === 'approved' || ev.status === 'rejected';
    const isDeleted = !!state.deletedRecords[`score_event:${ev.id}`];
    root.appendChild(rowEl(`
      <div class="pm-row-main">
        <div class="pm-row-title">
          ${accountIcon(ev.type)} ${sign}${ev.change_value} ${accountUnit(ev.type)}
          <span class="pm-badge ${ev.status}">${statusLabel(ev.status)}</span>
        </div>
        <div class="pm-row-meta">
          ${escapeHtml(ev.reason)} · <span class="pm-mono">#${ev.id}</span>
          · ${ev.source} · ${fmtTime(ev.created_at)}${deletedMarker('score_event', ev.id)}
        </div>
      </div>
      <div class="pm-row-actions">
        ${canRevoke
          ? `<button class="pm-btn warn" data-act="revoke" data-id="${ev.id}">撤销</button>`
          : ''}
        <button class="pm-btn hard-delete" data-act="hard-delete-event" data-id="${ev.id}">🗑 永久删除</button>
      </div>
    `, isDeleted ? 'row-deleted' : ''));
  });
}

// ---------- C. Tasks ----------
// Item #001: 20-preset emoji picker — click button → fill icon input, sync highlight.
// Manual typing in the icon input also syncs highlight (cleared if no match).
//
// Source of truth: /shared/emoji-presets.js (window.EMOJI_PRESETS, window.DEFAULT_TASK_ICON).
// This function renders the buttons dynamically so the picker is always in sync with
// the shared file (no more drift between HTML and tests/seed data).
function renderEmojiPicker() {
  const picker = $('#emoji-picker');
  if (!picker) return;
  const presets = window.EMOJI_PRESETS;
  const categories = window.EMOJI_CATEGORIES;
  if (!presets || !categories) {
    console.error('emoji-presets.js not loaded; picker will be empty');
    return;
  }
  picker.innerHTML = '';
  for (const cat of categories) {
    const row = document.createElement('div');
    row.className = 'emoji-pick-row';
    const label = document.createElement('span');
    label.className = 'emoji-pick-cat';
    label.textContent = cat;
    row.appendChild(label);
    for (const glyph of presets[cat]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-pick';
      btn.dataset.emoji = glyph;
      btn.textContent = glyph;
      row.appendChild(btn);
    }
    picker.appendChild(row);
  }
}

function bindEmojiPicker() {
  const form = $('#new-task-form');
  if (!form) return;
  const iconInput = form.elements['icon'];
  const picker = form.querySelector('.emoji-picker');
  if (!picker) return;
  // Delegated click: one handler covers all 20 buttons.
  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-pick');
    if (!btn) return;
    iconInput.value = btn.dataset.emoji || '';
    iconInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const sync = () => syncEmojiPickerHighlight(iconInput, picker);
  iconInput.addEventListener('input', sync);
  form.addEventListener('reset', sync);   // form.reset() doesn't fire input events
  sync();
}
function syncEmojiPickerHighlight(iconInput, picker) {
  const current = iconInput.value.trim();
  picker.querySelectorAll('.emoji-pick').forEach((b) => {
    b.classList.toggle('selected', current !== '' && b.dataset.emoji === current);
  });
}

function renderTasks() {
  const root = $('#tasks-list');
  const empty = $('#tasks-empty');
  $('#count-tasks').textContent = state.tasks.length;
  root.innerHTML = '';
  if (state.tasks.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;
  state.tasks.forEach((t) => {
    const active = t.is_active === 1 || t.is_active === true;
    root.appendChild(rowEl(`
      <div class="pm-row-main">
        <div class="pm-row-title">
          ${t.icon || DEFAULT_TASK_ICON} ${escapeHtml(t.name)}
          ${active ? '' : '<span class="pm-badge revoked">已停用</span>'}
        </div>
        <div class="pm-row-meta">
          +${t.token_reward} ${accountIcon(t.target_account)} ·
          ${categoryLabel(t.category)} · sort=${t.sort_order} ·
          <span class="pm-mono">#${t.id}</span>
        </div>
      </div>
      <div class="pm-row-actions">
        <button class="pm-toggle ${active ? 'pm-toggle--active' : 'pm-toggle--inactive'}"
                data-act="toggle-task"
                data-id="${t.id}"
                data-task-name="${escapeHtml(t.name)}"
                data-active="${active ? '1' : '0'}"
                aria-label="${active ? '暂停' : '恢复'}: ${escapeHtml(t.name)}"
                title="${active ? '暂停任务' : '恢复任务'}">
          <span class="pm-toggle-thumb"></span>
        </button>
        <button class="pm-btn ghost" data-act="edit-task"   data-id="${t.id}">编辑</button>
        <button class="pm-btn danger" data-act="delete-task" data-id="${t.id}">删除</button>
      </div>
    `, active ? '' : 'pm-task-suspended'));
  });
}

// ---------- D. Audit ----------
function renderAudit() {
  const root = $('#audit-list');
  const empty = $('#audit-empty');
  $('#count-audit').textContent = state.audit.length;
  root.innerHTML = '';
  if (state.audit.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;
  state.audit.forEach((a) => {
    const details = Object.keys(a.details || {}).length
      ? `<span class="pm-mono">${escapeHtml(JSON.stringify(a.details))}</span>`
      : '';
    const tgt = a.target_event_id
      ? `event #${a.target_event_id}`
      : (a.target_user_id ? `user #${a.target_user_id}` : '—');
    root.appendChild(rowEl(`
      <div class="pm-row-main">
        <div class="pm-row-title">
          ${actorLabel(a.actor)} · <code>${escapeHtml(a.action)}</code>
        </div>
        <div class="pm-row-meta">
          target: ${tgt} · ${fmtTime(a.created_at)} · ${details}
        </div>
      </div>
    `));
  });
}

// ---------- G. Completions ----------
function renderCompletions() {
  const root = $('#completions-list');
  const empty = $('#completions-empty');
  $('#count-completions').textContent = state.completions.length;
  root.innerHTML = '';
  if (state.completions.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;
  state.completions.forEach((c) => {
    const task = state.tasks.find((t) => t.id === c.task_id);
    const tName = task ? task.name : `task #${c.task_id}`;
    const tIcon = task?.icon || DEFAULT_TASK_ICON;
    const isRevoked = c.status === 'revoked';
    const isDeleted = !!state.deletedRecords[`task_completion:${c.id}`];
    root.appendChild(rowEl(`
      <div class="pm-row-main">
        <div class="pm-row-title">
          ${tIcon} ${escapeHtml(tName)}
          <span class="pm-badge ${isRevoked ? 'revoked' : 'approved'}">
            ${isRevoked ? '↩️ 已撤销' : '✅ active'}
          </span>
        </div>
        <div class="pm-row-meta">
          ${c.completed_date} · ${fmtTime(c.completed_at)} ·
          <span class="pm-mono">#${c.id}</span>${deletedMarker('task_completion', c.id)}
        </div>
      </div>
      <div class="pm-row-actions">
        ${!isRevoked
          ? `<button class="pm-btn warn" data-act="revoke-completion" data-id="${c.id}">撤销</button>`
          : ''}
        <button class="pm-btn hard-delete" data-act="hard-delete-completion" data-id="${c.id}">🗑 永久删除</button>
      </div>
    `, isDeleted ? 'row-deleted' : ''));
  });
}

// ---------- DOM helper ----------
function rowEl(html, extraClass) {
  const div = document.createElement('div');
  div.className = extraClass ? `pm-row ${extraClass}` : 'pm-row';
  div.innerHTML = html;
  return div;
}

// ---------- Actions ----------
// In-flight set prevents double-clicks from firing duplicate approve/reject/revoke
// requests, even though renderAll() recreates the buttons (which would reset .disabled).
const inFlight = new Set();

async function approveEvent(id) {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    await api('POST', `/api/admin/events/${id}/approve`);
    toast('已通过', 'success');
    await Promise.all([loadPendingEvents(), loadAllEvents(), loadBalance(), loadAudit()]);
    renderAll();
  } catch (e) {
    toast('操作失败：' + e.message, 'error');
  } finally {
    inFlight.delete(id);
  }
}
async function rejectEvent(id) {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    await api('POST', `/api/admin/events/${id}/reject`);
    toast('已拒绝', 'success');
    await Promise.all([loadPendingEvents(), loadAllEvents(), loadAudit()]);
    renderAll();
  } catch (e) {
    if (e.message !== 'UNAUTHORIZED') toast('操作失败：' + e.message, 'error');
  } finally {
    inFlight.delete(id);
  }
}
async function revokeEvent(id) {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  if (!confirm('确定要撤销这个事件吗？')) { inFlight.delete(id); return; }
  try {
    await api('POST', `/api/admin/events/${id}/revoke`);
    toast('已撤销', 'success');
    // §5 mirror inverse: revocation may flip the referencing task_completion's status
    // (PR #29 fix). Reload completions so the admin "任务完成历史" panel doesn't
    // show stale rows until manual refresh.
    await Promise.all([loadAllEvents(), loadBalance(), loadAudit(), loadCompletions()]);
    renderAll();
  } catch (e) {
    if (e.message !== 'UNAUTHORIZED') toast('操作失败：' + e.message, 'error');
  } finally {
    inFlight.delete(id);
  }
}

function startEditTask(id) {
  state.editingTaskId = id;
  // Simple approach: open the new-task form, pre-fill it.
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const f = $('#new-task-form');
  f.elements['name'].value = t.name;
  f.elements['icon'].value = t.icon || '';
  f.elements['icon'].dispatchEvent(new Event('input', { bubbles: true }));  // sync picker highlight
  f.elements['token_reward'].value = t.token_reward;
  f.elements['target_account'].value = t.target_account;
  f.elements['category'].value = t.category;
  f.elements['sort_order'].value = t.sort_order;
  // v2.1 (PRD §3.12) — cutoff_time + is_self_lockout must also be prefilled.
  // Without these 2 lines, PM edits a sleep task → both fields blank in form
  // → saving clears the sleep task's "准时上床" config. Regression: see #18.
  f.elements['cutoff_time'].value = t.cutoff_time || '';
  f.elements['is_self_lockout'].checked = t.is_self_lockout === 1;
  $('#new-task-form-wrap').hidden = false;
  $('#btn-new-task').textContent = '编辑中…';
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearEditTask() {
  state.editingTaskId = null;
  $('#new-task-form').reset();
  $('#new-task-form-wrap').hidden = true;
  $('#btn-new-task').textContent = '+ 新建任务';
}
async function deleteTask(id) {
  if (!confirm('确定要删除（停用）这个任务吗？')) return;
  try {
    await api('DELETE', `/api/admin/tasks/${id}`);
    toast('已停用', 'success');
    await Promise.all([loadTasks(), loadAudit()]);
    renderTasks();
  } catch (e) {
    if (e.message !== 'UNAUTHORIZED') toast('操作失败：' + e.message, 'error');
  }
}

// Item #014 §2: optimistic toggle with rollback on failure
async function toggleTaskAction(id, taskName, currentActive) {
  if (inFlight.has('toggle-' + id)) return;
  inFlight.add('toggle-' + id);
  var newActive = currentActive === '1' ? '0' : '1';
  // Optimistic: immediately flip the UI
  var toggleBtn = document.querySelector('[data-act="toggle-task"][data-id="' + id + '"]');
  if (toggleBtn) {
    toggleBtn.dataset.active = newActive;
    toggleBtn.className = 'pm-toggle ' + (newActive === '1' ? 'pm-toggle--active' : 'pm-toggle--inactive');
    toggleBtn.setAttribute('aria-label', newActive === '1' ? '暂停' : '恢复');
  }
  // Also toggle the pm-task-suspended class on the row
  var row = toggleBtn ? toggleBtn.closest('.pm-row') : null;
  if (row) {
    if (newActive === '0') {
      row.classList.add('pm-task-suspended');
    } else {
      row.classList.remove('pm-task-suspended');
    }
  }
  try {
    await api('POST', '/api/admin/tasks/' + id + '/toggle');
    toast('已' + (newActive === '1' ? '恢复' : '暂停') + ': ' + taskName, 'success');
    // Reload tasks + audit + re-render to keep state in sync
    await Promise.all([loadTasks(), loadAudit()]);
    renderTasks();
    renderAudit();
  } catch (e) {
    // Rollback optimistic UI on failure
    if (toggleBtn) {
      toggleBtn.dataset.active = currentActive;
      toggleBtn.className = 'pm-toggle ' + (currentActive === '1' ? 'pm-toggle--active' : 'pm-toggle--inactive');
      toggleBtn.setAttribute('aria-label', currentActive === '1' ? '暂停' : '恢复');
    }
    if (row) {
      if (currentActive === '0') {
        row.classList.add('pm-task-suspended');
      } else {
        row.classList.remove('pm-task-suspended');
      }
    }
    if (e.message !== 'UNAUTHORIZED') toast('操作失败：' + e.message, 'error');
  } finally {
    inFlight.delete('toggle-' + id);
  }
}

async function submitNewTask(form) {
  const body = {
    name: form.name.value.trim(),
    icon: form.icon.value.trim() || null,
    token_reward: Number(form.token_reward.value),
    target_account: form.target_account.value,
    category: form.category.value,
    sort_order: Number(form.sort_order.value) || 0,
    // §3.12 sleep task (Item #002): self-lockout cutoff. Form inputs exist in
    // public/admin/index.html. Server validates HH:MM regex on cutoff_time.
    cutoff_time: form.cutoff_time.value.trim() || null,
    is_self_lockout: form.is_self_lockout.checked ? 1 : 0,
  };
  try {
    if (state.editingTaskId) {
      // Partial update: only send fields the user might have changed.
      // Send all editable fields for simplicity.
      await api('PUT', `/api/admin/tasks/${state.editingTaskId}`, body);
      toast('任务已更新', 'success');
    } else {
      await api('POST', '/api/admin/tasks', body);
      toast('任务已创建', 'success');
    }
    clearEditTask();
    await Promise.all([loadTasks(), loadAudit()]);
    renderTasks();
  } catch (e) {
    if (e.message !== 'UNAUTHORIZED') toast('保存失败：' + e.message, 'error');
  }
}

async function submitExchange(form) {
  const body = {
    from_account: form.from_account.value,
    to_account: form.to_account.value,
    amount: Number(form.amount.value),
    child_user_id: CHILD_USER_ID,
  };
  try {
    const r = await api('POST', '/api/admin/exchange', body);
    toast(`兑换完成 🎮${r.new_balance.game_time} 💰${r.new_balance.pocket_money}`,
      'success');
    form.reset();
    await Promise.all([loadBalance(), loadAllEvents(), loadAudit()]);
    renderHeader(); renderAllEvents();
  } catch (e) {
    if (e.message !== 'UNAUTHORIZED') toast('兑换失败：' + e.message, 'error');
  }
}

async function submitGrant(form) {
  const body = {
    game_time: Number(form.game_time.value) || 0,
    pocket_money: Number(form.pocket_money.value) || 0,
    child_user_id: CHILD_USER_ID,
    note: form.note.value.trim() || undefined,
  };
  try {
    const r = await api('POST', '/api/admin/weekly-grant', body);
    toast(`已发放 🎮${r.new_balance.game_time} 💰${r.new_balance.pocket_money}`,
      'success');
    form.reset();
    await Promise.all([loadBalance(), loadAllEvents(), loadAudit()]);
    renderHeader(); renderAllEvents();
  } catch (e) {
    if (e.message !== 'UNAUTHORIZED') toast('发放失败：' + e.message, 'error');
  }
}

async function revokeCompletion(id) {
  if (!confirm('确定撤销这条完成记录？关联的积分也会回滚。')) return;
  try {
    await api('POST', `/api/admin/task-completions/${id}/revoke`);
    toast('已撤销完成', 'success');
    await Promise.all([loadCompletions(), loadBalance(), loadAllEvents(), loadAudit()]);
    renderAll();
  } catch (e) {
    if (e.message !== 'UNAUTHORIZED') toast('操作失败：' + e.message, 'error');
  }
}

// Stage 4 (NIGHTLY-TODO #009): hard-delete a score_event. The endpoint
// moves the row to deleted_records and recomputes the user's balance.
// On success we optimistically mark the event as deleted in local state
// (so the row greys out for the current render) before re-loading.
async function hardDeleteEvent(id) {
  if (inFlight.has(id)) return;
  if (!confirm(`此操作不可恢复, 确认删除? 事件 id=${id}`)) return;
  inFlight.add(id);
  try {
    await api('POST', `/api/admin/events/${id}/hard-delete`);
    // Optimistic: mark as deleted so the row shows 🗑 + grey this frame.
    state.deletedRecords[`score_event:${id}`] = {
      record_type: 'score_event',
      original_id: id,
      deleted_at: Math.floor(Date.now() / 1000),
      deleted_by: state.user?.id ?? 0,
    };
    toast('已删除', 'success');
    await Promise.all([loadAllEvents(), loadBalance(), loadAudit(), loadDeletedRecords()]);
    renderAll();
  } catch (e) {
    if (e.message !== 'UNAUTHORIZED') toast('删除失败：' + e.message, 'error');
  } finally {
    inFlight.delete(id);
  }
}

// Stage 4 (NIGHTLY-TODO #009): hard-delete a task_completion. Same
// pattern as the event variant; balance is unchanged because the
// underlying score_event is left in place.
async function hardDeleteCompletion(id) {
  if (inFlight.has(id)) return;
  if (!confirm(`此操作不可恢复, 确认删除? 完成记录 id=${id}`)) return;
  inFlight.add(id);
  try {
    await api('POST', `/api/admin/task-completions/${id}/hard-delete`);
    state.deletedRecords[`task_completion:${id}`] = {
      record_type: 'task_completion',
      original_id: id,
      deleted_at: Math.floor(Date.now() / 1000),
      deleted_by: state.user?.id ?? 0,
    };
    toast('已删除', 'success');
    await Promise.all([loadCompletions(), loadAudit(), loadDeletedRecords()]);
    renderAll();
  } catch (e) {
    if (e.message !== 'UNAUTHORIZED') toast('删除失败：' + e.message, 'error');
  } finally {
    inFlight.delete(id);
  }
}

async function doLogout() {
  try { await api('POST', '/api/admin/auth/logout'); } catch (_) {}
  window.location.href = '/admin/login';
}

// ---------- Event delegation ----------
function bindDelegatedActions() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = Number(btn.dataset.id);
    if (act === 'approve') return approveEvent(id);
    if (act === 'reject')  return rejectEvent(id);
    if (act === 'revoke')  return revokeEvent(id);
    if (act === 'edit-task')    return startEditTask(id);
    if (act === 'delete-task')  return deleteTask(id);
    if (act === 'revoke-completion') return revokeCompletion(id);
    if (act === 'hard-delete-event') return hardDeleteEvent(id);
    if (act === 'hard-delete-completion') return hardDeleteCompletion(id);
    if (act === 'fulfill-redemption') return fulfillRedemption(id);
    if (act === 'revoke-running') return revokeRunningRecordAction(id);
    if (act === 'toggle-task') return toggleTaskAction(id, btn.dataset.taskName, btn.dataset.active);
  });
}

function bindFilters() {
  $('#filter-event-status').addEventListener('change', (e) => {
    state.eventFilter = e.target.value;
    renderAllEvents();
  });
  $('#filter-audit-actor').addEventListener('change', async (e) => {
    state.auditFilter = e.target.value;
    try { await loadAudit(); renderAudit(); }
    catch (err) { if (err.message !== 'UNAUTHORIZED') toast('加载失败：' + err.message, 'error'); }
  });
  const dateEl = $('#filter-completion-date');
  dateEl.addEventListener('change', async (e) => {
    state.completionDate = e.target.value;
    try { await loadCompletions(); renderCompletions(); }
    catch (err) { if (err.message !== 'UNAUTHORIZED') toast('加载失败：' + err.message, 'error'); }
  });
  $('#filter-completion-status').addEventListener('change', async (e) => {
    state.completionStatus = e.target.value;
    try { await loadCompletions(); renderCompletions(); }
    catch (err) { if (err.message !== 'UNAUTHORIZED') toast('加载失败：' + err.message, 'error'); }
  });
  $('#filter-running-status').addEventListener('change', function(e) {
    state.runningFilter = e.target.value;
    renderRunningRecords();
  });
}

function bindForms() {
  $('#new-task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitNewTask(e.target);
  });
  $('#new-task-cancel').addEventListener('click', clearEditTask);
  $('#btn-new-task').addEventListener('click', () => {
    state.editingTaskId = null;
    $('#new-task-form').reset();
    $('#new-task-form-wrap').hidden = false;
    $('#btn-new-task').textContent = '+ 新建任务（编辑中…）';
  });
  $('#exchange-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitExchange(e.target);
  });
  $('#grant-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitGrant(e.target);
  });
}

function bindTopbar() {
  $('#btn-refresh').addEventListener('click', () => {
    toast('刷新中…', 'info');
    refreshAll();
  });
  $('#btn-logout').addEventListener('click', doLogout);
}

// ---------- Boot ----------
async function boot() {
  bindTopbar();
  bindForms();
  bindFilters();
  bindDelegatedActions();
  renderEmojiPicker();  // Item #001 — populate from window.EMOJI_PRESETS (shared/emoji-presets.js)
  bindEmojiPicker();   // Item #001
  try {
    await loadMe();
    await refreshAll();
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return;  // redirect handled in api()
    toast('启动失败：' + e.message, 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
