/**
 * family.ts — Family domain type
 *
 * Represents a family unit (首版: 1 家 1 家长 1 孩子).
 * Maps to the `families` D1 table created in migration 0016_families.sql.
 */

export interface Family {
  id: number;
  /** Display name of the family (e.g. "张三家") */
  name: string;
  /** Unix timestamp (seconds) when the family was created */
  created_at: number;
}
