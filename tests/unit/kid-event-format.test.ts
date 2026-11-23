// tests/unit/kid-event-format.test.ts
// feihao 需求 (2026-11-23): kid 页操作日志 (#event-list) 里的 task 不要只显示裸 id，
// 要显示「任务名 + 日期」。
//
// 覆盖 public/app.js 的纯函数 formatEventEntry(ev, tasksById) 及配套 helper：
//   - extractTaskIdFromReason / extractTaskIdFromSourceRef / resolveEventTaskId
//   - formatEventTime
//   - formatEventEntry
//   - buildTasksById / lookupTaskName
//
// 以及 renderEvents() 的接线（happy-dom 真 DOM，Iron Rule #25 —— 加载真实
// public/app.js 源码而不是复制一份逻辑）。
//
// 数据来源（服务端，本文件不改 src/）：
//   reason     `task:#<taskId>` / `revoke:task:#<taskId>` / `bonus:<date>:<userId>`
//   source_ref `task:<taskId>:<date>:<userId>` / `revoke:task:<taskId>:<date>:<userId>`
//   created_at unix 秒
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const JS_PATH  = path.join(__dirname, '..', '..', 'public', 'app.js');
const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'app.css');

// tsconfig 的 lib 只含 ES2022（无 DOM），所以 document / window / Storage
// 这些浏览器全局对 tsc 不可见。这里声明最小结构 —— 只用本测试真正碰到的
// 成员，避免为了跑通类型检查去动 tsconfig（会波及全仓的存量 error 计数）。
interface FakeElement {
  textContent: string | null;
  innerHTML: string;
  hidden: boolean;
  hasAttribute(name: string): boolean;
  querySelector(sel: string): FakeElement | null;
  querySelectorAll(sel: string): FakeElement[];
}
interface FakeDocument {
  body: { innerHTML: string };
  readyState: string;
  querySelector(sel: string): FakeElement | null;
  querySelectorAll(sel: string): FakeElement[];
}
declare const document: FakeDocument;
declare const window: unknown;

/** Map-backed localStorage shim (happy-dom's localStorage is undefined under Node). */
function makeMemoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  } as unknown as Storage;
}

/** Inject the real app.js into happy-dom, returning the named exports. */
function loadApp(extraExports: string): Record<string, unknown> {
  Object.defineProperty(document, 'readyState', {
    value: 'loading', configurable: true, writable: true,
  });
  const js = fs.readFileSync(JS_PATH, 'utf8');
  const wrapper = new Function(
    'document', 'window', 'localStorage',
    js + `\nreturn { ${extraExports} };`
  );
  return wrapper(document, window, makeMemoryStorage()) as Record<string, unknown>;
}

interface AppFns {
  formatEventEntry: (
    ev: { reason?: string; source_ref?: string | null; created_at?: number },
    tasksById: Map<number, string>,
  ) => { title: string; time: string };
  extractTaskIdFromReason: (reason: unknown) => number | null;
  extractTaskIdFromSourceRef: (sourceRef: unknown) => number | null;
  resolveEventTaskId: (ev: unknown) => number | null;
  formatEventTime: (unixSec: unknown) => string;
  buildTasksById: (tasks: unknown) => Map<number, string>;
  lookupTaskName: (tasksById: unknown, taskId: number) => string | null;
}

const app = loadApp(
  'formatEventEntry, extractTaskIdFromReason, extractTaskIdFromSourceRef, ' +
  'resolveEventTaskId, formatEventTime, buildTasksById, lookupTaskName'
) as unknown as AppFns;

// A fixed local-time timestamp builder — keeps the assertions meaningful AND
// timezone-independent (the app renders in the browser's local timezone, and
// CI/dev machines may not be on Asia/Shanghai).
function localUnix(y: number, m: number, d: number, hh: number, mm: number): number {
  return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000);
}

