# Web UI End-to-End Test Plan

**Status:** Draft v1
**Date:** 2026-06-05
**Owner:** Qual Agent (delegated)
**Audience:** Downstream Code Agents (CCs) who will implement these scenarios as Playwright specs.
**Scope:** Web UI only — two single-page apps (child SPA + PM SPA). Backend API behavior is covered separately in `tests/e2e/*-api-*.spec.ts` style files (see Appendix B).

---

## Table of Contents

1. [Test Strategy](#1-test-strategy)
2. [Test Environment](#2-test-environment)
3. [Test Scenarios by Feature](#3-test-scenarios-by-feature)
   - 3.1 [PM Login](#31-pm-login)
   - 3.2 [PM Dashboard Shell](#32-pm-dashboard-shell)
   - 3.3 [PM Pending Events](#33-pm-pending-events)
   - 3.4 [PM All Events](#34-pm-all-events)
   - 3.5 [PM Task Config (CRUD)](#35-pm-task-config-crud)
   - 3.6 [PM Audit Log](#36-pm-audit-log)
   - 3.7 [PM 双账户兑换 (game ↔ money)](#37-pm-双账户兑换-game--money)
   - 3.8 [PM Weekly Grant](#38-pm-weekly-grant)
   - 3.9 [Child First-time Flow](#39-child-first-time-flow)
   - 3.10 [Child Main Page](#310-child-main-page)
   - 3.11 [Child Task Complete](#311-child-task-complete)
   - 3.12 [Child Event Submit](#312-child-event-submit)
   - 3.13 [Child Recent Events](#313-child-recent-events)
   - 3.14 [Child Sleep Lockout](#314-child-sleep-lockout-self-lockout-task-type--item-002)
   - 3.15 [Admin Hard Delete](#315-admin-hard-delete-v22-新增-item-009)
   - 3.16 [Coin System Test Scenarios](#316-coin-system-test-scenarios-v3-新增)
4. [Cross-Cutting E2E Flows](#4-cross-cutting-e2e-flows)
5. [Visual & UX Tests (Manual QA)](#5-visual--ux-tests-manual-qa)
6. [Non-Functional Tests](#6-non-functional-tests)
7. [Coverage Matrix (PRD Use Cases)](#7-coverage-matrix-prd-use-cases)
8. [Implementation Plan](#8-implementation-plan)
9. [Open Questions for PM](#9-open-questions-for-pm)
10. [Appendix A: Test Data Fixtures](#appendix-a-test-data-fixtures)
11. [Appendix B: Existing Test Gaps](#appendix-b-existing-test-gaps)

---

## 1. Test Strategy

### 1.1 Personas

| Persona | Device | Entry Point | Auth | Vocabulary |
|---------|--------|-------------|------|------------|
| **Child (儿子)** | iPad Safari | `/` | None (public) | Name, balance, tasks, submit request |
| **PM (爸爸)** | Desktop Chrome / Mobile Safari | `/admin/` | PIN (4–8 digits) + HttpOnly cookie session | Approve, revoke, CRUD, audit, exchange, grant |

### 1.2 UIs to Cover

1. **Child SPA** — `public/index.html` + `app.js` + `app.css`
   - Sections: welcome modal, hero, balance cards (game time / pocket money), task shortcuts, submit modal, recent events list, error banner, toast, confetti canvas.
2. **PM SPA — Login** — `public/admin/login.html` + `login.js`
   - Sections: number pad (3×4), PIN dots, submit/back keys, lockout banner, error banner.
3. **PM SPA — Dashboard** — `public/admin/index.html` + `admin.js`
   - 7 collapsible sections (A–G): pending events, all events, tasks config, audit log, exchange, weekly grant, task completions history.

### 1.3 Test Environment

- **Viewport:** iPad (gen 7) landscape — 1024×768 (per existing `playwright.config.ts`).
- **Backend:** `wrangler dev` on `localhost:8787`, with D1 in local mode.
- **Reset:** Each test seeds its own D1 state via a helper that runs `wrangler d1 execute --local` with a TRUNCATE-equivalent script (see §2.4).

### 1.4 Test Types

| Type | Purpose | Count estimate |
|------|---------|----------------|
| **Smoke** | Page loads, key elements render, no JS errors | ~2 specs |
| **Happy path** | One end-to-end user flow per feature | ~13 specs |
| **Edge case** | Validation, network errors, lockout, empty states | ~6 specs |
| **Cross-cutting** | Multi-feature flows (new-user day, weekly payout, etc.) | ~5 specs |

### 1.5 Out of Scope

- Visual regression / pixel diff (deferred to v2 — see §9).
- Offline mode (PRD YAGNI).
- Browser matrix beyond iPad Safari (primary) + Chrome (PM secondary) — see §6.3.
- Server-side unit/integration tests (already covered by `tests/unit/*`).

---

## 2. Test Environment

### 2.1 Hardware / Software

- **Test runner:** Playwright 1.x (per `playwright.config.ts`).
- **Browser project:** `iPad (gen 7) landscape` (Chromium engine with iPad UA + touch).
- **Backend:** `wrangler dev --port 8787` (started by `playwright.config.ts` webServer block).
- **D1:** Local mode, auto-applies migrations from `migrations/`.

### 2.2 Seed Data

A single seed function (`seedChildData` below) inserts the canonical fixture set used across most tests:

- 1 PM user (`id=1`, name=PM, role=pm, bcrypt PIN=123654).
- 1 Child user (`id=2`, name=NULL initially; tests set it as needed).
- 3 active tasks (see Appendix A).
- 5 sample score events spanning statuses (`pending`, `approved`, `rejected`, `revoked`) and accounts (`game_time`, `pocket_money`).

### 2.3 Reset Between Tests

`fullyParallel: false` and `workers: 1` in `playwright.config.ts` mean tests run serially. A `beforeEach` hook in each spec calls `clearAllData()` (helper below) so the DB starts in a known state. We **do not** truncate `users` (id=1 and id=2 are restored by seed); we delete from `score_events`, `task_completions`, `audit_log`, `tasks`, `auth_attempts`.

### 2.4 Reusable Helpers

The following helpers live in `tests/e2e/helpers/db.ts` and `tests/e2e/helpers/ui.ts` (CCs implement). They are described here as contracts, not as code.

| Helper | Signature (TypeScript) | Purpose |
|--------|------------------------|---------|
| `clearAllData()` | `() => Promise<void>` | Deletes rows from dynamic tables; resets child `name=NULL`; clears `auth_attempts`. |
| `seedChildData(opts?)` | `(opts?: { tasks?: number; events?: number; childName?: string \| null }) => Promise<{ taskIds: number[]; eventIds: number[] }>` | Inserts the canonical fixture (or a smaller subset). Returns ids for follow-up assertions. |
| `loginAsPm(pin)` | `(pin: string) => Promise<void>` | Types digits into the login pad, clicks ✓, waits for redirect to `/admin/`. |
| `loginAsPmViaApi(pin)` | `(pin: string) => Promise<{ cookie: string }>` | POSTs to `/api/admin/auth/login`, returns the session cookie. Useful when UI login is noise (e.g., a spec focused on section G). |
| `waitForApiCall(url, method, opts?)` | `(url: string \| RegExp, method: string, opts?: { status?: number; timeout?: number }) => Promise<Request>` | Resolves on the first matching Playwright `request` event after current call. |
| `expectToast(text)` | `(text: string \| RegExp) => Promise<void>` | Polls `#toast` for visible text; fails after 3 s. |
| `expectBalance(account, value)` | `(account: 'game_time' \| 'pocket_money', value: number) => Promise<void>` | Reads `#balance-game-time` or `#balance-pocket-money`, asserts value. |

### 2.5 Time Mocking

Lockout (5-minute cooldown) is a real concern. Two strategies are acceptable:

1. **Real-time wait** — used only for the lockout recovery happy path; add `await page.waitForTimeout(5 * 60_000)` (acceptable because we have one test).
2. **Direct DB mutation** — for the rest, clear `auth_attempts` rows in `beforeEach` (already covered by `clearAllData`).

For date-dependent scenarios (e.g., "task completed today → 409 on second click"), we use `Date.now()` and rely on test execution being within a single calendar day. Add a CI-only env-var guard if running across midnight is a concern.

---

## 3. Test Scenarios by Feature

> **Format:** Each subsection lists the test scenarios in three groups: **Smoke**, **Happy path**, **Edge cases**. Each scenario becomes one `test()` (or `it()`) in a `describe()` block named after the feature. "Steps" describe UI interactions. "Assert" lists the expected UI/API outcome.

---

### 3.1 PM Login

**Spec file:** `tests/e2e/ui-admin-login.spec.ts`
**Page:** `/admin/login`
**Element IDs (from `login.html`):** `#login-pad`, `#login-dots`, `#login-back`, `#login-submit`, `[data-digit="N"]`, `#login-locked`, `#error-banner`, `#error-banner-retry`, `#toast`.

#### Smoke
- **Scenario: Login page renders all key elements in iPad viewport**
  - Steps: `page.goto('/admin/login')`.
  - Assert: 10 digit keys visible (0–9), submit/back keys visible, 4 dots visible, `login-pad` is in viewport, `<title>` contains `家长登录`, no console errors.

#### Happy path
- **Scenario: PM enters valid 4-digit PIN and reaches dashboard**
  - Steps: Click `1 → 2 → 3 → 6`, click `✓`.
  - Assert: Dots fill orange; `✓` enabled at 4 digits; after click, URL changes to `/admin/`; `audit_log` contains a `login` action with `actor=pm` (verify via `GET /api/admin/audit-log` with session cookie).

- **Scenario: PM enters valid 6-digit PIN (extended)**
  - Steps: Click `1 → 2 → 3 → 6 → 5 → 4`, click `✓`.
  - Assert: First 4 dots fill; dots 5–6 (`.login-dot[data-extra]`) also fill; no auto-submit at 4 digits; `✓` enabled; login succeeds.

#### Edge cases — input validation
- **Scenario: PM enters 3 digits and clicks `✓`**
  - Steps: Click `1 → 2 → 3`, attempt to click `✓`.
  - Assert: `✓` is disabled; clicking has no effect; no `/api/admin/auth/login` request fires.

- **Scenario: PM types 9th digit — 9th is ignored**
  - Steps: Click digits `1–8`, then click `9` and `0`.
  - Assert: PIN length is capped at 8; 9th and 10th clicks are no-ops (no additional dot fills); `✓` still submits the 8-digit buffer.

- **Scenario: PM clicks backspace on empty buffer**
  - Steps: Load `/admin/login`, click `⌫` (no prior digits).
  - Assert: No JS error; dots remain empty; `✓` stays disabled.

- **Scenario: PM presses `Backspace` key on body**
  - Steps: Load page, press `Backspace` keyboard key.
  - Assert: Optional behavior — either ignored, or treated like `⌫` click. Document actual behavior; do not crash.

- **Scenario: PM presses `Esc`**
  - Steps: Type `1 2 3 4`, press `Esc`.
  - Assert: Buffer cleared, dots empty, `✓` disabled.

- **Scenario: PM clicks the same digit rapidly (debounce / duplicate not blocked)**
  - Steps: Click `1` 4 times in quick succession.
  - Assert: All 4 clicks register as buffer input (or at most one per ~50 ms — document actual behavior); no crash.

#### Edge cases — wrong PIN & lockout
- **Scenario: PM enters wrong PIN 5 times — lockout banner appears**
  - Steps: Submit 5 wrong attempts (e.g., `0 0 0 0` × 5).
  - Assert: After the 5th, the server returns 429 `TOO_MANY_ATTEMPTS`; `#login-locked` becomes visible; pad remains visible but `✓` is disabled; `auth_attempts` table has 5 rows for ip/user.

- **Scenario: PM types during lockout — input is ignored**
  - Steps: After lockout banner shows, click digit keys.
  - Assert: Dots do not fill; no API call fires; banner remains.

- **Scenario: PM recovers from lockout after 5 minutes**
  - Steps: After triggering lockout, wait 5 min, then enter correct PIN.
  - Assert: Login succeeds; banner disappears; `auth_attempts` cleared on success.

#### Network / server errors
- **Scenario: Server returns 500 on login**
  - Steps: Mock `/api/admin/auth/login` to return 500 (use `page.route`).
  - Assert: `#error-banner` shows retry button; toast with error message; no crash.

- **Scenario: Network offline**
  - Steps: `page.context().setOffline(true)`, click submit with valid PIN length.
  - Assert: Fetch fails; error banner shows; `✓` re-enables for retry.

- **Scenario: Session check (`/api/admin/auth/me`) returns 401 after login**
  - Steps: Manually expire cookie, reload dashboard.
  - Assert: Client redirects to `/admin/login`; URL contains `?next=` or stays at `/admin/login`.

#### Cross-cutting (covered in §4 Flow E)
- Lockout recovery — see Flow E.

---

### 3.2 PM Dashboard Shell

**Spec file:** `tests/e2e/ui-admin-dashboard-shell.spec.ts`
**Page:** `/admin/`
**Element IDs:** `#pm-user`, `#pm-balance`, `#btn-logout`, `#btn-refresh`, `#sec-pending`, `#sec-all-events`, `#sec-tasks`, `#sec-audit`, `#sec-exchange`, `#sec-grant`, `#sec-completions`.

#### Smoke
- **Scenario: Dashboard renders all 7 sections with PM logged in**
  - Steps: `loginAsPm('123654')`.
  - Assert: 7 `<details>` elements present; section A is `open` by default; topbar shows `pm-balance` value; no console errors.

- **Scenario: Section count badges reflect data**
  - Steps: Seed 3 pending events, 2 tasks, 1 completion. Open dashboard.
  - Assert: `#count-pending` shows `3`, `#count-tasks` shows `2`, `#count-completions` shows `1`.

#### Happy path
- **Scenario: Click section `<summary>` toggles open/close**
  - Steps: Click section B's summary twice.
  - Assert: First click adds `open` attr; chevron rotates 90°; second click removes `open`.

- **Scenario: Click `#btn-refresh` re-fetches all data**
  - Steps: Open dashboard, click `🔄 刷新`.
  - Assert: All 4 `load*` requests fire (`loadBalance`, `loadPendingEvents`, `loadAllEvents`, `loadTasks`, `loadAudit`, `loadCompletions`); toast says "已刷新" (if implemented) or no error.

- **Scenario: Click `#btn-logout` clears session and redirects to login**
  - Steps: Click `退出`.
  - Assert: `POST /api/admin/auth/logout` returns 200; URL becomes `/admin/login`; reload of `/admin/` redirects back to login.

#### Edge cases
- **Scenario: Visit `/admin/` without session — redirected to login**
  - Steps: Clear cookies, `page.goto('/admin/')`.
  - Assert: Client `loadMe()` returns 401; `window.location.href = '/admin/login'`; URL matches `/admin/login` within 2 s.

- **Scenario: Dashboard JS loads but API is down (500)**
  - Steps: Mock all `/api/admin/*` to return 500.
  - Assert: Topbar shows `—` for balance; sections show empty state placeholders (`#pending-empty`, `#all-events-empty`); no infinite spinner; no crash.

- **Scenario: Slow API (> 5 s) — UI does not freeze**
  - Steps: Mock `/api/admin/audit-log` with 8 s delay.
  - Assert: Topbar balance still renders (other endpoints succeed); no JS error from fetch timeout.

- **Scenario: Logout button double-click**
  - Steps: Click `退出` twice in 200 ms.
  - Assert: Only one `POST /api/admin/auth/logout` fires (button disabled or debounced); no double-redirect.

- **Scenario: Reload mid-fetch**
  - Steps: Open dashboard, press `F5` while a request is in flight.
  - Assert: No unhandled promise rejection; new page load re-initializes cleanly.

---

### 3.3 PM Pending Events

**Spec file:** `tests/e2e/ui-admin-pending.spec.ts`
**Page:** `/admin/` → Section A `#sec-pending`
**Element IDs:** `#pending-list`, `#pending-empty`, `[data-action="approve"][data-id="N"]`, `[data-action="reject"][data-id="N"]`, `.pm-badge.pending`.

#### Smoke
- **Scenario: Section A renders pending events with correct fields**
  - Steps: Seed 2 pending events (one game_time, one pocket_money), open dashboard.
  - Assert: 2 rows in `#pending-list`; each shows reason text, account icon (🎮 or 💰), amount with sign, and `.pm-badge.pending`.

#### Happy path
- **Scenario: Approve a pending event**
  - Steps: Click `✓` on the first pending row.
  - Assert: Row disappears from `#pending-list`; count badge decreases; row appears in `#all-events-list` with `.pm-badge.approved`; balance updates; `audit_log` shows `event_approve` with `actor=pm`.

- **Scenario: Reject a pending event**
  - Steps: Click `✗` on a pending row.
  - Assert: Row disappears; appears in all-events with `.pm-badge.rejected`; balance **does not** change; audit log shows `event_reject`.

- **Scenario: Approve then revoke via "All Events" — chain**
  - Steps: Approve, then in section B revoke the same event.
  - Assert: Balance goes up after approve, back down after revoke; status transitions `pending → approved → revoked`; both actions in audit log.

#### Edge cases
- **Scenario: Approve while offline**
  - Steps: `setOffline(true)`, click approve.
  - Assert: Toast shows network error; row stays pending; no partial state.

- **Scenario: Approve an event that another admin already approved (concurrent)**
  - Steps: Approve the same event via API twice in parallel (second call gets 409 or 200 idempotent — document).
  - Assert: UI does not crash; shows a "已处理" toast or silently re-fetches.

- **Scenario: Pending list is empty — empty state shown**
  - Steps: Seed 0 pending events.
  - Assert: `#pending-empty` visible with text "没有待审事件"; `#pending-list` is empty.

- **Scenario: Approve button disabled during in-flight request**
  - Steps: Slow down `/api/admin/events/:id/approve` to 3 s; click approve twice.
  - Assert: Second click is ignored (button shows disabled / spinner); only one request fires.

- **Scenario: Approve with very long reason — does not break layout**
  - Steps: Seed event with 200-char reason; click approve.
  - Assert: Row does not push layout; section collapse still works.

#### Negative events
- **Scenario: Approve event id 9999 (does not exist)**
  - Steps: Direct API call (UI does not allow this normally, but test the API contract).
  - Assert: 404 returned; UI shows toast "事件不存在".

---

### 3.4 PM All Events

**Spec file:** `tests/e2e/ui-admin-all-events.spec.ts`
**Page:** `/admin/` → Section B `#sec-all-events`
**Element IDs:** `#all-events-list`, `#filter-event-status`, `#all-events-empty`, `[data-action="revoke"][data-id="N"]`, `.pm-badge.approved`, `.pm-badge.rejected`, `.pm-badge.revoked`.

#### Smoke
- **Scenario: All Events section lists every status with distinct badge colors**
  - Steps: Seed one event per status (pending/approved/rejected/revoked), open section B.
  - Assert: 4 rows; badges have distinct CSS classes (`.pending`, `.approved`, `.rejected`, `.revoked`).

#### Happy path
- **Scenario: Revoke an approved event — balance reverses**
  - Steps: Open section B, click `撤销` on an approved row.
  - Assert: API call `POST /api/admin/events/:id/revoke`; row's badge becomes `.revoked`; balance decrements by original amount; `audit_log` shows `event_revoke`.

- **Scenario: Revoke a rejected event — no balance change (already zero-impact)**
  - Steps: Click `撤销` on a rejected row.
  - Assert: Status becomes `.revoked`; balance unchanged; audit log shows `event_revoke` with reason.

- **Scenario: Filter by `approved`**
  - Steps: Seed 2 approved + 2 rejected + 1 revoked; select filter = `approved`.
  - Assert: `#all-events-list` shows only 2 rows; both have `.pm-badge.approved`; count badge updates.

- **Scenario: Filter by `rejected` and back to `all`**
  - Steps: Set filter to `rejected`, then back to `all`.
  - Assert: All rows reappear; filter change does not trigger a network refetch (filtering is client-side) — or refetch fires if server-side; document behavior.

- **Scenario: Sort by date — newest first**
  - Steps: Seed 3 events with distinct timestamps.
  - Assert: Order is descending by `created_at`.

#### Edge cases
- **Scenario: No events at all**
  - Steps: Seed 0 events.
  - Assert: `#all-events-empty` visible.

- **Scenario: Many events (50+) — pagination or virtual scroll**
  - Steps: Seed 100 events; verify list renders or paginates.
  - Assert: List shows max `limit` (default 50) OR full 100 with smooth scroll. Document which; no JS freeze.

- **Scenario: Revoke already-revoked event**
  - Steps: Click `撤销` twice on same row.
  - Assert: Second click is a no-op or shows toast "已撤销"; no double-decrement.

- **Scenario: Revoke while filter is `rejected` (not allowed)**
  - Steps: Set filter to `rejected`; verify revoke button is hidden or disabled for rejected rows.
  - Assert: Either no `撤销` button on rejected rows, or clicking returns 409.

- **Scenario: Event with very long reason — UI truncates with ellipsis**
  - Steps: Seed event with 500-char reason.
  - Assert: Row text truncates visually; tooltip on hover shows full text (or no tooltip — document).

- **Scenario: Filter persistence on reload**
  - Steps: Set filter to `revoked`, reload page.
  - Assert: Filter resets to `all` (current behavior — no localStorage); or persists if added later. Document.

---

### 3.5 PM Task Config (CRUD)

**Spec file:** `tests/e2e/ui-admin-tasks.spec.ts`
**Page:** `/admin/` → Section C `#sec-tasks`
**Element IDs:** `#tasks-list`, `#tasks-empty`, `#btn-new-task`, `#new-task-form-wrap`, `#new-task-form`, `[name="name"]`, `[name="icon"]`, `[name="token_reward"]`, `[name="target_account"]`, `[name="category"]`, `[name="sort_order"]`, `#new-task-cancel`, `[data-action="edit-task"][data-id="N"]`, `[data-action="delete-task"][data-id="N"]`.

#### Smoke
- **Scenario: Task list renders with name, icon, reward, account, category**
  - Steps: Seed 3 tasks (see Appendix A), open section C.
  - Assert: 3 rows; each shows emoji, name, `+N 代币`, `→ 🎮/💰`, category label.

#### Happy path — Create
- **Scenario: Create new task with valid data**
  - Steps: Click `+ 新建任务`; fill name=`练字`, icon=`✍️`, reward=`4`, target=`pocket_money`, category=`study`, sort=`5`; click 保存.
  - Assert: Form hides; new row appears in `#tasks-list` with values; `audit_log` shows `task_create`; child UI (in another tab/page) sees new task in `/api/public/tasks`.

- **Scenario: Cancel new-task form discards input**
  - Steps: Open form, type `test`, click 取消.
  - Assert: Form hides; no task created; `#tasks-list` unchanged.

#### Happy path — Edit
- **Scenario: Edit task reward — value updates in row**
  - Steps: Click `编辑` on first task; change reward from `5` to `8`; save.
  - Assert: Row shows `+8 代币`; `PUT /api/admin/tasks/:id` called; `audit_log` shows `task_update` with diff in `details`.

- **Scenario: Edit task from active to inactive (`is_active=0`)**
  - Steps: Toggle `is_active` to off (if UI exposes it) or delete it.
  - Assert: Task removed from `/api/public/tasks?active=true`; child UI no longer shows it as a shortcut.

#### Happy path — Delete
- **Scenario: Soft-delete task with no completions — succeeds**
  - Steps: Click `删除` on a task that has zero `task_completions`.
  - Assert: Row disappears; `DELETE /api/admin/tasks/:id` returns 200; `audit_log` shows `task_delete`.

- **Scenario: Soft-delete task with active completions — blocked with banner**
  - Steps: Seed task + 1 active `task_completion`; click `删除`.
  - Assert: API returns 409 `TASK_HAS_ACTIVE_COMPLETIONS` (or whatever code the API uses); toast shows "该任务有未撤销的完成记录，请先撤销完成"; task not deleted.

- **Scenario: Re-activate (undelete) a soft-deleted task**
  - Steps: After delete, PUT task with `is_active=1`.
  - Assert: Row reappears in admin list; returns to child shortcut list.

#### Edge cases
- **Scenario: Create with empty name — form rejects**
  - Steps: Click 保存 with `name=""`.
  - Assert: HTML5 `required` validation triggers; toast or inline error "请输入名称"; no API call.

- **Scenario: Create with reward=0 or negative — form rejects**
  - Steps: Fill `token_reward=0`, save.
  - Assert: Browser `min=1` validation prevents submit; no API call.

- **Scenario: Create with very long name (40 chars) — accepted, but 41+ truncated**
  - Steps: Fill `name` with 40 'a's, save → success. Fill 41 'b's, save → 40 saved.
  - Assert: DB stores ≤ 40 chars (maxlength enforced); UI displays correctly.

- **Scenario: Create with invalid `target_account` (e.g., `snack`) — API rejects**
  - Steps: Use `page.route` to inject a tampered form value, or test the API directly.
  - Assert: 400 with `BAD_REQUEST`; UI shows error toast.

- **Scenario: Edit form opened twice (different tasks) — first form is replaced**
  - Steps: Click edit on task A, then on task B.
  - Assert: Only one edit form visible; populated with task B's data.

- **Scenario: Network error during create — form stays open, inputs preserved**
  - Steps: Mock POST to 500; submit form.
  - Assert: Error toast; form not closed; input values still present so PM can retry.

- **Scenario: Delete confirmation — does it prompt?**
  - Steps: Click delete.
  - Assert: Either a `confirm()` dialog or in-app modal asks "确定删除？"; PM can cancel.
  - Document actual behavior; do not auto-delete without confirmation.

- **Scenario: Create with `cutoff_time` + `is_self_lockout=1` — fields persist and appear in admin row + child UI**
  - Steps: Open new-task form; fill name=`准时上床`, reward=`1`, target=`game_time`, category=`habit`, cutoff_time=`21:30`, check `is_self_lockout`. Save. Open the same task's edit form.
  - Assert: Row shows task; edit form repopulates `cutoff_time="21:30"` and checkbox checked; child `/api/public/tasks?active=true` returns `cutoff_time:"21:30"`, `is_self_lockout:1`.

- **Scenario: Edit `cutoff_time` to null — self-lockout disabled**
  - Steps: Open the sleep task's edit form; clear `cutoff_time` field, save.
  - Assert: Child API returns `cutoff_time:null`, `is_self_lockout:0` (or unchanged but lockout no longer applies). Server `POST /complete` no longer enforces cutoff.

- **Scenario: Submit invalid `cutoff_time` (e.g., `25:99`) — server rejects with 400**
  - Steps: Use `page.route` to inject `cutoff_time="25:99"`, submit form.
  - Assert: API returns 400 `BAD_REQUEST` "cutoff_time must match HH:MM (00:00–23:59)"; toast shows error; form stays open.

#### Cross-cutting (covered in §4 Flow A & C)
- New task appears in child UI after creation — Flow A.
- Task deletion with completions flow — covered here.

---

### 3.6 PM Audit Log

**Spec file:** `tests/e2e/ui-admin-audit.spec.ts`
**Page:** `/admin/` → Section D `#sec-audit`
**Element IDs:** `#audit-list`, `#audit-empty`, `#filter-audit-actor`.

#### Smoke
- **Scenario: Audit log renders rows with actor, action, target, time**
  - Steps: Seed 5 audit entries (login, event_approve, task_create, weekly_grant, exchange).
  - Assert: 5 rows; each shows actor icon (pm/child/system), action label, target id, formatted time.

#### Happy path
- **Scenario: Filter by `actor=pm`**
  - Steps: Seed 3 `actor=pm` + 2 `actor=child`; select filter `pm`.
  - Assert: 3 rows shown; all actor labels are `pm`.

- **Scenario: Filter by `actor=child`**
  - Steps: Same seed; select `child`.
  - Assert: 2 rows; all actor labels are `child`.

- **Scenario: Filter by `actor=system`**
  - Steps: Seed a `system` entry (e.g., auto-revoke of expired grant — if exists); select `system`.
  - Assert: Only system rows shown; if none seeded, `#audit-empty` visible.

- **Scenario: Reset filter to `all`**
  - Steps: Set `pm`, then back to `all`.
  - Assert: All rows visible.

#### Edge cases
- **Scenario: Empty audit log — empty state**
  - Steps: Seed 0 entries.
  - Assert: `#audit-empty` visible.

- **Scenario: Audit log > 100 entries — pagination / limit**
  - Steps: Seed 150 entries; open section.
  - Assert: List shows up to 100 (current `?limit=100` default) or paginated; older entries are not silently dropped from DB.

- **Scenario: Filter + reload — filter does not persist**
  - Steps: Set `pm`, reload.
  - Assert: Filter resets to `all` (no localStorage); or persists if added — document.

- **Scenario: Audit entry for revoked event shows `event_revoke` with original `target_event_id`**
  - Steps: Approve event, then revoke; check audit log.
  - Assert: Two entries: `event_approve` (id=A) and `event_revoke` (id=A); both have `target_event_id=A`.

- **Scenario: Newest entries appear first**
  - Steps: Seed 3 entries with different timestamps.
  - Assert: Order is DESC by `created_at`.

#### Non-functional
- **Scenario: Section D loads in < 500 ms with 100 rows**
  - Steps: Seed 100, open section.
  - Assert: Time-to-paint < 500 ms; no layout shift after load.

---

### 3.7 PM 双账户兑换 (game ↔ money)

> **消歧**: 本节"PM Exchange" = game_time ↔ pocket_money 双账户兑换 (PM 在 admin 后台手动操作)。
> 金币商店兑换 (coin → game_time / custom 商品) 是 §3.16 Coin System,**不是**本节。

**Spec file:** `tests/e2e/ui-admin-exchange.spec.ts`
**Page:** `/admin/` → Section E `#sec-exchange`
**Element IDs:** `#exchange-form`, `[name="from_account"]`, `[name="to_account"]`, `[name="amount"]`, `button[type="submit"]`.

#### Smoke
- **Scenario: Exchange form renders with all 3 fields**
  - Steps: Open section E.
  - Assert: 2 select fields (from, to), 1 number input (amount), submit button visible.

#### Happy path
- **Scenario: Exchange 10 game_time → 10 pocket_money**
  - Steps: Seed child balance `game_time=20`; set from=`game_time`, to=`pocket_money`, amount=10; submit.
  - Assert: Toast "兑换成功"; new balance `game_time=10, pocket_money=10`; audit log shows 2 score_events (`-10 game_time`, `+10 pocket_money`) + 1 exchange action; section B "All Events" shows both new events.

- **Scenario: Exchange pocket_money → game_time (reverse direction)**
  - Steps: Same setup, from=`pocket_money`, to=`game_time`, amount=5.
  - Assert: Balance moves from money to game; new events created.

- **Scenario: Exchange same account on both sides — API rejects**
  - Steps: Set from=`game_time`, to=`game_time`, submit.
  - Assert: Either client-side validation prevents submit, or server returns 400; no balance change.

#### Edge cases
- **Scenario: Exchange with amount=0 — rejected**
  - Steps: Amount=`0`, submit.
  - Assert: Browser `min=1` prevents submit; no API call.

- **Scenario: Exchange with negative amount — rejected**
  - Steps: Amount=`-5` (via tampered DOM or `page.route`); submit.
  - Assert: Server returns 400; no balance change.

- **Scenario: Exchange allowing negative balance (overspend) — succeeds**
  - Steps: Child has `game_time=5`; exchange 10 to money. (Per PRD §3.5: 双账户透支 is allowed.)
  - Assert: Balance becomes `game_time=-5, pocket_money=10`; no rejection.

- **Scenario: Very large amount (1,000,000) — succeeds**
  - Steps: Amount=`1000000`, submit.
  - Assert: Balance jumps accordingly; UI does not crash on rendering large number.

- **Scenario: Network error — form re-enabled, balance unchanged**
  - Steps: Mock POST to 500; submit.
  - Assert: Error toast; form still visible; balance unchanged on reload.

- **Scenario: Double-submit prevention**
  - Steps: Click submit twice rapidly.
  - Assert: Button disabled after first click; only one API call.

---

### 3.8 PM Weekly Grant

**Spec file:** `tests/e2e/ui-admin-grant.spec.ts`
**Page:** `/admin/` → Section F `#sec-grant`
**Element IDs:** `#grant-form`, `[name="game_time"]`, `[name="pocket_money"]`, `[name="note"]`, submit button.

#### Smoke
- **Scenario: Grant form renders with 3 fields (game_time, pocket_money, note)**
  - Steps: Open section F.
  - Assert: 2 number inputs, 1 text input, submit button visible.

#### Happy path
- **Scenario: Grant 30 game + 20 money with note**
  - Steps: Seed child balance `0/0`; fill `game_time=30`, `pocket_money=20`, `note='Week 1'`; submit.
  - Assert: Balance becomes `30/20`; toast "发放成功"; audit log shows 2 score_events + 1 `weekly_grant` action with `details={note, game_time, pocket_money}`.

- **Scenario: Grant only game_time (pocket_money=0)**
  - Steps: Set `game_time=15`, `pocket_money=0`, submit.
  - Assert: Balance +15 game; audit log shows 1 score_event.

- **Scenario: Grant only pocket_money (game_time=0)**
  - Steps: Reverse.
  - Assert: Same shape.

- **Scenario: Grant both zero — allowed?**
  - Steps: Set both to 0, submit.
  - Assert: Either silently no-op (no API call) or API returns 400; document behavior. **Recommendation:** disable submit when both are 0.

- **Scenario: Grant without note — note is optional**
  - Steps: Fill amounts, leave note blank, submit.
  - Assert: Succeeds; audit log entry has `note=""` or null.

#### Edge cases
- **Scenario: Grant with negative values — rejected**
  - Steps: Fill `game_time=-5`, submit.
  - Assert: Browser `min=0` blocks submit, or server returns 400.

- **Scenario: Grant with very long note (80+ chars) — truncated**
  - Steps: Type 100 'x' chars in note.
  - Assert: `maxlength=80` enforced; DB stores 80.

- **Scenario: Network error during grant — form preserves state**
  - Steps: Mock 500; submit.
  - Assert: Error toast; form still populated; balance unchanged.

- **Scenario: Grant twice in a row (e.g., double-click) — only one fires**
  - Steps: Double-click submit.
  - Assert: Button disabled after first click.

#### Cross-cutting (covered in §4 Flow C)
- Weekly payout flow with audit verification.

---

### 3.9 Child First-time Flow

**Spec file:** `tests/e2e/ui-child-onboarding.spec.ts`
**Page:** `/`
**Element IDs (from `index.html`):** `#welcome-modal`, `#welcome-name`, `#welcome-submit`, `#welcome-error`, `#confetti`, `#hero-greeting`, `#card-game-time`, `#card-pocket-money`.

#### Smoke
- **Scenario: First-time visit shows welcome modal**
  - Steps: `clearAllData()`; `seedChildData({ childName: null })`; `page.goto('/')`.
  - Assert: `#welcome-modal` visible; input is focused; `🎮 欢迎来到你的计分板！` text present; no console errors.

- **Scenario: Subsequent visit hides welcome modal**
  - Steps: Same as above, but seed `childName='Tommy'`.
  - Assert: `#welcome-modal` is `hidden` (or `display: none`); `#hero-greeting` shows `你好，Tommy！👋`.

#### Happy path
- **Scenario: Child enters name and submits — confetti fires, name persists**
  - Steps: Type `Tommy` in `#welcome-name`, click `开始 🚀`.
  - Assert: `PATCH /api/me/profile` returns 200 with `name='Tommy'`, `is_first_time=false`; confetti canvas animates for ~1.5 s; `#hero-greeting` updates to `你好，Tommy！👋`; modal hides within 2 s.

- **Scenario: Reload after first-time — name persists in DB**
  - Steps: Complete first-time flow; `page.reload()`.
  - Assert: Modal does **not** reappear; greeting still says `Tommy`.

- **Scenario: Submit via Enter key**
  - Steps: Type name, press `Enter`.
  - Assert: Same as button click; form submits.

#### Edge cases
- **Scenario: Empty name submission — error shown**
  - Steps: Click submit with empty input.
  - Assert: `#welcome-error` shows "请输入名字"; modal stays open; no API call (client-side trim check) or API returns 400.

- **Scenario: Whitespace-only name — trimmed to empty**
  - Steps: Type `   `, submit.
  - Assert: Treated as empty; error shown; no API call.

- **Scenario: Name with leading/trailing spaces — trimmed server-side**
  - Steps: Type `  Tommy  `, submit.
  - Assert: API receives `Tommy`; greeting shows `Tommy`.

- **Scenario: Very long name (> 20 chars) — truncated**
  - Steps: Type 25 'a's, submit.
  - Assert: `maxlength=20` enforces; DB stores 20 chars.

- **Scenario: Special characters / emoji in name — accepted (within reason)**
  - Steps: Type `小明🎮`, submit.
  - Assert: Stored and rendered; no XSS in greeting HTML (verify `escapeHtml` used).

- **Scenario: Try to set name again after first-time — server returns 409**
  - Steps: First-time flow done; directly PATCH `/api/me/profile` with new name via `page.request`.
  - Assert: 409 `ALREADY_SET`; UI does not surface this in normal flow but API contract holds.

- **Scenario: API returns 500 on PATCH**
  - Steps: Mock `PATCH /api/me/profile` to 500.
  - Assert: `#welcome-error` shows server error; modal stays open; child can retry.

- **Scenario: Network offline**
  - Steps: `setOffline(true)`, submit name.
  - Assert: Error shown; no crash; once back online, retry succeeds.

#### Cross-cutting
- New user first day (Flow A) covers the full chain including PM audit log entry for the name set.

---

### 3.10 Child Main Page

**Spec file:** `tests/e2e/ui-child-main.spec.ts`
**Page:** `/`
**Element IDs:** `#hero-greeting`, `#hero-sub`, `#balance-game-time`, `#balance-pocket-money`, `#task-shortcuts`, `#btn-submit`, `#btn-refresh`, `#event-list`, `#event-count`, `#event-empty`.

#### Smoke
- **Scenario: Main page renders all sections in iPad viewport**
  - Steps: Seed child with name + 3 tasks + 5 events; `page.goto('/')`.
  - Assert: Greeting text present; 2 balance cards visible (game_time, pocket_money) with values; task-shortcuts container populated; 5 event rows; no console errors.

- **Scenario: Balance values reflect seeded approved events**
  - Steps: Seed events: 2× approved `+10 game_time`, 1× approved `+5 pocket_money`.
  - Assert: `#balance-game-time` shows `20`; `#balance-pocket-money` shows `5`; units are `分钟` and `元`.

- **Scenario: Task shortcuts render with icon, name, reward**
  - Steps: Seed 3 tasks (Appendix A).
  - Assert: 3 buttons in `#task-shortcuts`; each shows emoji + name + `+N 代币` + account icon.

#### Happy path
- **Scenario: Click `🔄 刷新` refetches balance and events**
  - Steps: Open page, click refresh.
  - Assert: 3 GET requests fire (`balance`, `tasks`, `events`); no errors; values re-render.

- **Scenario: Approved task is greyed out as "✅ 今日已完成"**
  - Steps: Seed 1 task with `task_completion` for today.
  - Assert: Button in `#task-shortcuts` is disabled; shows `✅ 今日已完成` text or disabled state.

- **Scenario: Pending events show in recent events list with `pending` badge**
  - Steps: Seed 1 pending event.
  - Assert: Row in `#event-list` shows yellow `pending` badge; `+10 元` or `+5 分钟` indicator.

- **Scenario: Approved events show with green `approved` badge**
  - Steps: Same seed shape.
  - Assert: Green badge; amount visible.

- **Scenario: Revoked events show with orange `revoked` badge**
  - Steps: Seed revoked event.
  - Assert: Orange badge; visually de-emphasized (e.g., opacity 0.6).

#### Edge cases
- **Scenario: Zero events — empty state**
  - Steps: Seed 0 events.
  - Assert: `#event-empty` visible with `📭 还没有事件哦～`; `#event-list` empty.

- **Scenario: Zero tasks — empty task section**
  - Steps: Seed 0 active tasks.
  - Assert: `#task-shortcuts` shows `还没有任务哦` placeholder (or empty div); no crash.

- **Scenario: Network error on initial load — error banner**
  - Steps: Mock `/api/public/balance` to 500; reload.
  - Assert: `#error-banner` visible with retry button; balances show 0/0 (fallback); toast appears.

- **Scenario: Click retry in error banner — refetches**
  - Steps: After error banner shown, click `重试`.
  - Assert: API call re-fires; on success, banner hides and balance renders.

- **Scenario: Many events (>10) — capped at 10 in list**
  - Steps: Seed 20 events.
  - Assert: `#event-list` shows 10 rows; `#event-count` shows `10` (or `20` if total count is shown); older not in DOM.

- **Scenario: Time format — relative vs absolute**
  - Steps: Seed event with `created_at = now`; reload.
  - Assert: Shows `刚刚` or `1 分钟前`; document exact format from `app.js:fmtTime`.

- **Scenario: Child's name not set — still see main page (no crash)**
  - Steps: Clear `users.name`; open `/`.
  - Assert: Welcome modal reappears (per §3.9). After closing, main page shows `你好！👋` (no name).

---

### 3.11 Child Task Complete

**Spec file:** `tests/e2e/ui-child-task-complete.spec.ts`
**Page:** `/` → `#task-shortcuts`
**Element IDs:** `#task-shortcuts button`, `[data-task-id]`.

#### Smoke
- **Scenario: Task buttons are large enough for iPad touch (≥ 60 px height)**
  - Steps: Inspect task button computed style.
  - Assert: `min-height >= 60px`; no manual measurement required — rely on CSS class `.task-btn`.

#### Happy path
- **Scenario: Child completes a task — balance increases**
  - Steps: Seed 1 task (target=`pocket_money`, reward=5); balance=0; click the task button.
  - Assert: `POST /api/me/tasks/:id/complete` returns 201; `#balance-pocket-money` becomes 5; new event row appears in `#event-list` with `+5 元` and `approved` badge; button greys out and shows `✅ 今日已完成`.

- **Scenario: Completing 2 different tasks the same day — both succeed**
  - Steps: Seed 2 tasks; complete both.
  - Assert: Both balances update; both buttons disabled after; 2 events in list.

#### Edge cases
- **Scenario: Complete a task already done today — button is disabled, no second call**
  - Steps: Complete task once, then try to click again.
  - Assert: Second click is no-op (disabled); if forced via JS, API returns 409 `ALREADY_COMPLETED_TODAY`; toast shows "今天已经完成过啦".

- **Scenario: Complete a task that was just revoked by PM — succeeds (slot freed)**
  - Steps: PM revokes today's completion; child refreshes; clicks again.
  - Assert: API returns 201; new completion created.

- **Scenario: Task deleted by PM mid-click — 404 returned**
  - Steps: Click task; immediately have PM `DELETE` it (race).
  - Assert: Either the click succeeds (200) or fails (404); UI shows toast either way; no crash.

- **Scenario: Task completed with very large reward (e.g., 9999) — balance updates correctly**
  - Steps: Seed task with reward=9999; complete.
  - Assert: Balance +9999; number renders without overflow.

- **Scenario: API returns 500 on complete — toast + balance unchanged**
  - Steps: Mock POST to 500.
  - Assert: Toast with error; balance unchanged; button remains active so child can retry.

- **Scenario: Network offline**
  - Steps: `setOffline(true)`, click task.
  - Assert: Error toast; button remains active; once online, retry works.

- **Scenario: Click task button rapidly 5 times — only one completion**
  - Steps: Click 5× in 200 ms.
  - Assert: First click disables button; subsequent clicks ignored; only 1 API call.

---

### 3.12 Child Event Submit

**Spec file:** `tests/e2e/ui-child-submit.spec.ts`
**Page:** `/` → `#submit-modal`
**Element IDs:** `#btn-submit`, `#submit-modal`, `#submit-form`, `#submit-type`, `[data-dir]`, `#submit-amount`, `#submit-reason`, `#submit-cancel`.

#### Smoke
- **Scenario: Submit modal renders with all 4 fields and 2 buttons**
  - Steps: Click `📝 提交申请`.
  - Assert: Modal visible; fields: 类型 (select), 方向 (seg buttons 2), 数量 (number), 原因 (textarea); buttons: 取消, 提交.

#### Happy path
- **Scenario: Submit +10 game_time with reason — event appears in list as pending**
  - Steps: Open modal; type=game_time; dir=➕; amount=10; reason=`今天主动整理书桌`; submit.
  - Assert: Modal closes; toast `已提交，等家长审核`; new row in `#event-list` with `pending` badge; balance **not yet changed** (still pending).

- **Scenario: Submit -5 pocket_money (self-report penalty)**
  - Steps: Same, type=pocket_money, dir=➖, amount=5.
  - Assert: New pending event in list; balance unchanged.

- **Scenario: Submit all 4 type/direction combos**
  - Steps: Run 4 sub-tests, one per (type, dir) combo.
  - Assert: All 4 events land as `pending`; both accounts represented.

#### Edge cases
- **Scenario: Submit with amount=0 — rejected**
  - Steps: Amount=`0`, submit.
  - Assert: HTML5 `min=1` blocks submit; no API call.

- **Scenario: Submit with empty reason — rejected**
  - Steps: Reason blank, submit.
  - Assert: HTML5 `required` blocks submit; toast or inline error.

- **Scenario: Submit with very long reason (200+ chars) — truncated**
  - Steps: Type 250 'a's in reason, submit.
  - Assert: `maxlength=200` enforces; DB stores 200.

- **Scenario: Submit with whitespace-only reason — treated as empty**
  - Steps: Reason=`   `, submit.
  - Assert: Same as empty; blocked.

- **Scenario: Cancel modal discards input**
  - Steps: Fill all fields, click 取消.
  - Assert: Modal closes; no event in list; reopening modal shows clean form.

- **Scenario: Submit while offline — error toast, form stays open**
  - Steps: `setOffline(true)`, submit valid form.
  - Assert: Error toast; modal stays open with values intact; once online, submit succeeds.

- **Scenario: Submit with negative amount — rejected**
  - Steps: Amount=`-5` via DOM tampering.
  - Assert: Server returns 400; toast shown.

- **Scenario: Seg-button selection persists across reopens**
  - Steps: Select `➖`; cancel; reopen.
  - Assert: Default resets to `➕` (per `app.js:closeSubmitModal`); or persists if implemented — document.

- **Scenario: PM approves the submitted event — child sees balance change after refresh**
  - Steps: Submit; PM approves in another tab; child clicks `🔄 刷新`.
  - Assert: Balance updates; event badge changes to `approved`.

- **Scenario: Double-submit prevention**
  - Steps: Click 提交 twice rapidly.
  - Assert: Button disabled after first click; only one event created.

#### Cross-cutting
- Full submit → approve flow is part of §4 Flow A.

---

### 3.13 Child Recent Events

**Spec file:** `tests/e2e/ui-child-events.spec.ts`
**Page:** `/` → `#event-list`
**Element IDs:** `#event-list`, `#event-empty`, `#event-count`, `[data-event-id]`, `.event-badge.pending|approved|rejected|revoked`.

#### Smoke
- **Scenario: Initial empty state — no events**
  - Steps: Fresh DB; `page.goto('/')`.
  - Assert: `#event-empty` visible; `#event-count` shows `0`; no rows.

#### Happy path
- **Scenario: After submit, event appears at top of list**
  - Steps: Submit a `+5 元` event.
  - Assert: New row in `#event-list` is the first (or only) item; `#event-count` becomes 1.

- **Scenario: Status badges render with correct colors**
  - Steps: Seed 1 of each status.
  - Assert: 4 rows with badges: pending (yellow), approved (green), rejected (red), revoked (orange).

- **Scenario: Max 10 events in list**
  - Steps: Seed 15 events; reload.
  - Assert: `#event-list` has 10 rows; `#event-count` shows `10` (or `15` total in DB if `count` differs); document.

- **Scenario: Each event shows type icon, amount with sign, account unit, reason**
  - Steps: Seed event with reason=`测试事件`.
  - Assert: Row shows `🎮` or `💰`, `+5` or `-3`, `分钟` or `元`, and reason text.

- **Scenario: Time shown in human format**
  - Steps: Seed event with `created_at = now - 5 minutes`.
  - Assert: Shows `5 分钟前` or similar (per `app.js:fmtTime`).

#### Edge cases
- **Scenario: Event with very long reason — text wraps or truncates**
  - Steps: Seed event with 200-char reason.
  - Assert: Row does not break layout; text wraps within row.

- **Scenario: Event with XSS attempt in reason — escaped**
  - Steps: Seed event with reason=`<script>alert(1)</script>`.
  - Assert: Rendered as text, not executed; verify via `page.locator('script').count()` or by checking rendered DOM.

- **Scenario: Negative amount with sign — `-5 元` not `5-元`**
  - Steps: Seed `-3 元` event.
  - Assert: Sign prefix correct; consistent with positive (`+5`).

- **Scenario: Page refresh updates list — no duplicates**
  - Steps: Submit 1 event; reload page.
  - Assert: List has 1 event; no duplicate render.

- **Scenario: Click event row — does it expand? navigate?**
  - Steps: Click on event row.
  - Assert: No-op (per current design — no detail view); document if behavior changes.

- **Scenario: PM revokes event — child sees status change after refresh**
  - Steps: PM revokes approved event; child refreshes.
  - Assert: Badge becomes `revoked`; color orange.

---

### 3.14 Child Sleep Lockout (self-lockout task type — Item #002)

**Spec file:** `tests/e2e/ui-child-sleep-lockout.spec.ts` (new)
**Page:** `/` → `#task-shortcuts` → task button with `.task-btn-locked` class for sleep task
**Element IDs:** `[data-task-id="<sleep-task-id>"]`, `.task-btn-locked`, `#task-cutoff-countdown` (if separate span; otherwise inline in button text)
**Backend hooks:** `POST /api/me/tasks/:id/complete` returns 400 `CUTOFF_PASSED` when cutoff violated; `GET /api/public/tasks?active=true` returns `cutoff_time` + `is_self_lockout` per task
**Time control:** tests must use `page.clock` / `Date.now` mocking or seed `tasks.cutoff_time` directly; server time is `nowShanghaiHHMM()` (UTC+8)

#### Smoke
- **Scenario: Sleep task button shows countdown text before cutoff**
  - Steps: Seed 1 sleep task (`cutoff_time="21:30"`, `is_self_lockout=1`); freeze page clock at `2026-06-07 20:30:00` Asia/Shanghai; open `/`.
  - Assert: Sleep task button text contains "距离 21:30 还剩" + a `HH:MM:SS` countdown (e.g., "00:59:5x" or "01:00:00"); button is enabled.

#### Happy path
- **Scenario: Child clicks sleep task before cutoff — completes successfully, +1 min**
  - Steps: Clock at `21:25:00`; click sleep task button.
  - Assert: `POST /api/me/tasks/:id/complete` returns 201; `game_time` balance +1; button greys out to "✅ 今日已完成 (点击撤销)"; new event row in `#event-list` with `+1 分钟 准时上床`.

- **Scenario: Sleep task with `is_self_lockout=0` (cutoff_time set but no lockout) — completes after cutoff**
  - Steps: Seed task with `cutoff_time="21:30"`, `is_self_lockout=0`; clock at `22:00:00`; click.
  - Assert: API returns 201; balance +1; no lockout UI behavior. Confirms opt-in: lockout only fires when BOTH fields are set.

#### Edge cases — cutoff enforcement
- **Scenario: Clock crosses cutoff — button auto-locks (disabled)**
  - Steps: Seed sleep task; freeze page clock at `21:29:59`; assert button enabled. Advance clock 1 second to `21:30:00`.
  - Assert: Button receives `.task-btn-locked` class within ≤ 2s; `disabled` attribute set; click is no-op.

- **Scenario: After cutoff — child clicks button — server rejects 400 CUTOFF_PASSED**
  - Steps: Bypass client lockout (e.g., remove `disabled` via DevTools or send direct API call); clock at `21:30:01`; click.
  - Assert: `POST /api/me/tasks/:id/complete` returns 400 with `error.code="CUTOFF_PASSED"` and `message` containing "已过打卡时间 21:30"; toast shows server error; client state unchanged.

- **Scenario: Server time vs client time — server enforces cutoff even if client clock is wrong**
  - Steps: Mock `Date.now` to return a time before cutoff (e.g., `20:00:00`) but real server time is `21:35:00`; click sleep task.
  - Assert: Server returns 400 `CUTOFF_PASSED`; child sees error toast. **Confirms server-side enforcement is authoritative.**

- **Scenario: Countdown updates every second**
  - Steps: Open page; record countdown text at T=0; wait 2 seconds; record again.
  - Assert: Text changed (decreased by ~2 seconds); format remains `HH:MM:SS` zero-padded.

- **Scenario: Cross-day reset — at 00:00 button re-activates**
  - Steps: Sleep task has been locked for "today"; freeze clock at `23:59:58` (locked). Advance 2 seconds to `00:00:00` of next day.
  - Assert: Button becomes enabled (`.task-btn-locked` removed); countdown text resets to "距离 21:30 还剩 21:30:0x"; child can complete again (creates new `task_completion` for the new day).

#### Edge cases — admin configuration
- **Scenario: Admin creates sleep task — child UI sees countdown + lockout**
  - Steps: In PM admin tab, create task with `cutoff_time="21:30"`, `is_self_lockout=1`; in child tab, refresh.
  - Assert: Child sees the new task button with countdown; locks at 21:30. (Mirrors §3.5 "create with cutoff_time" but from child side.)

- **Scenario: Admin edits cutoff_time later — child UI re-renders with new cutoff (next reload)**
  - Steps: Change `cutoff_time` from `21:30` to `22:00`; child refreshes.
  - Assert: New countdown shows "距离 22:00 还剩 ...". **Document: cutoff changes do NOT take effect mid-day without page reload (acceptable; document limitation).**

#### Negative
- **Scenario: Click locked button — no network call**
  - Steps: Clock at `21:30:05`; button disabled; click anyway via `force: true`.
  - Assert: No `POST /api/me/tasks/:id/complete` request issued (client-side guard); no toast; button remains disabled.

- **Scenario: Network error during cutoff-task complete (pre-cutoff) — toast + balance unchanged, button stays active**
  - Steps: Mock POST to 500; click at `21:25:00`.
  - Assert: Error toast; balance unchanged; button still enabled; child can retry before cutoff.

#### Cross-cutting
- Sleep task flows from §3.5 admin config → §3.14 child UI → §3.11 task complete → §3.13 recent events.
- Daily progress bar (§3.11 / Item #005) updates correctly when sleep task is the only one completed that day.

---

### 3.15 Admin Hard Delete (v2.2 新增, Item #009)

**Spec file:** `tests/e2e/ui-admin-hard-delete.spec.ts`
**Page:** `/admin/` → Sections A (events) and G (task completions)
**Element IDs:** `[data-action="hard-delete"][data-id="N"]`, `[data-record-id="N"][data-deleted="1"]` (灰显 marker), `#hard-delete-confirm` (confirm dialog).
**Backend hooks:** `POST /api/admin/events/:id/hard-delete`, `POST /api/admin/task-completions/:id/hard-delete`, `GET /api/admin/deleted-records` (含 type filter).

#### Smoke
- **Scenario: PM sees "🗑 永久删除" 按钮 next to "撤销" on approved/revoked rows**
  - Steps: `loginAsPm('123654')`; seed 1 approved event + 1 active task completion; open section A and section G.
  - Assert: 2 buttons visible per row (撤销 + 🗑 永久删除), 灰底色区别于普通 approve/reject 按钮; no console errors.

#### Happy path
- **Scenario: PM hard-deletes a `score_event` — 物理消失 + `deleted_records` 有 + `audit_log` 有**
  - Steps: Seed 1 approved `score_event` (id=42, `change_value=+5 game_time`). PM clicks 🗑 on the row, confirm dialog → OK.
  - Assert: Toast `已永久删除`; row disappears from `#all-events-list`; `score_events` table has 0 rows for id=42; `deleted_records` table has 1 row with `record_type='score_event', original_id=42, original_data={...}, original_table='score_events', deleted_by='pm'`; `audit_log` has new entry `action='event_hard_deleted'` with `target_event_id=42` and `details={deleted_record_id, original_data}`; child `game_time` balance 重算后减 5.

- **Scenario: PM hard-deletes a `task_completion` — 物理消失 + `deleted_records` 有 + `audit_log` 有**
  - Steps: Seed 1 active `task_completion` (id=7, task_id=1, today). PM clicks 🗑 in section G, confirm → OK.
  - Assert: Toast `已永久删除`; row disappears from `#completions-list`; `task_completions` table has 0 rows for id=7; `deleted_records` has 1 row with `record_type='task_completion'`, `original_data` 含 `task_id` + `awarded_event_id`; `audit_log` has `action='completion_hard_deleted'`; 关联的 `score_event` 仍存在 (硬删 task_completion 不动 score_event).

- **Scenario: 删后孩子能再次打卡 (再完成同一任务 / 再提交新申请)**
  - Steps: Seed 1 active task completion for today's "按时上床" task. PM 软删 (撤销) → 硬删 (`task_completion` 物理消失). Child refreshes; clicks "按时上床" again.
  - Assert: `POST /api/me/tasks/:id/complete` returns 201 (UNIQUE 约束通过, 因为 `task_completions` 表已无记录); balance +1 again; 新的 task_completion + score_event 写入.

- **Scenario: 删后余额重算正确 (reflect new approved-event set)**
  - Steps: Seed balance `game_time=20, pocket_money=5` (5 events: 3 game_time approved, 2 pocket_money approved). PM 硬删 1 个 `+10 game_time` event.
  - Assert: Child refreshes → `game_time=10, pocket_money=5`; no "negative delta" 或 "drift".

#### Edge cases
- **Scenario: 未登录访问硬删 endpoint 返 401**
  - Steps: Clear session cookie. `page.request.post('/api/admin/events/42/hard-delete')` via API directly.
  - Assert: Response 401 `UNAUTHORIZED`; `score_events` 行未删; `audit_log` 未写; `deleted_records` 无新行.

- **Scenario: 删不存在的 id 返 404**
  - Steps: `loginAsPm`; API call `POST /api/admin/events/99999/hard-delete` (id 不存在).
  - Assert: Response 404 `NOT_FOUND`; no DB writes; UI 若触发则 toast "记录不存在".

- **Scenario: confirm 取消时不删**
  - Steps: Click 🗑; confirm dialog → 取消.
  - Assert: No API call fires; row stays in list; no DB changes; no audit_log entry.

- **Scenario: 已硬删的记录在列表里灰显 + 显示删除时间 + 谁删**
  - Steps: After hard-delete event 42; refresh "All Events" page.
  - Assert: 1 row with `data-deleted="1"` attribute (or `.deleted-row` class) showing "🚫 已删除 2026-06-08 23:00 by pm" subtitle; opacity 0.5; no 撤销/删除 button on it.

- **Scenario: 重复点击 🗑 (双击) — only one delete**
  - Steps: Click 🗑 twice in 200ms; confirm OK on first.
  - Assert: Second click either no-ops (button disabled after first) or returns 404 (id already gone); 1 `deleted_records` row total; 1 `audit_log` entry total.

#### Specs 覆盖映射
- E2E: `tests/e2e/ui-admin-hard-delete.spec.ts` (3 cases: smoke + happy events + happy completions)
- Unit: `tests/unit/admin-events-hard-delete.test.ts` (2: 删成功 + PM 401)
- Unit: `tests/unit/admin-task-completions-hard-delete.test.ts` (2: 删成功 + 删后允许再完成)
- Unit: `tests/unit/deleted-records.test.ts` (snapshot 写入 + JSON 序列化)

#### Cross-cutting
- Hard-delete flow §4 Flow G walks: events 删 → 灰显 → 孩子再打卡 (one full scenario per direction).

---

### 3.18 Running Map — Check-in, SVG UI, Milestone Gifts, Admin Revoke (Item #011)

**Spec files**: `tests/unit/running-schema.test.ts` + `tests/unit/running-prize.test.ts` + `tests/unit/admin-running-revoke.test.ts` + `tests/e2e/ui-running-checkin.spec.ts` + `tests/e2e/ui-running-map.spec.ts`

**Page**: `/` → `#running-checkin-modal` + `#running-map-section` + gift modal; `/admin/` → Section I

#### Unit Tests (running-schema + running-prize, existing)

**`tests/unit/running-schema.test.ts`**:
- Schema: running_maps / running_points / running_records tables exist
- Points ordered by order_index ASC
- Active map selected correctly
- cum_km aggregation (SUM with revoked_at IS NULL filter)

**`tests/unit/running-prize.test.ts`**:
- rollPrize: 60% small (1-5), 35% medium (5-10), 5% large (10-20)
- Rng parameter: fixed 0.5 → small bucket; fixed 0.8 → medium bucket; fixed 0.95 → large bucket
- Edge: awarded_minutes never negative

#### Unit Tests (admin-running-revoke, new — Item #011 §4)

**`tests/unit/admin-running-revoke.test.ts`**:
- GET /api/admin/running/records: 401 without cookie, returns all records including revoked
- POST revoke: confirm: true required (400), invalid id (400), not found (404), already revoked (409)
- Happy path: UPDATE revoked_at + INSERT -game_time score_event + UPSERT running_progress + audit_log
- No score_event when awarded_minutes=0
- Double revoke returns 409

#### E2E Tests

**`tests/e2e/ui-running-checkin.spec.ts`**:
- **Smoke: Running check-in modal renders and submits**
  - Steps: Click 🏃 emoji button → modal appears; enter 3.5 km; submit.
  - Assert: POST /api/running/records returns 200; cum_km updates; balance refreshes.

**`tests/e2e/ui-running-map.spec.ts`**:
- **Happy: SVG map renders with avatar at correct position after 1 check-in**
  - Steps: Seed child; check in 3.5 km; open running map section.
  - Assert: SVG path visible; avatar positioned at ~3.5 km mark (within point tolerance).
- **Happy: Milestone gift modal appears when reaching new point**
  - Steps: Check in km that crosses a running_point threshold.
  - Assert: Gift modal visible; shows awarded minutes; "再跑一次" closes modal.
- **Happy: Completion modal + next map activation**
  - Steps: Mock cum_km >= total_km; complete map.
  - Assert: Large completion modal visible; "🎉 恭喜通关! 上海→苏州"; next map activated.

### 3.17 Calendar — Month Grid + Day Detail Modal (Item #006, v2.x)

**Spec files**: `tests/unit/calendar-render.test.ts` + `tests/unit/calendar-color.test.ts` + `tests/e2e/ui-calendar-month-nav.spec.ts` + `tests/e2e/ui-calendar-day-detail.spec.ts`

**Page**: `/` → `#calendar-toggle-btn` + `#calendar-panel` + `#calendar-day-detail-modal`

#### Unit Tests (39 tests)

**`tests/unit/calendar-render.test.ts`** (30 tests):
- getDaysInMonth: 28d non-leap / 29d leap / 30d / 31d / century leap / century non-leap
- getFirstWeekday: Mon / Sat / various months
- grid cell count: always 42 cells (Feb non-leap / leap / Mar with prev padding / Jun / Dec)
- getColorTier: 0→tier0, 1→tier1, 2→tier2, 3→tier3, 100→tier3 (capped), -1→tier3
- prev-month trailing padding: correct prev cell count per firstWeekday

**`tests/unit/calendar-color.test.ts`** (7 tests):
- getColorTier boundaries: 0/1/2/3/4/100/9999 all map correctly (cap at tier 3)
- monotonic: tier(0) < tier(1) < tier(2) < tier(3)

**Performance** (1 test):
- `tests/unit/calendar-render.test.ts`: seed 1000 checkins, measure renderCalendar < 200ms

#### E2E Tests (2 scenarios)

**`tests/e2e/ui-calendar-month-nav.spec.ts`** (2 scenarios):
- **Smoke: Fold → Expand → See month → Navigate → Back**
  - Steps: Click `#calendar-toggle-btn` → `#calendar-panel` visible; verify month label (e.g. "2026 年 6 月"); click `#calendar-next-month` → month increments; click `#calendar-prev-month` → returns; click toggle → panel hides.
  - Assert: Panel shows/hides correctly; month label updates; navigation buttons work.

**`tests/e2e/ui-calendar-day-detail.spec.ts`** (1 scenario):
- **Happy: Click calendar cell → modal shows task list for that day**
  - Steps: Expand calendar; click a day cell that has checkins (≥1); `#calendar-day-detail-modal` opens.
  - Assert: Modal title shows date; task list shows correct task names + icons + rewards + times; clicking backdrop or pressing ESC closes modal.

#### Visual / UX (manual QA)
- V11: Calendar 4 color tiers visible — gray (0) / light cyan (1) / cyan (2) / neon cyan with glow (3+)
- V12: ◀/▶ nav buttons have Mecha cyan hover glow
- V13: Day detail modal renders task list cleanly with icons and times

---

### 3.16 Coin System Test Scenarios (v3 新增)

> **来源**: `docs/coin-system-rfc.md` §7 (F1-F12 验收) + `docs/coin-system-test-plan.md` §2/§3 + `docs/coin-shop-requirements.md` §7.
> **消歧**: 本节是**金币商店** (coin → game_time / custom 商品)。**不是** §3.7 双账户兑换 (game ↔ money)。

**Spec files (3 个 e2e, 21 个 case)**:
- `tests/e2e/coin-system.spec.ts` — 12 functional F1-F12
- `tests/e2e/coin-invariants.spec.ts` — 4 SQL invariant INV-1-4
- `tests/e2e/coin-visual-regression.spec.ts` — 5 visual baseline

**Page**: `/shop.html` (child) + `/admin/index.html` (PM 待发 section H)

**Element selectors (data-testid contract, M4 §6.1/§6.2 实现)**:
- `[data-testid="shop-items"]` — 根 grid
- `[data-testid="shop-item-{id}"]` — 单个商品卡
- `[data-testid="exchange-btn-{id}"]` — 兑换按钮 (id=1 游戏时间, id=2 小乐高)
- `[data-testid="weekly-remaining"]` — 周剩余 widget (e.g. `1 / 3`)
- `[data-testid="week-history"]` / `[data-testid="all-history"]` — 历史区
- `[data-testid="history-item"]` — 单条历史 (本周或全部)
- `[data-testid="confirm-modal"]` — 兑换确认弹窗
- `[data-testid="toast"]` — 成功/失败 toast (复用 `#toast`)

#### F1 — 任务完成 +1 金币
- Steps: Seed child user + 1 个 task; child `POST /api/me/tasks/:id/complete`; 查询 DB `score_events`。
- Assert: 1 条 `type='coins' change_value=+1 status='approved'` 写入; balance 正确反映 (via `GET /api/coins/balance`)。

#### F2 — 全部任务完成 +3 bonus
- Steps: Seed child + N 个 task, 全部完成; 查询 DB。
- Assert: 额外 1 条 `type='coins' change_value=+3` 写入, `week_of` 锁定本周 (ISO 8601 format like '2026-W24')。

#### F3 — 撤销任务回收 -1 金币
- Steps: F1 后, PM `POST /api/admin/task-completions/:id/revoke`。
- Assert: 1 条 `type='coins' change_value=-1 status='approved'` 写入 (来源 `source='revoke'`); balance 减少。

#### F4 — 撤销任务回收 bonus -3
- Steps: F2 后, 撤销任一 task completion 触发 bonus 回滚。
- Assert: 1 条 `type='coins' change_value=-3` 写入 (如果 bonus 已发, 应回收; 验证 M3 hook 正确)。

#### F5 — 撤销后重做再发 bonus
- Steps: F3 后, child 重新 complete 同一 task; 验证所有 task 都完成。
- Assert: bonus 重新发 (幂等性, M3 实现正确)。

#### F6 — 兑换扣金币 + 加游戏时间 (functional + admin 部分)
- Steps: Seed child balance=100 coins; child 点 `exchange-btn-1` → confirm modal → 确认。
- Assert:
  - DB: 2 条 `score_events`: `-10 coins` (source='exchange') + `+10 game_time` (source='exchange')
  - `shop_redemptions`: 1 条 `status='approved'`, `cost_coins=10`, `reward_value=10`, `reward_type='game_time'`, `week_of` = 本周 ISO
  - `audit_log`: 1 条 `action='coin_exchange'` 含 details JSON
  - UI: toast `✅ 兑换成功!`; balance 减 10; 历史区多 1 条
  - **Admin 部分 (3.16.4)**: PM 在 admin 待发 section 看 id=1 不在 (因为是 game_time, 自动 approved), 只有 id=2 (custom) 才出现

#### F7 — 周限额 3 次
- Steps: Seed child balance=100 coins, item id=1 weekly_limit=3; child 连续 `POST /api/coins/exchange` 4 次。
- Assert: 前 3 次返 200; 第 4 次返 400 `WEEKLY_LIMIT_REACHED` 含 `details={used:3, limit:3, week_of}`。

#### F8 — 跨周自动重置
- Steps: Mock time 跳到本周日 23:59; child 兑换 3 次到限额; mock time 跳到下周一 00:00; 再试 1 次。
- Assert: 第 4 次成功 (本周已重置, `week_of` 跨周)。

#### F9 — 按钮置灰 (余额不足)
- Steps: Seed child balance=5 coins; 打开 `/shop.html`。
- Assert:
  - `exchange-btn-1` (cost=10) `disabled`, 文本含 `还差 5 金币`
  - computed style: `opacity < 1` (Mecha 置灰)
  - 即使绕过 disabled, `POST /api/coins/exchange` 返 400 `INSUFFICIENT_COINS` 含 `details={need:10, have:5}` (server-side 校验)

#### F10 — 按钮置灰 (周次数用完)
- Steps: Seed child balance=100; item id=1 已兑换 3 次; 打开 `/shop.html`。
- Assert:
  - `exchange-btn-1` `disabled`, 文本含 `本周已用 3 / 3 次`
  - `[data-testid="weekly-remaining"]` 显示 `0 / 3`
  - `POST /api/coins/exchange` 返 400 `WEEKLY_LIMIT_REACHED`

#### F11 — 兑换历史展示
- Steps: Seed 2 exchanges 本周 + 1 exchange 上一周 (mock 时间); 打开 `/shop.html`。
- Assert:
  - `[data-testid="week-history"] [data-testid="history-item"]` count = 2
  - `[data-testid="all-history"] [data-testid="history-item"]` count >= 3
  - 每个 history-item 含: icon (e.g. 🎮) + 商品名 + 成本 `10 🪙` + 时间 `YYYY-MM-DD HH:mm` + status badge (待发/已发)

#### F12 — 第 3 个 balance card 显示 + 跳转
- Steps: Seed child balance=1 coin; 打开 `/index.html`。
- Assert:
  - `[id="card-coins"]` 可见, 不含 `placeholder` class, 含 `金币` + `1`
  - computed style: `cursor: pointer`
  - 点击 → 跳转 `/shop.html`, URL 匹配 `/\/shop(\.html)?$/`
  - 新页 `[data-testid="shop-items"]` 可见

#### INV-1 — balance 一致性
- SQL CHECK: `SELECT SUM(change_value) FROM score_events WHERE user_id=? AND type='coins' AND status='approved' AND source IN ('task_complete','revoke','exchange','manual','daily_bonus')` = `getCoinBalance(user_id)` (允许 0 偏差)

#### INV-2 — task_completion 唯一 coin grant
- SQL CHECK: 同一 `task_completion_id` 只产生 1 条 `type='coins' change_value=+1` event (无重复 grant)

#### INV-3 — bonus 每周每 user ≤1
- SQL CHECK: 同一 user_id + week_of, `type='coins' change_value=+3` (bonus) 最多 1 条

#### INV-4 — week_of ISO 8601
- SQL CHECK: 所有 `shop_redemptions.week_of` 匹配 `^\d{4}-W\d{2}$` (e.g. `2026-W24`)

#### Visual Regression (5 baselines, iPad 1180x820, maxDiffPixelRatio 0.01)
1. **shop-page-default** — 商店页 grid 2 列, 2 件商品, balance 100
2. **shop-confirm-modal** — 兑换 confirm 弹窗 (点 `exchange-btn-1` 后)
3. **shop-insufficient-coins** — 余额不足按钮置灰 (balance=5, 文案 `还差 5 金币`)
4. **shop-weekly-limit-reached** — 周次数用完按钮置灰 (3/3, 文案 `本周已用 3 / 3 次`)
5. **shop-redemption-success** — 兑换成功 toast (含 `兑换成功`)

#### Cross-cutting (per coin-shop-requirements.md §10 risk #2)
- M3/M4/M5/M6 实施跟 main 分支无交集; deploy 必带 `User-Agent: Mozilla/5.0` 绕过 GH Action bot 检测 (per `kiddo-scoreboard-deploy` §9a)
- 2 个 pre-existing flaky in `me-tasks-complete.test.ts` 跟 coin shop 无关, 单独 issue 跟踪, 不阻塞本 PR

---

## 4. Cross-Cutting E2E Flows

These flows span multiple features and are higher value than per-feature tests. Each flow is a single spec file with a single `test()` that walks the full scenario step by step, asserting along the way.

### Flow A: New user first day

**Spec file:** `tests/e2e/flow-new-user-day.spec.ts`
**Actors:** Child (iPad) + PM (desktop) in two browser contexts.

1. `clearAllData()`.
2. Open child context at `/` — welcome modal shown.
3. Type `Tommy`, submit — confetti, greeting updates, `PATCH /api/me/profile` succeeds.
4. Open PM context; `loginAsPm('123654')`.
5. Verify `/api/admin/audit-log` contains a `profile_set` (or similar) entry with `actor=child`, `details.name='Tommy'`.
6. PM goes to section C, creates 3 tasks: `整理书桌 +5` (pocket_money), `练琴 30 分钟 +10` (game_time), `刷牙 +1` (pocket_money).
7. Child refreshes — sees 3 task buttons in `#task-shortcuts`.
8. Child clicks `整理书桌` — balance `pocket_money=5`; section G `task_completions` has 1 row.
9. Child opens submit modal, submits `+10 元` (pocket_money) with reason `帮忙洗碗`.
10. PM sees the pending event in section A; clicks ✓; event moves to `approved`; balance in topbar shows `pocket_money=15`.
11. Child clicks refresh — balance updates to `15 元`; event shows `approved` badge.
12. **Assert at end:**
    - Audit log has entries: `profile_set`, `task_create` ×3, `task_complete` (1), `event_submit` (1), `event_approve` (1).
    - Child's final balance: `game_time=0, pocket_money=15`.
    - Section B "All Events" shows 2 rows (1 task complete, 1 event).
    - Section G "Task Completions" shows 1 row.

### Flow B: Punishment (deduction) + Revoke

**Spec file:** `tests/e2e/flow-deduct-revoke.spec.ts`

1. Seed child with `game_time=30, pocket_money=10`.
2. PM manually creates a `-5` game_time event (admin API: `POST /api/admin/events` with negative value, or `task_complete` with negative reward if supported). **Flag: confirm API supports negative-admin event creation; if not, simulate via direct D1 seed.**
3. Child refreshes — `game_time=25`; new row in events list with `approved` badge.
4. PM realizes mistake, opens section B, clicks `撤销` on the deduction event.
5. Child refreshes — `game_time=30` restored; badge becomes `revoked`.
6. **Assert:** Audit log shows `event_create` (or `task_complete`), `event_revoke` with `target_event_id` matching.

### Flow C: Weekly payout

**Spec file:** `tests/e2e/flow-weekly-grant.spec.ts`

1. Seed child balance `0/0`.
2. PM opens section F.
3. Fills `game_time=30, pocket_money=20, note='Week 1'`.
4. Submits — toast `发放成功`; balance in topbar updates to `30 / 20`.
5. Child refreshes — balance matches.
6. **Assert:** Audit log has 2 `score_event` entries (`+30 game_time`, `+20 pocket_money`) and 1 `weekly_grant` action with `details={game_time: 30, pocket_money: 20, note: 'Week 1'}`.

### Flow D: Exchange

**Spec file:** `tests/e2e/flow-exchange.spec.ts`

1. Seed child balance `game_time=30, pocket_money=0`.
2. PM opens section E; sets `from=game_time, to=pocket_money, amount=10`; submits.
3. PM topbar balance updates to `20 / 10`.
4. Child refreshes — balance matches.
5. PM goes to section B "All Events" — sees 2 new rows: `-10 game_time` and `+10 pocket_money`, both with `exchange` source label.
6. **Assert:** Audit log has 2 `score_event` entries + 1 `exchange` action with `details={from, to, amount}`.

### Flow E: Lockout recovery

**Spec file:** `tests/e2e/flow-pm-lockout.spec.ts`

1. PM attempts 5 wrong PINs — lockout banner shows.
2. Verify pad is non-functional (digit clicks ignored).
3. Wait 5 minutes (use `await page.waitForTimeout(5 * 60_000)`).
4. Enter correct PIN — banner disappears, login succeeds, dashboard loads.
5. **Assert:** `auth_attempts` table has 0 rows (or only successful one) after success.

> **Optimization note:** If the 5-min wait is too slow for CI, an alternative spec can mutate `auth_attempts` directly via `clearAllData()` to simulate the timeout.

### Flow F (bonus): Task lifecycle end-to-end

**Spec file:** `tests/e2e/flow-task-lifecycle.spec.ts`

1. PM creates a task `洗碗 +3 元`.
2. Child completes it — balance +3; button greys out.
3. PM revokes the completion — balance -3; button re-enables.
4. Child completes again — balance +3; new row in section G.
5. PM deletes the task — child refreshes; button no longer in `#task-shortcuts`.
6. **Assert:** Audit log has `task_create`, `task_complete` (×2), `task_complete_revoke` (×1), `task_delete`.

---

## 5. Visual & UX Tests (Manual QA)

These are **out of scope** for Playwright e2e but should be documented for manual QA. They are visual / tactile judgments a human must make on real hardware.

| # | Area | Check |
|---|------|-------|
| V1 | Design consistency | Warm Playful palette (per `app.css` `--bg-warm`, `--accent-orange`) used consistently across both UIs; no rogue colors. |
| V2 | Touch target sizes | Child: all interactive elements ≥ 60×60 px; PM: all buttons ≥ 44×44 px (per PRD §2.3). |
| V3 | Confetti animation | canvas-confetti fires only on first-time name submission; does not re-fire on page reload; 1.5 s duration; visually pleasant. |
| V4 | Balance pulse | When balance changes, the card briefly scales/highlights (if implemented in CSS); check on real iPad. |
| V5 | Button press squishy | `:active` state on task buttons and PM buttons shows subtle scale-down (per CSS). |
| V6 | Empty states | All 4 list sections (events, audit, tasks, completions) have friendly empty-state copy + icon. |
| V7 | Error states | Network errors show clear, kid-friendly Chinese copy with retry button; never show raw stack traces. |
| V8 | Loading states | Currently no spinners (all APIs are fast); document decision: keep no spinners, but add skeleton if any endpoint slows to > 300 ms. |
| V9 | Typography | Chinese fonts (system default) render cleanly on iPad; no clipping. |
| V10 | Landscape lock | iPad should stay landscape (per `playwright.config.ts`); document if app should enforce. |

---

## 6. Non-Functional Tests

### 6.1 Performance

| # | Test | Target | How |
|---|------|--------|-----|
| N1 | Child SPA first paint | < 2 s on iPad | `page.goto('/'); performance.timing.domContentLoadedEventEnd - navigationStart < 2000` |
| N2 | PM Dashboard full load | < 2 s with 100 audit rows | Open `/admin/`, measure `load` event |
| N3 | Task shortcut click → balance update | < 500 ms | Time from click to balance text change |
| N4 | Approve event → list refresh | < 1 s | Time from click to row removed + all-events updated |

These are smoke-level checks; not full Lighthouse audits. If targets are missed, file a perf bug.

### 6.2 Accessibility

| # | Test | How |
|---|------|-----|
| A1 | Keyboard: `Enter` submits forms | Tab to name input → `Enter` → submits; Tab to submit button → `Enter` → submits. |
| A2 | Keyboard: `Esc` clears PIN | Type PIN → `Esc` → buffer cleared. |
| A3 | Touch: all buttons reachable | Manual on iPad — every action is reachable without a mouse. |
| A4 | ARIA labels on icons | All `aria-hidden="true"` icons are decorative; controls have `aria-label`. |
| A5 | Color contrast | All text passes WCAG AA (4.5:1) on its background. **Manual check.** |
| A6 | Focus ring visible | When tabbing, focus ring is visible on each control. |

### 6.3 Browser Compatibility

- **Primary:** iPad Safari (iOS 17+) — covered by Playwright `iPad (gen 7) landscape` project.
- **Secondary (PM):** Chrome 120+ on macOS/Windows — PM is unlikely to use a phone; verify in CI on Chrome.
- **Not supported (per PRD YAGNI):** IE 11, Edge Legacy, Firefox (PM may use it — but no need to test). Document as best-effort.

---

## 7. Coverage Matrix (PRD Use Cases)

This matrix maps each PRD use case to one or more test scenarios. Status is `TBD` until a spec is implemented.

| PRD Ref | Use Case | Test Scenario(s) | Spec File (planned) | Status |
|---------|----------|------------------|---------------------|--------|
| §5.1 | 子首次填名字 | §3.9 Happy 1–2 | `ui-child-onboarding.spec.ts` | TBD |
| §5.1 | 名字持久化 + 不可改 | §3.9 Smoke 2, Edge `409` | same | TBD |
| §5.2 | 儿子完成任务 | §3.11 Happy 1–2 | `ui-child-task-complete.spec.ts` | TBD |
| §5.2 | 任务每日 1 次限制 | §3.11 Edge 1 | same | TBD |
| §3.4 | 任务模板 CRUD | §3.5 Happy create/edit/delete | `ui-admin-tasks.spec.ts` | TBD |
| §3.4 | 软删除（有 active completion 阻断）| §3.5 Edge `blocked` | same | TBD |
| §5.3 | PM 撤销任务完成 | §3.5 Edge `reactivate`; §3.11 Edge `revoked` | combined | TBD |
| §5.4 | PM 配置任务 | §3.5 Happy create; §4 Flow A step 6 | `ui-admin-tasks.spec.ts` | TBD |
| §5.5 | 儿子提交申请（4 种 type/dir 组合）| §3.12 Happy 1, Happy `4 combos` | `ui-child-submit.spec.ts` | TBD |
| §3.5 | 边界：amount=0 / 空 reason | §3.12 Edge 1–2 | same | TBD |
| §5.6 | PM 审批 | §3.3 Happy 1 (approve) | `ui-admin-pending.spec.ts` | TBD |
| §5.6 | PM 拒绝 | §3.3 Happy 2 (reject) | same | TBD |
| §5.6 | PM 撤销已通过 | §3.4 Happy 1 (revoke approved) | `ui-admin-all-events.spec.ts` | TBD |
| §3.2 | 晚睡扣游戏时间（手动 -1）| §4 Flow B | `flow-deduct-revoke.spec.ts` | TBD |
| §3.5 | 边界：超额申请 / 负余额允许 | §3.12 Edge `negative balance`; §3.7 Edge `overspend` | combined | TBD |
| §3.1 | 双账户模型（1:1） | §3.7 Smoke; §4 Flow D | `ui-admin-exchange.spec.ts` | TBD |
| §3.3 | 周末发零花钱 | §3.8 Happy 1; §4 Flow C | `ui-admin-grant.spec.ts` | TBD |
| §3.3 | 双账户发放 | §3.8 Happy 1 (both fields) | same | TBD |
| §5.7 | PM 兑换（game → money） | §3.7 Happy 1; §4 Flow D | `ui-admin-exchange.spec.ts` | TBD |
| §5.7 | PM 兑换（money → game） | §3.7 Happy 2 | same | TBD |
| §3.5 | 边界：同账户兑换 | §3.7 Edge `same account` | same | TBD |
| §5.8 | 周额度发放 | §3.8; §4 Flow C | `ui-admin-grant.spec.ts` | TBD |
| §2.3 | PM PIN 登录（4 位）| §3.1 Happy 1 | `ui-admin-login.spec.ts` | TBD |
| §2.3 | PM PIN 登录（6-8 位扩展）| §3.1 Happy 2 | same | TBD |
| §2.3 | PIN 错误 5 次锁定 | §3.1 Edge `lockout`; §4 Flow E | combined | TBD |
| §2.3 | 锁定期间输入被忽略 | §3.1 Edge `during lockout` | `ui-admin-login.spec.ts` | TBD |
| §2.3 | Session 过期自动跳登录 | §3.2 Edge `no session` | `ui-admin-dashboard-shell.spec.ts` | TBD |
| §2.3 | 显式登出 | §3.2 Happy `logout` | same | TBD |
| §9.4 | 审计 log 完整性 | §3.6; §4 Flow A end-assert | `ui-admin-audit.spec.ts` | TBD |
| §9.4 | 审计按 actor 过滤 | §3.6 Happy `filter` | same | TBD |

**Untestable / out of scope:**
- **§9.5 数据导出** — no export feature implemented in v2.
- **§10.3 性能验收中的"≥ 1000 事件下渲染 ≤ 1 s"** — only smoke-level perf checks (N1–N4); full benchmark deferred.
- **§3.4 默认任务一键导入** — UI exposes `+ 新建任务` only; the "import defaults" feature is not in v2 code.
- **§3.5 跨周余额累积** — purely a data-layer behavior; verified via direct D1 query, not UI.

---

## 8. Implementation Plan

### 8.1 Phasing

| Phase | Scope | Spec files | Test count est. | Notes |
|-------|-------|------------|-----------------|-------|
| **Phase 1** — Smoke | Both UIs load, key elements present | 2 | ~6 | Foundation for CI. |
| **Phase 2** — Happy path | One spec per feature (13 features) | 13 | ~40 | Main coverage. |
| **Phase 3** — Edge cases | Validation, errors, lockout, empty | 6 | ~25 | Reliability. |
| **Phase 4** — Cross-cutting | Multi-feature flows (A–E + bonus F) | 6 | ~6 | High value, integrates all. |
| **Total** | | ~26 | ~80–120 | |

### 8.2 File Layout

```
tests/e2e/
├── helpers/
│   ├── db.ts          # clearAllData, seedChildData
│   └── ui.ts          # loginAsPm, waitForApiCall, expectToast, expectBalance
├── ui-child-onboarding.spec.ts        # §3.9
├── ui-child-main.spec.ts              # §3.10
├── ui-child-task-complete.spec.ts     # §3.11
├── ui-child-submit.spec.ts            # §3.12
├── ui-child-events.spec.ts            # §3.13
├── ui-admin-login.spec.ts             # §3.1
├── ui-admin-dashboard-shell.spec.ts   # §3.2
├── ui-admin-pending.spec.ts           # §3.3
├── ui-admin-all-events.spec.ts        # §3.4
├── ui-admin-tasks.spec.ts             # §3.5
├── ui-admin-audit.spec.ts             # §3.6
├── ui-admin-exchange.spec.ts          # §3.7
├── ui-admin-grant.spec.ts             # §3.8
├── flow-new-user-day.spec.ts          # §4 Flow A
├── flow-deduct-revoke.spec.ts         # §4 Flow B
├── flow-weekly-grant.spec.ts          # §4 Flow C
├── flow-exchange.spec.ts              # §4 Flow D
├── flow-pm-lockout.spec.ts            # §4 Flow E
└── flow-task-lifecycle.spec.ts        # §4 Flow F
```

### 8.3 Tooling Conventions

- **Imports:** `import { test, expect } from '@playwright/test';` for all specs.
- **Describe pattern:** One top-level `test.describe('UI: <feature>')` per spec.
- **Per-test beforeEach:** Always call `clearAllData()` and `seedChildData({...})` to keep tests independent.
- **Wait strategy:** Prefer `expect(...).toBeVisible()` over `waitForTimeout`. Use `waitForApiCall` helper for action assertions.
- **Page vs context:** Use `test('...', async ({ browser }) => {...})` and create two contexts for cross-actor flows (child + PM).
- **Console errors:** Each spec ends with a soft check: `expect(pageErrors).toEqual([])` collected via `page.on('pageerror', ...)`.

### 8.4 Acceptance for "Phase Done"

- All scenarios in the phase pass locally with `npx playwright test`.
- CI runs the same suite on PR; failure blocks merge.
- Total wall-clock < 5 minutes (lockout flow's 5-min wait exempted — guarded by `test.skip` in CI or replaced with the DB-mutation alternative).

---

## 9. Open Questions for PM

1. **D1 reset strategy** — should tests truncate via `wrangler d1 execute --local` (recommended, ~50 ms per test) or use a dedicated in-memory mock? → **Recommend: real local D1 with helper.**
2. **Lockout timeout in CI** — accept a 5-min wait or substitute with a direct DB clear? → **Recommend: substitute in CI; keep the 5-min wait as one local-only test.**
3. **Cross-midnight tests** — should we mock `Date.now()` to avoid "task completed today" breaking at 00:00? → **Recommend: yes, use `page.clock` (Playwright ≥ 1.45) for the affected tests.**
4. **Visual regression** — defer to v2? → **Recommend: defer; manual QA suffices for v2 release.**
5. **Offline mode** — explicitly out of scope per PRD §1.3? → **Confirmed: not testing offline behavior beyond a single error-banner assertion.**
6. **Default task import** — §3.4 lists a "一键导入默认任务" feature that does not exist in v2 UI. Should we test the seed-based path or skip? → **Recommend: skip; covered by seed file, not UI.**
7. **Negative-event creation by PM** — PRD §3.5 mentions manual `+200 分钟` overspend but no PM UI for arbitrary negative events. Flow B relies on direct API. Add an admin UI? → **Open: defer to v2.1.**
8. **PM Name display in topbar** — `#pm-user` currently shows `未登录`; should it show the admin's display name? → **Open: clarify.**
9. **Child account switcher** — v2 hard-codes `CHILD_USER_ID=2`. Multi-child support is explicitly v2+ (PRD §1.3). Confirm we test only the single-child path. → **Confirmed.**
10. **Confetti library** — `app.js:fireConfetti` likely uses `canvas-confetti` from CDN. If CDN is down, does first-time flow break? → **Recommend: assert no crash if confetti fails (graceful try/catch).**

---

## Appendix A: Test Data Fixtures

### A.1 PM

```yaml
id: 1
name: PM
role: pm
pin_hash: <bcrypt of 123654>
```

Real PIN for tests: **`123654`** (per `.dev.vars` / `seeds/local.sql`).

### A.2 Child

```yaml
id: 2
name: null          # tests set to "Tommy" as needed
role: child
```

### A.3 Tasks (3 sample)

| # | name | token_reward | target_account | icon | category | sort_order |
|---|------|--------------|----------------|------|----------|------------|
| 1 | 整理书桌 | 5 | pocket_money | 📚 | chore | 10 |
| 2 | 练琴 30 分钟 | 10 | game_time | 🎹 | study | 20 |
| 3 | 刷牙 | 1 | pocket_money | 🦷 | habit | 30 |

### A.4 Score Events (5 sample)

| # | type | change_value | status | reason |
|---|------|--------------|--------|--------|
| 1 | game_time | +10 | approved | 按时上床 |
| 2 | pocket_money | +5 | approved | 主动整理书桌 |
| 3 | game_time | -3 | pending | 偷偷玩游戏 |
| 4 | pocket_money | -5 | rejected | 不想吃青菜（误报）|
| 5 | game_time | +20 | revoked | 周额度发放（已撤销）|

### A.5 Audit Log entries (synthetic, for D-section tests)

```yaml
- { actor: pm,     action: login,         target_event_id: null }
- { actor: pm,     action: event_approve, target_event_id: 1 }
- { actor: pm,     action: task_create,   target_event_id: null, details: { name: "整理书桌" } }
- { actor: pm,     action: weekly_grant,  target_event_id: null, details: { game_time: 30, pocket_money: 20, note: "Week 1" } }
- { actor: pm,     action: exchange,      target_event_id: null, details: { from: "game_time", to: "pocket_money", amount: 10 } }
```

### A.6 Seeding strategy

The `seedChildData` helper inserts the above (or a parameterized subset) and returns an object with `taskIds` and `eventIds` for follow-up assertions. The helper lives in `tests/e2e/helpers/db.ts` and uses raw SQL via `wrangler d1 execute --local --file=<temp>` or via direct `better-sqlite3` (CCs decide; both work).

---

## Appendix B: Existing Test Gaps

The current 10 spec files contain 26 test cases, all API-level. None of them drive the UI. This is the gap the new plan fills.

| Existing spec | Existing tests | UI-driven replacement? | Notes |
|---------------|----------------|-----------------------|-------|
| `hello.spec.ts` | 2 (health) | No | Stays — health check is API-only. |
| `public-api.spec.ts` | 2 (balance 400, user 404) | No | Stays — error contract. |
| `task-system.spec.ts` | 3 (404/400/401 on task APIs) | No | Stays — error contract. |
| `event-approval.spec.ts` | 4 (event submit 400, auth checks) | Partial | Keep auth-check tests; add §3.12 UI tests for happy path. |
| `exchange-grant.spec.ts` | 2 (auth 401) | No | Keep; add §3.7 + §3.8 UI happy paths. |
| `admin-extras.spec.ts` | 4 (profile/audit/tasks auth) | No | Keep; add §3.6 UI audit-log tests. |
| `admin-login.spec.ts` | 2 (static asset checks) | **Replace with** §3.1 | The existing 2 tests check `login.html` strings only; the new spec drives the actual keypad. Keep existing as "smoke"; the new `ui-admin-login.spec.ts` adds UI flows. |
| `child-ui.spec.ts` | 4 (3 static asset + 1 shell render) | **Augment with** §3.10–3.13 | Existing 4 stay as smoke; new specs add happy path / edge. |
| `admin-dashboard.spec.ts` | 3 (static asset + 1 auth-redirect) | **Augment with** §3.2 + §3.3–3.8 | Existing 3 stay; new specs add section-by-section flows. |

### B.1 Net new specs

26 (existing test cases) + ~80–120 (new, per §8.1) = ~106–146 total after this plan lands.

### B.2 Migration plan

1. Land Phase 1 (smoke) — no regressions.
2. Land Phase 2 (happy path) — one feature per PR for reviewability.
3. Land Phase 3 (edge cases).
4. Land Phase 4 (cross-cutting).
5. Each PR: ensure existing 26 tests still pass; new spec runs in < 30 s individually.

### B.3 What stays in `tests/unit/`

Unit tests for `tests/unit/admin-auth.test.ts` (and any other unit suites) are **not** affected by this plan. They cover hashing, validation, and other pure-function logic. The new e2e specs cover the UI layer; the API contract is the boundary between them.

---

**End of Test Plan v1.**
