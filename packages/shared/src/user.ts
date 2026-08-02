/**
 * user.ts — User type extensions for mecha-challenge-scoreboard
 *
 * Extends the kiddo User interface (src/db/types.ts) with the openid field
 * added in migration 0016_families.sql.
 *
 * @see src/db/types.ts — do NOT modify existing User interface here;
 *                           only add fields that are migration-added.
 */

/** Role of a user within a family. */
export type UserRole = 'child' | 'pm';

export interface User {
  id: number;
  name: string;
  role: 'child' | 'pm';
  pin_hash: string | null;
  created_at: number;
  updated_at: number;
  /** openid from wx.login (微信授权登录). NULL for non-WeChat users. */
  openid: string | null;
}