// ============================================================
// Pure function: formatEventEntry
// ============================================================
describe('formatEventEntry — 操作日志条目格式化（纯函数）', () => {
  const TASKS = new Map<number, string>([
    [42, '洗澡'],
    [7, '刷牙'],
  ]);

  it('HAPPY-1: reason = task:#42 且任务存在 → 显示任务名', () => {
    const { title, time } = app.formatEventEntry(
      { reason: 'task:#42', created_at: localUnix(2026, 7, 21, 9, 5) },
      TASKS,
    );
    expect(title).toBe('洗澡');
    expect(title).not.toContain('#42');   // 裸 id 不再出现
    expect(time).toBe('07-21 09:05');
  });

  it('EDGE-1: 任务已删除（tasksById 查不到）→ 回退显示「任务 #42」', () => {
    const { title } = app.formatEventEntry(
      { reason: 'task:#999', created_at: localUnix(2026, 7, 21, 9, 5) },
      TASKS,
    );
    expect(title).toBe('任务 #999');
  });

  it('EDGE-2: 任务存在但名字为空串 → 回退「任务 #id」（不渲染空标题）', () => {
    const { title } = app.formatEventEntry(
      { reason: 'task:#5', created_at: localUnix(2026, 7, 21, 9, 5) },
      new Map<number, string>([[5, '']]),
    );
    expect(title).toBe('任务 #5');
  });

  it('EDGE-3: bonus 类 reason 原样保留，语义不变', () => {
    const bonus = 'bonus:2026-07-21:2';
    const { title } = app.formatEventEntry(
      { reason: bonus, source_ref: bonus, created_at: localUnix(2026, 7, 21, 20, 0) },
      TASKS,
    );
    expect(title).toBe(bonus);
  });

  it('EDGE-4: 非 task 前缀的 source_ref 不误伤（running:… / exchange:… 原样）', () => {
    const running = '跑步打卡积分';
    const r1 = app.formatEventEntry(
      { reason: running, source_ref: 'running:123:point:5', created_at: localUnix(2026, 7, 21, 7, 0) },
      TASKS,
    );
    expect(r1.title).toBe(running);

    const exchange = 'exchange: -10 for 玩具枪';
    const r2 = app.formatEventEntry(
      { reason: exchange, source_ref: null, created_at: localUnix(2026, 7, 21, 7, 0) },
      TASKS,
    );
    expect(r2.title).toBe(exchange);

    // source_ref 形如 task-ish 但前缀不对 —— 不能当成 task
    const r3 = app.formatEventEntry(
      { reason: '手工申请', source_ref: 'mytask:42:2026-07-21:2', created_at: localUnix(2026, 7, 21, 7, 0) },
      TASKS,
    );
    expect(r3.title).toBe('手工申请');
  });

  it('EDGE-5: 撤销事件 reason = revoke:task:#42 → 同样显示任务名', () => {
    const { title } = app.formatEventEntry(
      { reason: 'revoke:task:#42', source_ref: 'revoke:task:42:2026-07-21:2', created_at: localUnix(2026, 7, 21, 10, 0) },
      TASKS,
    );
    expect(title).toBe('洗澡');
  });

  it('EDGE-6: reason 不带 id 但 source_ref 是 task:… → 用 source_ref 兜底解析', () => {
    const { title } = app.formatEventEntry(
      { reason: '任务完成', source_ref: 'task:7:2026-07-21:2', created_at: localUnix(2026, 7, 21, 8, 30) },
      TASKS,
    );
    expect(title).toBe('刷牙');
  });

  it('EDGE-7: created_at 缺失 / 非法 → time 为空串（不渲染坏时间）', () => {
    expect(app.formatEventEntry({ reason: 'bonus:x' }, TASKS).time).toBe('');
    expect(app.formatEventEntry({ reason: 'bonus:x', created_at: 0 }, TASKS).time).toBe('');
    expect(app.formatEventEntry({ reason: 'bonus:x', created_at: -5 }, TASKS).time).toBe('');
    expect(app.formatEventEntry({ reason: 'bonus:x', created_at: NaN }, TASKS).time).toBe('');
  });

  it('EDGE-8: ev.reason 缺失 / 非字符串 → title 为空串，不抛异常', () => {
    expect(app.formatEventEntry({}, TASKS).title).toBe('');
    expect(app.formatEventEntry({ reason: null as unknown as string }, TASKS).title).toBe('');
    expect(app.formatEventEntry(undefined as unknown as { reason?: string }, TASKS).title).toBe('');
  });

  it('EDGE-9: tasksById 传普通对象也能查（不只支持 Map）', () => {
    const { title } = app.formatEventEntry(
      { reason: 'task:#42', created_at: localUnix(2026, 7, 21, 9, 5) },
      { 42: '洗澡' } as unknown as Map<number, string>,
    );
    expect(title).toBe('洗澡');
  });
});

