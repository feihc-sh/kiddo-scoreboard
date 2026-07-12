-- =============================================================
-- Item #016 §5 (2026-07-12 feihao): per-subitem勾选持久化
-- 用户原话: "我还是要知道他具体打了哪几项的" — 当前 modal 里
-- 6 个 checkbox 的状态被丢弃, task_completions 只产生 1 行
-- "今日打卡"。这张表把 6 个子项的勾选状态持久化下来,
-- 让 admin 能做 "dot matrix" 看哪些 item 经常没打 / 长期没勾。
--
-- 设计原则:
--   * subitem_id 用 TEXT (hardcoded 6 个, app.js:59-66),
--     不走新建 tasks 子表 (没必要, 开学后整个 feature 下线)
--   * checked: 1=打了, 0=当天 modal 打开了但该项没勾
--     (跟 task_completions.status='revoked' 区别:
--      revoked=整笔被撤销, subitem.checked=0=当天该项没勾)
--   * 每个 completion 行对应 ≤ 6 行 subitem, UNIQUE 防止重复
--   * admin 总计行 = SUM(checked) GROUP BY subitem_id, UI 层算
-- =============================================================
CREATE TABLE IF NOT EXISTS summer_homework_subitems (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  task_completion_id  INTEGER NOT NULL,
  subitem_id          TEXT NOT NULL CHECK(subitem_id IN (
                        'chinese',         -- 📝 语文词语
                        'math-school',     -- 🔢 数学 (校内)
                        'english-vocab',   -- 📖 英语单词
                        'english-reading', -- 📚 英语绘本
                        'math-extra',      -- 🧮 数学举一反三
                        'english-class'    -- 🗓️ 英语外教课
                      )),
  checked             INTEGER NOT NULL DEFAULT 1 CHECK(checked IN (0, 1)),
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(task_completion_id, subitem_id),
  FOREIGN KEY (task_completion_id) REFERENCES task_completions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subitems_completion ON summer_homework_subitems(task_completion_id);
-- Admin dot-matrix query pattern: WHERE subitem_id=? GROUP BY date, so index on subitem_id alone.
CREATE INDEX IF NOT EXISTS idx_subitems_subitem ON summer_homework_subitems(subitem_id);