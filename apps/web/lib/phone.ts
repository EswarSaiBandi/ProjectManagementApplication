/** Digits only — keep in sync with SQL `normalize_phone` for attendance / labour matching. */
export function normalizePhoneDigits(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/\D/g, '');
}
