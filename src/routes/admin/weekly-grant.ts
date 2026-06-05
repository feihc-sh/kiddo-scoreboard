// src/routes/admin/weekly-grant.ts
// PM-only: issue "weekly allowance" to the child (default user_id = 2),
// to one or both accounts (game_time / pocket_money), in a single atomic batch.
//
// Atomicity guarantee: all score_event INSERTs and the audit_log INSERT go
// through one db.batch() call, so a partial failure cannot leave an audit gap.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import type { AccountType } from '../../db/types.ts';
import { computeBalance } from '../../utils/balance.ts';
import { currentWeek, nowUnix } from '../../utils/week.ts';
import type { Env } from '../../worker.ts';

const weeklyGrant = new Hono<{ Bindings: Env }>();

const DEFAULT_CHILD_USER_ID = 2;

interface GrantBody {
  game_time?: number;
  pocket_money?: number;
  child_user_id?: number;
  note?: string;
}

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json(
    { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
    401,
  );
}

function isNonNegativeInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

function parseBody(
  raw: unknown,
):
  | { ok: true; value: GrantBody }
  | { ok: false; code: string; message: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      message: 'body must be a JSON object',
    };
  }
  const body = raw as Record<string, unknown>;
  const out: GrantBody = {};

  if ('game_time' in body) {
    if (!isNonNegativeInt(body.game_time)) {
      return {
        ok: false,
        code: 'BAD_REQUEST',
        message: 'game_time must be a non-negative integer',
      };
    }
    out.game_time = body.game_time;
  }
  if ('pocket_money' in body) {
    if (!isNonNegativeInt(body.pocket_money)) {
      return {
        ok: false,
        code: 'BAD_REQUEST',
        message: 'pocket_money must be a non-negative integer',
      };
    }
    out.pocket_money = body.pocket_money;
  }
  if ('child_user_id' in body) {
    if (
      !Number.isInteger(body.child_user_id) ||
      (body.child_user_id as number) <= 0
    ) {
      return {
        ok: false,
        code: 'BAD_REQUEST',
        message: 'child_user_id must be a positive integer',
      };
    }
    out.child_user_id = body.child_user_id as number;
  }
  if ('note' in body) {
    if (typeof body.note !== 'string') {
      return {
        ok: false,
        code: 'BAD_REQUEST',
        message: 'note must be a string',
      };
    }
    out.note = body.note;
  }

  return { ok: true, value: out };
}

// ---------------- POST / ----------------

weeklyGrant.post('/', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      400,
    );
  }
  const parsed = parseBody(raw);
  if (!parsed.ok) {
    return c.json(
      { error: { code: parsed.code, message: parsed.message } },
      400,
    );
  }
  const body = parsed.value;

  const gt = body.game_time ?? 0;
  const pm = body.pocket_money ?? 0;
  if (gt === 0 && pm === 0) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'at least one of game_time or pocket_money must be > 0',
        },
      },
      400,
    );
  }

  const childUserId = body.child_user_id ?? DEFAULT_CHILD_USER_ID;
  const note = body.note;
  const week = currentWeek();
  const now = nowUnix();

  // Filter to non-zero positive amounts only.
  const grants: { type: AccountType; amount: number }[] = [];
  if (gt > 0) grants.push({ type: 'game_time', amount: gt });
  if (pm > 0) grants.push({ type: 'pocket_money', amount: pm });

  const db = c.env.DB;
  const statements = grants.map((g) => {
    const reason =
      `Weekly grant: +${g.amount} ${g.type}` +
      (note ? ` (${note})` : '');
    return db
      .prepare(
        `INSERT INTO score_events
           (user_id, type, change_value, reason, status,
            submitted_by, source, week_of, created_at)
         VALUES (?, ?, ?, ?, 'approved', 'pm', 'weekly_grant', ?, ?)`,
      )
      .bind(childUserId, g.type, g.amount, reason, week, now);
  });
  statements.push(
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'weekly_grant', ?, ?, ?, ?)`,
      )
      .bind(
        null,
        childUserId,
        JSON.stringify({
          game_time: gt,
          pocket_money: pm,
          note: note ?? null,
        }),
        now,
      ),
  );

  const results = await db.batch(statements);
  const eventIds = results
    .slice(0, grants.length)
    .map((r) => r.meta?.last_row_id ?? 0);

  const newBalance = await computeBalance(db, childUserId);
  return c.json({ event_ids: eventIds, new_balance: newBalance });
});

export default weeklyGrant;
