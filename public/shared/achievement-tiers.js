// public/shared/achievement-tiers.js
// 成就牌级 (medal tier) 规则 —— admin 发放面板的唯一事实源。
//
// 加载方式跟 /shared/emoji-presets.js 一样: classic <script> + window 全局。
// 这样 admin 面板和单测读的是**同一份**规则, 面板下拉不会跟后端
// (src/routes/admin/achievement-awards.ts) 的校验规则漂移 —— 否则 PM 会
// 选到后端必然 400 的组合 (e.g. 给平发奖选「金牌」)。
//
// 后端强制的规则 (spec docs/achievements-spec.md §2 / §7):
//   grant_mode = 'admin_flat'  → tier 必须是 'flat' (平发奖, 无等级阶梯)
//   grant_mode = 'admin_tier'  → tier 必须是五档之一, 且在该奖项的 ladder 里
//   grant_mode = 'auto_streak' → tier 必须是五档之一 (admin 可手动补发)
//   ladder 的值是"累计次数提示" (次数档 1/3/5/8/10); auto_streak 的 ladder
//   是天数档 (2/4/8/15/30) —— 所以提示单位不同。

(function () {
  'use strict';

  // 五档牌级 (铁 → 铜 → 银 → 金 → 王者) —— 与 src/utils/achievements.ts TIER_ORDER 一致。
  const TIER_ORDER = ['iron', 'bronze', 'silver', 'gold', 'king'];

  // 牌级显示名。admin 下拉用「铁牌」这种全称 (奖牌本体刻字在 medals.js 里是「铁」)。
  const TIER_LABELS = {
    iron: '铁牌',
    bronze: '铜牌',
    silver: '银牌',
    gold: '金牌',
    king: '王者',
    flat: '平发',
  };

  // 奖项分组显示名 (spec §1 三组)。
  const GROUP_LABELS = {
    study: '学习组',
    life: '生活组',
    skill: '技能组',
  };

  /** ladder 的值用什么单位提示: 天数档用「天」, 次数/本数档用「次」。 */
  function ladderUnit(achievement) {
    return achievement && achievement.grant_mode === 'auto_streak' ? '天' : '次';
  }

  /**
   * 某个奖项允许发放的牌级选项。
   *
   * 返回 [{ value: tier, label: '铁牌 (累计 1 次)' }, ...], 按 TIER_ORDER 升序。
   * - admin_flat → 只有 flat (平发, 无等级阶梯)
   * - 其他 → ladder 里存在的档位; ladder 缺失/为空时退回全五档 (后端也放行)
   */
  function tierOptionsFor(achievement) {
    if (!achievement) return [];
    if (achievement.grant_mode === 'admin_flat') {
      return [{ value: 'flat', label: TIER_LABELS.flat }];
    }
    const ladder =
      achievement.ladder && typeof achievement.ladder === 'object' ? achievement.ladder : {};
    const keys = Object.keys(ladder);
    const unit = ladderUnit(achievement);
    const tiers =
      keys.length > 0
        ? TIER_ORDER.filter((t) => typeof ladder[t] === 'number')
        : TIER_ORDER.slice();
    return tiers.map((t) => {
      const hint = keys.length > 0 ? ` (累计 ${ladder[t]} ${unit})` : '';
      return { value: t, label: TIER_LABELS[t] + hint };
    });
  }

  /** 牌级显示名 (发放日志行用)。未知牌级原样返回, 不猜。 */
  function tierLabel(tier) {
    return TIER_LABELS[tier] || String(tier || '');
  }

  window.ACHIEVEMENT_TIERS = {
    TIER_ORDER,
    TIER_LABELS,
    GROUP_LABELS,
    tierOptionsFor,
    tierLabel,
    ladderUnit,
  };
})();
