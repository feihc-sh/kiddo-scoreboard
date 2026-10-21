// src/routes/admin/tasks.ts
// PM-only task configuration endpoints (CRUD + soft-delete).
//   GET    /api/admin/tasks        — list ALL tasks (default: active only)
//   POST   /api/admin/tasks        — create
//   PUT    /api/admin/tasks/:id    — partial update
//   DELETE /api/admin/tasks/:id    — soft-delete (is_active=0; preserves history)
// Mounted at /api/admin/tasks by src/routes/admin/index.ts.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import { parseActiveDays } from '../../utils/coin.ts';
import type {
  AccountType,
  D1Database,
  Task,
  TaskCategory,
} from '../../db/types.ts';
import type { Env } from '../../worker.ts';

const tasksRoute = new Hono<{ Bindings: Env }>();

const TASK_COLUMNS =
  'id, name, token_reward, target_account, icon, category, ' +
  'is_active, sort_order, cutoff_time, is_self_lockout, active_days, ' +
  'created_at, updated_at';

const ALLOWED_ACCOUNTS: AccountType[] = ['game_time', 'pocket_money'];
const ALLOWED_CATEGORIES: TaskCategory[] = ['habit', 'study', 'chore', 'custom'];

/**
 * Normalize a raw active_days value from the request body into either
 *   - `null`         (= "every day" — what gets stored as NULL in the D1 row)
 *   - JSON string    (= the canonical "[1,3,5]" representation)
 * Spec §1 D2 / §3.4 (PM, 2026-10-17). null/undefined/[] → null.
 * Non-integer or out-of-[1..7] items → return a 400 reason string; caller
 * turns it into a BAD_REQUEST response.
 */
function normalizeActiveDays(raw: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'active_days must be an array of integers 1-7' };
  }
  if (raw.length === 0) {
    return { ok: true, value: null };
  }
  const seen = new Set<number>();
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 7) {
      return { ok: false, message: 'active_days must be an array of integers 1-7' };
    }
    seen.add(v);
  }
  const sorted = Array.from(seen).sort((a, b) => a - b);
  return { ok: true, value: JSON.stringify(sorted) };
}

// ---------------- helpers ----------------

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json(
    { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
    401,
  );
}

