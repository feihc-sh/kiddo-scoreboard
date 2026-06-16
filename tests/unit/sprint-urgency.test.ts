// tests/unit/sprint-urgency.test.ts
// Item #010 — Sprint modal countdown urgency 纯函数测试
// 验证 getSprintUrgency 在所有边界值下的分级是否正确.
import { describe, it, expect } from 'vitest';
import { getSprintUrgency, SPRINT_URGENCY_THRESHOLDS } from '../../src/utils/sprint-urgency.ts';

describe('getSprintUrgency (Item #010 sprint modal)', () => {
  describe('边界值: 每个阈值上下各一个值', () => {
    it('critical: diff <= 60s', () => {
      expect(getSprintUrgency(60)).toBe('critical');
      expect(getSprintUrgency(30)).toBe('critical');
      expect(getSprintUrgency(1)).toBe('critical');
    });
    it('danger: 60s < diff <= 600s', () => {
      expect(getSprintUrgency(61)).toBe('danger');
      expect(getSprintUrgency(300)).toBe('danger');
      expect(getSprintUrgency(600)).toBe('danger');
    });
    it('warning: 600s < diff <= 3600s', () => {
      expect(getSprintUrgency(601)).toBe('warning');
      expect(getSprintUrgency(1800)).toBe('warning');
      expect(getSprintUrgency(3600)).toBe('warning');
    });
    it('ok: diff > 3600s', () => {
      expect(getSprintUrgency(3601)).toBe('ok');
      expect(getSprintUrgency(7200)).toBe('ok');   // 2h
      expect(getSprintUrgency(86400)).toBe('ok');  // 1 day
    });
  });

  describe('edge: 已过期 (负数)', () => {
    it('diff = 0 → critical', () => {
      expect(getSprintUrgency(0)).toBe('critical');
    });
    it('diff = -1 → critical (防止调用方传错值导致颜色不更新)', () => {
      expect(getSprintUrgency(-1)).toBe('critical');
    });
    it('diff = -3600 → critical', () => {
      expect(getSprintUrgency(-3600)).toBe('critical');
    });
  });

  describe('threshold 常量自检 (防止被无意改坏)', () => {
    it('warning > danger > critical (阈值单调递减)', () => {
      expect(SPRINT_URGENCY_THRESHOLDS.warning).toBeGreaterThan(SPRINT_URGENCY_THRESHOLDS.danger);
      expect(SPRINT_URGENCY_THRESHOLDS.danger).toBeGreaterThan(SPRINT_URGENCY_THRESHOLDS.critical);
    });
  });
});
