/**
 * UK dates at the edges (Graeme, 2026-10-27: date of birth as DD/MM/YYYY
 * "everywhere"). Dates are STORED as ISO calendar days ("1990-05-14") —
 * nothing else changes — and only shown and typed as DD/MM/YYYY. Pure,
 * calendar arithmetic only: no Date objects, so no time zone can shift a day.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

function realDay(y: number, m: number, d: number): boolean {
  return Number.isInteger(y) && y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** "1990-05-14" → true; "2025-02-29" → false. */
export function isIsoDate(value: string): boolean {
  const m = ISO_RE.exec(value.trim());
  return !!m && realDay(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * What someone typed → ISO, or null if it isn't a real date.
 * Accepts "14/05/1990", "14051990", "14-05-1990", "14.05.1990", "4/5/1990",
 * and an ISO date (what the old date picker stored) as-is.
 */
export function parseUkDate(input: string): string | null {
  const s = input.trim();
  if (isIsoDate(s)) return s;
  let d: number, m: number, y: number;
  const sep = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(s);
  const bare = /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  if (sep) { d = Number(sep[1]); m = Number(sep[2]); y = Number(sep[3]); }
  else if (bare) { d = Number(bare[1]); m = Number(bare[2]); y = Number(bare[3]); }
  else return null;
  return realDay(y, m, d) ? iso(y, m, d) : null;
}

/** ISO → "14/05/1990". Anything that isn't an ISO date comes back as given. */
export function formatUkDate(value: string): string {
  const m = ISO_RE.exec(value.trim());
  if (!m || !realDay(Number(m[1]), Number(m[2]), Number(m[3]))) return value;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** A real date strictly before `todayIso` (the London day; the caller
 *  decides "today"). Dates of birth must pass this. */
export function isPastIsoDate(value: string, todayIso: string): boolean {
  return isIsoDate(value) && value.trim() < todayIso;
}

/** Tidy as-you-type: digits only, slashes added — "1405" → "14/05". */
export function maskUkDateInput(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