function badId(idRaw: string | undefined): number | null {
  if (!idRaw) return null;
  const n = Number(idRaw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function isAccountType(v: unknown): v is AccountType {
  return v === 'game_time' || v === 'pocket_money';
}

function isCategory(v: unknown): v is TaskCategory {
  return v === 'habit' || v === 'study' || v === 'chore' || v === 'custom';
}

function loadTask(db: D1Database, id: number): Promise<Task | null> {
  return db
    .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`)
    .bind(id)
    .first<Task>();
}

// ---------------- GET / (list) ----------------

tasksRoute.get('/', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const includeInactive = c.req.query('include_inactive') === 'true';
  const db = c.env.DB;
  const whereClause = includeInactive ? '' : 'WHERE is_active = ?';
  const stmt = db.prepare(
    `SELECT ${TASK_COLUMNS} FROM tasks ${whereClause} ` +
      `ORDER BY sort_order ASC, id ASC`,
  );
  const bound = includeInactive ? stmt.bind() : stmt.bind(1);
  const rows = await bound.all<Task>();

  // Bug fix (feihao 2026-10-21, found by CC doc audit E-9): active_days is
  // stored as JSON TEXT — returning it raw made the admin edit form's
  // Array.isArray prefill fail and silently fall back to "all 7 checked",
  // so saving an edit would silently turn a weekend-only task into every-day.
  // Parse to number[] | null here, same as me/ and public/ routes.
  const tasks = (rows.results ?? []).map((t) => ({
    ...t,
    active_days: parseActiveDays(t.active_days as unknown as string | null),
  }));
  return c.json({ tasks });
});

// ---------------- POST / (create) ----------------

interface CreateBody {
  name: string;
  token_reward: number;
  target_account: AccountType;
  icon: string | null;
  category: TaskCategory;
  sort_order: number;
  cutoff_time: string | null;
  is_self_lockout: 0 | 1;
  // task-active-days: JSON-encoded "[1,3,5]" or null = every day.
  active_days: string | null;
}

function parseCreateBody(raw: unknown):
  | { ok: true; value: CreateBody }
  | { ok: false; code: string; message: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return { ok: false, code: 'BAD_REQUEST', message: 'name must be a non-empty string' };
  }
  if (
    typeof body.token_reward !== 'number' ||
    !Number.isInteger(body.token_reward) ||
    body.token_reward <= 0
  ) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      message: 'token_reward must be a positive integer',
    };
  }
  if (!isAccountType(body.target_account)) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      message: 'target_account must be game_time or pocket_money',
    };
  }
  if (!isCategory(body.category)) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      message: 'category must be habit, study, chore, or custom',
    };
  }
  let sortOrder = 0;
  if (body.sort_order !== undefined) {
    if (
      typeof body.sort_order !== 'number' ||
      !Number.isInteger(body.sort_order)
    ) {
      return { ok: false, code: 'BAD_REQUEST', message: 'sort_order must be an integer' };
    }
    sortOrder = body.sort_order;
  }
  let icon: string | null = null;
  if (body.icon !== undefined && body.icon !== null) {
    if (typeof body.icon !== 'string') {
      return { ok: false, code: 'BAD_REQUEST', message: 'icon must be a string' };
    }
    icon = body.icon;
  }
  // §3.12 sleep task: cutoff_time optional ('HH:MM' or null). is_self_lockout
  // opt-in 0/1 flag. When is_self_lockout=1 with a cutoff_time, the server
  // refuses /complete after the cutoff in Asia/Shanghai.
  let cutoffTime: string | null = null;
  if (body.cutoff_time !== undefined && body.cutoff_time !== null) {
    if (typeof body.cutoff_time !== 'string') {
      return { ok: false, code: 'BAD_REQUEST', message: 'cutoff_time must be a string (HH:MM) or null' };
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.cutoff_time)) {
      return { ok: false, code: 'BAD_REQUEST', message: 'cutoff_time must match HH:MM (00:00–23:59)' };
    }
    cutoffTime = body.cutoff_time;
  }
  let isSelfLockout: 0 | 1 = 0;
  if (body.is_self_lockout !== undefined) {
    if (body.is_self_lockout !== 0 && body.is_self_lockout !== 1) {
      return { ok: false, code: 'BAD_REQUEST', message: 'is_self_lockout must be 0 or 1' };
    }
    isSelfLockout = body.is_self_lockout;
  }
  // task-active-days: validate + canonicalize. Empty array → null ("every day").
  const ad = normalizeActiveDays(body.active_days);
  if (!ad.ok) {
    return { ok: false, code: 'BAD_REQUEST', message: ad.message };
  }
  const activeDaysJson = ad.value;

  return {
    ok: true,
    value: {
      name: body.name.trim(),
      token_reward: body.token_reward,
      target_account: body.target_account,
      icon,
      category: body.category,
      sort_order: sortOrder,
      cutoff_time: cutoffTime,
      is_self_lockout: isSelfLockout,
      active_days: activeDaysJson,
    },
  };
}

tasksRoute.post('/', async (c) => {
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
  const parsed = parseCreateBody(raw);
  if (!parsed.ok) {
    return c.json({ error: { code: parsed.code, message: parsed.message } }, 400);
  }
  const body = parsed.value;

  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);

  const insertResult = await db.batch([
    db
      .prepare(
        `INSERT INTO tasks
           (name, token_reward, target_account, icon, category,
            is_active, sort_order, cutoff_time, is_self_lockout, active_days,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        body.name,
        body.token_reward,
        body.target_account,
        body.icon,
        body.category,
        body.sort_order,
        body.cutoff_time,
        body.is_self_lockout,
        body.active_days,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'task_create', NULL, NULL, ?, ?)`,
      )
      .bind(
        JSON.stringify({
          name: body.name,
          token_reward: body.token_reward,
          target_account: body.target_account,
        }),
        now,
      ),
  ]);

  // meta of the first statement (INSERT INTO tasks) carries last_row_id.
  const newId = Number(insertResult[0]?.meta?.last_row_id ?? 0);

  // task-active-days: body.active_days is the JSON-encoded value
  // (e.g. "[6]") — parse it back to number[] | null so the POST response
  // shape matches the PUT response and the Task TS type (admin UI pre-fills
  // from this). Mirrors the parse in the PUT handler. Defensive: also
  // accepts an already-parsed array for unit-test mocks.
  const activeDaysOut = (() => {
    const raw = body.active_days;
    if (raw == null) return null;
    if (Array.isArray(raw)) return raw as number[];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? (arr as number[]) : null;
    } catch {
      return null;
    }
  })();

  return c.json(
    {
      id: newId,
      name: body.name,
      token_reward: body.token_reward,
      target_account: body.target_account,
      icon: body.icon,
      category: body.category,
      is_active: 1 as const,
      sort_order: body.sort_order,
      cutoff_time: body.cutoff_time,
      is_self_lockout: body.is_self_lockout,
      active_days: activeDaysOut,
      created_at: now,
      updated_at: now,
    },
    201,
  );
});

// ---------------- PUT /:id (update) ----------------

type UpdateField = keyof Omit<Task, 'id' | 'created_at' | 'updated_at'>;

interface UpdateBody {
  name?: string;
  token_reward?: number;
  target_account?: AccountType;
  icon?: string | null;
  category?: TaskCategory;
  sort_order?: number;
  is_active?: 0 | 1;
  cutoff_time?: string | null;
  is_self_lockout?: 0 | 1;
  // task-active-days: JSON-encoded "[1,3,5]" or null = every day.
  active_days?: string | null;
}

function parseUpdateBody(raw: unknown):
  | { ok: true; value: UpdateBody }
  | { ok: false; code: string; message: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;
  const out: UpdateBody = {};

  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return { ok: false, code: 'BAD_REQUEST', message: 'name must be a non-empty string' };
    }
    out.name = body.name.trim();
  }
  if ('token_reward' in body) {
    if (
      typeof body.token_reward !== 'number' ||
      !Number.isInteger(body.token_reward) ||
      body.token_reward <= 0
    ) {
      return {
        ok: false,
        code: 'BAD_REQUEST',
        message: 'token_reward must be a positive integer',
      };
    }
    out.token_reward = body.token_reward;
  }
  if ('target_account' in body) {
    if (!isAccountType(body.target_account)) {
      return {
        ok: false,
        code: 'BAD_REQUEST',
        message: 'target_account must be game_time or pocket_money',
      };
    }
    out.target_account = body.target_account;
  }
  if ('icon' in body) {
    if (body.icon !== null && typeof body.icon !== 'string') {
      return { ok: false, code: 'BAD_REQUEST', message: 'icon must be a string or null' };
    }
    out.icon = body.icon as string | null;
  }
  if ('category' in body) {
    if (!isCategory(body.category)) {
      return {
        ok: false,
        code: 'BAD_REQUEST',
        message: 'category must be habit, study, chore, or custom',
      };
    }
    out.category = body.category;
  }
  if ('sort_order' in body) {
    if (typeof body.sort_order !== 'number' || !Number.isInteger(body.sort_order)) {
      return { ok: false, code: 'BAD_REQUEST', message: 'sort_order must be an integer' };
    }
    out.sort_order = body.sort_order;
  }
  if ('is_active' in body) {
    if (body.is_active !== 0 && body.is_active !== 1) {
      return { ok: false, code: 'BAD_REQUEST', message: 'is_active must be 0 or 1' };
    }
    out.is_active = body.is_active;
  }
  // §3.12 sleep task: allow updating cutoff_time and is_self_lockout too.
  if ('cutoff_time' in body) {
    if (body.cutoff_time === null) {
      out.cutoff_time = null;
    } else if (typeof body.cutoff_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.cutoff_time)) {
      return { ok: false, code: 'BAD_REQUEST', message: 'cutoff_time must match HH:MM or be null' };
    } else {
      out.cutoff_time = body.cutoff_time;
    }
  }
  if ('is_self_lockout' in body) {
    if (body.is_self_lockout !== 0 && body.is_self_lockout !== 1) {
      return { ok: false, code: 'BAD_REQUEST', message: 'is_self_lockout must be 0 or 1' };
    }
    out.is_self_lockout = body.is_self_lockout;
  }
  // task-active-days: validate + canonicalize.
  if ('active_days' in body) {
    const ad = normalizeActiveDays(body.active_days);
    if (!ad.ok) {
      return { ok: false, code: 'BAD_REQUEST', message: ad.message };
    }
    out.active_days = ad.value;
  }

  const provided: UpdateField[] = (
    Object.keys(out) as UpdateField[]
  );
  if (provided.length === 0) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      message: 'at least one field must be provided',
    };
  }
  return { ok: true, value: out };
}

tasksRoute.put('/:id', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const id = badId(c.req.param('id'));
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      400,
    );
  }
  const parsed = parseUpdateBody(raw);
  if (!parsed.ok) {
    return c.json({ error: { code: parsed.code, message: parsed.message } }, 400);
  }
  const patch = parsed.value;

  const db = c.env.DB;
  const existing = await loadTask(db, id);
  if (!existing) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'task not found' } },
      404,
    );
  }

  // Build dynamic SET clause from provided fields only.
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.token_reward !== undefined) {
    sets.push('token_reward = ?');
    params.push(patch.token_reward);
  }
  if (patch.target_account !== undefined) {
    sets.push('target_account = ?');
    params.push(patch.target_account);
  }
  if (patch.icon !== undefined) {
    sets.push('icon = ?');
    params.push(patch.icon);
  }
  if (patch.category !== undefined) {
    sets.push('category = ?');
    params.push(patch.category);
  }
  if (patch.sort_order !== undefined) {
    sets.push('sort_order = ?');
    params.push(patch.sort_order);
  }
  if (patch.is_active !== undefined) {
    sets.push('is_active = ?');
    params.push(patch.is_active);
  }
  if (patch.cutoff_time !== undefined) {
    sets.push('cutoff_time = ?');
    params.push(patch.cutoff_time);
  }
  if (patch.is_self_lockout !== undefined) {
    sets.push('is_self_lockout = ?');
    params.push(patch.is_self_lockout);
  }
  if (patch.active_days !== undefined) {
    sets.push('active_days = ?');
    params.push(patch.active_days);
  }
  sets.push('updated_at = unixepoch()');
  params.push(id);
  const setClause = sets.join(', ');

  // Capture old/new values for audit (only fields that actually changed).
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  const fields: UpdateField[] = [
    'name', 'token_reward', 'target_account', 'icon', 'category', 'sort_order', 'is_active',
    'cutoff_time', 'is_self_lockout', 'active_days',
  ];
  for (const f of fields) {
    if (patch[f] !== undefined && patch[f] !== existing[f]) {
      oldValues[f] = existing[f];
      newValues[f] = patch[f];
    }
  }

  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db
      .prepare(`UPDATE tasks SET ${setClause} WHERE id = ?`)
      .bind(...params),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'task_update', NULL, NULL, ?, ?)`,
      )
      .bind(
        JSON.stringify({
          task_id: id,
          old_values: oldValues,
          new_values: newValues,
        }),
        now,
      ),
  ]);

  const updated = await loadTask(db, id);
  if (!updated) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'task disappeared after update' } },
      404,
    );
  }

  // task-active-days: parse JSON → number[] | null so the admin UI gets the
  // typed value (not a raw string). Mirrors the row-read layer in
  // src/routes/public/tasks.ts and src/routes/me/tasks.ts. Accepts both
  // the JSON-text form (real D1) and an already-parsed array (unit-test mocks).
  const updatedActiveDays = parseActiveDaysOutput(updated.active_days);

  function parseActiveDaysOutput(raw: unknown): number[] | null {
    if (raw == null) return null;
    if (Array.isArray(raw)) return raw as number[];
    if (typeof raw === 'string') {
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? (arr as number[]) : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  return c.json({ ...updated, active_days: updatedActiveDays });
});