// ============================================================
// Pure function: formatEventTime
// ============================================================
describe('formatEventTime — unix 秒 → MM-DD HH:MM', () => {
  it('格式为 MM-DD HH:MM（月/日/时/分均补零）', () => {
    expect(app.formatEventTime(localUnix(2026, 7, 21, 9, 5))).toBe('07-21 09:05');
    expect(app.formatEventTime(localUnix(2026, 12, 1, 0, 0))).toBe('12-01 00:00');
    expect(app.formatEventTime(localUnix(2026, 1, 9, 23, 59))).toBe('01-09 23:59');
  });

  it('午夜是 00:00（不是 24:00）', () => {
    expect(app.formatEventTime(localUnix(2026, 3, 15, 0, 0))).toBe('03-15 00:00');
  });

  it('按本地时区渲染，不做 UTC 偏移', () => {
    const ts = localUnix(2026, 7, 21, 9, 5);
    const d = new Date(ts * 1000);
    // 期望值直接从本地 Date 组件推导 —— 换时区跑测试同样成立
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(app.formatEventTime(ts)).toBe(
      `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  });

  it('非法输入 → 空串', () => {
    expect(app.formatEventTime(0)).toBe('');
    expect(app.formatEventTime(null)).toBe('');
    expect(app.formatEventTime(undefined)).toBe('');
    expect(app.formatEventTime('abc')).toBe('');
    expect(app.formatEventTime(NaN)).toBe('');
  });
});

// ============================================================
// Pure function: id 解析 helper
// ============================================================
describe('task id 解析 helper', () => {
  it('extractTaskIdFromReason 认得 task:#N 和 revoke:task:#N', () => {
    expect(app.extractTaskIdFromReason('task:#42')).toBe(42);
    expect(app.extractTaskIdFromReason('revoke:task:#42')).toBe(42);
  });

  it('extractTaskIdFromReason 对非 task reason 返回 null', () => {
    expect(app.extractTaskIdFromReason('bonus:2026-07-21:2')).toBeNull();
    expect(app.extractTaskIdFromReason('跑步打卡积分')).toBeNull();
    expect(app.extractTaskIdFromReason('exchange: -10 for 玩具枪')).toBeNull();
    expect(app.extractTaskIdFromReason('')).toBeNull();
    expect(app.extractTaskIdFromReason(null)).toBeNull();
    expect(app.extractTaskIdFromReason(undefined)).toBeNull();
  });

  it('extractTaskIdFromSourceRef 只认 task: / revoke:task: 前缀', () => {
    expect(app.extractTaskIdFromSourceRef('task:42:2026-07-21:2')).toBe(42);
    expect(app.extractTaskIdFromSourceRef('revoke:task:42:2026-07-21:2')).toBe(42);
    expect(app.extractTaskIdFromSourceRef('bonus:2026-07-21:2')).toBeNull();
    expect(app.extractTaskIdFromSourceRef('running:123:point:5')).toBeNull();
    expect(app.extractTaskIdFromSourceRef('mytask:42:2026-07-21:2')).toBeNull();
    expect(app.extractTaskIdFromSourceRef(null)).toBeNull();
  });

  it('resolveEventTaskId 优先 reason，其次 source_ref', () => {
    expect(app.resolveEventTaskId({ reason: 'task:#7', source_ref: 'task:42:2026-07-21:2' })).toBe(7);
    expect(app.resolveEventTaskId({ reason: 'bonus:x', source_ref: 'task:42:2026-07-21:2' })).toBe(42);
    expect(app.resolveEventTaskId({ reason: 'bonus:x', source_ref: 'bonus:x' })).toBeNull();
    expect(app.resolveEventTaskId(null)).toBeNull();
  });
});

// ============================================================
// Pure function: buildTasksById / lookupTaskName
// ============================================================
describe('buildTasksById / lookupTaskName', () => {
  it('buildTasksById 把 state.tasks 转成 id → name 映射', () => {
    const map = app.buildTasksById([
      { id: 42, name: '洗澡' },
      { id: 7, name: '刷牙' },
    ]);
    expect(map.get(42)).toBe('洗澡');
    expect(map.get(7)).toBe('刷牙');
  });

  it('buildTasksById 跳过缺 name / 缺 id 的行，对非法输入返回空 Map', () => {
    const map = app.buildTasksById([
      { id: 1, name: '' },
      { id: null, name: '孤儿' },
      null,
      'nope',
    ]);
    expect(map.size).toBe(0);
    expect(app.buildTasksById(null).size).toBe(0);
    expect(app.buildTasksById(undefined).size).toBe(0);
  });

  it('lookupTaskName 支持 Map 与普通对象，查不到返回 null', () => {
    expect(app.lookupTaskName(new Map([[1, 'a']]), 1)).toBe('a');
    expect(app.lookupTaskName(new Map([[1, 'a']]), 2)).toBeNull();
    expect(app.lookupTaskName({ 1: 'a' } as unknown as Map<number, string>, 1)).toBe('a');
    expect(app.lookupTaskName(null, 1)).toBeNull();
  });
});

// ============================================================
// renderEvents() 接线 — 真 DOM（happy-dom）
// ============================================================
describe('renderEvents() — 操作日志渲染接线', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <span id="event-count">0</span>
      <div id="event-list" class="event-list"></div>
      <div id="event-empty" class="empty" hidden></div>
    `;
  });

  function render(tasks: unknown[], events: unknown[]): void {
    const a = loadApp('renderEvents, state') as {
      renderEvents: () => void;
      state: Record<string, unknown>;
    };
    (a.state.tasks as unknown) = tasks;
    (a.state.events as unknown) = events;
    a.renderEvents();
  }

  it('WIRE-1: 任务事件渲染出任务名 + 时间戳（不再显示裸 id）', () => {
    render(
      [{ id: 42, name: '洗澡' }],
      [{
        id: 1, type: 'coins', change_value: 1, reason: 'task:#42',
        source_ref: 'task:42:2026-07-21:2', status: 'approved',
        created_at: localUnix(2026, 7, 21, 9, 5),
      }],
    );
    const item = document.querySelector('#event-list .event-item')!;
    expect(item).not.toBeNull();
    const reason = item.querySelector('.event-reason')!.textContent;
    expect(reason).toBe('洗澡');
    expect(reason).not.toContain('#42');
    const time = item.querySelector('.event-time')!.textContent;
    expect(time).toBe('07-21 09:05');
    // 计数同步（非空列表 → '1'）。
    expect(document.querySelector('#event-count')!.textContent).toBe('1');
  });

  it('WIRE-2: 任务已删 → 渲染「任务 #id」而不是空标题', () => {
    render(
      [{ id: 42, name: '洗澡' }],
      [{
        id: 1, type: 'coins', change_value: 1, reason: 'task:#999',
        source_ref: 'task:999:2026-07-21:2', status: 'approved',
        created_at: localUnix(2026, 7, 21, 9, 5),
      }],
    );
    expect(document.querySelector('#event-list .event-reason')!.textContent).toBe('任务 #999');
  });

  it('WIRE-3: 非任务事件文案不变（bonus:… 原样）+ 仍有时间戳', () => {
    render(
      [],
      [{
        id: 2, type: 'coins', change_value: 3, reason: 'bonus:2026-07-21:2',
        source_ref: 'bonus:2026-07-21:2', status: 'approved',
        created_at: localUnix(2026, 7, 21, 20, 0),
      }],
    );
    expect(document.querySelector('#event-list .event-reason')!.textContent).toBe('bonus:2026-07-21:2');
    expect(document.querySelector('#event-list .event-time')!.textContent).toBe('07-21 20:00');
  });

  it('WIRE-4: created_at 缺失 → 不渲染 .event-time 节点', () => {
    render(
      [],
      [{
        id: 3, type: 'pocket_money', change_value: 5, reason: '手工申请',
        source_ref: null, status: 'pending',
      }],
    );
    expect(document.querySelector('#event-list .event-time')).toBeNull();
    expect(document.querySelector('#event-list .event-reason')!.textContent).toBe('手工申请');
  });

  it('WIRE-5: 任务名走 escapeHtml —— XSS 不被执行', () => {
    render(
      [{ id: 42, name: '<script>alert(1)</script>' }],
      [{
        id: 4, type: 'coins', change_value: 1, reason: 'task:#42',
        source_ref: 'task:42:2026-07-21:2', status: 'approved',
        created_at: localUnix(2026, 7, 21, 9, 5),
      }],
    );
    const item = document.querySelector('#event-list .event-item')!;
    expect(item.querySelectorAll('script')).toHaveLength(0);
    expect(item.querySelector('.event-reason')!.textContent).toBe('<script>alert(1)</script>');
  });

  it('WIRE-6: 空列表 → 走 empty 分支，不渲染任何 item', () => {
    render([], []);
    expect(document.querySelectorAll('#event-list .event-item')).toHaveLength(0);
    expect(document.querySelector('#event-empty')!.hasAttribute('hidden')).toBe(false);
    // 注：#event-count 写的是数字 0。happy-dom 的 textContent setter 用
    // 真值判断（`if (textContent)`），会丢弃 0 —— 这是 happy-dom 与 DOM 规范的
    // 偏差（浏览器会强制转成 "0"），与本次改动无关。真实浏览器下的断言在
    // tests/e2e/ui-child-events.spec.ts（SMOKE: #event-count === '0'）。
    // 这里只断言「不渲染 item」，不去断言 happy-dom 的 0 渲染行为。
  });
});

// ============================================================
// CSS 契约
// ============================================================
describe('app.css — .event-time 样式', () => {
  it('定义了 .event-time 规则（mono 小字、muted 色）', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.event-time\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
    expect(css).toMatch(/\.event-time\s*\{[^}]*color:\s*var\(--text-muted\)/);
  });
});
