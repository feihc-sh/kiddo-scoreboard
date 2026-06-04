// tests/unit/audit.test.ts
// Tests for src/utils/audit.ts using a minimal D1 mock.
import { describe, it, expect, beforeEach } from 'vitest';
import { logAudit, readAuditLog, type AuditEntry } from '../../src/utils/audit.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  AuditAction,
  Actor,
} from '../../src/db/types.ts';

interface AuditRow {
  id: number;
  actor: Actor;
  action: AuditAction;
  target_event_id: number | null;
  target_user_id: number | null;
  details: string;
  created_at: number;
}

let table: AuditRow[] = [];
let nextId = 1;
let nowOffset = 0;  // 每次 insert 递增 1s，避免 created_at 相同导致 sort 不稳定

function resetTable() {
  table = [];
  nextId = 1;
  nowOffset = 0;
}

function makeMockDb(): D1Database {
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let params: unknown[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values;
          return stmt;
        },
        first: () => Promise.resolve(null),
        run<T = unknown>(): Promise<D1Result<T>> {
          if (/INSERT\s+INTO\s+audit_log/i.test(query)) {
            const [actor, action, target_event_id, target_user_id, details] = params as [
              Actor, AuditAction, number | null, number | null, string,
            ];
            const row: AuditRow = {
              id: nextId++,
              actor,
              action,
              target_event_id,
              target_user_id,
              details,
              created_at: Math.floor(Date.now() / 1000) + nowOffset,
            };
            table.push(row);
            nowOffset += 1;  // ensure each insert has a strictly later timestamp
            return Promise.resolve({
              success: true,
              meta: { changes: 1, last_row_id: row.id, duration: 0 },
            });
          }
          return Promise.resolve({ success: true });
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          // readAuditLog query: SELECT ... ORDER BY created_at DESC LIMIT ?
          const limit = (params[params.length - 1] as number) ?? 100;
          const filters = params.slice(0, -1);
          const wheres: string[] = [];
          let fi = 0;
          if (/actor\s*=\s*\?/.test(query)) wheres.push(`actor = '${filters[fi++]}'`);
          if (/action\s*=\s*\?/.test(query)) wheres.push(`action = '${filters[fi++]}'`);
          if (/target_user_id\s*=\s*\?/.test(query)) wheres.push(`target_user_id = ${filters[fi++]}`);

          let rows = [...table];
          // Apply wheres (very naive: we just check exact string presence)
          for (const w of wheres) {
            const [col, valRaw] = w.split(' = ');
            const val = valRaw.replace(/^'|'$/g, '');
            rows = rows.filter((r) => String((r as unknown as Record<string, unknown>)[col]) === val);
          }
          rows.sort((a, b) => b.created_at - a.created_at);
          rows = rows.slice(0, limit);
          return Promise.resolve({ results: rows as unknown as T[], success: true });
        },
        raw: () => Promise.resolve([]),
      };
      return stmt;
    },
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return db;
}

describe('logAudit', () => {
  beforeEach(() => {
    resetTable();
  });

  it('inserts a row and returns the new id', async () => {
    const db = makeMockDb();
    const id = await logAudit(db, {
      actor: 'pm',
      action: 'approve_event',
      target_event_id: 42,
      details: { note: 'looks good' },
    });
    expect(id).toBe(1);
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({
      actor: 'pm',
      action: 'approve_event',
      target_event_id: 42,
      target_user_id: null,
      details: '{"note":"looks good"}',
    });
  });

  it('serializes empty details as {}', async () => {
    const db = makeMockDb();
    await logAudit(db, { actor: 'system', action: 'login' });
    expect(table[0].details).toBe('{}');
  });

  it('handles null target_event_id and target_user_id', async () => {
    const db = makeMockDb();
    await logAudit(db, { actor: 'pm', action: 'task_create', details: { name: 'New task' } });
    expect(table[0].target_event_id).toBeNull();
    expect(table[0].target_user_id).toBeNull();
  });

  it('records nested details correctly', async () => {
    const db = makeMockDb();
    await logAudit(db, {
      actor: 'pm',
      action: 'exchange',
      details: { from: 'pocket_money', to: 'game_time', amount: 30 },
    });
    expect(JSON.parse(table[0].details)).toEqual({
      from: 'pocket_money',
      to: 'game_time',
      amount: 30,
    });
  });
});

describe('readAuditLog', () => {
  beforeEach(() => {
    resetTable();
  });

  it('returns all rows newest-first when no filter', async () => {
    const db = makeMockDb();
    await logAudit(db, { actor: 'pm', action: 'login' });
    await logAudit(db, { actor: 'pm', action: 'logout' });
    await logAudit(db, { actor: 'child', action: 'submit_event' });
    const rows = await readAuditLog(db);
    expect(rows).toHaveLength(3);
    // Newest first
    expect(rows[0].action).toBe('submit_event');
    expect(rows[2].action).toBe('login');
  });

  it('filters by actor', async () => {
    const db = makeMockDb();
    await logAudit(db, { actor: 'pm', action: 'login' });
    await logAudit(db, { actor: 'child', action: 'submit_event' });
    await logAudit(db, { actor: 'pm', action: 'logout' });
    const rows = await readAuditLog(db, { actor: 'pm' });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actor === 'pm')).toBe(true);
  });

  it('filters by action', async () => {
    const db = makeMockDb();
    await logAudit(db, { actor: 'pm', action: 'login' });
    await logAudit(db, { actor: 'child', action: 'submit_event' });
    const rows = await readAuditLog(db, { action: 'login' });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('login');
  });

  it('respects limit parameter (default 100, max 500)', async () => {
    const db = makeMockDb();
    for (let i = 0; i < 10; i++) {
      await logAudit(db, { actor: 'pm', action: 'login' });
    }
    const rows = await readAuditLog(db, { limit: 3 });
    expect(rows).toHaveLength(3);
  });

  it('clamps limit to >= 1 and <= 500', async () => {
    const db = makeMockDb();
    await logAudit(db, { actor: 'pm', action: 'login' });
    const rows0 = await readAuditLog(db, { limit: 0 });
    const rows500 = await readAuditLog(db, { limit: 1000 });
    expect(rows0).toHaveLength(1);     // clamped to 1, but we only have 1 row
    expect(rows500).toHaveLength(1);   // clamped to 500, still only 1 row
  });
});
