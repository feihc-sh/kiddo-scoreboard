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
  // Item #016 §2 (2026-07-12 feihao): summer-homework calendar heatmap.
  summerCalendar: null,   // { task_id, task_name, from_date, to_date, kids:[...] }
  summerCalendarTaskId: null,   // selected task (default = first active task)
  // Item #016 §7 (2026-09-04 feihao): cache "any active summer-homework task?"
  // (set by loadTasks; consumed by refreshAll + filter handlers to skip
  // loadSummerCalendar/loadSummerSubitemsMatrix when feature is disabled).
  summerHomeworkActive: false,
  summerCalendarYear: 2026,
  // feihao 2026-07-12: tabbed month picker (was 2-col grid, now 1 month at a time).
  summerCalendarMonth: (function () { const m = new Date().getMonth() + 1; return [7, 8].includes(m) ? m : 7; })(),
  // Item #016 §5 (2026-07-12 feihao): per-subitem dot matrix (which of the
  // 6 暑假作业 sub-items did the kid勾 each day). Uses the SAME /by-task
  // endpoint but renders transposed (rows=date, cols=6 items + footer
  // total row). Separate state so the dropdown changes don't clobber
  // each other.
  summerSubmatrix: null,
  summerSubmatrixTaskId: null,
  summerSubmatrixYear: 2026,
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
  // Item #016 §7 (2026-09-04 feihao): cache "any active summer-homework task?"
  // flag on state so refreshAll + filter handlers can skip loadSummerCalendar /
  // loadSummerSubitemsMatrix network calls without scanning state.tasks each time.
  // (UI section hidden in admin/index.html; this is defense-in-depth.)
  state.summerHomeworkActive = state.tasks.some(
    (t) => t && t.name === '每日完成暑假作业' && t.is_active === 1,
  );
  // Item #016 §2: refresh summer-calendar task dropdown now that state.tasks
  // is populated. Done here (not inside loadSummerCalendar) so the dropdown
  // is filled BEFORE loadSummerCalendar reads state.summerCalendarTaskId.
  populateSummerTaskSelect();
  // Item #016 §5: same pattern for the subitem-matrix dropdown.
  populateSubmatrixTaskSelect();
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

// ---------- Item #016 §2 (2026-07-12 feihao): Summer Homework Calendar ----------
// GitHub-style per-kid heatmap of打卡 across a year. Backed by
// /api/admin/task-completions/by-task?task_id=…&from=YYYY-MM-DD&to=YYYY-MM-DD.

const SUMMER_CALENDAR_MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const SUMMER_CALENDAR_WEEKDAYS = ['日','一','二','三','四','五','六'];

async function loadSummerCalendar() {
  // populateSummerTaskSelect() is invoked from loadTasks() once state.tasks
  // is populated (guarantees the dropdown options exist before we read the
  // selected taskId). This function only does the API fetch.
  const taskId = state.summerCalendarTaskId;
  if (!taskId) {
    state.summerCalendar = { task_id: 0, task_name: '(none)', from_date: '', to_date: '', kids: [] };
    return;
  }
  const year = state.summerCalendarYear;
  try {
    const r = await api(
      'GET',
      `/api/admin/task-completions/by-task?task_id=${taskId}&from=${year}-01-01&to=${year}-12-31`,
    );
    state.summerCalendar = r;
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') throw e;
    state.summerCalendar = { task_id: taskId, task_name: '?', from_date: '', to_date: '', kids: [] };
    toast('加载暑假作业月历失败：' + e.message, 'error');
  }
}

function populateSummerTaskSelect() {
  const sel = $('#filter-summer-task');
  if (!sel) return;
  const activeTasks = (state.tasks || []).filter((t) => t.is_active === 1);
  if (activeTasks.length === 0) {
    sel.innerHTML = '<option value="">(没有 active 任务)</option>';
    return;
  }
  // Default to the summer-homework task if present, else first active task.
  if (!state.summerCalendarTaskId) {
    const summer = activeTasks.find((t) => /暑假作业/.test(t.name));
    state.summerCalendarTaskId = summer ? summer.id : activeTasks[0].id;
  }
  sel.innerHTML = activeTasks
    .map((t) => `<option value="${t.id}" ${t.id === state.summerCalendarTaskId ? 'selected' : ''}>${escapeHtml(t.icon || '📝')} ${escapeHtml(t.name)} (#${t.id})</option>`)
    .join('');
}

