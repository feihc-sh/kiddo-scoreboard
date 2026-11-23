// tests/unit/achievement-admin-panel.test.ts
// Card 3 (成就系统 admin 发放面板) 单测。
//
// 覆盖两层:
//   1. /shared/achievement-tiers.js —— 牌级规则的**单一事实源**。
//      admin 面板的下拉选项由它生成; 后端 (src/routes/admin/
//      achievement-awards.ts) 会拒绝非法组合, 所以这里测的是
//      「面板永远不会给 PM 选出一个后端会 400 的组合」。
//   2. admin.js 的接线 —— 静态断言 (与 admin-toggle-ui.test.ts 同风格):
//      面板元素存在、action 已接上、API 路径正确、撤销 confirm 门在。
//
// 不用 happy-dom 跑整个 admin.js (它是 classic script, 不导模块);
// 这里沿用仓库既有的「读源码 + 断言契约」风格 (admin-toggle-ui.test.ts)。

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

const TIERS_PATH = path.join(__dirname, '..', '..', 'public', 'shared', 'achievement-tiers.js');
const JS_PATH = path.join(__dirname, '..', '..', 'public', 'admin', 'admin.js');
const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'admin', 'index.html');
const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'app.css');

interface TierOption { value: string; label: string }
interface TierRules {
  TIER_ORDER: string[];
  TIER_LABELS: Record<string, string>;
  GROUP_LABELS: Record<string, string>;
  tierOptionsFor: (a: unknown) => TierOption[];
  tierLabel: (t: string) => string;
}

/** 加载 shared 脚本 (classic IIFE, 挂 window.*) —— 同 emoji-presets.test.ts。 */
function loadTierRules(): TierRules {
  const src = fs.readFileSync(TIERS_PATH, 'utf8');
  const sandbox: Record<string, unknown> = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return (sandbox.window as Record<string, unknown>).ACHIEVEMENT_TIERS as TierRules;
}

// 8 个 seed 奖项 (migrations/0021_achievements.sql) —— 前 5 个够测规则。
const TIER_ACH = {
  id: 1, grp: 'study', name: '语文默写全对', grant_mode: 'admin_tier',
  ladder: { iron: 1, bronze: 3, silver: 5, gold: 8, king: 10 },
};
const FLAT_ACH = {
  id: 5, grp: 'life', name: '创新家务奖', grant_mode: 'admin_flat', ladder: {},
};
const STREAK_ACH = {
  id: 4, grp: 'life', name: '自律生活', grant_mode: 'auto_streak',
  ladder: { iron: 2, bronze: 4, silver: 8, gold: 15, king: 30 },
};

// ---------------------------------------------------------------------------
// 1. 牌级规则 (单一事实源)
// ---------------------------------------------------------------------------
describe('shared/achievement-tiers.js — 牌级规则', () => {
  it('exposes the 5 tiers in ascending order (铁→铜→银→金→王者)', () => {
    expect(loadTierRules().TIER_ORDER).toEqual(['iron', 'bronze', 'silver', 'gold', 'king']);
  });

  it('admin_flat award offers exactly ONE option: 平发 (no medal tiers)', () => {
    const opts = loadTierRules().tierOptionsFor(FLAT_ACH);
    expect(opts).toHaveLength(1);
    expect(opts[0].value).toBe('flat');
    expect(opts[0].label).toBe('平发');
  });

  it('admin_tier award offers the 5 tiers and NEVER flat', () => {
    const opts = loadTierRules().tierOptionsFor(TIER_ACH);
    expect(opts.map((o) => o.value)).toEqual(['iron', 'bronze', 'silver', 'gold', 'king']);
    expect(opts.some((o) => o.value === 'flat')).toBe(false);
  });

  it('auto_streak award offers the 5 tiers and NEVER flat', () => {
    const opts = loadTierRules().tierOptionsFor(STREAK_ACH);
    expect(opts.map((o) => o.value)).toEqual(['iron', 'bronze', 'silver', 'gold', 'king']);
    expect(opts.some((o) => o.value === 'flat')).toBe(false);
  });

  it('the tier label carries the ladder hint (累计 N 次) for tier awards', () => {
    const opts = loadTierRules().tierOptionsFor(TIER_ACH);
    expect(opts[0].label).toBe('铁牌 (累计 1 次)');
    expect(opts[1].label).toBe('铜牌 (累计 3 次)');
    expect(opts[4].label).toBe('王者 (累计 10 次)');
  });

  it('the streak award uses 天 as the ladder unit (not 次)', () => {
    const opts = loadTierRules().tierOptionsFor(STREAK_ACH);
    expect(opts[0].label).toBe('铁牌 (累计 2 天)');
    expect(opts[4].label).toBe('王者 (累计 30 天)');
  });

  it('only the tiers present in the ladder are offered', () => {
    const partial = {
      id: 99, grp: 'study', name: '部分档位', grant_mode: 'admin_tier',
      ladder: { bronze: 3, gold: 8 },
    };
    const opts = loadTierRules().tierOptionsFor(partial);
    expect(opts.map((o) => o.value)).toEqual(['bronze', 'gold']);
  });

  it('an award with no ladder falls back to all 5 tiers (backend also allows it)', () => {
    const noLadder = { id: 98, grp: 'study', name: '无阶梯', grant_mode: 'admin_tier', ladder: {} };
    const opts = loadTierRules().tierOptionsFor(noLadder);
    expect(opts.map((o) => o.value)).toEqual(['iron', 'bronze', 'silver', 'gold', 'king']);
    // No ladder → no hint suffix.
    expect(opts[0].label).toBe('铁牌');
  });

  it('returns no options for a missing achievement (nothing to grant)', () => {
    expect(loadTierRules().tierOptionsFor(null)).toEqual([]);
    expect(loadTierRules().tierOptionsFor(undefined)).toEqual([]);
  });

  it('tierLabel maps the 5 tiers + flat to Chinese labels', () => {
    const r = loadTierRules();
    expect(r.tierLabel('iron')).toBe('铁牌');
    expect(r.tierLabel('king')).toBe('王者');
    expect(r.tierLabel('flat')).toBe('平发');
    // Unknown tier → returned verbatim (no guessing).
    expect(r.tierLabel('champion')).toBe('champion');
  });
});

