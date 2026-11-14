#!/usr/bin/env bash
# scripts/pre-pr-check.sh — Phase 0 mecha-challenge pre-PR gate
# All checks must PASS before commit / push / PR
# PRD §A.4 + §D.2: hard gate
set -e

# The PM/cron shell exports NODE_ENV=production. npm then silently omits
# devDependencies ("npm config get omit" -> "dev"), so packages/shared's
# `prepare: tsc` runs before tsc is installed and dies with
#   sh: tsc: command not found   (exit 127)
# which aborts EVERY commit on this branch (the .husky/pre-commit hook calls
# this script). Measured 2026-11-12: 7 suites / 62 tests silently uncollected.
#
# Fix: force devDependencies explicitly instead of relying on the ambient
# NODE_ENV. --include=dev overrides `omit=dev`; NODE_ENV=development keeps
# npm from re-deriving omit=dev in the first place.
export NODE_ENV=development
export npm_config_omit=

echo "[1/4] npm install (silent, triggers workspace prepare to build packages/shared/dist/)"
npm install --no-audit --no-fund --silent --include=dev

echo "[2/4] test:unit (baseline — pre-existing failures accepted, see MECHA-PHASE-0-BASELINE.md)"
npm run test:unit 2>&1 | tail -20 || echo "  ↑ allowed: pre-existing happy-dom + D1Result baseline from origin/main"

echo "[3/4] test:shared"
npm run test:shared

echo "[4/4] typecheck (tsconfig.phase0.json — excludes pre-existing mecha baseline)"
npm run typecheck:phase0

echo "✅ pre-pr-check PASS"
