// src/routes/mp/auth.ts
// POST /api/mp/auth  — wx.login 桥
// Receives { code } from 微信小程序 wx.login()
// Calls wx code2Session to get openid + session_key,
// looks up or creates a 'child' user, returns { openid, userId, role, familyId }.
//
// session_key is intentionally NOT persisted — caller (小程序端) holds it in
// memory for encrypted data decryption. M5+ will handle that flow server-side.
//
// Required Env vars (set via `wrangler secret put`):
//   WECHAT_APPID   — 小程序 appid
//   WECHAT_SECRET  — 小程序 secret

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';

// =============================================================
// Types
// =============================================================

interface WxCode2SessionResponse {
  /** 用户唯一标识 */
  openid: string;
  /** 会话密钥 (caller holds; we return but do NOT persist) */
  session_key: string;
  /** 用户在开放平台的唯一标识（仅 UnionID 机制时返回） */
  unionid?: string;
  /** 错误码: 0=成功 */
  errcode?: number;
  /** 错误信息 */
  errmsg?: string;
}

interface WechatError {
  errcode: number;
  errmsg: string;
}

// =============================================================
// Route
// =============================================================

const mpAuth = new Hono<{ Bindings: Env }>();

mpAuth.post('/', async (c) => {
  // 1. Parse body
  let body: { code?: unknown };
  try {
    const parsed: unknown = await c.req.json();
    if (parsed === null || parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'request body must be a JSON object' } },
        400,
      );
    }
    body = parsed as { code?: unknown };
  } catch {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'request body must be valid JSON' } },
      400,
    );
  }

  const { code } = body;
  if (typeof code !== 'string' || code.trim().length === 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'code must be a non-empty string' } },
      400,
    );
  }

  // 2. Validate env
  const appid = c.env.WECHAT_APPID;
  const secret = c.env.WECHAT_SECRET;
  if (!appid || !secret) {
    console.error('[mp/auth] WECHAT_APPID or WECHAT_SECRET is not configured');
    return c.json(
      { error: { code: 'SERVER_MISCONFIG', message: 'Wechat credentials not configured' } },
      500,
    );
  }

  // 3. Call wx code2Session
  let wxResp: WxCode2SessionResponse;
  try {
    const wxUrl =
      `https://api.weixin.qq.com/sns/jscode2session` +
      `?appid=${encodeURIComponent(appid)}` +
      `&secret=${encodeURIComponent(secret)}` +
      `&js_code=${encodeURIComponent(code.trim())}` +
      `&grant_type=authorization_code`;

    const res = await fetch(wxUrl);
    if (!res.ok) {
      console.error(`[mp/auth] wx API HTTP error: ${res.status} ${res.statusText}`);
      return c.json(
        { error: { code: 'WECHAT_API_ERROR', message: 'Failed to contact Wechat API' } },
        502,
      );
    }

    const raw = (await res.json()) as unknown;
    if (
      typeof raw !== 'object' || raw === null ||
      !('openid' in raw) || typeof (raw as Record<string, unknown>).openid !== 'string'
    ) {
      // wx returns { errcode, errmsg } on failure
      const err = raw as WechatError | Record<string, unknown>;
      if ('errcode' in err && typeof err.errcode === 'number' && err.errcode !== 0) {
        console.error(`[mp/auth] wx code2Session error: ${err.errcode} ${err.errmsg ?? ''}`);
        return c.json(
          {
            error: {
              code: 'WECHAT_API_ERROR',
              message: typeof err.errmsg === 'string' ? err.errmsg : 'Wechat API returned an error',
            },
          },
          400,
        );
      }
      console.error('[mp/auth] wx code2Session unexpected response shape:', raw);
      return c.json(
        { error: { code: 'WECHAT_API_ERROR', message: 'Unexpected Wechat API response' } },
        502,
      );
    }

    wxResp = raw as WxCode2SessionResponse;
  } catch (err) {
    console.error('[mp/auth] fetch exception:', err);
    return c.json(
      { error: { code: 'WECHAT_API_ERROR', message: 'Failed to reach Wechat API' } },
      502,
    );
  }

  const { openid } = wxResp;

  // 4. Look up user by openid — if not found, create a new 'child' account
  const db = c.env.DB;

  const existingUser = await db
    .prepare(`SELECT id, role, family_id FROM users WHERE openid = ?`)
    .bind(openid)
    .first<{ id: number; role: 'child' | 'pm'; family_id: number | null }>();

  if (existingUser) {
    return c.json({
      openid,
      userId: existingUser.id,
      role: existingUser.role,
      familyId: existingUser.family_id ?? null,
    });
  }

  // New user: insert with role='child', no name yet (M5 will let them set it)
  const now = Math.floor(Date.now() / 1000);
  const insertResult = await db
    .prepare(
      `INSERT INTO users (name, role, openid, created_at, updated_at)
       VALUES ('', 'child', ?, ?, ?)`,
    )
    .bind(openid, now, now)
    .run();

  if (!insertResult.success) {
    // Race condition: another concurrent login may have inserted first.
    // Re-query and return the winner.
    const raceUser = await db
      .prepare(`SELECT id, role, family_id FROM users WHERE openid = ?`)
      .bind(openid)
      .first<{ id: number; role: 'child' | 'pm'; family_id: number | null }>();

    if (raceUser) {
      return c.json({
        openid,
        userId: raceUser.id,
        role: raceUser.role,
        familyId: raceUser.family_id ?? null,
      });
    }

    console.error('[mp/auth] failed to insert new user for openid:', openid);
    return c.json(
      { error: { code: 'DB_ERROR', message: 'Failed to create user account' } },
      500,
    );
  }

  const newUserId = insertResult.meta?.last_row_id;
  if (!newUserId) {
    console.error('[mp/auth] no last_row_id after user insert');
    return c.json(
      { error: { code: 'DB_ERROR', message: 'Failed to retrieve new user ID' } },
      500,
    );
  }

  return c.json({
    openid,
    userId: newUserId,
    role: 'child',
    familyId: null,
  });
});

export default mpAuth;