// ---------------------------------------------------------------------------
// 2. admin.js 接线 (静态契约)
// ---------------------------------------------------------------------------
describe('admin.js 成就发放面板接线', () => {
  const js = fs.readFileSync(JS_PATH, 'utf8');
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  it('admin/index.html has the 🏅 成就发放 section', () => {
    expect(html).toContain('id="sec-achievements"');
    expect(html).toContain('🏅 成就发放');
  });

  it('admin/index.html loads the shared tier rules before admin.js', () => {
    const tiersIdx = html.indexOf('/shared/achievement-tiers.js');
    const adminIdx = html.indexOf('/admin/admin.js');
    expect(tiersIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeGreaterThan(-1);
    expect(tiersIdx).toBeLessThan(adminIdx);
  });

  it('the panel has the 4 form controls (award / tier / user_id / grant)', () => {
    expect(html).toContain('id="achievement-select"');
    expect(html).toContain('id="achievement-tier-select"');
    expect(html).toContain('name="user_id"');
    expect(html).toContain('id="achievement-grant-form"');
    expect(html).toContain('id="btn-grant-achievement"');
  });

  // ---------------------------------------------------------------------------
  // 完成详情 (spec §7c) —— 发放时可填「完成日期」+「完成内容」
  // ---------------------------------------------------------------------------
  it('the grant form has the optional 完成日期 + 完成内容 fields', () => {
    expect(html).toContain('name="completed_on"');
    expect(html).toContain('type="date"');
    expect(html).toContain('name="note"');
    // 完成内容有长度上限 (与后端的 100 字校验一致)。
    expect(html).toContain('maxlength="100"');
  });

  it('the grant submits completed_on and note to the API', () => {
    const fn = js.slice(js.indexOf('async function submitAchievementGrant'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("form.elements['completed_on']");
    expect(body).toContain("form.elements['note']");
    expect(body).toContain('body.completed_on = completedOn');
    expect(body).toContain('body.note = note');
  });

  it('the grant only sends the optional fields when they are filled (空串不传)', () => {
    const fn = js.slice(js.indexOf('async function submitAchievementGrant'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // 条件发送 —— 否则空串会被后端当成「填了但为空」。
    expect(body).toContain('if (completedOn) body.completed_on = completedOn;');
    expect(body).toContain('if (note) body.note = note;');
  });

  it('the grant clears the 完成详情 fields after a successful grant', () => {
    const fn = js.slice(js.indexOf('async function submitAchievementGrant'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // 下一次发放不该带着上一次的日期/内容 (容易误记)。
    expect(body).toContain("form.elements['completed_on'].value = ''");
    expect(body).toContain("form.elements['note'].value = ''");
  });

  it('the 完成日期 field defaults to today on boot', () => {
    expect(js).toContain('prefillGrantCompletedOn');
    const fn = js.slice(js.indexOf('function prefillGrantCompletedOn'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('completed_on');
    expect(body).toContain('todayIsoLocal()');
  });

  it('the grant log escapes and renders the 完成详情 (note)', () => {
    const fn = js.slice(js.indexOf('function renderAchievementAwards'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('a.completed_on');
    expect(body).toContain('a.note');
    // 动态文本必须过 escapeHtml (XSS)。
    expect(body).toContain('escapeHtml(a.note)');
  });

  it('the grant form posts to /api/admin/achievement-awards', () => {
    expect(js).toContain("'/api/admin/achievement-awards'");
    expect(js).toContain('submitAchievementGrant');
  });

  it('the revoke action posts to /api/admin/achievement-awards/revoke with confirm:true', () => {
    expect(js).toContain("'/api/admin/achievement-awards/revoke'");
    expect(js).toContain('confirm: true');
    expect(js).toContain('revokeAchievementAward');
    // The destructive action must be wired into the delegated handler.
    expect(js).toContain("data-act=\"revoke-achievement\"");
  });

  it('the revoke action is guarded by a window.confirm 二次确认', () => {
    const fn = js.slice(js.indexOf('async function revokeAchievementAward'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('window.confirm');
    // The confirm copy must mention the token burn (烧回) — the PM needs to
    // know this destroys the minted 🌟, not just hides a row.
    expect(body).toContain('烧回');
  });

  it('the grant log loads with status=all by default (审计面不隐藏历史)', () => {
    expect(js).toContain("achievementFilter: 'all'");
    expect(js).toContain('/api/admin/achievement-awards?status=');
  });

  it('the status filter offers 全部 / 已发放 / 已撤销', () => {
    expect(html).toContain('id="filter-achievement-status"');
    expect(html).toContain('<option value="all">全部</option>');
    expect(html).toContain('<option value="active">已发放</option>');
    expect(html).toContain('<option value="revoked">已撤销</option>');
  });

  it('switching the award recomputes the tier options (no stale value)', () => {
    expect(js).toContain("'#achievement-select').addEventListener('change'");
    expect(js).toContain('renderTierSelect');
  });

  it('the revoke button only renders on active rows', () => {
    const fn = js.slice(js.indexOf('function renderAchievementAwards'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("const isRevoked = a.status === 'revoked'");
    // The button is inside a `!isRevoked ? ... : ''` ternary.
    expect(body).toMatch(/!isRevoked[\s\S]*revoke-achievement/);
  });

  it('the award log escapes dynamic text before inserting HTML', () => {
    const fn = js.slice(js.indexOf('function renderAchievementAwards'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('escapeHtml(achievementName(a.achievement_id))');
    expect(body).toContain('escapeHtml(tier)');
  });

  it('the panel badges do NOT reuse the score_event status classes', () => {
    // .pm-badge.pending|approved|rejected|revoked 是 score_event 状态的专属
    // 语义 —— 别的 spec 会用全局选择器数它们 (ui-admin-all-events.spec.ts
    // 数 '.pm-row .pm-badge.approved' == 1)。成就牌是另一个维度, 必须用
    // 自己的 class, 否则面板一行就把那个计数顶成 2。
    const fn = js.slice(js.indexOf('function renderAchievementAwards'));
    const awardsBody = fn.slice(0, fn.indexOf('\n}'));
    expect(awardsBody).toContain('ach-active');
    expect(awardsBody).toContain('ach-revoked');
    expect(awardsBody).not.toMatch(/pm-badge ' \+ \(isRevoked \? 'revoked' : 'approved'\)/);

    const seasonFn = js.slice(js.indexOf('function renderSeasons'));
    const seasonBody = seasonFn.slice(0, seasonFn.indexOf('\n}'));
    expect(seasonBody).toContain('ach-current');
    expect(seasonBody).toContain('ach-archived');
  });

  it('app.css defines the achievement badge classes', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.pm-badge\.ach-active\s*\{/);
    expect(css).toMatch(/\.pm-badge\.ach-revoked\s*\{/);
    expect(css).toMatch(/\.pm-badge\.ach-current\s*\{/);
    expect(css).toMatch(/\.pm-badge\.ach-archived\s*\{/);
  });

  it('the season panel loads /api/admin/seasons and creates via POST', () => {
    expect(js).toContain("'/api/admin/seasons'");
    expect(js).toContain('submitAchievementSeason');
    expect(html).toContain('id="achievement-season-form"');
    expect(html).toContain('id="achievement-current-season"');
  });

  it('the streak re-eval button calls /api/admin/achievements/eval-streak', () => {
    expect(js).toContain("'/api/admin/achievements/eval-streak'");
    expect(js).toContain('evalAchievementStreak');
    expect(html).toContain('id="btn-eval-streak"');
  });

  it('the season wall link carries the season_id query param', () => {
    expect(js).toContain('achievements.html?season_id=');
  });
});
