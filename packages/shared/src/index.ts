/**
 * index.ts — Shared domain types for mecha-challenge-scoreboard
 *
 * Re-exports all domain interfaces from this package so consumers can do:
 *   import { Family, Question, User, isCorrect } from 'mecha-challenge-shared';
 */

export type { User, UserRole } from './user.js';
export type { Family } from './family.js';
export type { Question, QuestionAttempt, QuestionDifficulty, QuestionOption } from './question.js';
export {
  isCorrect,
  isValidOption,
  parseOptionsJson,
  serializeOptionsJson,
} from './question.js';