function renderSummerCalendar() {
  const root = $('#summer-calendar-list');
  const empty = $('#summer-calendar-empty');
  const countEl = $('#count-summer-calendar');
  if (!root || !countEl) return;

  const data = state.summerCalendar;
  if (!data || !data.kids || data.kids.length === 0) {
    root.innerHTML = '';
    empty.hidden = false;
    countEl.textContent = '0';
    return;
  }
  empty.hidden = true;
  countEl.textContent = data.kids.length;

  // feihao 2026-07-12: month tab bar (7月 | 8月), shared across all kids.
  const tabsHtml = `
    <div class="sc-month-tabs">
      ${[7, 8].map((m) => {
        const active = state.summerCalendarMonth === m;
        const name = SUMMER_CALENDAR_MONTH_NAMES[m - 1];
        return `<button type="button" class="sc-month-tab${active ? ' active' : ''}" data-month="${m}">${name}</button>`;
      }).join('')}
    </div>
  `;

  // Build per-kid row.
  root.innerHTML = tabsHtml + data.kids.map((kid) => {
    // Index completions by date → status (latest wins; 'revoked' overrides 'active' if both).
    const byDate = {};
    for (const c of kid.completions) {
      const prev = byDate[c.completed_date];
      if (!prev || c.status === 'revoked') byDate[c.completed_date] = c.status;
    }
    let doneCount = 0, revokedCount = 0;
    Object.values(byDate).forEach((s) => { if (s === 'active') doneCount++; else if (s === 'revoked') revokedCount++; });

    const year = state.summerCalendarYear;
    const month = state.summerCalendarMonth;
    return `
      <div class="summer-calendar-kid">
        <div class="summer-calendar-kid-header">
          <span class="summer-calendar-kid-name">${escapeHtml(kid.kid_name)} <span style="color:var(--text-muted);font-weight:400;font-size:13px;">#${kid.kid_id}</span></span>
          <span class="summer-calendar-kid-stats">
            <span style="color:var(--green);">✓ ${doneCount} 天</span> ·
            <span style="color:var(--orange);">↩ ${revokedCount} 天</span>
          </span>
          <span class="summer-calendar-legend">
            <span><span class="summer-calendar-legend-swatch" style="background:var(--green);"></span>active</span>
            <span><span class="summer-calendar-legend-swatch" style="background:var(--orange-dim);"></span>revoked</span>
          </span>
        </div>
        <div class="summer-calendar-grid">${render2026Month(year, month, byDate)}</div>
      </div>
    `;
  }).join('');

  // Bind month tab clicks (re-render only, no API call).
  root.querySelectorAll('.sc-month-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.summerCalendarMonth = Number(btn.dataset.month);
      renderSummerCalendar();
    });
  });
}

function render2026Month(year, month, byDate) {
  const today = todayIsoLocal();
  // feihao 2026-07-12: render single selected month (was SUMMER_MONTHS.map).
  const idx = month - 1;
  const mName = SUMMER_CALENDAR_MONTH_NAMES[idx];
  const daysInMonth = new Date(year, month, 0).getDate();
  // JS getDay: 0=Sun..6=Sat.
  const firstDayOfWeek = new Date(year, idx, 1).getDay();
  const dayCells = [];
  for (let i = 0; i < firstDayOfWeek; i++) dayCells.push('<div class="summer-calendar-day empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const status = byDate[dateStr];
    const isFuture = dateStr > today;
    const cls = ['summer-calendar-day'];
    if (status === 'active') cls.push('done');
    else if (status === 'revoked') cls.push('revoked');
    if (dateStr === today) cls.push('today');
    if (isFuture) cls.push('future');
    const tip = status ? `${dateStr} · ${status}` : dateStr;
    // feihao 2026-07-12: 把日期数字 ${d} 填进格子, 方便扫读
    dayCells.push(`<div class="${cls.join(' ')}" title="${escapeHtml(tip)}"><span class="sc-day-num">${d}</span></div>`);
  }
  return `
    <div class="summer-calendar-month">
      <div class="summer-calendar-month-name">${mName}</div>
      <div class="summer-calendar-month-weekdays">${SUMMER_CALENDAR_WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="summer-calendar-month-days">${dayCells.join('')}</div>
    </div>
  `;
}

