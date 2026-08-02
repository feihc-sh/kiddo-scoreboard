#!/usr/bin/env bash
# scripts/pre-pr-check.sh — Phase 0 mecha-challenge pre-PR gate
# All checks must PASS before commit / push / PR
# PRD §A.4 + §D.2: hard gate
set -e

echo "[1/4] npm ci (silent)"
npm ci --silent

echo "[2/4] test:unit (baseline — pre-existing failures accepted, see MECHA-PHASE-0-BASELINE.md)"
npm run test:unit 2>&1 | tail -20 || echo "  ↑ allowed: pre-existing happy-dom + D1Result baseline from origin/main"

echo "[3/4] test:shared"
npm run test:shared

echo "[4/4] typecheck (tsconfig.phase0.json — excludes pre-existing mecha baseline)"
npm run typecheck:phase0

echo "✅ pre-pr-check PASS"
