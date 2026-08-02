-- Phase 0 (mecha-challenge) — 新增 questions 表（四选一题型）
-- =========================================================================
-- questions: 题目表（4 选 1）
-- 复用 kiddo 现有 ECDict 资产路径（PRD-V1 §三 拍板 5B）
-- =========================================================================

CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- stem: 题目干（英文单词或词组）
  stem          TEXT NOT NULL,
  -- options_json: 4 个选项 JSON 数组，每项 { text: string }
  -- 格式示例: [{"text":"苹果"},{"text":"香蕉"},{"text":"橘子"},{"text":"葡萄"}]
  options_json  TEXT NOT NULL,
  -- answer_index: 正确答案下标 0-3（对应 options_json 数组顺序）
  answer_index  INTEGER NOT NULL CHECK(answer_index BETWEEN 0 AND 3),
  -- difficulty: 难度等级（与 kiddo 现有 difficulty 量表对齐）
  difficulty    TEXT NOT NULL DEFAULT 'medium' CHECK(difficulty IN ('easy', 'medium', 'hard')),
  -- ecdict_ref: ECDict 词库 ID 引用（可选，方便题库关联）
  ecdict_ref    TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
