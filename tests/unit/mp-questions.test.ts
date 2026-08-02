// tests/unit/mp-questions.test.ts
// Phase 1 Day 3 (mecha-challenge-phase1) — Unit tests for miniprogram questions API
//
//   GET  /api/mp/questions/random?difficulty=N  — random 4-choice question
//   POST /api/mp/questions/attempt               — record attempt + return correctness
//
// D1 mock (in-memory) so tests run without real database.
// Shared helpers (isCorrect, isValidOption) from packages/shared/src/question.ts
// are verified via packages/shared/src/question.test.ts (already exists, Day 1).
//
// Test structure: Arrange-Act-Assert (AAA pattern).
// Coverage: happy paths, edge cases, anti-cheat (no answer_index in random response).

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';
import type { QuestionDifficulty } from '../../src/routes/mp/questions.ts';

// ============================================================
// In-memory fixture tables
// ============================================================

interface QuestionRow {
  id: number;
  stem: string;
  options_json: string;
  answer_index: number;
  difficulty: QuestionDifficulty;
  ecdict_ref: string | null;
  created_at: number;
}

interface AttemptRow {
  id: number;
  user_id: number;
  question_id: number;
  selected_index: number;
  is_correct: number;
  created_at: number;
}

let questions: QuestionRow[] = [];
let attempts: AttemptRow[] = [];
let nextQuestionId = 1;
let nextAttemptId = 1;

function reset() {
  questions = [];
  attempts = [];
  nextQuestionId = 1;
  nextAttemptId = 1;
}

function seedQuestion(overrides: Partial<QuestionRow> = {}): QuestionRow {
  const id = overrides.id ?? nextQuestionId++;
  const q: QuestionRow = {
    id,
    stem: 'apple',
    options_json: '[{"text":"苹果"},{"text":"香蕉"},{"text":"橘子"},{"text":"葡萄"}]',
    answer_index: 0,
    difficulty: 'easy',
    ecdict_ref: null,
    created_at: 1_700_000_000,
    ...overrides,
  };
  if (id >= nextQuestionId) nextQuestionId = id + 1;
  questions.push(q);
  return q;
}

// ============================================================
// Mock D1 — patterned after health-events.test.ts
// ============================================================

function makeStmt(query: string): D1PreparedStatement {
  let params: unknown[] = [];
  const stmt = {
    bind(...values: unknown[]) {
      params = values;
      return stmt;
    },
    async first<T = unknown>(): Promise<T | null> {
      const q = query.trim().replace(/\s+/g, ' ');
      // SELECT id, answer_index FROM questions WHERE id = ? (attempt endpoint)
      if (/SELECT\s+id[,\s]+answer_index\s+FROM\s+questions\s+WHERE\s+id\s*=\s*\?/i.test(q)) {
        const id = params[0] as number;
        const found = questions.find((x) => x.id === id) ?? null;
        return found as unknown as T;
      }
      // SELECT COUNT(*) FROM questions [WHERE difficulty = ?] (random count step)
      if (/SELECT\s+COUNT\(\*\)\s+FROM\s+questions\b/i.test(q)) {
        const difficulty = params[0] as QuestionDifficulty | undefined;
        const filtered = difficulty
          ? questions.filter((x) => x.difficulty === difficulty)
          : questions;
        return { cnt: filtered.length } as unknown as T;
      }
      // SELECT ... FROM questions ... LIMIT 1 OFFSET ? (random select step)
      // Only match if query actually contains LIMIT + OFFSET (guards against
      // matching COUNT(*) queries that don't have them).
      if (/LIMIT\s+1\s+OFFSET\s+\?/i.test(q)) {
        // Determine difficulty filter: first param is difficulty (string) or
        // directly the offset (number) when no difficulty filter is applied.
        const difficulty = typeof params[0] === 'string'
          ? (params[0] as QuestionDifficulty)
          : undefined;
        const offset = typeof params[0] === 'number'
          ? (params[0] as number)
          : (params[1] as number ?? 0);
        const filtered = difficulty
          ? questions.filter((x) => x.difficulty === difficulty)
          : questions;
        return (filtered[offset] ?? null) as unknown as T;
      }
      return null;
    },
    async run<T = unknown>(): Promise<D1Result<T>> {
      const q = query.trim().replace(/\s+/g, ' ');
      // INSERT INTO question_attempts ...
      if (/INSERT\s+INTO\s+question_attempts/i.test(q)) {
        const id = nextAttemptId++;
        const [userId, questionId, selectedIndex, isCorrect, createdAt] = params;
        attempts.push({
          id,
          user_id: userId as number,
          question_id: questionId as number,
          selected_index: selectedIndex as number,
          is_correct: isCorrect as number,
          created_at: createdAt as number,
        });
        return {
          success: true,
          meta: { changes: 1, last_row_id: id, duration: 0 },
        } as D1Result<T>;
      }
      return { success: true };
    },
    async all<T = unknown>(): Promise<D1Result<T>> {
      return { results: [], success: true } as D1Result<T>;
    },
    raw<T = unknown>(): Promise<T[]> {
      return Promise.resolve([] as unknown as T[]);
    },
  };
  return stmt as unknown as D1PreparedStatement;
}

