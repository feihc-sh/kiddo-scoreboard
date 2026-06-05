#!/usr/bin/env bash
# Run Playwright e2e tests in 3 parallel shards.
# STATUS: DRAFT — not currently working.
#
# Why it's a draft: wrangler 4.98's `d1 execute --persist-to <abs-path>` resolves
# the path relative to CWD (strips leading /), so helpers/db.ts can't write to
# the shard-specific SQLite file. To make this work, helpers/db.ts must switch
# from `wrangler d1 execute` to the sqlite3 CLI, reading/writing the SQLite
# file directly (path: <persist-to>/v3/d1/miniflare-D1DatabaseObject/*.sqlite).
# See helpers/db.ts TODO for details.
#
# Usage once helpers support it:
#   bash scripts/run-shards.sh
#   # or
#   SHARDS=2 bash scripts/run-shards.sh

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "❌ scripts/run-shards.sh is not currently functional."
echo "   See top of this file for the wrangler 4.98 path-resolution workaround needed."
exit 1