// today as YYYY-MM-DD in LOCAL time (matches the dev "today" the user sees).
function todayIsoLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- Item #016 §5 (2026-07-12 feihao): Summer Subitem Matrix ----------
// Per-kid dot matrix. Rows = dates in the SUMMER window (Jul+Aug by default,
// same window as the calendar heatmap). Columns = the 6 hardcoded sub-items
// from app.js:59-66. Last row of the matrix = per-item total 打卡天数
// (SUM of checked=1 across all kids/days — answers "which item gets
// checked the most"). Uses the same /by-task endpoint, just rendered
// transposed + per-subitem.

const SUBITEM_COLS = [
  { id: 'chinese',         icon: '📝', name: '语文' },
  { id: 'math-school',     icon: '🔢', name: '校内数' },
  { id: 'english-vocab',   icon: '📖', name: '英语单词' },
  { id: 'english-reading', icon: '📚', name: '英语绘本' },
  { id: 'math-extra',      icon: '🧮', name: '举一反三' },
  { id: 'english-class',   icon: '🗓️', name: '外教课' },
];
const SUBMATRIX_MONTHS = [7, 8]; // 1-indexed; same Jul+Aug window as the calendar (feihao 2026-07-12 fix — was [6,7] → June+July)

function populateSubmatrixTaskSelect() {
  const sel = $('#filter-submatrix-task');
  if (!sel) return;
  const activeTasks = (state.tasks || []).filter((t) => t.is_active === 1);
  if (activeTasks.length === 0) {
    sel.innerHTML = '<option value="">(没有 active 任务)</option>';
    return;
  }
  if (!state.summerSubmatrixTaskId) {
    const summer = activeTasks.find((t) => /暑假作业/.test(t.name));
    state.summerSubmatrixTaskId = summer ? summer.id : activeTasks[0].id;
  }
  sel.innerHTML = activeTasks
    .map((t) => `<option value="${t.id}" ${t.id === state.summerSubmatrixTaskId ? 'selected' : ''}>${escapeHtml(t.icon || '📝')} ${escapeHtml(t.name)} (#${t.id})</option>`)
    .join('');
}

async function loadSummerSubitemsMatrix() {
  const taskId = state.summerSubmatrixTaskId;
  if (!taskId) {
    state.summerSubmatrix = null;
    return;
  }
  const year = state.summerSubmatrixYear;
  try {
    const r = await api(
      'GET',
      `/api/admin/task-completions/by-task?task_id=${taskId}&from=${year}-07-01&to=${year}-08-31`,
    );
    state.summerSubmatrix = r;
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') throw e;
    state.summerSubmatrix = null;
    toast('加载子项完成度失败：' + e.message, 'error');
  }
}

