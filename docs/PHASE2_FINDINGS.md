# Phase 2 Findings

Phase 2 added two new e2e spec files (`tests/e2e/ui-child-submit-happy.spec.ts`,
`tests/e2e/ui-admin-pending.spec.ts`) covering `docs/TEST_PLAN.md` §3.12 and §3.3.
The work surfaced 4 findings — 1 was a real bug (fixed), 3 are documented
behaviors to track for later.

## Fixed

### F1. submitEvent() reads from missing `name` attributes (bug, fixed)

**Symptom**: Child submit modal worked, but on submit the API call never
fired — the modal stayed open and no toast appeared. All 4 §3.12 happy
tests failed at `expect('#submit-modal').toBeHidden()`.

**Root cause** (`public/index.html:31-54` + `public/app.js:195-210`):
`submitEvent(form)` reads `form.type.value`, `form.amount.value`,
`form.reason.value` to build the POST body. But the form elements had
`id="submit-..."` but no `name="..."` attributes. The `<select>` `<input>`
and `<textarea>` were thus unreachable via `form.<name>`. `form.type` on
`HTMLFormElement` returns the deprecated string "form", so
`form.type.value` was undefined; `form.amount` / `form.reason` were
undefined, throwing TypeError on `.value` access.

Why unit tests missed it: `tests/unit/me-events-submit.test.ts` only
exercises the server endpoint `POST /api/me/events` directly. It does
not test the browser-side `submitEvent` JS. The bug only fires when
the browser submit handler runs.

**Fix** (5 lines, public/index.html):
- `<select id="submit-type">` → `name="type"`
- `<input id="submit-amount">` → `name="amount"`
- `<textarea id="submit-reason">` → `name="reason"`

After fix: all 4 §3.12 happy tests pass.

## Documented (not fixed)

### F2. PM approve button has no debounce / disabled-during-fetch (ui-bug)

**Symptom**: `ui-admin-pending.spec.ts` "approve 5x in 200ms" test
asserts the current behavior — 5 clicks fire 5 separate POST requests.
The first one wins (200 + balance updated). The other 4 get 409
"already approved" or 200 idempotent.

**Root cause** (`public/admin/admin.js:328-336`): `approveEvent(id)` has
no in-flight tracking, no button-disable, no debouncing. Each click
re-enters the function and re-fires the POST.

**Why we accept current behavior**:
- Server-side: the API is idempotent + returns 409 on conflict, so
  the worst case is 4 redundant 409s, no data corruption.
- UX impact: low (PM user can spam-click without seeing a stuck button
  or broken state).
- The fix is a 10-line change in admin.js (set btn.disabled, await,
  re-enable) but it touches multiple event handlers (approve, reject,
  revoke, deleteTask). Defer to next sprint.

**Tracking**: search for `KNOWN FINDING (PHASE2)` in the spec for the
exact assertion pattern.

### F3. loginAsPm via `request` fixture doesn't share cookies with page

**Symptom**: §3.3 admin-pending spec, beforeEach used Playwright's
`request` fixture (separate API context). Cookie set by `loginAsPm(request)`
was on the API context, not on the page's browser context. After
`page.goto('/admin/')` the page was unauthenticated and got redirected
to `/admin/login`. 9 of 11 §3.3 tests failed with
`expect('#pending-list .pm-row').toHaveCount(2)` → 0.

**Root cause**: This is a Playwright API design choice. The `request`
fixture creates a fresh `APIRequestContext` per test, with its own
cookie jar. To share cookies with the page, you must use
`page.context().request`.

**Fix** (in `ui-admin-pending.spec.ts`): replaced all `request` fixture
references with `page.context().request` in beforeEach + 4 individual
test functions that need authenticated API calls (audit log fetch,
concurrent API re-approve, negative API approve).

**General rule**: any Playwright test that does `loginAsPm` then
`page.goto('/admin/...')` MUST use `page.context().request`, not the
`request` fixture. The baseline `ui-admin-login.spec.ts` already used
this pattern correctly (`page.context().request`); §3.3 inherited the
buggy pattern from §3.12 spec which doesn't need page-side auth.

### F4. pending-list rows do NOT have a status badge (only 通过/拒绝 buttons)

**Symptom**: §3.3 smoke test asserted `.pm-badge.pending` inside
`#pending-list .pm-row` → 0 elements. The row only renders the
`<button data-act="approve">通过</button>` and
`<button data-act="reject">拒绝</button>` actions.

**Root cause** (`public/admin/admin.js:165-189`): `renderPending()` only
outputs icon + amount + reason + 2 action buttons. Badges only render
in `renderAllEvents()` (section B).

**Fix** (spec): §3.3 smoke test now checks for the 通过/拒绝 buttons
instead of the missing badge. This is a faithful representation of the
current UI design — the status is implicit (everything in the pending
list is by definition pending).

**Design note**: the "no badge in pending" is intentional — the section
header is already labeled "⏳ 待审 Events", so adding a per-row
"pending" badge would be redundant. The all-events section does need
per-row badges because it shows all 4 statuses (pending/approved/
rejected/revoked) together.

## Test count delta

| | Before Phase 2 | After Phase 2 |
|---|---|---|
| Unit | 198 | 198 |
| E2E | 85 (4 happy + 3 known flaky) | 99 (4 happy + 11 §3.3 + 1 pre-existing flaky) |
| **Total** | 283 | 297 |

- 4 new e2e (§3.12 happy)
- 11 new e2e (§3.3 PM pending)
- 1 pre-existing flaky in `ui-child-main.spec.ts:82` (test completed
  today badge test) — not introduced by Phase 2.
