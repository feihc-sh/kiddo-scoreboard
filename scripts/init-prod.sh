#!/usr/bin/env bash
# scripts/init-prod.sh
# Initialize (or reset) the PM user in production Cloudflare D1.
#
# What it does:
#   1. Read JWT_SECRET from env (or prompt)
#   2. Read new PIN (or read from env $PIN; 4-8 digits)
#   3. Hash the PIN with the JWT_SECRET using PBKDF2-SHA256 (600k iter, matching M2)
#   4. UPSERT into the users table (id=1, role='pm') with the new pin_hash
#   5. Log a marker in audit_log so it's obvious in history
#
# Usage:
#   PIN=1234 JWT_SECRET=$(cat .prod-secret) ./scripts/init-prod.sh
# Or interactive:
#   ./scripts/init-prod.sh
#
# Requires: wrangler authenticated (run `npx wrangler login` first)

set -euo pipefail

DB_NAME="${DB_NAME:-kiddo-scoreboard-db}"

# --- 1. Read PIN ---
if [[ -z "${PIN:-}" ]]; then
  echo "Enter new PM PIN (4-8 digits):"
  read -r -s PIN
  echo
fi
if [[ ! "$PIN" =~ ^[0-9]{4,8}$ ]]; then
  echo "ERROR: PIN must be 4-8 digits" >&2
  exit 1
fi

# --- 2. Read JWT_SECRET ---
if [[ -z "${JWT_SECRET:-}" ]]; then
  if [[ -t 0 ]]; then
    echo "Enter JWT_SECRET (the same one set via 'wrangler secret put JWT_SECRET'):"
    read -r -s JWT_SECRET
    echo
  else
    echo "ERROR: JWT_SECRET env var required (set the same value as the wrangler secret)" >&2
    exit 1
  fi
fi

# --- 3. Hash PIN ---
HASH=$(node scripts/hash-pin.mjs "$PIN" "$JWT_SECRET")
echo "Generated hash: $HASH"

# --- 4. Verify wrangler auth ---
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "ERROR: wrangler not authenticated. Run: npx wrangler login" >&2
  exit 1
fi

# --- 5. Apply SQL ---
NOW=$(date +%s)
SQL=$(cat <<EOF
INSERT INTO users (id, name, role, pin_hash, created_at, updated_at)
  VALUES (1, 'PM', 'pm', '$HASH', $NOW, $NOW)
  ON CONFLICT(id) DO UPDATE SET
    pin_hash = excluded.pin_hash,
    updated_at = excluded.updated_at;

INSERT INTO audit_log (actor, action, target_user_id, details, created_at)
  VALUES ('system', 'init_prod_pin', 1, json_object('note', 'PM PIN initialized/updated via init-prod.sh'), $NOW);
EOF
)

echo
echo "About to run the following on REMOTE D1 ($DB_NAME):"
echo "----------------------------------------"
echo "$SQL" | sed 's/pbkdf2\$[^\"]*/pbkdf2$REDACTED/g'
echo "----------------------------------------"
read -p "Continue? [y/N] " -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo "$SQL" | npx wrangler d1 execute "$DB_NAME" --remote --command=-

echo
echo "✅ PM PIN updated in production. Test by visiting /admin/login on the deployed URL."
