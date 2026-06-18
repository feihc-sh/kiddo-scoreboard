// tests/unit/running-schema.test.ts
// Item #011 §1: Running Map M1 schema contract.
// Verifies that migrations/0009_running_tables.sql creates the 3 required
// tables (running_maps / running_points / running_records) with the right
// shape, and that migrations/0010_seed_shanghai_suzhou.sql seeds the
// first map (Shanghai → Suzhou, 10 nodes) + 2 inactive placeholders.
// Mirrors the deleted-records / health-events migration test pattern.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'migrations', '0009_running_tables.sql');
const SEED_PATH   = path.join(__dirname, '..', '..', 'migrations', '0010_seed_shanghai_suzhou.sql');

describe('Item #011 §1: running map schema + seed', () => {
  it('0009_running_tables.sql exists at the expected path', () => {
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
  });

  it('0010_seed_shanghai_suzhou.sql exists at the expected path', () => {
    expect(fs.existsSync(SEED_PATH)).toBe(true);
  });

  it('0009 declares the running_maps table with is_active + display_order', () => {
    const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS running_maps/);
    expect(sql).toMatch(/is_active\s+INTEGER NOT NULL DEFAULT 0 CHECK\(is_active IN \(0, 1\)\)/);
    expect(sql).toMatch(/display_order\s+INTEGER/);
    expect(sql).toMatch(/total_km\s+REAL\s+NOT NULL CHECK\(total_km > 0\)/);
  });

  it('0009 declares the running_points table with order_index + cum_km', () => {
    const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS running_points/);
    expect(sql).toMatch(/order_index\s+INTEGER NOT NULL/);
    expect(sql).toMatch(/cum_km\s+REAL\s+NOT NULL CHECK\(cum_km >= 0\)/);
    // FK to running_maps with ON DELETE CASCADE (so dropping a map cleans up points)
    expect(sql).toMatch(/FOREIGN KEY \(map_id\) REFERENCES running_maps\(id\) ON DELETE CASCADE/);
    // Index for the per-map ordered rendering
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_running_points_map_order/);
  });

  it('0009 declares the running_records table with revoke columns + child FK', () => {
    const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS running_records/);
    expect(sql).toMatch(/child_id\s+INTEGER NOT NULL/);
    expect(sql).toMatch(/km\s+REAL\s+NOT NULL CHECK\(km > 0\)/);
    expect(sql).toMatch(/revoked_at\s+INTEGER/);
    expect(sql).toMatch(/revoked_by\s+INTEGER/);
    // 2 indexes: child+map timeline + active filter
    expect(sql).toMatch(/idx_running_records_child_map/);
    expect(sql).toMatch(/idx_running_records_active/);
  });

  it('0010 seeds the first Shanghai→Suzhou map (95 km) as active', () => {
    const sql = fs.readFileSync(SEED_PATH, 'utf8');
    expect(sql).toMatch(/INSERT OR IGNORE INTO running_maps[\s\S]*?\(1,[\s\S]*?shanghai-suzhou[\s\S]*?95\.0,\s*1,\s*1,/);
  });

  it('0010 seeds 2 inactive placeholder maps for the unlock chain', () => {
    const sql = fs.readFileSync(SEED_PATH, 'utf8');
    expect(sql).toContain("'suzhou-hangzhou'");
    expect(sql).toContain("'hangzhou-huangshan'");
    // The 2nd/3rd maps must be inactive (is_active=0) — match across the row
    expect(sql).toMatch(/\(2,[\s\S]*?180\.0,\s*0,\s*2,/);
    expect(sql).toMatch(/\(3,[\s\S]*?260\.0,\s*0,\s*3,/);
  });

  it('0010 seeds 10 points on the Shanghai→Suzhou map (start + 8 mid + end)', () => {
    const sql = fs.readFileSync(SEED_PATH, 'utf8');
    expect(sql).toMatch(/INSERT OR IGNORE INTO running_points/);
    // 起点 cum_km=0
    expect(sql).toMatch(/0,\s*0\.0\)/);
    // 终点 cum_km=95.0
    expect(sql).toMatch(/9,\s*95\.0\)/);
    // 8 个中间节点 (order_index 1..8, 至少 8 条 INSERT 行, 行号 id=2..9)
    const orderMatches = sql.match(/,\s*([1-8]),\s*\d+\.\d+\)/g) || [];
    expect(orderMatches.length).toBeGreaterThanOrEqual(8);
  });
});
