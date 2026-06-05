# 🚀 Deployment Guide

This doc covers the one-time setup and the recurring deploy workflow for the
**kiddo-scoreboard** Cloudflare Workers + D1 app.

## One-time setup

### 1. Install dependencies
```bash
npm install
```

### 2. Authenticate with Cloudflare
```bash
npx wrangler login
```
This opens a browser window; approve access. Verify with:
```bash
npx wrangler whoami
```

### 3. Create the production D1 database
```bash
npx wrangler d1 create kiddo-scoreboard-db --remote
```
The output will include a `database_id` UUID. **Copy it.**

### 4. Update `wrangler.toml`
Replace the placeholder `database_id` with the real one:
```toml
[[d1_databases]]
binding = "DB"
database_name = "kiddo-scoreboard-db"
database_id = "REAL-UUID-HERE"  # from step 3
migrations_dir = "migrations"
```

### 5. Set the JWT secret
The PM PIN hash and the session HMAC both derive from this secret. Pick a
strong random value (32+ bytes) and store it as a Wrangler secret:
```bash
openssl rand -hex 32 | npx wrangler secret put JWT_SECRET
```
**Save this value somewhere safe** — you need the same value to (re)set the
PM PIN later (see step 8).

### 6. Apply migrations to production D1
```bash
npm run deploy:migrate
```
This runs all `migrations/*.sql` files against the remote database.

### 7. (Optional) Seed the PM user template
The PM user is created lazily by `init-prod.sh` (next step). You don't need
to seed it manually.

### 8. Set the initial PM PIN
This is what the parent types at `/admin/login` to access the dashboard.
```bash
PIN=1234 JWT_SECRET=<same-value-from-step-5> npm run deploy:init
```
- `PIN` is 4-8 digits. Pick something memorable.
- `JWT_SECRET` must be the **same** value you stored in step 5 (the hash
  is derived from it).
- The script will prompt to confirm before executing the remote SQL.

You can re-run this script at any time to change the PM PIN.

### 9. Deploy the worker + assets
```bash
npm run deploy
```
The output will show the deployed URL: `https://kiddo-scoreboard.<your-subdomain>.workers.dev`
(or your custom domain if configured).

### 10. Verify
```bash
# Health
curl https://kiddo-scoreboard.<sub>.workers.dev/health

# Child UI
open https://kiddo-scoreboard.<sub>.workers.dev/

# PM login (open in browser; enter PIN from step 8)
open https://kiddo-scoreboard.<sub>.workers.dev/admin/login
```

---

## Recurring deploy

```bash
# Run all unit + e2e tests
npm test

# Dry-run the deploy (catches config errors without actually deploying)
npm run deploy:dry-run

# Apply pending migrations (if any)
npm run deploy:migrate

# Deploy
npm run deploy
```

That's it. Cloudflare workers deploy in ~10 seconds globally.

---

## Rollback

Cloudflare keeps the last few deployments. To roll back:
1. Open the Cloudflare dashboard → Workers & Pages → `kiddo-scoreboard` → Deployments
2. Click "..." on an earlier deployment → "Rollback to this deploy"

Or via CLI:
```bash
npx wrangler rollback  # rolls back to the previous deployment
```

Database migrations are **not** auto-rolled back. If a migration caused
issues, write a new migration to reverse it (the MIGRATIONS are append-only
by design).

---

## Operations

### Reset the PM PIN
```bash
PIN=9999 JWT_SECRET=<your-secret> npm run deploy:init
```

### Inspect the production D1
```bash
# List tables
npx wrangler d1 execute kiddo-scoreboard-db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"

# Last 20 events
npx wrangler d1 execute kiddo-scoreboard-db --remote --command="SELECT id, type, change_value, reason, status, created_at FROM score_events ORDER BY id DESC LIMIT 20;"

# Audit log
npx wrangler d1 execute kiddo-scoreboard-db --remote --command="SELECT id, actor, action, target_user_id, created_at FROM audit_log ORDER BY id DESC LIMIT 20;"
```

### Local development
```bash
# Local D1 (separate from production)
npm run dev
# Visit http://localhost:8787
```
Local uses a SQLite file under `.wrangler/state/`. Migrations run automatically
on first dev start.

---

## Security checklist

Before going live, confirm:
- [ ] `JWT_SECRET` is ≥ 32 bytes random (use `openssl rand -hex 32`)
- [ ] `JWT_SECRET` is stored as a Wrangler secret (not in code)
- [ ] PM PIN is 4-8 digits and not "1234"
- [ ] The deployed URL uses HTTPS (it always does on Cloudflare)
- [ ] `wrangler.toml` does NOT have `database_id = "local-dev-placeholder"` in production

---

## Cost

The app runs on Cloudflare's free tier:
- **Workers**: 100,000 requests/day free
- **D1**: 5 GB storage, 5 million reads/day, 100k writes/day free
- **Static assets**: served from the same Worker, no extra cost

This is well within the bounds of a single-family use case. No credit card
needed.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `wrangler: Not authenticated` | `npx wrangler login` |
| `D1_ERROR: no such table` | `npm run deploy:migrate` |
| `SERVER_MISCONFIG: JWT_SECRET not set` | `npx wrangler secret put JWT_SECRET` |
| `NO_PM_USER: No PM user configured` | `npm run deploy:init` |
| Login cookie not sticking | Check browser DevTools → Application → Cookies; should have `Secure` flag set in prod |
| 429 on login | Wait 5 minutes (per-IP lockout) |
| 404 on `/admin/` | Deploy must include latest code; `npm run deploy` |
