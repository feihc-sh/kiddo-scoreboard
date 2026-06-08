// src/routes/admin/deleted-records.ts
// Stage 4 (NIGHTLY-TODO #009): PM-only read endpoint for the
// `deleted_records` snapshot table. The admin UI uses this to grey-out
// rows that have been hard-deleted in the current session (e.g. a row
// that the user just deleted but is still visible because the page
// hasn't reloaded yet).
//
//   GET /api/admin/deleted-records
//     ?record_type='score_event'|'task_completion' (optional)
//
// Response: { records: DeletedRecord[] }
//
// Each row has the full snapshot (`original_data`) so the UI could
// theoretically show a "view original" popover, but the current UI only
// needs `record_type`, `original_id`, `deleted_at`, `deleted_by`.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import type { Env } from '../../worker.ts';

const deletedRecords = new Hono<{ Bindings: Env }>();

interface DeletedRecordRow {
  id: number;
  record_type: 'score_event' | 'task_completion';
  original_id: number;
  original_data: string;
  deleted_at: number;
  deleted_by: number;
  original_table: 'score_events' | 'task_completions';
}

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json(
    { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
    401,
  );
}

function parseRecordType(raw: string | undefined): 'score_event' | 'task_completion' | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'score_event' || raw === 'task_completion') return raw;
  return undefined;
}

deletedRecords.get('/', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const recordType = parseRecordType(c.req.query('record_type'));

  const wheres: string[] = [];
  const params: unknown[] = [];
  if (recordType !== undefined) {
    wheres.push('record_type = ?');
    params.push(recordType);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  const result = await c.env.DB
    .prepare(
      `SELECT id, record_type, original_id, original_data, deleted_at, deleted_by, original_table
       FROM deleted_records
       ${where}
       ORDER BY deleted_at DESC
       LIMIT 500`,
    )
    .bind(...params)
    .all<DeletedRecordRow>();

  const records = (result.results ?? []).map((r) => ({
    id: r.id,
    record_type: r.record_type,
    original_id: r.original_id,
    original_data: r.original_data,
    deleted_at: r.deleted_at,
    deleted_by: r.deleted_by,
    original_table: r.original_table,
  }));

  return c.json({ records, count: records.length });
});

export default deletedRecords;
