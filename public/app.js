// Single source of truth for fallback task icon. See /shared/emoji-presets.js.
const DEFAULT_TASK_ICON = (typeof window !== 'undefined' && window.DEFAULT_TASK_ICON) || '⭐';

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
  health: { activeType: 'cough', currentMonth: null, events: [] },
  running: { activeMap: null, cumKm: 0 },
};
// Expose state for e2e introspection (read-only).
if (typeof window !== 'undefined') window.__kiddoState = state;

// ---------- Running Check-in (Item #011 §2) ----------
/** Load active map + cumulative km for the running check-in. */
async function loadRunningState() {
  try {
    // Stage 2 reuses the records endpoint: the response includes cum_km.
    // For an initial load (no records), we fall back to a 0-km read.
    const r = await api('GET', '/api/running/records?limit=1');
    // If the route doesn't yet expose GET, just hide the ticker.
    if (r && typeof r.cum_km === 'number') {
      state.running.cumKm = r.cum_km;
      renderRunningCum();
    }
  } catch (_) {
    // Stage 2 ships POST first; GET is Stage 3+. Silently no-op.
  }
}

function renderRunningCum() {
  const el = document.getElementById('running-cum');
  const kmEl = document.getElementById('running-cum-km');
  if (!el || !kmEl) return;
  kmEl.textContent = Number(state.running.cumKm || 0).toFixed(1);
  el.hidden = state.running.cumKm <= 0;
}

function openRunningCheckinModal() {
  const modal = document.getElementById('running-checkin-modal');
  const err = document.getElementById('running-checkin-error');
  const input = document.getElementById('running-km-input');
  if (!modal || !input) return;
  if (err) { err.hidden = true; err.textContent = ''; }
  input.value = '3.5';
  modal.hidden = false;
  input.focus();
  input.select();
}

function closeRunningCheckinModal() {
  const modal = document.getElementById('running-checkin-modal');
  const form = document.getElementById('running-checkin-form');
  if (form) form.reset();
  if (modal) modal.hidden = true;
}

function showRunningError(message) {
  const err = document.getElementById('running-checkin-error');
  if (!err) return;
  err.textContent = message;
  err.hidden = false;
}

async function submitRunning(km) {
  const submitBtn = document.getElementById('running-checkin-submit');
  if (submitBtn) submitBtn.disabled = true;
  try {
    const r = await api('POST', '/api/running/records', { km });
    // Refresh local state from the server response.
    state.running.cumKm = Number(r.cum_km || 0);
    renderRunningCum();

    // Update the 3 balance cards if the response includes them.
    if (r.balance) {
      const gt = document.getElementById('balance-game-time');
      const pm = document.getElementById('balance-pocket-money');
      const co = document.getElementById('balance-coins');
      if (gt) gt.textContent = r.balance.game_time ?? state.balance.game_time;
      if (pm) pm.textContent = r.balance.pocket_money ?? state.balance.pocket_money;
      if (co) co.textContent = r.balance.coins ?? state.balance.coins;
    }

    // Re-render the map to show avatar in the new position.
    if (state.running.activeMap) {
      renderRunningMap(state.running.activeMap, state.running.cumKm);
    }

    closeRunningCheckinModal();

    const points = r.new_points_reached?.length || 0;
    const coins = r.total_awarded_coins || 0;

    // Show gift modal for each newly-reached point.
    if (points > 0 && r.new_points_reached) {
      // Show the first gift modal; the rest (if any) are shown after closing.
      const firstPoint = r.new_points_reached[0];
      showGiftModal(firstPoint, coins);
      toast(`🏃 跑了 ${km} km, 到达 ${points} 个新点位, +${coins} 枚`, 'success');
    } else {
      toast(`🏃 跑了 ${km} km, 累计 ${state.running.cumKm.toFixed(1)} km`, 'success');
    }

    // Check if map is now completed (cumKm >= totalKm).
    if (r.cum_km >= r.total_km) {
      // Trigger server-side completion (unlocks next map).
      if (r.map_id) triggerMapComplete(r.map_id);
      // Gather stats for the completion modal.
      const stats = {
        mapName: state.running.activeMap?.name || '上海→苏州',
        totalKm: r.total_km || 95,
        totalRuns: 1, // Approximate; server has the real count
        totalDays: 1,
        hasNextMap: true, // Optimistic; server will confirm
      };
      // Small delay so the gift modal plays first.
      setTimeout(() => showCompletionModal(stats), 600);
    }
  } catch (e) {
    showRunningError(e?.message || '提交失败, 再试一次');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ---------- Health Checkin (M2 — RFC §6.2) ----------
const HEALTH_EVENT_TYPES = [
  { type: 'ulcer',   label: '溃疡', emoji: '🤕' },
  { type: 'fever',   label: '发烧', emoji: '🤒' },
  { type: 'cough',   label: '咳嗽', emoji: '😷' },
  { type: 'injury',  label: '受伤', emoji: '🩹' },
  { type: 'allergy', label: '过敏', emoji: '🤧' },
  { type: 'dizzy',   label: '头晕', emoji: '😵' },
  { type: 'vomit',   label: '呕吐', emoji: '🤮' },
  { type: 'other',   label: '其他', emoji: '🌀' },
];
const HEALTH_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

// Current Shanghai YYYY-MM (computed at module load — refreshes on renderHealthCalendar).
function shanghaiTodayStr() {
  const d = new Date();
  // Use Asia/Shanghai via Intl so client matches server (RFC §1.4 timezone rule).
  const sh = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
  return sh;  // en-CA gives 'YYYY-MM-DD'
}
function shanghaiYearMonth(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit'
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  return { year: Number(y), month: Number(m) };
}

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
    await Promise.all([loadBalance(), loadTasks(), loadEvents(), loadProgress(), loadHealthEvents()]);
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
  renderHealthSubtabs();
  renderHealthCalendar();
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

// ---------- Health Checkin (M2) ----------
function renderHealthSubtabs() {
  const bar = $('#health-subtab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  HEALTH_EVENT_TYPES.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'health-subtab' + (t.type === state.health.activeType ? ' health-subtab-active' : '');
    btn.dataset.type = t.type;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', t.type === state.health.activeType ? 'true' : 'false');
    btn.innerHTML = `<span class="health-subtab-emoji">${t.emoji}</span><span>${t.label}</span>`;
    btn.addEventListener('click', () => switchHealthType(t.type));
    bar.appendChild(btn);
  });
}

function switchHealthType(type) {
  if (!HEALTH_EVENT_TYPES.some((t) => t.type === type)) return;
  state.health.activeType = type;
  renderHealthSubtabs();
  loadHealthEvents();
}

function renderHealthCalendar() {
  const grid = $('#health-calendar');
  if (!grid) return;
  grid.innerHTML = '';

  // Header row: 7 weekday labels (Mon first per RFC §2.1 — ISO 8601)
  HEALTH_WEEKDAYS.forEach((wd) => {
    const cell = document.createElement('div');
    cell.className = 'health-cal-weekday';
    cell.textContent = wd;
    grid.appendChild(cell);
  });

  const { year, month } = state.health.currentMonth || shanghaiYearMonth();
  $('#health-month-label').textContent = `${year}-${String(month).padStart(2, '0')}`;

  // First day of month (Shanghai) — find weekday (Mon=1, Sun=7)
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = (firstDay.getUTCDay() + 6) % 7 + 1;  // 0=Sun → 7, 1=Mon → 1
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const todayStr = shanghaiTodayStr();

  // Index events by start_date (YYYY-MM-DD) for fast cell lookup.
  // For cross-month events (start < month AND end >= month), show emoji on
  // every day in the month the event covers. RFC §4.2.1 calendar rule.
  const cellsToFill = daysInMonth + (firstWeekday - 1);
  const totalCells = Math.ceil(cellsToFill / 7) * 7;
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'health-cal-cell';
    const dayNum = i - (firstWeekday - 1) + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cell.classList.add('health-cal-empty');
      grid.appendChild(cell);
      continue;
    }
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    if (dateStr === todayStr) cell.classList.add('health-cal-today');

    // Day number (top-left corner)
    const dayLabel = document.createElement('span');
    dayLabel.className = 'health-cal-day';
    dayLabel.textContent = dayNum;
    cell.appendChild(dayLabel);

    // Find events for this day:
    //   - Active (end_date IS NULL): only mark start_date (not all subsequent dates)
    //   - Resolved (end_date set): mark every day in [start, end]
    // Fix: prior version had `(end_date === null || end_date >= dateStr)` which
    // short-circuited to true for any date >= start_date, marking the whole
    // remaining month as "having the event" when only the start day was checked in.
    const dayEvents = state.health.events.filter((ev) => {
      if (ev.event_type !== state.health.activeType) return false;
      if (ev.end_date === null) return ev.start_date === dateStr;
      return ev.start_date <= dateStr && ev.end_date >= dateStr;
    });
    if (dayEvents.length > 0) {
      const emojis = document.createElement('div');
      emojis.className = 'health-cal-emojis';
      // For M2: show first event's emoji. If resolved, dim it. M3 will add
      // resume modal click for active events.
      dayEvents.forEach((ev) => {
        const span = document.createElement('span');
        span.textContent = HEALTH_EVENT_TYPES.find((t) => t.type === ev.event_type)?.emoji ?? '•';
        if (ev.is_resolved) span.classList.add('health-cal-resolved');
        emojis.appendChild(span);
      });
      cell.appendChild(emojis);
      cell.classList.add('health-cal-cell-has-events');
      cell.dataset.date = dateStr;
      // Store event ids as JSON for click handler. Comma-separated would
      // be simpler but JSON handles edge cases (single event OK, multi OK).
      cell.dataset.eventIds = JSON.stringify(dayEvents.map(e => e.id));
    }
    grid.appendChild(cell);
  }

  // Show / hide empty state
  const monthEvents = state.health.events.filter((ev) =>
    ev.event_type === state.health.activeType
    && ev.start_date.startsWith(`${year}-${String(month).padStart(2, '0')}`)
  );
  $('#health-empty').hidden = monthEvents.length > 0;
}

