// src/db/types.ts
// TypeScript interfaces matching migrations/0001_initial.sql
// All timestamps are Unix seconds (INTEGER in D1).

// =============================================================
// Enums (kept narrow — match CHECK constraints in SQL)
// =============================================================
export type UserRole = 'child' | 'pm';
export type AccountType = 'game_time' | 'pocket_money';
export type EventStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export type EventSource = 'manual' | 'task' | 'exchange' | 'weekly_grant';
export type SubmittedBy = 'child' | 'pm' | 'system';
export type Actor = 'child' | 'pm' | 'system';
export type TaskCategory = 'habit' | 'study' | 'chore' | 'custom';
export type CompletionStatus = 'active' | 'revoked';

// Audit actions: covers all write operations across the app
export type AuditAction =
  | 'login' | 'logout' | 'login_failed'
  | 'submit_event'        // child or pm submits a +/- request
  | 'approve_event' | 'reject_event' | 'revoke_event' | 'edit_event'
  | 'weekly_grant'
  | 'exchange'
  | 'set_name'            // v2 首次填名字
  | 'task_complete' | 'task_revoke'
  | 'task_create' | 'task_update' | 'task_delete';

// =============================================================
// Row types (mirror SQL columns exactly)
// =============================================================
export interface User {
  id: number;
  name: string;
  role: UserRole;
  pin_hash: string | null;
  created_at: number;
  updated_at: number;
}

export interface ScoreEvent {
  id: number;
  user_id: number;
  type: AccountType;
  change_value: number;          // 正=奖 / 负=扣
  reason: string;
  status: EventStatus;
  submitted_by: SubmittedBy;
  source: EventSource;
  source_ref: string | null;     // e.g. 'task:42' (we store as "task:42" string)
  reviewed_by: number | null;
  reviewed_at: number | null;
  week_of: string | null;        // '2026-W23'
  created_at: number;
}

export interface Task {
  id: number;
  name: string;
  token_reward: number;
  target_account: AccountType;
  icon: string | null;
  category: TaskCategory;
  is_active: 0 | 1;
  sort_order: number;
  // §3.12 sleep task (准时上床): self-lockout button after cutoff_time.
  // cutoff_time is 'HH:MM' (Asia/Shanghai). is_self_lockout=1 means the
  // server rejects /complete after the cutoff. NULL cutoff or 0 lockout
  // means no time check (regular task).
  cutoff_time: string | null;
  is_self_lockout: 0 | 1;
  created_at: number;
  updated_at: number;
}

export interface TaskCompletion {
  id: number;
  task_id: number;
  user_id: number;
  status: CompletionStatus;
  completed_date: string;        // 'YYYY-MM-DD' (Asia/Shanghai)
  completed_at: number;          // unix seconds
  awarded_event_id: number | null;
  revoked_at: number | null;
  revoked_by: number | null;
}

export interface AuditLog {
  id: number;
  actor: Actor;
  action: AuditAction;
  target_event_id: number | null;
  target_user_id: number | null;
  details: string;               // JSON string
  created_at: number;
}

// =============================================================
// Computed / API response types
// =============================================================
export interface Balance {
  game_time: number;             // 分钟
  pocket_money: number;          // 元
}

export interface EventWithMeta extends ScoreEvent {
  // joined info, used in lists
  reviewed_by_name?: string | null;
  user_name?: string;
}

// D1 binding helper — used in worker fetch handlers
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: { changes: number; last_row_id: number; duration: number };
  error?: string;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}
