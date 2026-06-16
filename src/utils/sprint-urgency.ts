// src/utils/sprint-urgency.ts
// Item #010 — Sprint modal countdown urgency 分级纯函数
// 被 public/app.js (前端倒计时) + tests/unit/sprint-urgency.test.ts 引用.
// 阈值与第 1 段/第 3 段 Action Plan 一致:
//   diff > 3600  → "ok"       (默认灰)
//   diff ≤ 3600  → "warning"  (黄, 1h 内)
//   diff ≤ 600   → "danger"   (橙, 10min 内)
//   diff ≤ 60    → "critical" (红 + pulse, 1min 内)
//   diff ≤ 0     → "critical" (已过期, 防调用方传错值)

export const SPRINT_URGENCY_THRESHOLDS = {
  warning: 3600,  // 1h
  danger: 600,    // 10min
  critical: 60,   // 1min
} as const;

export type SprintUrgency = 'ok' | 'warning' | 'danger' | 'critical';

/**
 * 根据剩余秒数 (diffSec) 返回紧迫度等级.
 * @param diffSec 剩余秒数, 已过期传 0 或负数都视为 critical.
 */
export function getSprintUrgency(diffSec: number): SprintUrgency {
  if (diffSec <= SPRINT_URGENCY_THRESHOLDS.critical) return 'critical';
  if (diffSec <= SPRINT_URGENCY_THRESHOLDS.danger) return 'danger';
  if (diffSec <= SPRINT_URGENCY_THRESHOLDS.warning) return 'warning';
  return 'ok';
}
