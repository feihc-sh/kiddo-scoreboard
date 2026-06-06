// public/admin/admin.js — kiddo-scoreboard PM admin dashboard
// Vanilla JS, no framework. Calls real backend APIs (M1-M7 + admin).
// Single page with all sections visible (collapsible <details>).

const API = '';                  // same origin
const CHILD_USER_ID = 2;         // kiddo user (hardcoded; matches seeds/local.sql)

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- State ----------
const state = {
  user: null,            // { id, name, role }
  balance: { game_time: 0, pocket_money: 0 },
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
function accountIcon(t) { return t === 'game_time' ? '🎮' : '💰'; }
function accountUnit(t) { return t === 'game_time' ? '分钟' : '元'; }
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

async function refreshAll() {
  try {
    await Promise.all([
      loadBalance(),
      loadPendingEvents(),
      loadAllEvents(),
      loadTasks(),
      loadAudit(),
      loadCompletions(),
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
}
function renderHeader() {
  const u = state.user;
  $('#pm-user').textContent = u ? `${actorLabel(u.role)} · ${u.name || '(未命名)'}` : '未登录';
  const b = state.balance;
  $('#pm-balance').textContent =
    `kiddo: 🎮 ${b.game_time} 分钟 · 💰 ${b.pocket_money} 元`;
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
    root.appendChild(rowEl(`
      <div class="pm-row-main">
        <div class="pm-row-title">
          ${accountIcon(ev.type)} ${sign}${ev.change_value} ${accountUnit(ev.type)}
          <span class="pm-badge ${ev.status}">${statusLabel(ev.status)}</span>
        </div>
        <div class="pm-row-meta">
          ${escapeHtml(ev.reason)} · <span class="pm-mono">#${ev.id}</span>
          · ${ev.source} · ${fmtTime(ev.created_at)}
        </div>
      </div>
      <div class="pm-row-actions">
        ${canRevoke
          ? `<button class="pm-btn warn" data-act="revoke" data-id="${ev.id}">撤销</button>`
          : ''}
      </div>
    `));
  });
}

// ---------- C. Tasks ----------
// Item #001: 20-preset emoji picker — click button → fill icon input, sync highlight.
// Manual typing in the icon input also syncs highlight (cleared if no match).
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
          ${t.icon || '⭐'} ${escapeHtml(t.name)}
          ${active ? '' : '<span class="pm-badge revoked">已停用</span>'}
        </div>
        <div class="pm-row-meta">
          +${t.token_reward} ${accountIcon(t.target_account)} ·
          ${categoryLabel(t.category)} · sort=${t.sort_order} ·
          <span class="pm-mono">#${t.id}</span>
        </div>
      </div>
      <div class="pm-row-actions">
        <button class="pm-btn ghost" data-act="edit-task"   data-id="${t.id}">编辑</button>
        <button class="pm-btn danger" data-act="delete-task" data-id="${t.id}">删除</button>
      </div>
    `));
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
    const tIcon = task?.icon || '⭐';
    const isRevoked = c.status === 'revoked';
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
          <span class="pm-mono">#${c.id}</span>
        </div>
      </div>
      <div class="pm-row-actions">
        ${!isRevoked
          ? `<button class="pm-btn warn" data-act="revoke-completion" data-id="${c.id}">撤销</button>`
          : ''}
      </div>
    `));
  });
}

// ---------- DOM helper ----------
function rowEl(html) {
  const div = document.createElement('div');
  div.className = 'pm-row';
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
    await Promise.all([loadAllEvents(), loadBalance(), loadAudit()]);
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

async function submitNewTask(form) {
  const body = {
    name: form.name.value.trim(),
    icon: form.icon.value.trim() || null,
    token_reward: Number(form.token_reward.value),
    target_account: form.target_account.value,
    category: form.category.value,
    sort_order: Number(form.sort_order.value) || 0,
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
