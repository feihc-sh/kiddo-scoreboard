# 2026-06-06 — Phase 2 hotfix: task buttons + seg-btn + server bind bug

## User report
1. 任务按钮很小且点不动，点了没变绿色 + 加奖励
2. 申请表里"想要"和"扣分"按下去没反应，不知道选了哪个

## Investigation
Wrote a regression spec (now `tests/e2e/ui-task-and-segbtn.spec.ts`) that:
- Seeds 2 active tasks
- Loads child page, checks task-btn size + click → done state
- Opens submit modal, checks seg-btn initial active + toggle behavior

**Found 3 root causes** (1 client + 1 client + 1 server):

### Bug 1: CSS missing for `.task-btn` / `.task-btn-done`
- `public/app.js:126` `btn.className = 'task-btn' + (done ? ' task-btn-done' : '')`
- `public/app.css` had **zero matches** for `.task-btn` — buttons used browser default `<button>` styling
- (Old `.task-shortcut` rules from Phase 1 were a different class name; renderTasks never used them.)
- Result: tiny ~30px buttons, no touch target, no green "done" state

### Bug 2: `.seg-btn` class name mismatch
- `public/app.js:297` toggles class `seg-btn-active`
- `public/app.css:498` selector was `.seg-btn.active` — never matched
- Result: clicking +/- did nothing visible (state.selectedDir updated, but no visual)

### Bug 3 (P0 server bug): `tasks.ts:100` extra `bind()` arg
- `INSERT INTO task_completions ... VALUES (?, ?, 'active', ?, unixepoch())` has 3 `?` placeholders
- `.bind(taskId, CHILD_USER_ID, 'active', today)` had **4** args (extra 'active')
- D1 error: `Wrong number of parameter bindings for SQL query`
- POST `/api/me/tasks/:id/complete` returned **500**
- Why didn't phase 1 catch this? The 12 phase-1 e2e tests didn't seed tasks + complete them together.

## Fixes
- `public/app.css`: added full `.task-btn` block (100px min-height for iPad touch, .task-btn-done green gradient) + `.task-btn .task-name` etc. nested rules; also fixed double-selector `.seg-btn.active, .seg-btn.seg-btn-active`
- `public/app.js:openSubmitModal()`: now syncs `seg-btn-active` class on every open (so + button shows active by default, not just on close)
- `src/routes/me/tasks.ts:100`: removed extra 'active' bind arg
- `tests/e2e/helpers/db.ts`: switched `d1Exec` from `wrangler d1 execute` to direct `sqlite3` CLI on the workerd D1 file — eliminates the file-vs-workerd-cache sync gap (3-5s speedup too)
- `tests/e2e/ui-child-main.spec.ts:82`: same fix at the inline `execSync` site
- All 3 HTML files: bumped `?v=2 → ?v=4` for cache-busting

## Verification
- New regression test `tests/e2e/ui-task-and-segbtn.spec.ts`:
  - task-btn size 140x100 ✓
  - click → POST /complete → 201 ✓
  - task-btn-done class added + disabled + green bg ✓
  - seg-btn initial: + active + linear-gradient bgImage ✓
  - click - → - active + + inactive ✓
- Full suite: **100 passed (47.8s)** — no pre-existing flaky
- 4 new screenshots `09-12*.png` show visual confirmation

## iPad user action
Same as before iPad cache fix:
1. Kill Safari process (swipe up from home bar)
2. Reopen Safari
3. Visit https://chem-asn-cir-chester.trycloudflare.com/
4. Try a task click → should turn green + add reward
5. Open submit modal → + should show active orange by default

## Lessons (saved to skill below)
- **CSS class name parity check**: when you add JS that generates DOM with className, ALWAYS grep CSS for the class FIRST, not after the test fails
- **Server `bind()` count**: count `?` in SQL, count args in `.bind()` — they MUST match (D1 enforces strictly, unlike some other ORMs)
- **workerd + wrangler d1 execute cache gap**: don't mix `wrangler d1 execute` (file write) with running workerd (cached) for setup/seed. Either use `sqlite3` CLI directly (sync) or restart workerd.