function renderSummerSubitemsMatrix() {
  const root = $('#summer-subitems-matrix-list');
  const empty = $('#summer-subitems-matrix-empty');
  const countEl = $('#count-summer-subitems-matrix');
  if (!root || !countEl) return;
  const data = state.summerSubmatrix;
  if (!data || !data.kids || data.kids.length === 0) {
    root.innerHTML = '';
    empty.hidden = false;
    countEl.textContent = '0';
    return;
  }
  empty.hidden = true;
  countEl.textContent = data.kids.length;
  // Build date grid: every day in Jul+Aug of selected year.
  const year = state.summerSubmatrixYear;
  const today = todayIsoLocal();
  const dates = [];
  for (const m of SUBMATRIX_MONTHS) {
    const daysInMonth = new Date(year, m, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      dates.push(`${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }
  // Render per-kid block.
  root.innerHTML = data.kids.map((kid) => {
    // Index completions by date.
    const byDate = {};
    for (const c of kid.completions) {
      byDate[c.completed_date] = c; // latest write wins (UNIQUE per (task,user,date))
    }
    // Per-item total counter for the footer row.
    const perItemTotals = Object.fromEntries(SUBITEM_COLS.map((c) => [c.id, 0]));
    let totalRows = 0; // how many dates the kid actually opened the modal
    // Build matrix rows.
    const rows = dates.map((dateStr) => {
      const c = byDate[dateStr];
      const isFuture = dateStr > today;
      if (!c || c.status === 'revoked') {
        return `<tr class="sm-row sm-empty"><td class="sm-date">${dateStr.slice(5)}${dateStr === today ? ' · 今天' : ''}</td>${
          SUBITEM_COLS.map(() => '<td class="sm-cell sm-na"></td>').join('')
        }<td class="sm-status"></td></tr>`;
      }
      totalRows++;
      const cells = SUBITEM_COLS.map((col) => {
        const v = c.subitems ? c.subitems[col.id] : undefined;
        let cls = 'sm-cell';
        let tip = `${col.name}: `;
        if (v === 1) { cls += ' sm-done'; tip += '✓ 勾了'; if (perItemTotals[col.id] !== undefined) perItemTotals[col.id]++; }
        else if (v === 0) { cls += ' sm-missed'; tip += '✗ 开了但没勾'; }
        else { cls += ' sm-legacy'; tip += '(历史记录,无子项)'; }
        return `<td class="${cls}" title="${escapeHtml(tip)}"></td>`;
      }).join('');
      const checkedCount = Object.values(c.subitems || {}).filter((v) => v === 1).length;
      return `<tr class="sm-row"><td class="sm-date">${dateStr.slice(5)}${dateStr === today ? ' · 今天' : ''}</td>${cells}<td class="sm-status">${checkedCount}/${SUBITEM_COLS.length}</td></tr>`;
    }).join('');
    // Footer row: per-item 总计打卡天数.
    const footerCells = SUBITEM_COLS.map((col) => {
      const n = perItemTotals[col.id];
      const tone = n === 0 ? 'sm-zero' : n >= totalRows * 0.8 ? 'sm-strong' : 'sm-mid';
      return `<td class="sm-cell ${tone}"><span class="sm-total">${n}</span></td>`;
    }).join('');
    const totalAll = SUBITEM_COLS.reduce((s, c) => s + perItemTotals[c.id], 0);
    return `
      <div class="sm-kid-block">
        <div class="sm-kid-header">
          <span class="sm-kid-name">${escapeHtml(kid.kid_name)} <span style="color:var(--text-muted);font-weight:400;font-size:12px;">#${kid.kid_id}</span></span>
          <span class="sm-kid-stats">
            打卡 ${totalRows} 天 · 总勾 ${totalAll}/${totalRows * 6}
          </span>
        </div>
        <table class="sm-table">
          <thead>
            <tr>
              <th class="sm-date-col">日期</th>
              ${SUBITEM_COLS.map((c) => `<th class="sm-subitem-col" title="${escapeHtml(c.name)}">${c.icon}<br><span class="sm-subitem-col-name">${c.name}</span></th>`).join('')}
              <th class="sm-status-col">合计</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="sm-footer-row">
              <td class="sm-date sm-footer-label">总计打卡天数</td>
              ${footerCells}
              <td class="sm-status sm-footer-total">${totalAll}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }).join('');
}

async function refreshAll() {
  try {
    // Item #016 §2: loadTasks MUST run before loadSummerCalendar because
    // populateSummerTaskSelect() (called from loadTasks) sets the default
    // summerCalendarTaskId from state.tasks. Running them in parallel leaves
    // a race where loadSummerCalendar sees state.tasks=[] and bails.
    await loadBalance();
    await loadPendingEvents();
    await loadAllEvents();
    await loadTasks();
    // The rest are independent and can run in parallel.
    await Promise.all([
      loadAudit(),
      loadCompletions(),
      loadDeletedRecords(),
      loadPendingRedemptions(),
      loadRunningRecords(),
      // Item #016 §7 (2026-09-04 feihao): post-暑假 disabled (tasks.is_active=0)。
      // UI section 已 hidden (admin/index.html:214/238),这里 defense-in-depth:
      // 如果 state.tasks 里没有 is_active=1 的 SUMMER_HOMEWORK_TASK_NAME,跳过这俩 network call。
      state.summerHomeworkActive ? loadSummerCalendar() : Promise.resolve(),
      state.summerHomeworkActive ? loadSummerSubitemsMatrix() : Promise.resolve(),
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
  renderSummerCalendar();
  // Item #016 §5 (2026-07-12 feihao): subitem dot matrix render.
  renderSummerSubitemsMatrix();
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

// Item #013 §6 — admin revoke now triggers R2 cascade (rederiveRecordRevoke).
// The endpoint returns a cascade summary instead of a single -X event; we
// surface the net coin delta + per-milestone counts in the success toast so
// the PM sees what the revoke actually did. Confirmation copy is kept safe
// (no preview claim — there's no /preview endpoint; we just say "积分按
// cascade 调整" and let the response speak).
async function revokeRunningRecordAction(id) {
  if (!Number.isInteger(id) || id <= 0) return;
  if (inFlight.has('rr-' + id)) return;
  inFlight.add('rr-' + id);
  var ok = window.confirm(
    '确定要撤销这条跑步记录?\n\n' +
    '• 累计公里数将回退\n' +
    '• 积分按 milestone cascade 调整 (补偿 / 反向)\n' +
    '此操作不可撤销。'
  );
  if (!ok) { inFlight.delete('rr-' + id); return; }
  try {
    const result = await api(
      'POST',
      '/api/admin/running/records/' + id + '/revoke',
      { confirm: true },
    );
    // Cascade summary: net_coin_change signed (+ = compensation net, - = reverse net).
    const net = Number(result && result.net_coin_change);
    const compensated = (result && result.compensated_milestones) || [];
    const reversed = (result && result.reversed_milestones) || [];
    const sign = net > 0 ? '+' : '';
    const msg =
      '已撤销 · 净金币 ' + sign + net +
      ' (补偿 ' + compensated.length + ' / 反向 ' + reversed.length + ')';
    toast(msg, 'success');
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
  // Item #016 §7 (2026-09-04 feihao): skip network call when summer-homework
  // task is disabled (UI section hidden, no need to query).
  $('#filter-summer-task').addEventListener('change', async (e) => {
    if (!state.summerHomeworkActive) return;
    state.summerCalendarTaskId = Number(e.target.value);
    try { await loadSummerCalendar(); renderSummerCalendar(); }
    catch (err) { if (err.message !== 'UNAUTHORIZED') toast('加载失败：' + err.message, 'error'); }
  });
  $('#filter-summer-year').addEventListener('change', async (e) => {
    state.summerCalendarYear = Number(e.target.value);
    try { await loadSummerCalendar(); renderSummerCalendar(); }
    catch (err) { if (err.message !== 'UNAUTHORIZED') toast('加载失败：' + err.message, 'error'); }
  });
  // Item #016 §5 (2026-07-12 feihao): subitem matrix filters (separate
  // state so changing one doesn't reset the other).
  $('#filter-submatrix-task').addEventListener('change', async (e) => {
    state.summerSubmatrixTaskId = Number(e.target.value);
    try { await loadSummerSubitemsMatrix(); renderSummerSubitemsMatrix(); }
    catch (err) { if (err.message !== 'UNAUTHORIZED') toast('加载失败：' + err.message, 'error'); }
  });
  $('#filter-submatrix-year').addEventListener('change', async (e) => {
    state.summerSubmatrixYear = Number(e.target.value);
    try { await loadSummerSubitemsMatrix(); renderSummerSubitemsMatrix(); }
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
