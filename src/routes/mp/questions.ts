// src/routes/mp/questions.ts
// Phase 1 Day 3 (mecha-challenge-phase1) — Miniprogram question API
//
// Endpoints:
//   GET  /api/mp/questions/random?difficulty=N  — 随机抽题，不返回 answer_index
//   POST /api/mp/questions/attempt               — 答题，写入 question_attempts
//
// Types imported from packages/shared/src/question.ts (Day 1 established).
// isCorrect() helper from packages/shared/src/question.ts used for scoring.

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import {
  isCorrect,
  isValidOption,
  parseOptionsJson,
  type QuestionDifficulty,
  type QuestionOption,
} from 'mecha-challenge-shared';

const mpQuestions = new Hono<{ Bindings: Env }>();

// ---------------- GET /random?difficulty=N ----------------

mpQuestions.get('/random', async (c) => {
  const difficultyRaw = c.req.query('difficulty');

  // Validate difficulty param (optional; undefined = any difficulty).
  if (difficultyRaw !== undefined) {
    const validDifficulties: QuestionDifficulty[] = ['easy', 'medium', 'hard'];
    if (!validDifficulties.includes(difficultyRaw as QuestionDifficulty)) {
      return c.json(
        {
          error: {
            code: 'INVALID_DIFFICULTY',
            message: "difficulty must be one of: easy, medium, hard",
          },
        },
        400,
      );
    }
  }

  const db = c.env.DB;

  // Step 1: count total eligible questions.
  const countSql = difficultyRaw
    ? `SELECT COUNT(*) as cnt FROM questions WHERE difficulty = ?`
    : `SELECT COUNT(*) as cnt FROM questions`;
  const countStmt = db.prepare(countSql);
  const countResult = difficultyRaw
    ? await countStmt.bind(difficultyRaw).first<{ cnt: number }>()
    : await countStmt.first<{ cnt: number }>();

  const total = countResult?.cnt ?? 0;
  if (total === 0) {
    return c.json({ id: null, stem: '', options: [], difficulty: difficultyRaw ?? 'medium' }, 200);
  }

  // Step 2: random offset sampling — avoid ORDER BY RANDOM() performance issue.
  // Compute random offset in application code (avoids RANDOM() * COUNT SQL complexity).
  // Use LIMIT 1 OFFSET N — N is 0-indexed row offset.
  const randomOffset = Math.floor(Math.random() * total);

  const selectSql = difficultyRaw
    ? `SELECT id, stem, options_json, difficulty, answer_index
       FROM questions
       WHERE difficulty = ?
       LIMIT 1 OFFSET ?`
    : `SELECT id, stem, options_json, difficulty, answer_index
       FROM questions
       LIMIT 1 OFFSET ?`;

  const selectStmt = db.prepare(selectSql);
  const row = difficultyRaw
    ? await selectStmt.bind(difficultyRaw, randomOffset).first<{
        id: number;
        stem: string;
        options_json: string;
        difficulty: QuestionDifficulty;
        answer_index: number;
      }>()
    : await selectStmt.bind(randomOffset).first<{
        id: number;
        stem: string;
        options_json: string;
        difficulty: QuestionDifficulty;
        answer_index: number;
      }>();

  if (!row) {
    return c.json({ id: null, stem: '', options: [], difficulty: difficultyRaw ?? 'medium' }, 200);
  }

  // Parse options but DO NOT include answer_index (anti-cheat).
  let options: QuestionOption[];
  try {
    options = parseOptionsJson(row.options_json);
  } catch {
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'failed to parse question options' } },
      500,
    );
  }

  return c.json(
    {
      id: row.id,
      stem: row.stem,
      options,
      difficulty: row.difficulty,
    },
    200,
  );
});

// ---------------- POST /attempt ----------------

interface AttemptBody {
  questionId?: unknown;
  selectedIndex?: unknown;
  childId?: unknown;
}

mpQuestions.post('/attempt', async (c) => {
  const body = (await c.req.json().catch(() => null)) as AttemptBody | null;

  if (!body || typeof body !== 'object') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'request body must be a JSON object' } },
      400,
    );
  }

  // Validate questionId: required, positive integer.
  const questionId = body.questionId;
  if (typeof questionId !== 'number' || !Number.isInteger(questionId) || questionId <= 0) {
    return c.json(
      { error: { code: 'INVALID_QUESTION_ID', message: 'questionId must be a positive integer' } },
      400,
    );
  }

  // Validate selectedIndex: required, must be 0-3.
  const selectedIndex = body.selectedIndex;
  if (!isValidOption(selectedIndex as number)) {
    return c.json(
      {
        error: {
          code: 'INVALID_SELECTED_INDEX',
          message: 'selectedIndex must be an integer between 0 and 3',
        },
      },
      400,
    );
  }

  // Validate childId: required, positive integer.
  const childId = body.childId;
  if (typeof childId !== 'number' || !Number.isInteger(childId) || childId <= 0) {
    return c.json(
      { error: { code: 'INVALID_CHILD_ID', message: 'childId must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;
  const nowSec = Math.floor(Date.now() / 1000);

  // Step 1: fetch the question to get answer_index (server-side scoring).
  const qRow = await db
    .prepare(`SELECT id, answer_index FROM questions WHERE id = ?`)
    .bind(questionId)
    .first<{ id: number; answer_index: number }>();

  if (!qRow) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'question not found' } },
      404,
    );
  }

  // Step 2: compute isCorrect using the shared helper.
  const isCorrectResult = isCorrect(
    { id: qRow.id, answerIndex: qRow.answer_index } as Parameters<typeof isCorrect>[0],
    selectedIndex as number,
  );

  // Step 3: write attempt to question_attempts table.
  // Phase 1: no cross-user/family validation (M5 will add child auth).
  const insertResult = await db
    .prepare(
      `INSERT INTO question_attempts (user_id, question_id, selected_index, is_correct, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(childId, questionId, selectedIndex, isCorrectResult ? 1 : 0, nowSec)
    .run();

  if (!insertResult.success) {
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'failed to record attempt' } },
      500,
    );
  }

  return c.json(
    {
      isCorrect: isCorrectResult,
      correctIndex: qRow.answer_index,
    },
    200,
  );
});

export default mpQuestions;