function makeMockDb(): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      return makeStmt(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      return statements.map(() => ({ success: true } as D1Result<T>));
    },
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
}

// ============================================================
// Test request helper
// ============================================================

function envObj() {
  return { DB: makeMockDb(), JWT_SECRET: 'test-secret' };
}

async function call(path: string, init: RequestInit = {}, env = envObj()) {
  return app.request(`http://test.local${path}`, init, env);
}

// ============================================================
// Test suites
// ============================================================
beforeEach(() => {
  reset();
});

describe('GET /api/mp/questions/random — happy paths', () => {
  it('RANDOM-1: returns a random question when questions exist', async () => {
    seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });
    seedQuestion({ stem: 'banana', answer_index: 1, difficulty: 'medium' });
    seedQuestion({ stem: 'orange', answer_index: 2, difficulty: 'hard' });

    const res = await call('/api/mp/questions/random');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      id: number;
      stem: string;
      options: { text: string }[];
      difficulty: QuestionDifficulty;
    };

    expect([1, 2, 3]).toContain(body.id);
    expect(body.stem).toMatch(/^(apple|banana|orange)$/);
    expect(body.options).toHaveLength(4);
    expect(body.options[0]).toHaveProperty('text');
    expect(body.difficulty).toMatch(/^(easy|medium|hard)$/);
  });

  it('RANDOM-2: response does NOT include answer_index (anti-cheat)', async () => {
    seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });
    seedQuestion({ stem: 'banana', answer_index: 1, difficulty: 'medium' });

    const res = await call('/api/mp/questions/random');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    // answer_index must not appear in the response
    expect(body).not.toHaveProperty('answer_index');
    expect(body).not.toHaveProperty('answerIndex');
    expect(body).not.toHaveProperty('options_json');
  });

  it('RANDOM-3: difficulty=medium filter returns only medium questions', async () => {
    seedQuestion({ stem: 'apple', difficulty: 'easy', answer_index: 0 });
    seedQuestion({ stem: 'banana', difficulty: 'medium', answer_index: 1 });
    seedQuestion({ stem: 'orange', difficulty: 'hard', answer_index: 2 });

    const res = await call('/api/mp/questions/random?difficulty=medium');
    expect(res.status).toBe(200);
    const body = await res.json() as { stem: string; difficulty: string };
    expect(body.stem).toBe('banana');
    expect(body.difficulty).toBe('medium');
  });

  it('RANDOM-4: difficulty=easy filter returns only easy questions', async () => {
    seedQuestion({ stem: 'apple', difficulty: 'easy', answer_index: 0 });
    seedQuestion({ stem: 'banana', difficulty: 'medium', answer_index: 1 });

    const res = await call('/api/mp/questions/random?difficulty=easy');
    expect(res.status).toBe(200);
    const body = await res.json() as { stem: string; difficulty: string };
    expect(body.stem).toBe('apple');
    expect(body.difficulty).toBe('easy');
  });

  it('RANDOM-5: difficulty=hard filter returns only hard questions', async () => {
    seedQuestion({ stem: 'grape', difficulty: 'hard', answer_index: 3 });
    seedQuestion({ stem: 'apple', difficulty: 'easy', answer_index: 0 });

    const res = await call('/api/mp/questions/random?difficulty=hard');
    expect(res.status).toBe(200);
    const body = await res.json() as { stem: string; difficulty: string };
    expect(body.stem).toBe('grape');
    expect(body.difficulty).toBe('hard');
  });

  it('RANDOM-6: options contain 4 items with text property', async () => {
    seedQuestion({
      stem: 'cherry',
      options_json: '[{"text":"樱桃"},{"text":"草莓"},{"text":"蓝莓"},{"text":"黑莓"}]',
      answer_index: 0,
      difficulty: 'easy',
    });

    const res = await call('/api/mp/questions/random');
    expect(res.status).toBe(200);
    const body = await res.json() as { options: { text: string }[] };
    expect(body.options).toHaveLength(4);
    expect(body.options[0].text).toBe('樱桃');
    expect(body.options[3].text).toBe('黑莓');
  });
});

describe('GET /api/mp/questions/random — edge cases', () => {
  it('RANDOM-7: no questions → returns id:null with empty options', async () => {
    // questions array is empty (reset between tests)
    const res = await call('/api/mp/questions/random');
    expect(res.status).toBe(200);
    const body = await res.json() as { id: null; stem: string; options: unknown[] };
    expect(body.id).toBeNull();
    expect(body.stem).toBe('');
    expect(body.options).toHaveLength(0);
  });

  it('RANDOM-8: invalid difficulty → 400 INVALID_DIFFICULTY', async () => {
    const res = await call('/api/mp/questions/random?difficulty=impossible');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_DIFFICULTY');
  });

  it('RANDOM-9: difficulty with no matching questions → returns id:null', async () => {
    seedQuestion({ stem: 'apple', difficulty: 'easy', answer_index: 0 });
    seedQuestion({ stem: 'banana', difficulty: 'medium', answer_index: 1 });

    const res = await call('/api/mp/questions/random?difficulty=hard');
    expect(res.status).toBe(200);
    const body = await res.json() as { id: null };
    expect(body.id).toBeNull();
  });
});

