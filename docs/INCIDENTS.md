# 🚨 kiddo-scoreboard Deploy Incidents

> 每次 backup / deploy 失败, Action 会自动追加一行在这里。
> 不要删这个文件, 它是 fail-safe 信号。 看 commit history 即可追踪所有失败。

## RCA 模板 (新 incident 必填 4 段)

```
## YYYY-MM-DDTHH:MM:SSZ - Deploy or smoke test FAILED
- **Commit**: <sha>
- **Actor**: <user>
- **Run**: <gh-run-id>
- **Branch**: <branch>
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Symptom**: <错误信息原文, e.g. "FOREIGN KEY constraint failed [code: 7500]">
- **Root cause**: <真因, 不只是症状 — 找代码 commit / 库版本 / 配置>
- **Fix**: <PR/commit that resolved it, 或 mitigation>
- **Recovery**: <怎么 rollback / 修>
```

新填 incident 时, 用 4 段 (Symptom / Root cause / Fix / Recovery) 写, 别只贴 GH Actions 失败行.

---

## 2026-06-08T05:22:28Z - Deploy or smoke test FAILED
- **Commit**: a9307e5bd2c8f4a086b538c673a1d52cfb3f1155
- **Actor**: feihc-sh
- **Run**: 27117684788
- **Branch**: refs/heads/main
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Symptom**: `Could not resolve hono` — wrangler 打包 `functions/api/[[path]].ts` 时找不到 hono import
- **Root cause**: GH runner 把 wrangler 装在 global PATH, 但 `node_modules/hono` 没装. 本来 `npm install` 步骤假设 wrangler 自带依赖 (实际 wrangler 只是 CLI wrapper, 真正的 hono 必须 project-local).
- **Fix**: a9307e5 (PR #14) — 加 `npm ci` 在 deploy 步骤前, 装项目级 deps.
- **Recovery**: 不需要回滚. PR #14 修完后 deploy 成功 (2026-06-08 6:33 之后 PR #14 merge).

## 2026-06-11T14:16:44Z - Deploy or smoke test FAILED
- **Commit**: cbfd0c310f5550fd14c96797364a186694b8dc07
- **Actor**: feihc-sh
- **Run**: 27353272553
- **Branch**: refs/heads/main
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Symptom**: `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY [code: 7500]` during `wrangler d1 migrations apply`
- **Root cause**: 0007_coin_system.sql 用 "CREATE new + INSERT SELECT + DROP + RENAME" 模式重建 `score_events` 表 (为加 `type='coins'` CHECK 选项). DROP score_events 时, D1 (SQLite with `foreign_keys=ON`) 触发 FK 检查, 发现 `task_completions.awarded_event_id` 引用了要删的 score_events.id → 失败.
- **Fix**: 0007 migration 需要 `PRAGMA defer_foreign_keys = ON;` 包裹 DROP/RENAME, 或先 `PRAGMA foreign_keys = OFF;` 再恢复. 后续 PR 应修 0007.
- **Recovery**: 部署没改 (D1 migration 没 apply, Pages 部署走 smoke-test fail 之前). 数据无影响, 但 feature (coin system) 没生效.

## 2026-06-11T14:46:58Z - Deploy or smoke test FAILED
- **Commit**: 7d02cdc058d5725670458fd5b722a9e2da18fd52
- **Actor**: feihc-sh
- **Run**: 27355264178
- **Branch**: refs/heads/main
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Symptom**: 同 14:16 一样, `FOREIGN KEY constraint failed [code: 7500]` (同一个未修的 0007 根因)
- **Root cause**: 7d02cdc 改的是测试 + 文档 (badge 文案 sync), 不带 migration. 但 deploy 流程 apply 全部 pending migration, 包括没修的 0007 → 同样 FK 错.
- **Fix**: 治本还是修 0007 (defer_foreign_keys). 治标: 在 0008 之后插入 1 个 0009_migration 修 0007, 或者让 0007 改用 `ALTER TABLE` 替代 DROP/CREATE (SQLite 不支持 ALTER CHECK, 所以这条路不通).
- **Recovery**: 同上, 无数据影响, feature 没生效.

## 2026-06-11T14:47:58Z - Deploy or smoke test FAILED
- **Commit**: d5c86c82b662c15e6496c5bdc541782c4b576167
- **Actor**: feihc-sh
- **Run**: 27355332922
- **Branch**: refs/heads/main
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Symptom**: 同上, `FOREIGN KEY constraint failed [code: 7500]`
- **Root cause**: 同上 (0007 重建表 + FK 约束). d5c86c8 是 test(regression) commit, 也不带 migration fix. 跑 deploy 又 apply 同样未修的 0007.
- **Fix**: 同上, 治本 = 修 0007 migration.
- **Recovery**: 同上.

## 2026-06-11T16:36:02Z - Deploy or smoke test FAILED
- **Commit**: 9d6d1bf14fc5b162f0a5104933406888957e3a27 (PR #35 merge)
- **Actor**: feihc-sh
- **Run**: 27362124186
- **Branch**: refs/heads/main
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Symptom**: 同上, `FOREIGN KEY constraint failed [code: 7500]`
- **Root cause**: 同上 (0007 重建表 + FK 约束). PR #35 加 smoke regression checks (test only), 不带 migration fix.
- **Fix**: 治本 = 修 0007 migration (defer_foreign_keys PRAGMA).
- **Recovery**: 同上.

## ⚠️ Pattern warning (2026-06-11 4 次连续失败)

**所有 4 次 6-11 失败都是同一个根因**: 0007_coin_system.sql DROP score_events 触发 FK 约束, 因 task_completions.awarded_event_id 引用 score_events.id.

**治本建议** (还没修):
- 在 0007 的 DROP 前后加 `PRAGMA defer_foreign_keys = ON;` / `PRAGMA defer_foreign_keys = OFF;` (SQLite 11+)
- 或 wrap 整个 migration in `PRAGMA foreign_keys = OFF;` ... `PRAGMA foreign_keys = ON;`
- 验证: 本地 `wrangler d1 migrations apply kiddo-scoreboard-db --local` 跑通再 push
- 推荐 PR title: `fix(migration): 0007 defer FK constraint for score_events rebuild`

**新 deploy 在修 0007 前会继续翻车** (6-11 之后没再 push, 是因为没修). feihao 提 PR 修 0007 是 P0, 否则 0008_health_events 也上不去.

## 2026-06-14T14:17:26Z - Deploy or smoke test FAILED
- **Commit**: d032482087e99508594279370fffa76c208d69d2
- **Actor**: feihc-sh
- **Run**: 27501579015
- **Branch**: refs/heads/main
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Recovery**: Roll back to last known good deploy via Cloudflare dashboard

## 2026-06-14T15:08:06Z - Deploy or smoke test FAILED
- **Commit**: ede486d048c8bb3fa0e12965876980aa40a7faf7
- **Actor**: feihc-sh
- **Run**: 27502880714
- **Branch**: refs/heads/main
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Recovery**: Roll back to last known good deploy via Cloudflare dashboard

## 2026-06-14T15:27:09Z - Deploy or smoke test FAILED
- **Commit**: 6c3f8f083cbe037c1c45b661ed5965df12795abd
- **Actor**: feihc-sh
- **Run**: 27503406390
- **Branch**: refs/heads/main
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Recovery**: Roll back to last known good deploy via Cloudflare dashboard

## 2026-06-14T15:55:17Z - Deploy or smoke test FAILED
- **Commit**: 990b2a9c707f6f6047ba675226babff61110bad5
- **Actor**: feihc-sh
- **Run**: 27504153270
- **Branch**: refs/heads/main
- **Backup was OK** (data safe), but deploy/smoke-test broke something
- **Recovery**: Roll back to last known good deploy via Cloudflare dashboard

## 2026-06-21T18:06:45Z - Pre-deploy D1 backup FAILED
- **Commit**: 7ce8a637ebffb9b2dc428768da0ee84a09d3309f
- **Actor**: feihc-sh
- **Run**: 27912992052
- **Branch**: refs/heads/main
- **Action**: Deploy blocked (backup is mandatory)
- **Check**: GitHub Actions run log
- **Recovery**: `wrangler d1 export kiddo-scoreboard-db --remote --output=remote-backup/manual-$(date +%Y-%m-%d).sql`

## 2026-06-21T19:09:02Z - Pre-deploy D1 backup FAILED
- **Commit**: 8d89de5cdf205204921bf1b24c896ff2e12c3340
- **Actor**: feihc-sh
- **Run**: 27914553938
- **Branch**: refs/heads/main
- **Action**: Deploy blocked (backup is mandatory)
- **Check**: GitHub Actions run log
- **Recovery**: `wrangler d1 export kiddo-scoreboard-db --remote --output=remote-backup/manual-$(date +%Y-%m-%d).sql`