// ---------------- DELETE /:id (soft-delete) ----------------

tasksRoute.delete('/:id', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const id = badId(c.req.param('id'));
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;
  const existing = await loadTask(db, id);
  if (!existing) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'task not found' } },
      404,
    );
  }

  // Refuse to lose history: any active completion for this task blocks soft-delete.
  const activeCompletion = await db
    .prepare(
      `SELECT id FROM task_completions
       WHERE task_id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(id)
    .first<{ id: number }>();
  if (activeCompletion) {
    return c.json(
      {
        error: {
          code: 'HAS_ACTIVE_COMPLETIONS',
          message: 'cannot soft-delete task with active completions',
        },
      },
      409,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db
      .prepare(
        `UPDATE tasks SET is_active = 0, updated_at = ? WHERE id = ?`,
      )
      .bind(now, id),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'task_delete', NULL, NULL, ?, ?)`,
      )
      .bind(JSON.stringify({ task_id: id, name: existing.name }), now),
  ]);

  return c.json({ id, is_active: 0 as const });
});

// ---------------- POST /:id/toggle (suspend/resume) ----------------

tasksRoute.post('/:id/toggle', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const id = badId(c.req.param('id'));
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;
  const existing = await loadTask(db, id);
  if (!existing) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'task not found' } },
      404,
    );
  }

  const oldIsActive = existing.is_active;
  const newIsActive = oldIsActive === 1 ? 0 : 1;
  const action = newIsActive === 1 ? 'task_resumed' : 'task_suspended';
  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db
      .prepare(`UPDATE tasks SET is_active = ?, updated_at = ? WHERE id = ?`)
      .bind(newIsActive, now, id),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', '${action}', NULL, NULL, ?, ?)`,
      )
      .bind(
        JSON.stringify({
          task_id: id,
          old_is_active: oldIsActive,
          new_is_active: newIsActive,
          toggled_at: now,
        }),
        now,
      ),
  ]);

  return c.json({ id, is_active: newIsActive as 0 | 1, action, toggled_at: now });
});

export default tasksRoute;
