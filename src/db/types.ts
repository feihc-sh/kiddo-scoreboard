// src/db/types.ts
// TypeScript interfaces matching migrations/0001_initial.sql
// All timestamps are Unix seconds (INTEGER in D1).

// =============================================================
// Enums (kept narrow — match CHECK constraints in SQL)
// =============================================================
export type UserRole = 'child' | 'pm';
// Module 7 (Coin System, RFC §3): added 'coins' as 3rd account type.
// Each user's coin balance is SUM(change_value) of approved score_events
// with type='coins'. Coin events are written by task completion hooks
// (grantCoinsForTaskCompletion / revokeCoinsForTask in src/utils/coin.ts).
export type AccountType = 'game_time' | 'pocket_money' | 'coins';
export type EventStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export type EventSource = 'manual' | 'task' | 'exchange' | 'weekly_grant';
export type SubmittedBy = 'child' | 'pm' | 'system';
export type Actor = 'child' | 'pm' | 'system';
export type TaskCategory = 'habit' | 'study' | 'chore' | 'custom';
export type CompletionStatus = 'active' | 'revoked';

// Shop item enum (RFC §3.2): kind determines what account type the reward flows into.
// v1 hardcode only uses 'game_time'; 'pocket_money' / 'custom' are reserved for v2+.
// reward_type mirrors kind (with 'none' for 'custom' items that don't credit any account).
export type ShopItemKind = 'game_time' | 'pocket_money' | 'custom';
export type ShopRewardType = 'game_time' | 'pocket_money' | 'none';
// shop_redemptions.status: v1 simplification — redemption is final on creation.
// 'revoked' reserved for future PM-side undo (M3+).
export type ShopRedemptionStatus = 'consumed' | 'revoked';

// Module 8 (Health Check-in, RFC §2.2): 8 hardcoded event types. v1 hardcodes these;
// PM backend config UI for additional types is v2+. Emoji is decided per type in
// frontend HEALTH_EVENT_TYPES constant; backend stays type-safe via CHECK constraint.
export type HealthEventType =
  | 'ulcer' | 'fever' | 'cough' | 'injury'
  | 'allergy' | 'dizzy' | 'vomit' | 'other';
// health_events.submitted_by CHECK IN ('child', 'pm') — no 'system' (system-triggered
// events don't apply to health; only the user themselves or PM can check-in).
export type HealthSubmittedBy = 'child' | 'pm';

// Audit actions: covers all write operations across the app
export type AuditAction =
  | 'login' | 'logout' | 'login_failed'
  | 'submit_event'        // child or pm submits a +/- request
  | 'approve_event' | 'reject_event' | 'revoke_event' | 'edit_event'
  | 'weekly_grant'
  | 'exchange'
  | 'set_name'            // v2 首次填名字
  | 'task_complete' | 'task_revoke'
  | 'task_create' | 'task_update' | 'task_delete'
  | 'event_hard_deleted' | 'completion_hard_deleted'
  // Module 8 (Health Check-in, RFC §3.3): health_events write actions. create/resolve
  // ship in M1; delete is reserved for v2 PM hard-delete UI (RFC §4.4 — not in v1).
  | 'health_event_create' | 'health_event_resolve' | 'health_event_delete';

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

// Module 8 (Health Check-in, RFC §3.1): row interface for health_events.
// Field shape mirrors the RFC §4.2.1 API response (snake_case + boolean
// is_resolved) — used both as the raw row type and the API response shape.
// SQL stores is_resolved as 0|1 INTEGER; helpers in src/utils/health-events.ts
// convert to boolean at the row-read layer so the route layer doesn't have to.
export interface HealthEvent {
  id: number;
  user_id: number;
  event_type: HealthEventType;
  start_date: string;            // 'YYYY-MM-DD' (Asia/Shanghai)
  end_date: string | null;       // NULL = 进行中
  is_resolved: boolean;
  note: string | null;
  submitted_by: HealthSubmittedBy;
  created_at: number;            // Unix seconds
  resolved_at: number | null;    // Unix seconds, set when end_date written
  resolved_by: number | null;    // user id who resolved (PM or child, §4.2.4/§4.2.5)
  updated_at: number;            // Unix seconds, last write
}

// =============================================================
// Computed / API response types
// =============================================================
export interface Balance {
  game_time: number;             // 分钟
  pocket_money: number;          // 元
  coins: number;                 // 枚 (Module 7 Coin System, RFC §3.4)
}

// Module 7 (Coin System, RFC §3.2): row interfaces for shop tables.
// These mirror the SQL columns exactly so callers can use them with the
// raw D1 row shape (snake_case) before mapping to API responses.
//
// CoinBalance is a computed view (sum of approved coin events) — not a
// stored row. Returned by getCoinBalance() in src/utils/coin.ts.
export interface CoinBalance {
  userId: number;
  balance: number;               // SUM(change_value WHERE type='coins' AND status='approved')
  lastUpdatedAt: number;         // unix seconds of the latest contributing event (0 if none)
}

export interface ShopItem {
  id: number;
  name: string;
  kind: ShopItemKind;
  costCoins: number;             // SQL: cost_coins
  rewardValue: number;           // SQL: reward_value
  rewardType: ShopRewardType;
  description: string | null;
  icon: string | null;
  isActive: 0 | 1;               // SQL: is_active
  sortOrder: number;             // SQL: sort_order
  weeklyLimit: number;           // SQL: weekly_limit; 0 = unlimited
  createdAt: number;
  updatedAt: number;
}

export interface ShopRedemption {
  id: number;
  userId: number;
  itemId: number;
  weekOf: string;                // ISO 8601 '2026-W23'
  costCoins: number;
  rewardValue: number;
  rewardType: ShopRewardType;
  status: ShopRedemptionStatus;
  redeemedAt: number;
  revokedAt: number | null;
  revokedBy: number | null;
  coinEventId: number;           // FK → score_events (type='coins', change_value=-cost)
  rewardEventId: number;         // FK → score_events (type=reward_type, change_value=+reward)
  createdAt: number;
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
