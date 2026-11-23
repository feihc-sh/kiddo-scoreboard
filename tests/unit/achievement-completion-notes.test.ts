// tests/unit/achievement-completion-notes.test.ts
// 发放记录「完成日期 / 完成内容」+ 新奖项「读完一本英文长篇小说」
// (spec docs/achievements-spec.md §2 / §7c, migration 0022).
//
// 覆盖三段:
//   1. admin grant 端点 —— completed_on / note 的落库 + 校验 + audit details
//   2. public API —— records 数组的序列化 (降序 / null / 空数组)
//   3. 新奖项 —— 「读完一本英文长篇小说」出现在目录里 (grp/ladder/位置)
//
// 跑在内存 mock DB 上 (见 achievements-mock.ts) —— mock 镜像真实 SQL 语义
// (last_insert_rowid / 条件 INSERT), 所以断言的是**语句契约**而不是
// 手写返回值。

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import {
  addAchievement,
  addSeason,
  addUser,
  makeMockDb,
  type MockState,
} from './achievements-mock.ts';

const SECRET = 'unit-test-secret-1234567890';
const CHILD_ID = 2;
const PM_ID = 1;

let mock = makeMockDb();
let state: MockState;

beforeEach(() => {
  mock = makeMockDb();
  state = mock.state;
  addUser(state, PM_ID, 'pm');
  addUser(state, CHILD_ID, 'child');
  addSeason(state, { id: 1, name: 'S1 · 四年级上学期', starts_on: '2026-09-01', is_current: 1 });
});

function envObj() {
  return { DB: mock.db, JWT_SECRET: SECRET };
}

async function pmCookie(): Promise<string> {
  const token = await signSession(
    { user_id: PM_ID, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  return `pm_session=${token}`;
}

async function post(path: string, body: unknown, cookie?: string) {
  return app.request(
    `http://test.local${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    },
    envObj(),
  );
}

async function get(path: string) {
  return app.request(`http://test.local${path}`, {}, envObj());
}

// =============================================================
// 1. Grant — 完成日期 / 完成内容
// =============================================================
describe('POST /api/admin/achievement-awards — 完成详情 (spec §7c)', () => {
  it('stores completed_on and note on the award row', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    const r = await post(
      '/api/admin/achievement-awards',
      {
        achievement_id: ach.id,
        tier: 'bronze',
        user_id: CHILD_ID,
        completed_on: '2026-11-21',
        note: '英语课外班默写全对',
      },
      cookie,
    );
    expect(r.status).toBe(201);

    // 落库: award 行带着两个字段。
    expect(state.awards).toHaveLength(1);
    expect(state.awards[0].completed_on).toBe('2026-11-21');
    expect(state.awards[0].note).toBe('英语课外班默写全对');

    // 响应体也回显这两个字段。
    const body = (await r.json()) as {
      award: { completed_on: string | null; note: string | null };
    };
    expect(body.award.completed_on).toBe('2026-11-21');
    expect(body.award.note).toBe('英语课外班默写全对');
  });

  it('stores NULL for both fields when they are not supplied', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'bronze', user_id: CHILD_ID },
      cookie,
    );
    expect(r.status).toBe(201);

    expect(state.awards).toHaveLength(1);
    expect(state.awards[0].completed_on).toBeNull();
    expect(state.awards[0].note).toBeNull();
  });

  it('treats empty strings as "not recorded" (NULL), not as empty text', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    const r = await post(
      '/api/admin/achievement-awards',
      {
        achievement_id: ach.id,
        tier: 'bronze',
        user_id: CHILD_ID,
        completed_on: '',
        note: '',
      },
      cookie,
    );
    expect(r.status).toBe(201);
    expect(state.awards[0].completed_on).toBeNull();
    expect(state.awards[0].note).toBeNull();
  });

  it('trims whitespace around the note before storing it', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    await post(
      '/api/admin/achievement-awards',
      {
        achievement_id: ach.id,
        tier: 'bronze',
        user_id: CHILD_ID,
        note: '  英语课外班默写全对  ',
      },
      cookie,
    );
    expect(state.awards[0].note).toBe('英语课外班默写全对');
  });

  it('writes completed_on and note into the audit details', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    await post(
      '/api/admin/achievement-awards',
      {
        achievement_id: ach.id,
        tier: 'silver',
        user_id: CHILD_ID,
        completed_on: '2026-11-21',
        note: '英语课外班默写全对',
      },
      cookie,
    );

    expect(state.audit).toHaveLength(1);
    const details = JSON.parse(state.audit[0].details) as Record<string, unknown>;
    expect(details.completed_on).toBe('2026-11-21');
    expect(details.note).toBe('英语课外班默写全对');
    // 原有字段不受影响。
    expect(details.tier).toBe('silver');
    expect(details.achievement_id).toBe(ach.id);
  });

  it('rejects a malformed completed_on with 400 INVALID', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    for (const bad of ['21/11/2026', '2026-11', 'not-a-date', '20261121']) {
      const r = await post(
        '/api/admin/achievement-awards',
        {
          achievement_id: ach.id,
          tier: 'bronze',
          user_id: CHILD_ID,
          completed_on: bad,
        },
        cookie,
      );
      expect(r.status).toBe(400);
      const body = (await r.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID');
    }

    // 一条都没写进去。
    expect(state.awards).toHaveLength(0);
  });

  it('rejects a note longer than 100 characters with 400', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    const r = await post(
      '/api/admin/achievement-awards',
      {
        achievement_id: ach.id,
        tier: 'bronze',
        user_id: CHILD_ID,
        note: '字'.repeat(101),
      },
      cookie,
    );
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID');
    expect(state.awards).toHaveLength(0);
  });

  it('accepts a note of exactly 100 characters', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    const note = '字'.repeat(100);
    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'bronze', user_id: CHILD_ID, note },
      cookie,
    );
    expect(r.status).toBe(201);
    expect(state.awards[0].note).toBe(note);
  });

  it('same-tier re-grant keeps each record separate (records accumulate)', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    await post(
      '/api/admin/achievement-awards',
      {
        achievement_id: ach.id,
        tier: 'bronze',
        user_id: CHILD_ID,
        completed_on: '2026-11-01',
        note: '第一次',
      },
      cookie,
    );
    await post(
      '/api/admin/achievement-awards',
      {
        achievement_id: ach.id,
        tier: 'bronze',
        user_id: CHILD_ID,
        completed_on: '2026-11-21',
        note: '第二次',
      },
      cookie,
    );

    // 两次发放 = 两行, 各自带自己的完成详情。
    expect(state.awards).toHaveLength(2);
    expect(state.awards[0].note).toBe('第一次');
    expect(state.awards[1].note).toBe('第二次');
  });
});

