/**
 * Quantity validation: all stock quantities must be multiples of 0.25.
 * Mirrors the DB helper public.is_quarter_multiple(NUMERIC).
 */

export const QUANTITY_STEP = 0.25;

export function isQuarterMultiple(n: number | null | undefined): boolean {
  if (n == null) return true;
  if (!Number.isFinite(n)) return false;
  // Multiply by 4 then check integer — avoids FP modulo edge cases.
  const scaled = n * 4;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

/**
 * Parse a user-entered string and validate it as a positive quarter-multiple.
 * Returns the parsed number on success, or an error message on failure.
 */
export function parseQuarterQty(
  raw: string,
  opts: { label?: string; allowZero?: boolean } = {}
): { ok: true; value: number } | { ok: false; error: string } {
  const label = opts.label ?? 'Quantity';
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} is required` };
  if (!opts.allowZero && n <= 0) return { ok: false, error: `${label} must be > 0` };
  if (opts.allowZero && n < 0) return { ok: false, error: `${label} cannot be negative` };
  if (!isQuarterMultiple(n)) {
    return {
      ok: false,
      error: `${label} must be a multiple of 0.25 (e.g. 0.25, 0.5, 0.75, 1, 1.25). Got ${n}.`,
    };
  }
  return { ok: true, value: n };
}
