# 2026-06-06 — iPad Safari stale cache blocks submit form

## Symptom (user report)
"Kiddo 主页提交申请 → form 不关 → 刷新最近事件 hang"

## Investigation
1. Server-side OK: `wrangler dev` log shows `POST /api/me/events 201 Created` in all runs.
2. WebKit + iPad UA simulation via cloudflared URL: form closes, toast shows, refresh works — 0 hung requests out of 14.
3. wrangler dev returns `Cache-Control: public, max-age=0, must-revalidate` — Safari treats 304 + matching ETag as "use cached body", so iPad kept running old HTML/JS.

## Root cause
iPad Safari cached OLD app.js + OLD HTML (from before F1 fix that added `name="type"/"amount"/"reason"`). The new HTML on server had the fix, but Safari's cache served the old version. So submit failed silently (no name attrs → `form.type.value` = `undefined`), error toast was shown, modal did NOT close (per `submitEvent()` code: `closeSubmitModal()` only runs on `await api` success).

## Fix (defense in depth, 3 layers)
1. `public/index.html`, `public/admin/index.html`, `public/admin/login.html` add:
   ```html
   <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
   <meta http-equiv="Pragma" content="no-cache">
   <meta http-equiv="Expires" content="0">
   ```
2. All `<link href="/app.css">` and `<script src="/app.js">` get `?v=2` query string for cache-busting.
3. `wrangler.toml` adds `[assets.cache_control]` table for future wrangler versions that support it (4.98 silently ignores).

## Verification
- `curl https://chem-asn-cir-chester.trycloudflare.com/` returns HTML with `?v=2` + no-store meta ✓
- `node scripts/screenshot-phase2.mjs` regenerated 8 phase2 PNGs ✓
- WebKit diag spec: 14 requests, 0 hung, modal closes, toast shows ✓
- Committed: `bcd906c`

## User action required
On iPad:
1. **Kill Safari process** (swipe up from home bar → swipe up on Safari preview to close)
2. **Reopen Safari**
3. **Visit** https://chem-asn-cir-chester.trycloudflare.com/
4. Submit one event → modal should close, toast "已提交，等家长审核～" should appear
5. Tap refresh button → events should reload without hang

## Production note
Remove the 3 `<meta http-equiv>` lines and `?v=2` query strings before `wrangler deploy` — they prevent real CDN caching. Replace with a build-time hash in filenames (e.g. `app.<hash>.js`) for proper production cache-busting.