// ---------- Running Map (Item #011 §3) ----------
// SVG map rendering + avatar animation + gift modal + completion modal.

/** SVG node positions — hand-crafted curved route from 上海普陀区 → 苏州金鸡湖.
 *  SVG viewBox: 600×280. Each entry: [x, y] in SVG coordinate space.
 *  Route is curved (cubic Bezier) through all 10 points. */
const NODE_POSITIONS = [
  [30,  220],  // 0: 起点 上海·普陀区
  [90,  200],  // 1: 嘉定新城
  [160, 160],  // 2: 太仓
  [220, 180],  // 3: 昆山花桥
  [290, 140],  // 4: 昆山城区
  [360, 120],  // 5: 阳澄湖
  [430, 100],  // 6: 苏州相城区
  [490,  80],  // 7: 苏州姑苏区
  [540,  60],  // 8: 苏州工业园区
  [570,  30],  // 9: 终点 苏州·金鸡湖
];

/**
 * Build a smooth cubic-bezier SVG path string through NODE_POSITIONS.
 * Uses Catmull-Rom → Bezier conversion for natural curves.
 */
function buildRoutePath(positions) {
  if (positions.length < 2) return '';
  const pts = positions.map(([x, y]) => ({ x, y }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Interpolate avatar position along the route path based on cumKm / totalKm.
 *  Returns { x, y } in SVG coordinate space. */
function interpolateAvatarPosition(cumKm, totalKm, positions) {
  if (!positions || positions.length < 2) return positions?.[0] ?? [30, 220];
  const ratio = Math.min(cumKm / totalKm, 1.0);
  const totalSegments = positions.length - 1;
  const exactPos = ratio * totalSegments;
  const segIdx = Math.min(Math.floor(exactPos), totalSegments - 1);
  const t = exactPos - segIdx;
  const [x0, y0] = positions[segIdx];
  const [x1, y1] = positions[segIdx + 1];
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
}

/** Render the SVG map from the loaded map data. */
function renderRunningMap(mapData, cumKm) {
  const section = document.getElementById('running-map-section');
  const svg = document.getElementById('running-map-svg');
  const routePath = document.getElementById('running-route-path');
  const nodesGroup = document.getElementById('running-nodes');
  const avatarGroup = document.getElementById('running-avatar-group');
  const titleEl = document.getElementById('running-map-title');
  const progressEl = document.getElementById('running-map-progress');
  const labelsEl = document.getElementById('running-point-labels');

  if (!section || !svg) return;

  const points = mapData.points || [];
  const totalKm = mapData.total_km || 95;
  const ratio = Math.min(cumKm / totalKm, 1.0);

  // Show the section
  section.hidden = false;

  // Title + progress
  if (titleEl) titleEl.textContent = mapData.name || '上海 → 苏州';
  if (progressEl) progressEl.textContent = `${cumKm.toFixed(1)} / ${totalKm} km`;

  // Route path
  if (routePath) {
    routePath.setAttribute('d', buildRoutePath(NODE_POSITIONS));
  }

  // Determine current point index
  let currentPointIdx = 0;
  for (let i = 0; i < points.length; i++) {
    if (cumKm >= (points[i].cum_km || 0)) currentPointIdx = i;
    else break;
  }

  // Render nodes
  nodesGroup.innerHTML = '';
  points.forEach((pt, idx) => {
    const pos = NODE_POSITIONS[idx];
    if (!pos) return;
    const [x, y] = pos;
    const ptKm = pt.cum_km || 0;
    const isReached = cumKm >= ptKm;
    const isCurrent = idx === currentPointIdx;
    const stateClass = isCurrent ? 'current' : isReached ? 'reached' : 'unreached';

    // Short label: extract just the city/area name
    const rawLabel = pt.name || '';
    const shortLabel = rawLabel
      .replace(/^🏁\s*/, '')
      .replace(/^🚩\s*/, '')
      .replace(/\s*\(起点\)|\(终点\)/g, '')
      .split('·').pop() || rawLabel;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('running-node', stateClass);
    g.setAttribute('transform', `translate(${x}, ${y})`);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', isCurrent ? '9' : '7');
    circle.setAttribute('cx', '0');
    circle.setAttribute('cy', '0');
    g.appendChild(circle);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '0');
    text.setAttribute('y', '4');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '9');
    text.setAttribute('font-family', 'Share Tech Mono, monospace');
    text.textContent = shortLabel.slice(0, 4);
    g.appendChild(text);

    nodesGroup.appendChild(g);
  });

  // Position avatar
  const [ax, ay] = interpolateAvatarPosition(cumKm, totalKm, NODE_POSITIONS);
  if (avatarGroup) {
    avatarGroup.setAttribute('transform', `translate(${ax}, ${ay})`);
  }

  // Point labels below
  labelsEl.innerHTML = '';
  points.forEach((pt, idx) => {
    const div = document.createElement('div');
    div.className = 'running-point-label';
    const rawLabel = pt.name || '';
    div.textContent = rawLabel.replace(/^🏁\s*/, '').replace(/^🚩\s*/, '').split('·').pop() || rawLabel;
    labelsEl.appendChild(div);
  });

  // Update state
  state.running.activeMap = mapData;
}

/** Animate avatar to a specific point (called after a successful check-in). */
function animateAvatarToPoint(pointIdx, cumKm, totalKm) {
  const avatarGroup = document.getElementById('running-avatar-group');
  if (!avatarGroup) return;
  const pos = NODE_POSITIONS[pointIdx];
  if (!pos) return;
  const [ax, ay] = pos;
  avatarGroup.setAttribute('transform', `translate(${ax}, ${ay})`);
  // Update progress text
  const progressEl = document.getElementById('running-map-progress');
  if (progressEl) progressEl.textContent = `${cumKm.toFixed(1)} / ${totalKm} km`;
}

/** Show the gift modal when child reaches a new point. */
function showGiftModal(point, minutes) {
  const modal = document.getElementById('running-gift-modal');
  const amountEl = document.getElementById('running-gift-amount');
  const titleEl = document.getElementById('running-gift-title');
  const hintEl = document.getElementById('running-gift-hint');
  if (!modal) return;
  if (amountEl) amountEl.textContent = `+${minutes}`;
  if (titleEl) titleEl.textContent = minutes >= 10 ? '🎁 通关奖励!' : '🎁 到达新地点!';
  if (hintEl) hintEl.textContent = `恭喜到达 ${point.name || '下一站'}!`;
  modal.hidden = false;
}

function closeGiftModal() {
  const modal = document.getElementById('running-gift-modal');
  if (modal) modal.hidden = true;
}

/** Show the completion modal when cumKm >= totalKm. */
function showCompletionModal(stats) {
  const modal = document.getElementById('running-completion-modal');
  const titleEl = document.getElementById('running-completion-title');
  const runsEl = document.getElementById('completion-total-runs');
  const kmEl = document.getElementById('completion-total-km');
  const daysEl = document.getElementById('completion-total-days');
  const nextBtn = document.getElementById('running-completion-next');
  const waitingEl = document.getElementById('running-completion-waiting');
  if (!modal) return;
  if (titleEl) titleEl.textContent = `🎉 恭喜通关! ${stats.mapName || '上海→苏州'}`;
  if (runsEl) runsEl.textContent = stats.totalRuns || 0;
  if (kmEl) kmEl.textContent = (stats.totalKm || 0).toFixed(1);
  if (daysEl) daysEl.textContent = stats.totalDays || 0;
  if (nextBtn && waitingEl) {
    if (stats.hasNextMap) {
      nextBtn.hidden = false;
      waitingEl.hidden = true;
    } else {
      nextBtn.hidden = true;
      waitingEl.hidden = false;
    }
  }
  modal.hidden = false;
  // Fire confetti
  if (typeof fireConfetti === 'function') fireConfetti();
}

function closeCompletionModal() {
  const modal = document.getElementById('running-completion-modal');
  if (modal) modal.hidden = true;
}

/** Load running map data from the API and render the map. */
async function loadAndRenderMap() {
  try {
    const r = await api('GET', '/api/running/maps/active');
    if (!r || !r.map) return;
    state.running.activeMap = r.map;
    state.running.cumKm = r.cum_km || 0;
    renderRunningMap(r.map, r.cum_km || 0);
  } catch (_) {
    // Silently skip if map endpoint not available yet
  }
}

/** Trigger the map-complete flow: POST /api/running/maps/:id/complete. */
async function triggerMapComplete(mapId) {
  try {
    await api('POST', `/api/running/maps/${mapId}/complete`);
  } catch (_) {
    // Non-fatal: completion may already be processed server-side
  }
}

/** Initialize the running map section: load map + bind events. */
function initRunningMap() {
  // Bind gift modal close button
  document.getElementById('running-gift-close')?.addEventListener('click', closeGiftModal);
  document.getElementById('running-gift-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'running-gift-modal') closeGiftModal();
  });

  // Bind completion modal next-map button
  document.getElementById('running-completion-next')?.addEventListener('click', async () => {
    closeCompletionModal();
    // Reload the map to see if next one is now active
    await loadAndRenderMap();
  });

  // Load and render on init
  loadAndRenderMap();
}

