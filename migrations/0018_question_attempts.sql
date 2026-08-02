-- Phase 0 (mecha-challenge) — 新增 question_attempts 表（答题流水）
-- =========================================================================
-- question_attempts: 每道题的答题记录
-- 用于自动判分 + 历史记录 + 统计
-- =========================================================================

CREATE TABLE IF NOT EXISTS question_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  question_id   INTEGER NOT NULL,
  -- selected_index: 用户选择的下标 0-3（对应 questions.options_json）
  selected_index INTEGER NOT NULL CHECK(selected_index BETWEEN 0 AND 3),
  -- is_correct: 是否答对（由 answer_index 比对计算，不存原始答案避免泄露）
  is_correct    INTEGER NOT NULL CHECK(is_correct IN (0, 1)),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id)     REFERENCES users(id),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_user     ON question_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_question ON question_attempts(question_id);