// =============================================================
// 2. Public API — records 数组
// =============================================================
describe('GET /api/public/achievements — records (spec §7c)', () => {
  interface WallResponse {
    achievements: Array<{
      id: number;
      name: string;
      award: { tier: string; count: number } | null;
      records: Array<{
        completed_on: string | null;
        note: string | null;
        granted_at: string;
      }>;
    }>;
  }

  /** 种一个奖项 (默认 id=1, 语文默写全对)。 */
  function seedAchievement(overrides = {}) {
    return addAchievement(state, {
      id: 1,
      grp: 'study',
      name: '语文默写全对',
      grant_mode: 'admin_tier',
      ladder_json: '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',
      sort_order: 1,
      ...overrides,
    });
  }

  /** 种一条发放记录。 */
  function seedAward(overrides: Record<string, unknown> = {}) {
    const id = state.nextIds.award++;
    state.awards.push({
      id,
      achievement_id: 1,
      user_id: CHILD_ID,
      tier: 'bronze',
      season_id: 1,
      status: 'active',
      granted_by: PM_ID,
      granted_at: 1_700_000_000,
      revoked_at: null,
      revoked_by: null,
      completed_on: null,
      note: null,
      ...overrides,
    });
    return state.awards[state.awards.length - 1];
  }

  beforeEach(() => {
    addSeason(state, { id: 1, is_current: 1 });
    seedAchievement();
  });

  it('returns an empty records array when nothing was earned', async () => {
    const r = await get('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    expect(body.achievements[0].records).toEqual([]);
  });

  it('serializes completed_on / note / granted_at for each record', async () => {
    seedAward({
      completed_on: '2026-11-21',
      note: '英语课外班默写全对',
      granted_at: 1_700_000_000,
    });

    const r = await get('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    const records = body.achievements[0].records;

    expect(records).toHaveLength(1);
    expect(records[0].completed_on).toBe('2026-11-21');
    expect(records[0].note).toBe('英语课外班默写全对');
    expect(records[0].granted_at).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it('orders records by granted_at DESC (newest first)', async () => {
    seedAward({ granted_at: 1_700_000_000, note: '最早' });
    seedAward({ granted_at: 1_700_000_900, note: '中间' });
    seedAward({ granted_at: 1_700_001_800, note: '最近' });

    const r = await get('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    const notes = body.achievements[0].records.map((x) => x.note);

    expect(notes).toEqual(['最近', '中间', '最早']);
  });

  it('serializes NULL completed_on / note as null (not omitted, not empty string)', async () => {
    seedAward({ completed_on: null, note: null });

    const r = await get('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    const record = body.achievements[0].records[0];

    expect(record.completed_on).toBeNull();
    expect(record.note).toBeNull();
    // 字段必须在 (不能因为是 null 就整个消失 —— 前端读的是固定形状)。
    expect(Object.keys(record).sort()).toEqual(['completed_on', 'granted_at', 'note']);
  });

  it('excludes revoked awards from the records list', async () => {
    seedAward({ note: '有效记录', granted_at: 1_700_001_000 });
    seedAward({
      status: 'revoked',
      revoked_at: 1_700_002_000,
      revoked_by: PM_ID,
      note: '已撤销',
      granted_at: 1_700_000_000,
    });

    const r = await get('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    const records = body.achievements[0].records;

    expect(records).toHaveLength(1);
    expect(records[0].note).toBe('有效记录');
  });

  it('every achievement carries a records array (even unlocked-free ones)', async () => {
    seedAchievement();
    addAchievement(state, {
      id: 2,
      grp: 'life',
      name: '自律生活',
      grant_mode: 'auto_streak',
      ladder_json: '{"iron":2,"bronze":4,"silver":8,"gold":15,"king":30}',
      sort_order: 4,
    });

    const r = await get('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    for (const a of body.achievements) {
      expect(Array.isArray(a.records)).toBe(true);
    }
  });
});

// =============================================================
// 3. 新奖项「读完一本英文长篇小说」
// =============================================================
describe('新奖项「读完一本英文长篇小说」(migration 0022)', () => {
  it('appears in the achievements catalog with the skill group and the count ladder', async () => {
    addSeason(state, { id: 1, is_current: 1 });
    const en = addAchievement(state, {
      id: 9,
      grp: 'skill',
      name: '读完一本英文长篇小说',
      description: '读完一本英文长篇小说',
      grant_mode: 'admin_tier',
      ladder_json: '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',
      sort_order: 6.5,
    });

    const r = await get('/api/public/achievements?user_id=2');
    const body = (await r.json()) as {
      achievements: Array<{
        id: number;
        grp: string;
        name: string;
        description: string | null;
        grant_mode: string;
        ladder: Record<string, number>;
      }>;
    };

    const found = body.achievements.find((a) => a.id === en.id);
    expect(found).toBeDefined();
    expect(found!.grp).toBe('skill');
    expect(found!.name).toBe('读完一本英文长篇小说');
    expect(found!.description).toBe('读完一本英文长篇小说');
    expect(found!.grant_mode).toBe('admin_tier');
    // ladder 走服务端 parse —— 是对象, 不是 JSON 字符串 (R11)。
    expect(found!.ladder).toEqual({ iron: 1, bronze: 3, silver: 5, gold: 8, king: 10 });
    expect(typeof found!.ladder).toBe('object');
  });

  it('is a SEPARATE award from 「读完一本长篇中文小说」 (not a rename)', async () => {
    addSeason(state, { id: 1, is_current: 1 });
    const chinese = addAchievement(state, {
      id: 6,
      grp: 'skill',
      name: '读完一本长篇中文小说',
      description: '读完一本长篇中文小说',
      grant_mode: 'admin_tier',
      ladder_json: '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',
      sort_order: 6,
    });
    const english = addAchievement(state, {
      id: 9,
      grp: 'skill',
      name: '读完一本英文长篇小说',
      description: '读完一本英文长篇小说',
      grant_mode: 'admin_tier',
      ladder_json: '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',
      sort_order: 6.5,
    });

    const r = await get('/api/public/achievements?user_id=2');
    const body = (await r.json()) as {
      achievements: Array<{ id: number; name: string }>;
    };

    const names = body.achievements.map((a) => a.name);
    expect(names).toContain('读完一本长篇中文小说');
    expect(names).toContain('读完一本英文长篇小说');
    expect(chinese.id).not.toBe(english.id);
  });

  it('sorts between 中文长篇 (6) and 曲子 (7) by sort_order', async () => {
    addSeason(state, { id: 1, is_current: 1 });
    addAchievement(state, { id: 6, grp: 'skill', name: '读完一本长篇中文小说', sort_order: 6 });
    addAchievement(state, { id: 9, grp: 'skill', name: '读完一本英文长篇小说', sort_order: 6.5 });
    addAchievement(state, { id: 7, grp: 'skill', name: '完成一首新曲子演奏', sort_order: 7 });
    addAchievement(state, { id: 8, grp: 'skill', name: '通关一个新游戏', sort_order: 8 });

    const r = await get('/api/public/achievements?user_id=2');
    const body = (await r.json()) as { achievements: Array<{ name: string }> };
    const names = body.achievements.map((a) => a.name);

    expect(names.indexOf('读完一本长篇中文小说')).toBeLessThan(
      names.indexOf('读完一本英文长篇小说'),
    );
    expect(names.indexOf('读完一本英文长篇小说')).toBeLessThan(
      names.indexOf('完成一首新曲子演奏'),
    );
  });

  it('can be granted like any other admin_tier award (mints the right tokens)', async () => {
    const ach = addAchievement(state, {
      id: 9,
      grp: 'skill',
      name: '读完一本英文长篇小说',
      grant_mode: 'admin_tier',
      ladder_json: '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',
    });
    const cookie = await pmCookie();

    const r = await post(
      '/api/admin/achievement-awards',
      {
        achievement_id: ach.id,
        tier: 'gold',
        user_id: CHILD_ID,
        completed_on: '2026-11-21',
        note: '读完 Harry Potter 第一册',
      },
      cookie,
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as { tokens_minted: number; award: { note: string } };
    // 金牌 = +5 星币 (spec §5)
    expect(body.tokens_minted).toBe(5);
    expect(body.award.note).toBe('读完 Harry Potter 第一册');
  });
});
