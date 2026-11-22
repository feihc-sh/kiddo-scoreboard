# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**kiddo-scoreboard** — A family reward/punishment PWA built on Cloudflare Workers + D1 + Hono. Parents manage tasks, rewards, and approvals; children submit requests and track progress.

- Production: https://kiddo-scoreboard.pages.dev
- Runtime: Cloudflare Workers (V8 isolates), Pages deployment
- Storage: Cloudflare D1 (SQLite), deployed migrations
- Auth: PIN + bcrypt + cookie session

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Hono 4 + TypeScript (strict) |
| Database | Cloudflare D1 (SQLite) + Drizzle ORM (planned) |
| Tests | Vitest (unit) + Playwright (e2e, iPad Safari viewport) |
| Deploy | Wrangler + Cloudflare Pages |
| Auth | PIN + bcrypt + Cookie session |

## Key Commands

```bash
# Development
npm run dev                              # wrangler pages dev (port 8787)
npm run test:unit                        # Vitest unit tests only
npx vitest run                           # same as above
npx playwright test                      # full e2e suite
npx playwright test tests/e2e/foo.spec.ts  # single spec file

# Type checking
npm run typecheck                        # tsc --noEmit

# Deploy (requires backup first!)
wrangler pages deploy ./public --branch main --project-name kiddo-scoreboard

# D1 migrations
wrangler d1 migrations apply kiddo-scoreboard-db --remote
```

## Architecture

### Frontend (static)
- `public/` — Static files served by Cloudflare Pages. All routes are file-based (no server routing for frontend).
- `public/app.html` — Child-facing SPA
- `public/admin/` — Admin SPA
- `public/fighter/` — Fighter V1 (legacy)
- `public/fighter/v2/` — Fighter V2 RPG (world-map, battle-scene, combat, skills, shop)

### Backend (API routes)
- `src/worker.ts` — Hono app entry, mounts all route modules
- `src/routes/admin/` — PM-facing API (tasks, events, grants, audit)
- `src/routes/me/` — Child-facing API (profile, balance, tasks, coins)
- `src/routes/public/` — Public API (health, calendar, tasks, balance)
- `src/routes/shop/` — Shop catalog + redemptions
- `src/routes/running/` — Running map check-in records
- `src/db/types.ts` — TypeScript interfaces for all D1 row types + enums

### Fighter V2 Module (self-contained RPG)
Located in `public/fighter/v2/`. **Read `docs/FIGHTER-V2-STATUS.md` before changing it**; the older `HANDOVER-fighter-v2.md` is a historical design draft.

- `fighter.js` — Entry point and 3-view router (main-menu / stage-intro / battle)
- `fighter.css` — All scene styles (~1919 lines; high regression risk)
- `battle-controller.js` — Turn orchestration and win/defeat/shop transitions
- `battle-scene.js` — DOM battle renderer (sprites, HP/MP, floating text, banners)
- `combat.js` — Damage/skill/turn pure functions
- `skill-effects.js` — Fireball/heal/shield VFX; note that only fireball is currently reachable from UI
- `equipment.js` / `shop-modal.js` — Equipment data, purchase logic, shop modal
- `world-map.js` — Despite its name, currently renders a Main Menu; no World selector
- `stage-intro.js` — World stage list and production lock
- `stages.js` — 15 stage definitions: 9 non-empty across World 0-2, 6 empty/deferred across World 3-4
- `utils.js` — localStorage (`fighterV2Bank`) and DOM helpers
- Assets currently come from **both** `public/assets/fighter/v2/` (source sprite sheets) and local cropped/runtime files under `public/fighter/v2/`; verify the actual `src` in DOM before moving files

**Current P0 state (2026-07-20)**: only World 0 is reachable; SKILL is hardcoded to fireball; ITEM has no effect; cooldown is not written; battle sprite mapping is visually wrong; Fighter V2 unit baseline is red. See the status doc for evidence and backlog.

### Data Model
- `migrations/` — D1 schema migrations (0001_initial.sql + 0002_auth.sql + 0003_app_config.sql + 0004_sleep_cutoff.sql)
- All timestamps stored as Unix seconds (INTEGER in D1)
- `audit_log` table records every write operation with actor + action + details JSON

## Conventions

### Timezone
All dates/times use **Asia/Shanghai** timezone. Week numbering follows ISO 8601 (`'2026-W23'`).

### Audit Logging
Every write operation must call `logAudit()` from `src/utils/audit.ts` AFTER the write, with a structured `details` object. This is how the app tracks who did what.

### API Response Format
Use consistent envelope: `{ status, data, error, meta }` where `data` is nullable on error, `error` is nullable on success, and `meta` is for pagination.

### Fighter V2 State
Fighter V2 is **client-side only** (no server persistence).
Game state stored in `localStorage` under key `fighterV2Bank` (schema: bank + session + hero + equipment + progress).
See `docs/FIGHTER-V2-STATUS.md` §D for full schema.

## Important IDs

| Item | Value |
|---|---|
| D1 database_id | `b584ebbf-bcb3-45d2-85e8-3ca2d5cb297c` |
| D1 binding name | `DB` (use `c.env.DB` in worker) |
| PM PIN | `123654` (hashed in D1 users table) |
| Production URL | `https://kiddo-scoreboard.pages.dev` |

## Testing

- Unit tests: `tests/unit/` (Vitest, `npm run test:unit`)
- E2E tests: `tests/e2e/` (Playwright, `npm test` or `npx playwright test`)
- Playwright uses **iPad landscape** viewport (1024×768) via iPad Safari device emulation
- webServer in playwright.config.ts starts `wrangler pages dev ./public --port 8787` automatically
- Fighter V2 unit tests: `tests/unit/fighter-v2/` (Vitest node environment). Current baseline on 2026-07-20: **6 files pass / 2 fail; 192 tests pass / 12 fail**
- Fighter V2 E2E tests: `tests/e2e/fighter-v2/` (Playwright, iPad 1024×768)
  - ⚠️ `battle.spec.ts` has class name mismatch — tests currently failing, see `docs/FIGHTER-V2-STATUS.md` §H
- Visual tests: `scripts/visual-test-suite.mjs` — requires running tunnel URL

## Known Gotchas

| Issue | Fix |
|---|---|
| PBKDF2 > 100k iterations fails on CF Workers | Use exactly 100k iterations |
| wrangler.toml missing `name` + `pages_build_output_dir` | Causes D1 binding to fail → 500 |
| `.workers.dev` domain blocked by GFW | Use `.pages.dev` for production |
| wrangler 4.98 `d1 execute --persist-to` resolves absolute paths incorrectly | Use `sqlite3` CLI directly instead |
| Fighter V2 uses both source sheets and cropped runtime assets | Check actual `<img src>` plus `ASSET-CATALOG.md`; never assume the filename matches image content |
| Fighter V2 Stage Intro module reads `window` at import time | Node Vitest crashes unless guarded or run with a DOM environment |
| `playwright.config.ts` has `reuseExistingServer: true` on port 8787 | Confirm port 8787 belongs to this worktree before E2E; another worktree can silently serve the wrong app |
