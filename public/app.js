// public/app.js — kiddo-scoreboard child UI logic
// Vanilla JS, no framework. Calls real backend APIs (M1-M7).
// CHILD_USER_ID = 2 (hardcoded; auth swap is M5-later).

const API = '';  // same origin
const CHILD_USER_ID = 2;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- State ----------
const state = {
  user: null,                     // { id, name, role, is_first_time }
  balance: { game_time: 0, pocket_money: 0 },
  tasks: [],                      // Task[] (active only)
  completedTaskIds: new Set(),    // Set<number>
  events: [],                     // ScoreEvent[] (last 10)
  selectedDir: 1,                 // for submit modal
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

function showError(msg, retry) {
  const banner = $('#error-banner');
  $('#error-banner-text').textContent = msg;
  banner.hidden = false;
  const retryBtn = $('#error-banner-retry');
  if (retry) {
    retryBtn.hidden = false;
    retryBtn.onclick = () => { banner.hidden = true; retry(); };
  } else {
    retryBtn.hidden = true;
  }
}
function clearError() { $('#error-banner').hidden = true; }

// ---------- API ----------
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
    const code = data?.error?.code || 'HTTP_' + r.status;
    throw new Error(code);
  }
  return data;
}
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// ---------- Data loaders ----------
async function loadUser() {
  state.user = await api('GET', `/api/public/user/${CHILD_USER_ID}`);
}
async function loadBalance() {
  state.balance = await api('GET', `/api/public/balance?user_id=${CHILD_USER_ID}`);
}
async function loadTasks() {
  const [tasksRes, todayRes] = await Promise.all([
    api('GET', `/api/public/tasks?user_id=${CHILD_USER_ID}&active=true`),
    api('GET', `/api/public/tasks/today-status?user_id=${CHILD_USER_ID}`),
  ]);
  state.tasks = tasksRes.tasks;
  state.completedTaskIds = new Set(todayRes.completed_task_ids);
}
async function loadEvents() {
  const r = await api('GET', `/api/public/events?user_id=${CHILD_USER_ID}&limit=10`);
  state.events = r.events;
}

async function refreshAll() {
  clearError();
  try {
    await Promise.all([loadBalance(), loadTasks(), loadEvents()]);
    renderAll();
  } catch (e) {
    showError('加载失败：' + e.message, refreshAll);
  }
}

