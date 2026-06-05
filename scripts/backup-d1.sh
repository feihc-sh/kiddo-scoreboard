#!/usr/bin/env bash
# scripts/backup-d1.sh
# Export the production D1 database to a local .sql file.
# Uses `wrangler d1 export` (Cloudflare-provided; produces a SQL dump).
#
# Usage:
#   ./scripts/backup-d1.sh                    # writes to ./backups/<timestamp>.sql
#   ./scripts/backup-d1.sh /path/to/file.sql  # writes to specified path
#
# Cron-friendly: 0 3 * * * /path/to/scripts/backup-d1.sh /path/to/backups/daily-$(date +\%F).sql

set -euo pipefail

DB_NAME="${DB_NAME:-kiddo-scoreboard-db}"

if [[ -n "${1:-}" ]]; then
  OUT="$1"
  mkdir -p "$(dirname "$OUT")"
else
  mkdir -p backups
  OUT="backups/$(date +%Y%m%d-%H%M%S).sql"
fi

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "ERROR: wrangler not authenticated. Run: npx wrangler login" >&2
  exit 1
fi

echo "Exporting D1 ($DB_NAME) → $OUT"
npx wrangler d1 export "$DB_NAME" --remote --output="$OUT"

# Compress if > 1MB
SIZE=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT" 2>/dev/null || echo 0)
if [[ $SIZE -gt 1048576 ]]; then
  gzip "$OUT"
  echo "Compressed to ${OUT}.gz (was ${SIZE} bytes)"
fi

echo "✅ Backup complete: $OUT"
