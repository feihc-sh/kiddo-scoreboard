/**
 * question.ts — 4-choice question domain types
 *
 * Maps to D1 tables created in migrations 0017_questions.sql and
 * 0018_question_attempts.sql.
 */

export type QuestionDifficulty = 'easy' | 'medium' | 'hard';

export interface QuestionOption {
  /** Display text of the option (e.g. "苹果") */
  text: string;
}

/**
 * A 4-choice question.
 * options_json is stored as a JSON string in D1; parsed to this array at
 * the route/read layer.
 */
export interface Question {
  id: number;
  /** The question stem (e.g. an English word) */
  stem: string;
  /** The 4 choices; order is fixed (0 = first, 3 = last) */
  options: QuestionOption[];
  /**
   * 0-based index of the correct answer within options.
   * Never exposed to the client to prevent leaking answers.
   */
  answerIndex: number;
  difficulty: QuestionDifficulty;
  /** Optional reference to the ECDict word ID */
  ecdictRef: string | null;
  created_at: number;
}

/**
 * A single attempt at answering a question.
 * Maps to question_attempts D1 table.
 */
export interface QuestionAttempt {
  id: number;
  userId: number;
  questionId: number;
  /** 0-based index of the user's selected option */
  selectedIndex: number;
  /** Whether the selected answer was correct */
  isCorrect: boolean;
  created_at: number;
}

/**
 * Parse the raw D1 row options_json string into a QuestionOption array.
 * Throws if the JSON is malformed.
 */
export function parseOptionsJson(json: string): QuestionOption[] {
  const parsed = JSON.parse(json) as unknown[];
  if (!Array.isArray(parsed) || parsed.length !== 4) {
    throw new Error(`options_json must be an array of exactly 4 items; got ${parsed.length ?? 'invalid'}`);
  }
  return parsed.map((item) => {
    if (typeof item !== 'object' || item === null || !('text' in item)) {
      throw new Error(`Invalid option shape: expected { text: string }`);
    }
    return item as QuestionOption;
  });
}

/**
 * Check whether a given selectedIndex is the correct answer for a question.
 *
 * Usage:
 *   const q = { ...answerIndex: 2, ... };
 *   const correct = isCorrect(q, 2); // true
 *   const wrong   = isCorrect(q, 0); // false
 */
export function isCorrect(question: Question, selectedIndex: number): boolean {
  return question.answerIndex === selectedIndex;
}

/**
 * Validate that a selectedIndex is within the valid range (0-3).
 */
export function isValidOption(selectedIndex: number): boolean {
  return Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex <= 3;
}

/**
 * Serialize options array back to the JSON string format stored in D1.
 * Inverse of parseOptionsJson.
 */
export function serializeOptionsJson(options: QuestionOption[]): string {
  if (options.length !== 4) {
    throw new Error(`options must have exactly 4 items; got ${options.length}`);
  }
  return JSON.stringify(options);
}