describe('POST /api/mp/questions/attempt — happy paths', () => {
  it('ATTEMPT-1: correct answer → isCorrect:true, correctIndex returned', async () => {
    const q = seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });

    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: 0, childId: 2 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { isCorrect: boolean; correctIndex: number };
    expect(body.isCorrect).toBe(true);
    expect(body.correctIndex).toBe(0);
  });

  it('ATTEMPT-2: wrong answer → isCorrect:false, correctIndex returned', async () => {
    const q = seedQuestion({ stem: 'banana', answer_index: 1, difficulty: 'medium' });

    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: 0, childId: 2 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { isCorrect: boolean; correctIndex: number };
    expect(body.isCorrect).toBe(false);
    expect(body.correctIndex).toBe(1);
  });

  it('ATTEMPT-3: last option (index 3) correct → isCorrect:true', async () => {
    const q = seedQuestion({ stem: 'grape', answer_index: 3, difficulty: 'hard' });

    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: 3, childId: 2 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { isCorrect: boolean };
    expect(body.isCorrect).toBe(true);
  });

  it('ATTEMPT-4: attempt written to question_attempts table', async () => {
    const q = seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });

    await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: 0, childId: 2 }),
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0].user_id).toBe(2);
    expect(attempts[0].question_id).toBe(q.id);
    expect(attempts[0].selected_index).toBe(0);
    expect(attempts[0].is_correct).toBe(1);
  });

  it('ATTEMPT-5: wrong answer stored as is_correct=0', async () => {
    const q = seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });

    await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: 1, childId: 2 }),
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0].is_correct).toBe(0);
  });

  it('ATTEMPT-6: different childId stored correctly', async () => {
    const q = seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });

    await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: 0, childId: 99 }),
    });

    expect(attempts[0].user_id).toBe(99);
  });
});

describe('POST /api/mp/questions/attempt — edge cases', () => {
  it('ATTEMPT-7: non-existent questionId → 404 NOT_FOUND', async () => {
    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: 9999, selectedIndex: 0, childId: 2 }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('ATTEMPT-8: missing questionId → 400 INVALID_QUESTION_ID', async () => {
    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectedIndex: 0, childId: 2 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_QUESTION_ID');
  });

  it('ATTEMPT-9: invalid selectedIndex (negative) → 400 INVALID_SELECTED_INDEX', async () => {
    const q = seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });
    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: -1, childId: 2 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_SELECTED_INDEX');
  });

  it('ATTEMPT-10: invalid selectedIndex (4) → 400 INVALID_SELECTED_INDEX', async () => {
    const q = seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });
    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: 4, childId: 2 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_SELECTED_INDEX');
  });

  it('ATTEMPT-11: missing childId → 400 INVALID_CHILD_ID', async () => {
    const q = seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });
    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: 0 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CHILD_ID');
  });

  it('ATTEMPT-12: non-integer selectedIndex (1.5) → 400 INVALID_SELECTED_INDEX', async () => {
    const q = seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });
    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: 1.5, childId: 2 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_SELECTED_INDEX');
  });

  it('ATTEMPT-13: non-integer childId → 400 INVALID_CHILD_ID', async () => {
    const q = seedQuestion({ stem: 'apple', answer_index: 0, difficulty: 'easy' });
    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: q.id, selectedIndex: 0, childId: 'abc' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CHILD_ID');
  });

  it('ATTEMPT-14: empty body → 400 BAD_REQUEST', async () => {
    const res = await call('/api/mp/questions/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(400);
  });
});

describe('anti-cheat — answer never leaked in random endpoint', () => {
  it('ANTI-1: random response never includes answer_index field', async () => {
    seedQuestion({ stem: 'apple', answer_index: 2, difficulty: 'hard' });
    seedQuestion({ stem: 'banana', answer_index: 0, difficulty: 'easy' });

    // Run multiple times to catch any non-deterministic leakage
    for (let i = 0; i < 10; i++) {
      const res = await call('/api/mp/questions/random');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).not.toHaveProperty('answer_index');
      expect(body).not.toHaveProperty('answerIndex');
      expect(body).not.toHaveProperty('correct_answer');
      expect(body).not.toHaveProperty('correctOption');
      // options array itself should not contain any "correct" flag
      const options = body.options as Record<string, unknown>[] | undefined;
      if (options) {
        options.forEach((opt) => {
          expect(opt).not.toHaveProperty('isCorrect');
          expect(opt).not.toHaveProperty('correct');
          expect(opt).not.toHaveProperty('is_correct');
        });
      }
    }
  });
});
