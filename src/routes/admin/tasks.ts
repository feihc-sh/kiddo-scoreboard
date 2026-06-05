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
  'is_active, sort_order, created_at, updated_at';

const ALLOWED_ACCOUNTS: AccountType[] = ['game_time', 'pocket_money'];
const ALLOWED_CATEGORIES: TaskCategory[] = ['habit', 'study', 'chore', 'custom'];

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

  return c.json({ tasks: rows.results ?? [] });
});

// ---------------- POST / (create) ----------------

interface CreateBody {
  name: string;
  token_reward: number;
  target_account: AccountType;
  icon: string | null;
  category: TaskCategory;
  sort_order: number;
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

  return {
    ok: true,
    value: {
      name: body.name.trim(),
      token_reward: body.token_reward,
      target_account: body.target_account,
      icon,
      category: body.category,
      sort_order: sortOrder,
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
            is_active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        body.name,
        body.token_reward,
        body.target_account,
        body.icon,
        body.category,
        body.sort_order,
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
  sets.push('updated_at = unixepoch()');
  params.push(id);
  const setClause = sets.join(', ');

  // Capture old/new values for audit (only fields that actually changed).
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  const fields: UpdateField[] = [
    'name', 'token_reward', 'target_account', 'icon', 'category', 'sort_order', 'is_active',
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

  return c.json(updated);
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

export default tasksRoute;
