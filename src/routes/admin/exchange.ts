// src/routes/admin/exchange.ts
// POST /api/admin/exchange
// PM-only: bidirectional 1:1 transfer between game_time and pocket_money.
// Creates two approved score_events (one negative, one positive) plus an
// audit_log row, all in a single db.batch() so the operation is atomic at
// the D1 level. Exchange is allowed even with negative balance
// (PRD §3.5 "双账户透支").

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import { computeBalance } from '../../utils/balance.ts';
import { currentWeek } from '../../utils/week.ts';
import type { AccountType, Balance } from '../../db/types.ts';
import type { Env } from '../../worker.ts';

const CHILD_USER_ID = 2;

const exchange = new Hono<{ Bindings: Env }>();

interface ExchangeBody {
  from_account: AccountType;
  to_account: AccountType;
  amount: number;
  child_user_id: number;
}

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json(
    { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
    401,
  );
}

function parseBody(
  raw: unknown,
): { ok: true; value: ExchangeBody } | { ok: false; code: string; message: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'body must be a JSON object' };
  }
  const b = raw as Record<string, unknown>;

  if (b.from_account !== 'game_time' && b.from_account !== 'pocket_money') {
    return { ok: false, code: 'BAD_REQUEST', message: 'from_account must be game_time or pocket_money' };
  }
  if (b.to_account !== 'game_time' && b.to_account !== 'pocket_money') {
    return { ok: false, code: 'BAD_REQUEST', message: 'to_account must be game_time or pocket_money' };
  }
  if (b.from_account === b.to_account) {
    return { ok: false, code: 'BAD_REQUEST', message: 'from_account and to_account must differ' };
  }
  if (typeof b.amount !== 'number' || !Number.isInteger(b.amount) || b.amount <= 0) {
    return { ok: false, code: 'BAD_REQUEST', message: 'amount must be a positive integer' };
  }

  let childUserId = CHILD_USER_ID;
  if (b.child_user_id !== undefined) {
    if (typeof b.child_user_id !== 'number' || !Number.isInteger(b.child_user_id) || b.child_user_id <= 0) {
      return { ok: false, code: 'BAD_REQUEST', message: 'child_user_id must be a positive integer' };
    }
    childUserId = b.child_user_id;
  }

  return {
    ok: true,
    value: {
      from_account: b.from_account as AccountType,
      to_account: b.to_account as AccountType,
      amount: b.amount,
      child_user_id: childUserId,
    },
  };
}

exchange.post('/', async (c) => {
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
    return c.json({ error: { code: parsed.code, message: parsed.message } }, 400);
  }
  const { from_account, to_account, amount, child_user_id } = parsed.value;

  const db = c.env.DB;
  const week = currentWeek();
  const now = Math.floor(Date.now() / 1000);

  // Atomic transaction: 2 score_events + 1 audit_log row.
  // Inline audit INSERT (no logAudit wrapper) so all three writes share
  // the same db.batch() and the same `now` timestamp.
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO score_events
           (user_id, type, change_value, reason, status, submitted_by,
            source, week_of, created_at)
         VALUES (?, ?, ?, ?, 'approved', 'pm', 'exchange', ?, ?)`,
      )
      .bind(child_user_id, from_account, -amount, `Exchange: -${amount} to ${to_account}`, week, now),
    db
      .prepare(
        `INSERT INTO score_events
           (user_id, type, change_value, reason, status, submitted_by,
            source, week_of, created_at)
         VALUES (?, ?, ?, ?, 'approved', 'pm', 'exchange', ?, ?)`,
      )
      .bind(child_user_id, to_account, +amount, `Exchange: +${amount} from ${from_account}`, week, now),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'exchange', NULL, ?, ?, ?)`,
      )
      .bind(
        child_user_id,
        JSON.stringify({ from_account, to_account, amount }),
        now,
      ),
  ]);

  const from_event_id = Number(results[0]?.meta?.last_row_id ?? 0);
  const to_event_id = Number(results[1]?.meta?.last_row_id ?? 0);

  const new_balance: Balance = await computeBalance(db, child_user_id);
  return c.json({ from_event_id, to_event_id, new_balance });
});

export default exchange;