// ---------- Renderers ----------
function renderAll() {
  renderGreeting();
  renderBalance();
  renderTasks();
  renderEvents();
}
function renderGreeting() {
  const u = state.user;
  const greet = u && u.name ? `你好，${u.name}！👋` : '你好！👋';
  $('#hero-greeting').textContent = greet;
}
function renderBalance() {
  $('#balance-game-time').textContent = state.balance.game_time;
  $('#balance-pocket-money').textContent = state.balance.pocket_money;
  // Pulse animation
  ['game-time', 'pocket-money'].forEach((k) => {
    const el = $('#card-' + k);
    el.classList.remove('pulse');
    void el.offsetWidth;  // reflow
    el.classList.add('pulse');
  });
}
function renderTasks() {
  const root = $('#task-shortcuts');
  root.innerHTML = '';
  if (state.tasks.length === 0) {
    root.innerHTML = '<div class="empty"><div class="empty-icon">🎯</div><div>家长还没设置任务～</div></div>';
    return;
  }
  state.tasks.forEach((t) => {
    const done = state.completedTaskIds.has(t.id);
    const btn = document.createElement('button');
    btn.className = 'task-btn' + (done ? ' task-btn-done' : '');
    btn.disabled = done;
    btn.dataset.taskId = t.id;
    btn.innerHTML = `
      <span class="task-icon">${t.icon || '⭐'}</span>
      <span class="task-name">${escapeHtml(t.name)}</span>
      <span class="task-reward">+${t.token_reward} ${t.target_account === 'game_time' ? '🎮' : '💰'}</span>
      ${done ? '<span class="task-done-badge">✅ 今日已完成</span>' : ''}
    `;
    if (!done) {
      btn.addEventListener('click', () => completeTask(t.id));
    }
    root.appendChild(btn);
  });
}
function renderEvents() {
  const root = $('#event-list');
  const empty = $('#event-empty');
  $('#event-count').textContent = state.events.length;
  root.innerHTML = '';
  if (state.events.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  state.events.forEach((ev) => {
    const el = document.createElement('div');
    el.className = 'event-item event-status-' + ev.status;
    const sign = ev.change_value > 0 ? '+' : '';
    const icon = ev.type === 'game_time' ? '🎮' : '💰';
    const unit = ev.type === 'game_time' ? '分钟' : '元';
    el.innerHTML = `
      <span class="event-icon">${icon}</span>
      <span class="event-text">
        <span class="event-amount">${sign}${ev.change_value} ${unit}</span>
        <span class="event-reason">${escapeHtml(ev.reason)}</span>
      </span>
      <span class="event-status">${statusLabel(ev.status)}</span>
    `;
    root.appendChild(el);
  });
}
function statusLabel(s) {
  return ({ pending: '⏳ 待审', approved: '✅ 已通过', rejected: '❌ 已拒', revoked: '↩️ 已撤销' })[s] || s;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- Actions ----------
async function completeTask(taskId) {
  try {
    const r = await api('POST', `/api/me/tasks/${taskId}/complete`);
    state.completedTaskIds.add(taskId);
    state.balance = r.new_balance;
    renderBalance();
    renderTasks();
    toast(`+${r.token_awarded} ${r.target_account === 'game_time' ? '🎮' : '💰'}`, 'success');
    // refresh events in background
    loadEvents().then(renderEvents).catch(() => {});
  } catch (e) {
    if (e.message === 'ALREADY_COMPLETED_TODAY') {
      state.completedTaskIds.add(taskId);
      renderTasks();
    }
    toast('操作失败：' + e.message, 'error');
  }
}

async function submitEvent(form) {
  const type = form.type.value;
  const amount = parseInt(form.amount.value, 10);
  const dir = state.selectedDir;
  const reason = form.reason.value.trim();
  const change_value = dir * Math.abs(amount);
  try {
    await api('POST', '/api/me/events', { type, change_value, reason });
    closeSubmitModal();
    toast('已提交，等家长审核～', 'success');
    // refresh events
    loadEvents().then(renderEvents).catch(() => {});
  } catch (e) {
    toast('提交失败：' + e.message, 'error');
  }
}

async function setName(name) {
  try {
    const r = await api('PATCH', '/api/me/profile', { name });
    state.user = { ...state.user, name: r.name, is_first_time: false };
    hideWelcome();
    renderGreeting();
    fireConfetti();
    toast(`欢迎，${r.name}！🎉`, 'success');
  } catch (e) {
    if (e.message === 'ALREADY_SET') {
      // User reloaded after name was set; just hide the modal
      hideWelcome();
      renderGreeting();
      return;
    }
    showWelcomeError('设置失败：' + e.message);
  }
}

// ---------- Modals ----------
function showWelcome() { $('#welcome-modal').hidden = false; $('#welcome-name').focus(); }
function hideWelcome() { $('#welcome-modal').hidden = true; }
function showWelcomeError(msg) {
  const e = $('#welcome-error');
  e.textContent = msg;
  e.hidden = false;
}
function openSubmitModal() { $('#submit-modal').hidden = false; $('#submit-reason').focus(); }
function closeSubmitModal() { $('#submit-modal').hidden = true; $('#submit-form').reset(); state.selectedDir = 1; $$('.seg-btn').forEach((b) => b.classList.toggle('seg-btn-active', Number(b.dataset.dir) === 1)); }

// ---------- Confetti ----------
function fireConfetti() {
  const canvas = $('#confetti');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#FF8A4C', '#10B981', '#F59E0B', '#3B82F6', '#EC4899'];
  const N = 80;
  const parts = Array.from({ length: N }, () => ({
    x: Math.random() * canvas.width,
    y: -20,
    vy: 2 + Math.random() * 4,
    vx: -2 + Math.random() * 4,
    size: 4 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI * 2,
    vrot: -0.2 + Math.random() * 0.4,
  }));
  let t = 0;
  const dur = 90;  // frames
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.vrot;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    if (++t < dur) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  tick();
}

// ---------- Boot ----------
function bindEvents() {
  // Welcome
  $('#welcome-submit').addEventListener('click', () => {
    const name = $('#welcome-name').value.trim();
    if (!name) return showWelcomeError('名字不能为空');
    if (name.length > 20) return showWelcomeError('名字不能超过 20 字');
    setName(name);
  });
  $('#welcome-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#welcome-submit').click();
  });
  // Submit modal
  $('#btn-submit').addEventListener('click', openSubmitModal);
  $('#submit-cancel').addEventListener('click', closeSubmitModal);
  $$('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      state.selectedDir = Number(b.dataset.dir);
      $$('.seg-btn').forEach((x) => x.classList.toggle('seg-btn-active', x === b));
    });
  });
  $('#submit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitEvent(e.target);
  });
  // Refresh
  $('#btn-refresh').addEventListener('click', () => { toast('刷新中…', 'info'); refreshAll(); });
  // Click on modal backdrop closes it
  $('#welcome-modal').addEventListener('click', (e) => {
    if (e.target.id === 'welcome-modal') {} // require explicit submit; don't allow click-out
  });
  $('#submit-modal').addEventListener('click', (e) => {
    if (e.target.id === 'submit-modal') closeSubmitModal();
  });
}

async function boot() {
  bindEvents();
  clearError();
  try {
    await loadUser();
    if (state.user.is_first_time) {
      showWelcome();
      // still load balance/tasks so they're ready when modal closes
      refreshAll();
      return;
    }
    await refreshAll();
  } catch (e) {
    showError('启动失败：' + e.message, boot);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
