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
  uncompletedTodayIds: new Set(), // Set<number> §3.11 toggle: tasks revoked today
  events: [],                     // ScoreEvent[] (last 10)
  progress: null,                 // { daily:{completed,total}, monthly:{completed,target}, yearly:{completed,target} }
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
  state.uncompletedTodayIds = new Set(todayRes.uncompleted_today_ids ?? []);
}
async function loadEvents() {
  const r = await api('GET', `/api/public/events?user_id=${CHILD_USER_ID}&limit=10`);
  state.events = r.events;
}
async function loadProgress() {
  state.progress = await api('GET', `/api/public/tasks/progress?user_id=${CHILD_USER_ID}`);
}

async function refreshAll() {
  clearError();
  try {
    await Promise.all([loadBalance(), loadTasks(), loadEvents(), loadProgress()]);
    renderAll();
  } catch (e) {
    showError('系统错误：' + e.message, refreshAll);
  }
}

// ---------- Renderers ----------
function renderAll() {
  renderGreeting();
  renderBalance();
  renderProgress();
  renderTasks();
  renderEvents();
}
function renderGreeting() {
  const u = state.user;
  const greet = u && u.name ? `驾驶员 ${u.name}，系统就绪` : '驾驶员，系统启动中';
  $('#hero-greeting').textContent = greet;
}
function renderBalance() {
  $('#balance-game-time').textContent = state.balance.game_time;
  $('#balance-pocket-money').textContent = state.balance.pocket_money;
  $('#balance-coins').textContent = state.balance.coins;
}

function renderProgress() {
  const p = state.progress;
  if (!p) return;
  // Daily: 显眼 (大), Monthly: 中, Yearly: 小
  setBar('#pb-daily-fill', '#pb-daily-text', p.daily.completed, p.daily.total, '今日');
  setBar('#pb-monthly-fill', '#pb-monthly-text', p.monthly.completed, p.monthly.target, '本月');
  setBar('#pb-yearly-fill', '#pb-yearly-text', p.yearly.completed, p.yearly.target, '本年');
}

function setBar(fillSel, textSel, done, total, label) {
  const fill = $(fillSel);
  const text = $(textSel);
  if (!fill || !text) return;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  fill.style.width = pct + '%';
  text.textContent = `${label} ${done} / ${total} (${pct}%)`;
}

function pulseBalanceCards() {
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
    root.innerHTML = '<div class="empty"><div class="empty-icon">📡</div><div>等待任务指令…</div></div>';
    return;
  }
  state.tasks.forEach((t) => {
    const done = state.completedTaskIds.has(t.id);
    const revoked = state.uncompletedTodayIds.has(t.id);
    // §3.12 sleep task (Item #002): self-lockout state fires before revoked/done/normal.
    const isSleepLocked = !done && !revoked
      && t.is_self_lockout === 1 && t.cutoff_time;
    const btn = document.createElement('button');
    btn.className = 'task-btn'
      + (done && !revoked ? ' task-btn-done' : '')
      + (revoked ? ' task-btn-revoked' : '')
      + (isSleepLocked ? ' task-btn-locked' : '');
    btn.dataset.taskId = t.id;
    if (revoked) {
      btn.disabled = true;
      btn.innerHTML = `
        <span class="task-icon">${t.icon || '⭐'}</span>
        <span class="task-name">${escapeHtml(t.name)}</span>
        <span class="task-done-badge">系统休眠中</span>
      `;
    } else if (done) {
      btn.innerHTML = `
        <span class="task-icon">${t.icon || '⭐'}</span>
        <span class="task-name">${escapeHtml(t.name)}</span>
        <span class="task-reward">+${t.token_reward} ${t.target_account === 'game_time' ? '⚡' : '⚙️'}</span>
        <span class="task-done-badge">✓ 任务完成</span>
      `;
    } else if (isSleepLocked) {
      // Initial render: compute diff once. setInterval(updateCountdowns) keeps it fresh.
      const diff = computeCutoffDiffSec(t.cutoff_time);
      if (diff <= 0) {
        btn.classList.add('task-btn-locked-out');
        btn.disabled = true;
        btn.innerHTML = `
          <span class="task-icon">${t.icon || '⭐'}</span>
          <span class="task-name">${escapeHtml(t.name)}</span>
          <span class="task-done-badge">已过打卡时间 ${t.cutoff_time} (明天再来)</span>
        `;
      } else {
        btn.innerHTML = `
          <span class="task-icon">${t.icon || '⭐'}</span>
          <span class="task-name">${escapeHtml(t.name)}</span>
          <span class="task-cutoff-label">· 距离时限还剩</span>
          <span class="task-countdown-text" data-cutoff="${t.cutoff_time}">${formatHHMMSS(diff)}</span>
        `;
      }
    } else {
      btn.innerHTML = `
        <span class="task-icon">${t.icon || '⭐'}</span>
        <span class="task-name">${escapeHtml(t.name)}</span>
        <span class="task-reward">+${t.token_reward} ${t.target_account === 'game_time' ? '⚡' : '⚙️'}</span>
      `;
    }
    if (revoked) {
      // no-op (disabled)
    } else if (done) {
      btn.addEventListener('click', () => tryUncompleteTask(t));
    } else if (isSleepLocked) {
      // Only attach click if button not already past cutoff (disabled).
      if (!btn.disabled) {
        btn.addEventListener('click', () => completeTask(t.id));
      }
    } else {
      btn.addEventListener('click', () => completeTask(t.id));
    }
    root.appendChild(btn);
  });
  // Start the per-second countdown loop. Idempotent.
  startCountdownLoop();
}

