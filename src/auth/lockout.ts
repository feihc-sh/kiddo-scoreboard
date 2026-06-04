// src/auth/lockout.ts
// 5 wrong PIN attempts in 5 minutes → IP locked out.
// State is persisted in `auth_attempts` table (migration 0002).

import type { D1Database } from '../db/types.ts';

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_DURATION_SEC = 5 * 60;

/**
 * Returns true if the IP has >= MAX_ATTEMPTS failed attempts in the last LOCKOUT_DURATION_SEC.
 * `nowSec` is injectable for testing (defaults to current Unix seconds).
 */
export async function isLockedOut(db: D1Database, ip: string, nowSec: number = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const cutoff = nowSec - LOCKOUT_DURATION_SEC;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM auth_attempts
       WHERE success = 0 AND attempted_at >= ? AND ip = ?`,
    )
    .bind(cutoff, ip)
    .first<{ n: number }>();
  return Number(row?.n ?? 0) >= MAX_ATTEMPTS;
}

/** Append a login attempt. success=true clears the count effectively (but keeps history). */
export async function recordAttempt(db: D1Database, ip: string, success: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auth_attempts (ip, success, attempted_at) VALUES (?, ?, unixepoch())`,
    )
    .bind(ip, success ? 1 : 0)
    .run();
}
