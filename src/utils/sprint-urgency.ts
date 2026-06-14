// src/utils/sprint-urgency.ts
// Item #010 — Sprint modal countdown urgency 分级 (pure logic, testable)
//
// 分级阈值 (与 docs/NIGHTLY-TODO.md § Item #010 第 3 段 一致):
//   diff > 3600 sec  (1h+)    → "ok"       (灰)
//   diff ≤ 3600 sec  (1h)     → "warning"  (黄 #FFB800)
//   diff ≤ 600  sec  (10min)  → "danger"   (橙)
//   diff ≤ 60   sec  (1min)   → "critical" (红 + pulse)
//
// 已过期 (diff <= 0) 视为 "critical" — 弹窗打开时已是 locked-out 状态,
// 但函数本身不依赖业务, 只接收数字返回字符串, 方便纯函数测试.

export type SprintUrgency = 'ok' | 'warning' | 'danger' | 'critical';

export const SPRINT_URGENCY_THRESHOLDS = {
  warning: 3600,
  danger: 600,
  critical: 60,
} as const;

export function getSprintUrgency(diffSec: number): SprintUrgency {
  // 负数 (已过期) 也算 critical — 防止调用方传错值导致颜色不更新
  if (diffSec <= SPRINT_URGENCY_THRESHOLDS.critical) return 'critical';
  if (diffSec <= SPRINT_URGENCY_THRESHOLDS.danger) return 'danger';
  if (diffSec <= SPRINT_URGENCY_THRESHOLDS.warning) return 'warning';
  return 'ok';
}