// ---------- §3.12 sleep task countdown helpers ----------
/** Seconds until HH:MM cutoff in Asia/Shanghai client local time. Negative = past cutoff. */
function computeCutoffDiffSec(hhmm) {
  const now = new Date();
  const [h, m] = hhmm.split(':').map(Number);
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  return Math.floor((cutoff.getTime() - now.getTime()) / 1000);
}
function formatHHMMSS(totalSec) {
  if (totalSec < 0) totalSec = 0;
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
let _countdownTimer = null;
function startCountdownLoop() {
  if (_countdownTimer) return; // idempotent
  _countdownTimer = setInterval(updateCountdowns, 1000);
}
function updateCountdowns() {
  const texts = document.querySelectorAll('.task-countdown-text[data-cutoff]');
  texts.forEach((el) => {
    const cutoff = el.getAttribute('data-cutoff');
    const diff = computeCutoffDiffSec(cutoff);
    if (diff <= 0) {
      // Crossed cutoff: lock this button. Replace the countdown span with the
      // "已过打卡时间" badge so the layout matches a newly-rendered locked-out button.
      const btn = el.closest('.task-btn-locked');
      if (!btn) return;
      btn.classList.add('task-btn-locked-out');
      btn.disabled = true;
      // Also detach the click handler: easiest is to clone-replace the node.
      const fresh = btn.cloneNode(true);
      fresh.innerHTML = `
        <span class="task-icon">${btn.querySelector('.task-icon')?.textContent || '⭐'}</span>
        <span class="task-name">${btn.querySelector('.task-name')?.textContent || ''}</span>
          <span class="task-done-badge">超出时限 · 明日再来</span>
      `;
      btn.replaceWith(fresh);
    } else {
      el.textContent = formatHHMMSS(diff);
    }
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
    const icon = ev.type === 'game_time' ? '⚡' : '⚙️';
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
  return ({ pending: '◷ 待确认', approved: '✓ 已通过', rejected: '✕ 已拒绝', revoked: '↩ 已回收' })[s] || s;
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
    toast(`+${r.token_awarded} ${r.target_account === 'game_time' ? '⚡' : '⚙️'} 能量到账`, 'success');
    // refresh events + progress in background
    loadEvents().then(renderEvents).catch(() => {});
    loadProgress().then(() => {
      renderProgress();
      // If daily is now 100% and we haven't fired today, celebrate.
      if (state.progress?.daily?.total > 0
          && state.progress.daily.completed >= state.progress.daily.total
          && !hasFiredConfettiToday()) {
        fireConfetti();
        markConfettiFiredToday();
        toast('⚡ 今日任务全部完成！', 'success');
      }
    }).catch(() => {});
  } catch (e) {
    if (e.message === 'ALREADY_COMPLETED_TODAY') {
      state.completedTaskIds.add(taskId);
      renderTasks();
    }
    toast('系统报错：' + e.message, 'error');
  }
}

// §3.11 toggle: confirm dialog before revoke.
function tryUncompleteTask(task) {
  const ok = window.confirm(
    `确认取消「${task.name}」？\n本日无法再次执行该任务。`,
  );
  if (!ok) return;
  uncompleteTask(task.id);
}

async function uncompleteTask(taskId) {
  try {
    const r = await api('POST', `/api/me/tasks/${taskId}/uncomplete`);
    state.completedTaskIds.delete(taskId);
    state.uncompletedTodayIds.add(taskId);
    state.balance = r.new_balance;
    renderBalance();
    renderTasks();
    toast(`-${r.token_revoked} ${r.target_account === 'game_time' ? '⚡' : '⚙️'} 已回收`, 'success');
    // refresh events + progress in background
    loadEvents().then(renderEvents).catch(() => {});
    loadProgress().then(renderProgress).catch(() => {});  // §5.2 fix: revoke must refresh progress
  } catch (e) {
    if (e.message === 'ALREADY_UNCOMPLETED_TODAY') {
      // sync state (server says already revoked, but UI didn't know)
      state.completedTaskIds.delete(taskId);
      state.uncompletedTodayIds.add(taskId);
      renderTasks();
    } else if (e.message === 'NOT_COMPLETED_TODAY') {
      // sync state
      state.completedTaskIds.delete(taskId);
      renderTasks();
    }
    toast('系统报错：' + e.message, 'error');
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
    toast('申请已发送，等待指令确认…', 'success');
    // refresh events
    loadEvents().then(renderEvents).catch(() => {});
  } catch (e) {
    toast('申请失败：' + e.message, 'error');
  }
}

async function setName(name) {
  try {
    const r = await api('PATCH', '/api/me/profile', { name });
    state.user = { ...state.user, name: r.name, is_first_time: false };
    hideWelcome();
    renderGreeting();
    fireConfetti();
    toast(`系统就绪，${r.name} 驾驶员`, 'success');
  } catch (e) {
    if (e.message === 'ALREADY_SET') {
      // User reloaded after name was set; just hide the modal
      hideWelcome();
      renderGreeting();
      return;
    }
    showWelcomeError('初始化失败：' + e.message);
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
function openSubmitModal() {
  $('#submit-modal').hidden = false;
  // Reset to "想要" (+) as the default direction every time modal opens,
  // and sync the visual seg-btn state with state.selectedDir.
  state.selectedDir = 1;
  $$('.seg-btn').forEach((b) => b.classList.toggle('seg-btn-active', Number(b.dataset.dir) === 1));
  $('#submit-reason').focus();
}
function closeSubmitModal() { $('#submit-modal').hidden = true; $('#submit-form').reset(); state.selectedDir = 1; $$('.seg-btn').forEach((b) => b.classList.toggle('seg-btn-active', Number(b.dataset.dir) === 1)); }

// ---------- Confetti ----------
function confettiKey() { return 'lastConfettiAt'; }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function hasFiredConfettiToday() { return localStorage.getItem(confettiKey()) === todayStr(); }
function markConfettiFiredToday() { localStorage.setItem(confettiKey(), todayStr()); }

function fireConfetti() {
  const canvas = $('#confetti');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#00F5FF', '#FF6B35', '#00FF88', '#00D4E4', '#FF9500', '#00A8B5'];
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
    if (!name) return showWelcomeError('代号不能为空');
    if (name.length > 20) return showWelcomeError('代号过长（最多20字符）');
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
    showError('启动异常：' + e.message, boot);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