// ---------- Health Checkin (M3 — RFC §6.3) ----------
// 续接 UX 弹窗 + 打卡流程

let healthActiveEvent = null;  // M3 临时状态: 当前 resume 弹窗的 active event

async function onCheckinClick() {
  const btn = $('#health-checkin-btn');
  btn.disabled = true;
  try {
    const r = await api('GET',
      `/api/public/health/events?user_id=${CHILD_USER_ID}` +
      `&event_type=${state.health.activeType}&active_only=true`
    );
    const actives = (r.events ?? []).filter((ev) => ev.end_date === null);
    if (actives.length > 0) {
      healthActiveEvent = actives[0];
      showResumeDialog(healthActiveEvent);
    } else {
      showNewEventForm(state.health.activeType);
    }
  } catch (e) {
    toast('打卡准备失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function showResumeDialog(activeEvent) {
  const t = HEALTH_EVENT_TYPES.find((x) => x.type === activeEvent.event_type);
  $('#health-resume-title').textContent = `上次${t?.label ?? ''} (${activeEvent.start_date} 起) 现在怎么样？`;
  $('#health-resume-modal').hidden = false;
  $('#health-resolve-date-row').hidden = true;
}

function closeResumeDialog() {
  $('#health-resume-modal').hidden = true;
  healthActiveEvent = null;
}

function showNewEventForm(type) {
  const t = HEALTH_EVENT_TYPES.find((x) => x.type === type);
  $('#health-new-title').textContent = `📝 新建 ${t?.emoji ?? ''} ${t?.label ?? '打卡'}`;
  $('#health-new-hint').textContent = `// ${t?.label ?? '记录'}打卡 — 记录今天的健康状况`;
  $('#health-new-date').value = shanghaiTodayStr();
  $('#health-new-date').max = shanghaiTodayStr();  // 不能选未来
  $('#health-new-date').min = '';  // 不限过去 (溃疡可能追溯)
  $('#health-new-note').value = '';
  $('#health-new-modal').hidden = false;
}

// ---------- M1.2: 日历 cell 点击 → 详情 dialog (RFC §4.2.6/§4.2.7) ----------
// 状态: 当前选中的 event (来自日历点击)
let healthSelectedEvent = null;
// 状态: confirm delete 时缓存要删的 event id + 调用哪个 endpoint
let healthPendingDeleteId = null;
let healthPendingDeleteVia = 'me';  // 'me' (child) 或 'admin' (pm)

function openEventDetailModal(event, date) {
  healthSelectedEvent = event;
  const t = HEALTH_EVENT_TYPES.find((x) => x.type === event.event_type);
  const isActive = !event.is_resolved;
  const statusText = isActive
    ? `还在继续 (从 ${event.start_date} 起)`
    : `${event.start_date} → ${event.end_date} (已愈)`;
  const submitterText = event.submitted_by === 'child' ? '儿子' : '爸爸 (PM)';

  $('#health-event-detail-title').textContent = `${t?.emoji ?? '•'} ${t?.label ?? event.event_type} 详情`;
  $('#health-event-detail-body').innerHTML = `
    <div class="field"><strong>状态：</strong> ${statusText}</div>
    <div class="field"><strong>记录人：</strong> ${submitterText}</div>
    ${event.note ? `<div class="field"><strong>备注：</strong> ${escapeHtml(event.note)}</div>` : ''}
    <div class="field" style="opacity:0.6;font-size:11px">点击日期: ${date} · event id: ${event.id}</div>
  `;

  const actions = $('#health-event-detail-actions');
  actions.innerHTML = '';
  if (isActive) {
    const btnResolve = mkBtn('已愈', 'btn-primary', () => {
      // 复用 §4.2.5 resolve 流程 — 把 event 存进 healthActiveEvent 然后显示 date picker
      healthActiveEvent = event;
      closeEventDetailModal();
      openResumeDialogForResolve(event);
    });
    const btnNew = mkBtn('又起新的', 'btn-secondary', () => {
      // 复用 §5.3 又起新流程
      healthActiveEvent = event;
      closeEventDetailModal();
      doStartNew(event.id);
    });
    const btnDelete = mkBtn('删除', 'btn-danger', () => openConfirmDelete(event, 'me'));
    const btnClose = mkBtn('关闭', 'btn-secondary', closeEventDetailModal);
    actions.append(btnResolve, btnNew, btnDelete, btnClose);
  } else {
    const btnDelete = mkBtn('删除', 'btn-danger', () => openConfirmDelete(event, 'me'));
    const btnClose = mkBtn('关闭', 'btn-secondary', closeEventDetailModal);
    actions.append(btnDelete, btnClose);
  }

  $('#health-event-detail-modal').hidden = false;
}

function closeEventDetailModal() {
  $('#health-event-detail-modal').hidden = true;
  healthSelectedEvent = null;
}

function openResumeDialogForResolve(event) {
  // 跟 showResumeDialog 类似, 但 event 已固定 (从 cell 点击来的)
  const t = HEALTH_EVENT_TYPES.find((x) => x.type === event.event_type);
  $('#health-resume-title').textContent = `标记 ${t?.label ?? ''} 已愈 (${event.start_date} 起)`;
  $('#health-resume-modal').hidden = false;
  $('#health-resolve-date-row').hidden = false;
  $('#health-resolve-date').value = shanghaiTodayStr();
  $('#health-resolve-date').max = shanghaiTodayStr();
  $('#health-resolve-date').min = event.start_date;
}

function mkBtn(text, cls, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function openConfirmDelete(event, via /* 'me' | 'admin' */) {
  healthPendingDeleteId = event.id;
  healthPendingDeleteVia = via;
  const t = HEALTH_EVENT_TYPES.find((x) => x.type === event.event_type);
  $('#health-confirm-delete-hint').textContent =
    `确定要删除 ${t?.emoji ?? ''} ${t?.label ?? event.event_type} (${event.start_date}${event.end_date ? ' → ' + event.end_date : ' 还在继续'})？删除后无法恢复`;
  $('#health-confirm-delete-modal').hidden = false;
}

function closeConfirmDelete() {
  $('#health-confirm-delete-modal').hidden = true;
  healthPendingDeleteId = null;
}

async function doConfirmDelete() {
  if (!healthPendingDeleteId) return;
  const id = healthPendingDeleteId;
  const via = healthPendingDeleteVia;
  const path = via === 'admin'
    ? `/api/admin/health/events/${id}`
    : `/api/me/health/events/${id}`;
  try {
    await api('DELETE', path);
    toast('已删除', 'success');
    closeConfirmDelete();
    closeEventDetailModal();
    await loadHealthEvents();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

function closeNewModal() {
  $('#health-new-modal').hidden = true;
}

async function doResolve(eventId, endDate) {
  try {
    // §4.2.5: child can resolve their own event via /api/me/...
    // (was /api/admin/... but that requires PM session → 401 silent fail on child device)
    await api('PATCH', `/api/me/health/events/${eventId}/resolve`, { end_date: endDate });
    toast('已记录', 'success');
    closeResumeDialog();
    await loadHealthEvents();
  } catch (e) {
    toast('已愈失败：' + e.message, 'error');
  }
}

async function doCreate(type, startDate, note) {
  try {
    await api('POST', '/api/me/health/events', {
      user_id: CHILD_USER_ID,
      event_type: type,
      start_date: startDate,
      note: note || null,
    });
    toast('打卡成功', 'success');
    closeNewModal();
    await loadHealthEvents();
  } catch (e) {
    toast('打卡失败：' + e.message, 'error');
  }
}

async function doStartNew(oldEventId) {
  const today = shanghaiTodayStr();
  try {
    // 1. resolve 旧 (child self-resolve via §4.2.5; was /api/admin/... → 401 on iPad)
    await api('PATCH', `/api/me/health/events/${oldEventId}/resolve`, { end_date: today });
    // 2. create 新
    await api('POST', '/api/me/health/events', {
      user_id: CHILD_USER_ID,
      event_type: state.health.activeType,
      start_date: today,
      note: null,
    });
    toast('新事件已起', 'success');
    closeResumeDialog();
    await loadHealthEvents();
  } catch (e) {
    toast('操作失败：' + e.message + ' (旧可能已结束, 请刷新查看)', 'error');
    // best-effort 刷新, 让用户看到当前状态
    await loadHealthEvents();
  }
}

async function loadHealthEvents() {
  const { year, month } = state.health.currentMonth || shanghaiYearMonth();
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  try {
    const r = await api('GET',
      `/api/public/health/events?user_id=${CHILD_USER_ID}` +
      `&event_type=${state.health.activeType}&month=${monthStr}`
    );
    state.health.events = r.events ?? [];
  } catch (e) {
    state.health.events = [];
    toast('健康数据加载失败：' + e.message, 'error');
  }
  renderHealthActiveBanner();
  renderHealthCalendar();
}

function renderHealthActiveBanner() {
  const banner = $('#health-active-banner');
  if (!banner) return;
  const active = state.health.events.find(
    (ev) => ev.event_type === state.health.activeType && ev.end_date === null
  );
  if (!active) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const t = HEALTH_EVENT_TYPES.find((x) => x.type === active.event_type);
  banner.textContent = `${t?.emoji ?? '•'} 进行中：${active.start_date} 起`;
}

function shiftHealthMonth(delta) {
  const { year, month } = state.health.currentMonth || shanghaiYearMonth();
  let newY = year;
  let newM = month + delta;
  if (newM < 1) { newM = 12; newY -= 1; }
  if (newM > 12) { newM = 1; newY += 1; }
  state.health.currentMonth = { year: newY, month: newM };
  loadHealthEvents();
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
        <span class="task-icon">${t.icon || DEFAULT_TASK_ICON}</span>
        <span class="task-name">${escapeHtml(t.name)}</span>
        <span class="task-done-badge">系统休眠中</span>
      `;
    } else if (done) {
      btn.innerHTML = `
        <span class="task-icon">${t.icon || DEFAULT_TASK_ICON}</span>
        <span class="task-name">${escapeHtml(t.name)}</span>
        <span class="task-reward">${taskRewardIcon(t.target_account)}</span>
        <span class="task-done-badge">✓ 任务完成</span>
      `;
    } else if (isSleepLocked) {
      // Initial render: compute diff once. setInterval(updateCountdowns) keeps it fresh.
      const diff = computeCutoffDiffSec(t.cutoff_time);
      if (diff <= 0) {
        btn.classList.add('task-btn-locked-out');
        btn.disabled = true;
        btn.innerHTML = `
          <span class="task-icon">${t.icon || DEFAULT_TASK_ICON}</span>
          <span class="task-name">${escapeHtml(t.name)}</span>
          <span class="task-done-badge">已过打卡时间 ${t.cutoff_time} (明天再来)</span>
        `;
      } else {
        btn.innerHTML = `
          <span class="task-icon">${t.icon || DEFAULT_TASK_ICON}</span>
          <span class="task-name">${escapeHtml(t.name)}</span>
          <span class="task-cutoff-label">· 距离时限还剩</span>
          <span class="task-countdown-text" data-cutoff="${t.cutoff_time}">${formatHHMMSS(diff)}</span>
        `;
      }
    } else {
      btn.innerHTML = `
        <span class="task-icon">${t.icon || DEFAULT_TASK_ICON}</span>
        <span class="task-name">${escapeHtml(t.name)}</span>
        <span class="task-reward">${taskRewardIcon(t.target_account)}</span>
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
    // §2 mecha HUD frame: wrap button in .mecha-frame with 4 corner brackets.
    // .mecha-corner spans sit inside the frame so they can overflow slightly
    // (overflow:visible on the frame + negative offset) for the mecha look.
    const frame = document.createElement('div');
    frame.className = 'mecha-frame mecha-glow'
      + (done && !revoked ? ' frame-done' : '')
      + (revoked || isSleepLocked ? ' frame-locked' : '');
    frame.innerHTML = '<span class="mecha-corner tl"></span>'
      + '<span class="mecha-corner tr"></span>'
      + '<span class="mecha-corner bl"></span>'
      + '<span class="mecha-corner br"></span>';
    frame.appendChild(btn);
    root.appendChild(frame);
  });
  // Start the per-second countdown loop. Idempotent.
  startCountdownLoop();
  // Update the "全部完成 +3" hint below the section title (separate from per-task reward).
  renderTaskBonusHint();
}

// Bug #1 (feihao 2026-06-14): The per-task reward display is now just the coin icon
// (the actual grant is uniform +1 coin per task, regardless of `token_reward`).
// The "all complete +3" daily bonus is shown separately below the section title.
function renderTaskBonusHint() {
  const hint = $('#task-bonus-hint');
  if (!hint) return;
  if (state.tasks.length === 0) { hint.hidden = true; return; }
  const allDone = state.tasks.every((t) =>
    state.completedTaskIds.has(t.id) && !state.uncompletedTodayIds.has(t.id)
  );
  hint.hidden = false;
  hint.classList.toggle('achieved', allDone);
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
        <span class="task-icon">${btn.querySelector('.task-icon')?.textContent || DEFAULT_TASK_ICON}</span>
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
    const icon = eventIcon(ev.type);
    const unit = eventUnit(ev.type);
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
// ---------- Reward / event icon helpers (2026-06-14: 任务实际入账是 🪙 coin, 0007 schema drift) ----------
// task.target_account schema only allows 'game_time' | 'pocket_money', but task completion
// actually grants 'coins' (writeTaskCoinGrant in src/utils/coin.ts hardcodes type='coins').
// For UI consistency, show 🪙 for ALL task rewards today. The 'game_time' / 'pocket_money'
// branches are kept only for the visual fallback in score_event list (events with those
// types do exist historically — see eventIcon / eventUnit). taskRewardIcon hardcodes 🪙
// because the actual grant path is coins regardless of tasks.target_account.
function taskRewardIcon(_targetAccount) {  // targetAccount ignored — see comment
  return '🪙';
}
function eventIcon(type) {
  if (type === 'game_time') return '⚡';
  if (type === 'pocket_money') return '⚙️';
  if (type === 'coins') return '🪙';
  return '•';
}
function eventUnit(type) {
  if (type === 'game_time') return '分钟';
  if (type === 'pocket_money') return '元';
  if (type === 'coins') return '枚';
  return '';
}

// ---------- Actions ----------
async function completeTask(taskId) {
  try {
    const r = await api('POST', `/api/me/tasks/${taskId}/complete`);
    state.completedTaskIds.add(taskId);
    state.balance = r.new_balance;
    renderBalance();
    renderTasks();
    // §3 equip activation: "weapon activate" pulse on task completion (after re-render
    // so it targets the newly rendered .mecha-frame, not the DOM node just replaced)
    triggerEquipActivation(taskId);
    toast(`+${r.token_awarded} ${taskRewardIcon(r.target_account)} 到账`, 'success');
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
    toast(`-${r.token_revoked} ${taskRewardIcon(r.target_account)} 已回收`, 'success');
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

// Submit form has no id (one modal at a time), so a module-level flag is
// enough to block double-click. Mirrors admin.js::approveEvent's inFlight
// pattern (line 387-401). Regression: see #20 — child submit double-click
// was creating 2 events in the log.
let inFlightSubmit = false;

async function submitEvent(form) {
  if (inFlightSubmit) return;
  inFlightSubmit = true;
  try {
    const type = form.type.value;
    const amount = parseInt(form.amount.value, 10);
    const dir = state.selectedDir;
    const reason = form.reason.value.trim();
    const change_value = dir * Math.abs(amount);
    await api('POST', '/api/me/events', { type, change_value, reason });
    closeSubmitModal();
    toast('申请已发送，等待指令确认…', 'success');
    // refresh events
    loadEvents().then(renderEvents).catch(() => {});
  } catch (e) {
    toast('申请失败：' + e.message, 'error');
  } finally {
    inFlightSubmit = false;
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
// ============================================================================
// Item #006 §1: Calendar fold toggle + localStorage persistence
// Stage 2+ adds loadMonthCheckins() + renderCalendar() inside #calendar-grid
// ============================================================================
const CALENDAR_COLLAPSED_KEY = 'calendarCollapsed';

// ---------- §6 Calendar state ----------
const calendarState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1, // 1-indexed
  checkins: {}, // { "2026-06-15": [{task_id, task_icon, task_name, count}, ...] }
  tasks: [],    // [{id, name, icon, category, sort_order}]  from /api/public/calendar/tasks
  selectedTaskIds: [], // [] = 全部 (Item #012 §4 D2 localStorage)
};

// localStorage keys for Item #012 §4 (D2 persistence)
const CALENDAR_SELECTED_KEY = 'calendarSelectedTaskIds';

/** Load selectedTaskIds from localStorage. Returns [] on any failure. */
function loadCalendarSelectedFromStorage() {
  try {
    const raw = localStorage.getItem(CALENDAR_SELECTED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch (_) {
    return [];
  }
}

/** Persist selectedTaskIds to localStorage. */
function saveCalendarSelectedToStorage() {
  try {
    localStorage.setItem(CALENDAR_SELECTED_KEY, JSON.stringify(calendarState.selectedTaskIds));
  } catch (_) {
    // localStorage might be disabled (e.g. Safari private mode) — silently ignore
  }
}

// Weekday labels (Mon first per ISO 8601)
const CAL_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/** Load active task list (Item #012 §1 endpoint) and render tab bar. */
async function loadCalendarTasks() {
  try {
    const r = await api('GET', '/api/public/calendar/tasks');
    calendarState.tasks = Array.isArray(r?.tasks) ? r.tasks : [];
  } catch (_) {
    calendarState.tasks = [];
  }
  renderCalendarTabs();
}

/** Render the row of task pills above the calendar grid (Item #012 §3 C1). */
function renderCalendarTabs() {
  const bar = document.getElementById('calendar-tab-bar');
  if (!bar) return;
  bar.innerHTML = '';

  // "全部" tab (id = empty / null)
  const allTab = document.createElement('button');
  allTab.type = 'button';
  allTab.className = 'calendar-tab';
  allTab.dataset.taskId = '';
  allTab.textContent = '全部';
  if (calendarState.selectedTaskIds.length === 0) allTab.classList.add('calendar-tab--active');
  bar.appendChild(allTab);

  // One tab per active task (B2 multi-select with OR logic)
  for (const task of calendarState.tasks) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'calendar-tab';
    tab.dataset.taskId = String(task.id);
    const iconSpan = document.createElement('span');
    iconSpan.className = 'calendar-tab-icon';
    iconSpan.textContent = task.icon || '';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'calendar-tab-name';
    nameSpan.textContent = task.name || '';
    tab.appendChild(iconSpan);
    tab.appendChild(nameSpan);
    if (calendarState.selectedTaskIds.includes(task.id)) {
      tab.classList.add('calendar-tab--active');
    }
    bar.appendChild(tab);
  }

  // Attach click handlers (toggle selection)
  bar.querySelectorAll('.calendar-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const raw = tab.dataset.taskId;
      if (raw === '') {
        // "全部" tab clicked → clear all selections
        calendarState.selectedTaskIds = [];
      } else {
        const id = Number(raw);
        const idx = calendarState.selectedTaskIds.indexOf(id);
        if (idx >= 0) {
          calendarState.selectedTaskIds.splice(idx, 1);
        } else {
          calendarState.selectedTaskIds.push(id);
        }
      }
      saveCalendarSelectedToStorage();
      renderCalendarTabs();
      // Re-fetch checkins with new filter (and re-render)
      loadMonthCheckins(CHILD_USER_ID, calendarState.year, calendarState.month);
    });
  });
}

/** Load month checkins from API and re-render calendar. */
async function loadMonthCheckins(childId, year, month) {
  const taskIdsParam = calendarState.selectedTaskIds.length > 0
    ? `&task_ids=${calendarState.selectedTaskIds.join(',')}`
    : '';
  try {
    const r = await api('GET',
      `/api/public/calendar/checkins?child_id=${childId}&year=${year}&month=${month}${taskIdsParam}`
    );
    calendarState.checkins = r?.checkins ?? {};
  } catch (_) {
    calendarState.checkins = {};
  }
  renderCalendar(year, month);
}

/** Render the 7×6 month grid into #calendar-grid. */
function renderCalendar(_year, _month) {
  const grid = document.getElementById('calendar-grid');
  const label = document.getElementById('calendar-month-label');
  if (!grid || !label) return;

  // Use calendarState (latest) instead of closure args (year, month) to avoid
  // race when user clicks ◀/▶ rapidly: if a stale fetch resolves after a newer
  // click, the render still reflects the latest state.
  const year = calendarState.year;
  const month = calendarState.month;

  label.textContent = `${year} 年 ${month} 月`;
  grid.innerHTML = '';

  // Header row: weekday labels
  CAL_WEEKDAYS.forEach((wd) => {
    const h = document.createElement('div');
    h.className = 'calendar-weekday';
    h.textContent = wd;
    grid.appendChild(h);
  });

  // Days in month
  const daysInMonth = new Date(year, month, 0).getDate();
  // First day: Mon=1 … Sun=7 (ISO 8601)
  const firstDay = new Date(year, month - 1, 1);
  const firstWeekday = ((firstDay.getDay() + 6) % 7) + 1; // 1=Mon

  // Previous month trailing days (gray)
  const prevMonthDays = new Date(year, month - 1, 0).getDate();
  for (let i = firstWeekday - 1; i > 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'calendar-cell calendar-cell--other-month';
    cell.textContent = String(prevMonthDays - i + 1);
    grid.appendChild(cell);
  }

  // Current month days
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'calendar-cell';
    cell.dataset.date = dateStr;
    if (dateStr === todayStr) cell.classList.add('calendar-cell--today');

    // checkins[dateStr] is now [{task_id, task_icon, task_name, count}, ...] (Item #012 §1)
    // When task_ids filter is applied via the API, server returns only matching tasks.
    const dateCheckins = calendarState.checkins[dateStr];
    const filteredCount = Array.isArray(dateCheckins) ? dateCheckins.length : 0;

    if (filteredCount > 0) {
      cell.classList.add('calendar-cell--active');
      cell.classList.add(`calendar-cell--tier-${getColorTier(filteredCount)}`);
      cell.title = `${filteredCount} 次打卡`;
    }

    const dayLabel = document.createElement('span');
    dayLabel.className = 'calendar-cell-day';
    dayLabel.textContent = String(d);
    cell.appendChild(dayLabel);

    if (filteredCount > 0) {
      // Item #012 §2 A3+: 横排所有 task icon, 无数字无 +N; ≥5 → ⭐ single icon (overflow)
      const iconsWrap = document.createElement('div');
      iconsWrap.className = 'calendar-cell-icons';
      if (filteredCount >= 5) {
        const star = document.createElement('span');
        star.className = 'calendar-cell-icon calendar-cell-overflow';
        star.textContent = '⭐';
        iconsWrap.appendChild(star);
      } else {
        for (const c of dateCheckins) {
          const ic = document.createElement('span');
          ic.className = 'calendar-cell-icon';
          ic.textContent = c.task_icon || '⭐';
          ic.title = c.task_name || '';
          iconsWrap.appendChild(ic);
        }
      }
      cell.appendChild(iconsWrap);
    }

    cell.addEventListener('click', () => showDayDetailModal(dateStr));
    grid.appendChild(cell);
  }

  // Next month leading days (gray) — always pad to 42 day cells (7×6 grid)
  // totalCells here counts day cells only (we just finished the current-month
  // loop, weekday headers are children but not .calendar-cell). The spec
  // (calendar-render.test.ts:99) is "Always 42 cells", so we pad day cells
  // to 42, leaving 7 weekday headers + 42 day cells = 49 total children.
  const dayCellsRendered = grid.querySelectorAll('.calendar-cell').length;
  const remaining = 42 - dayCellsRendered;
  for (let d = 1; d <= remaining; d++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-cell calendar-cell--other-month';
    cell.textContent = String(d);
    grid.appendChild(cell);
  }
}

/** Color tier: 0=gray, 1=light-cyan, 2=cyan, 3+=neon-cyan */
function getColorTier(count) {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

/** Show day detail modal with task completions for the given date. */
async function showDayDetailModal(dateStr) {
  const modal = document.getElementById('calendar-day-modal');
  const title = document.getElementById('calendar-day-title');
  const body = document.getElementById('calendar-day-body');
  if (!modal || !title || !body) return;

  title.textContent = `${dateStr} 打卡明细`;
  body.innerHTML = '<div class="modal-hint">加载中…</div>';
  modal.hidden = false;

  try {
    const r = await api('GET',
      `/api/public/calendar/details?child_id=${CHILD_USER_ID}&date=${dateStr}`
    );

    if (!r?.completions || r.completions.length === 0) {
      body.innerHTML = '<div class="modal-hint">当日无打卡记录</div>';
      return;
    }

    body.innerHTML = r.completions.map(c => {
      // API returns completed_at as INTEGER unix seconds; convert to local HH:MM
      const time = c.completed_at
        ? new Date(Number(c.completed_at) * 1000).toTimeString().slice(0, 5)
        : '';
      return `
      <div class="calendar-completion-item">
        <span class="calendar-completion-icon">${c.task_icon || '⭐'}</span>
        <span class="calendar-completion-name">${escapeHtml(c.task_name)}</span>
        <span class="calendar-completion-reward">+${c.token_reward} 🪙</span>
        <span class="calendar-completion-time">${time}</span>
      </div>
    `;
    }).join('');
  } catch (e) {
    body.innerHTML = '<div class="modal-hint" style="color:var(--red)">加载失败：' + escapeHtml(String(e)) + '</div>';
  }
}

function closeCalendarDayModal() {
  const modal = document.getElementById('calendar-day-modal');
  if (modal) modal.hidden = true;
}

/** Initialize calendar: load current month and bind nav events. */
function initCalendar() {
  // Item #012 §2 D2: restore tab selection from localStorage BEFORE first render
  calendarState.selectedTaskIds = loadCalendarSelectedFromStorage();

  const prevBtn = document.getElementById('calendar-prev-month');
  const nextBtn = document.getElementById('calendar-next-month');

  prevBtn?.addEventListener('click', () => {
    let m = calendarState.month - 1;
    let y = calendarState.year;
    if (m < 1) { m = 12; y -= 1; }
    // Bound check: 2024-01 is the earliest allowed
    if (y < 2024) return;
    calendarState.year = y;
    calendarState.month = m;
    // Optimistic UI: re-render synchronously so the label/grid update
    // immediately, not after the async fetch resolves. The fetch will
    // re-render with fresh checkins when it completes.
    renderCalendar();
    loadMonthCheckins(CHILD_USER_ID, y, m);
  });

  nextBtn?.addEventListener('click', () => {
    const now = new Date();
    const curY = calendarState.year;
    const curM = calendarState.month;
    // Bound: cannot navigate past current month
    if (curY > now.getFullYear()) return;
    if (curY === now.getFullYear() && curM >= now.getMonth() + 1) return;

    let m = curM + 1;
    let y = curY;
    if (m > 12) { m = 1; y += 1; }
    calendarState.year = y;
    calendarState.month = m;
    // Optimistic UI: re-render synchronously (see prev handler for rationale).
    renderCalendar();
    loadMonthCheckins(CHILD_USER_ID, y, m);
  });

  // Close modal on backdrop click or ESC
  const modal = document.getElementById('calendar-day-modal');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeCalendarDayModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCalendarDayModal();
  });
  document.getElementById('calendar-day-close')?.addEventListener('click', closeCalendarDayModal);

  // Load current month on init
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  calendarState.year = y;
  calendarState.month = m;
  loadMonthCheckins(CHILD_USER_ID, y, m);
}

function initCalendarToggle() {
  const btn = document.getElementById('calendar-toggle-btn');
  const panel = document.getElementById('calendar-panel');
  if (!btn || !panel) return;
  // Restore folded state from localStorage (default = collapsed)
  const stored = localStorage.getItem(CALENDAR_COLLAPSED_KEY);
  const isCollapsed = stored === null ? true : stored === '1';
  applyCalendarCollapsed(btn, panel, isCollapsed);
  btn.addEventListener('click', () => {
    const nowCollapsed = panel.hasAttribute('hidden');
    const nextCollapsed = !nowCollapsed; // toggle: flip current state for both DOM + localStorage
    applyCalendarCollapsed(btn, panel, nextCollapsed);
    try { localStorage.setItem(CALENDAR_COLLAPSED_KEY, nextCollapsed ? '1' : '0'); } catch (_) { /* ignore quota */ }
  });
}

function applyCalendarCollapsed(btn, panel, collapsed) {
  if (collapsed) {
    panel.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '📅 月历';
  } else {
    panel.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = '📅 收起月历';
  }
}

// Item #008 §3: Equip activation — "weapon power-up" pulse on task completion.
// Finds the .mecha-frame for taskId, adds .mecha-equip-active (0.5s animation),
// then removes it so it can re-fire on the next completion.
function triggerEquipActivation(taskId) {
  // Locate the .mecha-frame wrapping the task button
  const frame = document.querySelector(
    `.task-shortcuts > .mecha-frame > .task-btn[data-task-id="${taskId}"]`
  )?.closest('.mecha-frame');
  if (!frame) return;
  // Guard: if animation is already running, skip
  if (frame.classList.contains('mecha-equip-active')) return;
  frame.classList.add('mecha-equip-active');
  // Remove after 500ms (matches @keyframes mecha-equip-activate duration)
  setTimeout(() => {
    frame.classList.remove('mecha-equip-active');
  }, 500);
}

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
  // Item #006 §2 — calendar month nav + grid render
  initCalendar();
  // Item #012 §2 — load active task list (drives the tab bar)
  loadCalendarTasks();
  // Item #006 §1 — calendar fold toggle button (PM-fix: was defined but never invoked)
  initCalendarToggle();
  $('#btn-running')?.addEventListener('click', openRunningCheckinModal);
  $('#running-checkin-cancel')?.addEventListener('click', closeRunningCheckinModal);
  $('#running-checkin-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'running-checkin-modal') closeRunningCheckinModal();
  });
  $('#running-checkin-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#running-km-input');
    const km = parseFloat(input?.value ?? '');
    if (!Number.isFinite(km)) {
      showRunningError('公里数要大于 0 哦');
      return;
    }
    submitRunning(km);
  });
  // Load initial running state (cum-km ticker)
  loadRunningState();
  // Health checkin — month nav
  $('#health-prev-month')?.addEventListener('click', () => shiftHealthMonth(-1));
  $('#health-next-month')?.addEventListener('click', () => shiftHealthMonth(1));
  // Health checkin — M3 按钮 + 弹窗
  $('#health-checkin-btn')?.addEventListener('click', onCheckinClick);
  $$('[data-resume-action]').forEach((b) => {
    b.addEventListener('click', () => {
      const action = b.dataset.resumeAction;
      if (action === 'resolve') {
        $('#health-resolve-date-row').hidden = false;
        $('#health-resolve-date').value = shanghaiTodayStr();
        $('#health-resolve-date').max = shanghaiTodayStr();
        $('#health-resolve-date').min = healthActiveEvent?.start_date ?? '';
      } else if (action === 'continue') {
        toast('已记一笔', 'info');
        closeResumeDialog();
      } else if (action === 'new') {
        doStartNew(healthActiveEvent.id);
      }
    });
  });
  $('#health-resolve-confirm')?.addEventListener('click', () => {
    const d = $('#health-resolve-date').value;
    if (!d) return toast('请选择日期', 'error');
    doResolve(healthActiveEvent.id, d);
  });
  $('#health-resolve-cancel')?.addEventListener('click', () => {
    $('#health-resolve-date-row').hidden = true;
  });
  $('#health-new-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    doCreate(state.health.activeType, $('#health-new-date').value, $('#health-new-note').value.trim());
  });
  $('#health-new-cancel')?.addEventListener('click', closeNewModal);
  // Click on modal backdrop closes it (跟 submit-modal 一致)
  $('#health-resume-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'health-resume-modal') closeResumeDialog();
  });
  $('#health-new-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'health-new-modal') closeNewModal();
  });
  // M1.2: 日历 cell 点击 → 详情 dialog
  $('#health-calendar')?.addEventListener('click', (e) => {
    const cell = e.target.closest('.health-cal-cell-has-events');
    if (!cell) return;
    const date = cell.dataset.date;
    const eventIds = JSON.parse(cell.dataset.eventIds || '[]');
    const events = (state.health.events || []).filter(
      ev => eventIds.includes(ev.id) && ev.event_type === state.health.activeType
    );
    if (events.length === 0) return;
    if (events.length === 1) {
      openEventDetailModal(events[0], date);
    } else {
      // 多 event 同日 (业务允许, EDGE-1): 列出来选
      // 简化: 取第一个, TODO M-later 弹 picker
      openEventDetailModal(events[0], date);
    }
  });
  // M1.2: 详情 dialog + 删除 confirm 按钮 bind
  $('#health-confirm-delete-confirm')?.addEventListener('click', doConfirmDelete);
  $('#health-confirm-delete-cancel')?.addEventListener('click', closeConfirmDelete);
  $('#health-event-detail-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'health-event-detail-modal') closeEventDetailModal();
  });
  $('#health-confirm-delete-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'health-confirm-delete-modal') closeConfirmDelete();
  });
  // M4: tap balance-card (3rd, coins) → open /shop.html (Q5 06-11 拍板 (a))
  // CSS uses cursor:pointer (set in app.css balance-card.coins rule) for affordance.
  $('#card-coins')?.addEventListener('click', () => { window.location.href = '/shop.html'; });

  // Item #011 §3: init running map section
  initRunningMap();
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
