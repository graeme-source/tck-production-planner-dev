/**
 * Contract rendering — pure text substitution, kept out of the route so it
 * can be unit-tested (charter: bug fixes and sensitive logic ship with
 * tests; a half-filled employment contract reaching an employee would be
 * exactly the kind of quiet failure this codebase refuses).
 *
 * Rules:
 *  - Placeholders are {{snake_case}} tokens in the template body.
 *  - Every provided field must be non-blank; every placeholder in the
 *    template must be provided. Anything else throws — generation fails
 *    loudly rather than issuing a contract with "{{rate_of_pay}}" in it.
 */

export const CONTRACT_FIELDS = [
  "employee_name",
  "issue_date",
  "start_date",
  "rate_of_pay",
  "job_title",
  "weekly_hours",
] as const;

export type ContractField = (typeof CONTRACT_FIELDS)[number];

const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

/** All distinct placeholder names appearing in a template body. */
export function templatePlaceholders(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER_RE)) found.add(m[1]);
  return [...found];
}

/** Format a YYYY-MM-DD date the way the contract reads: "7 September 2026". */
export function contractDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Not a YYYY-MM-DD date: "${iso}"`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) throw new Error(`Not a real date: "${iso}"`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function renderContract(body: string, fields: Record<ContractField, string>): string {
  const blank = CONTRACT_FIELDS.filter(f => !fields[f] || fields[f].trim() === "");
  if (blank.length > 0) {
    throw new Error(`Missing contract fields: ${blank.join(", ")}`);
  }

  const unknown = templatePlaceholders(body).filter(p => !(CONTRACT_FIELDS as readonly string[]).includes(p));
  if (unknown.length > 0) {
    throw new Error(
      `The template contains placeholders the generator doesn't know how to fill: ${unknown.map(p => `{{${p}}}`).join(", ")}. ` +
      `Known fields: ${CONTRACT_FIELDS.map(f => `{{${f}}}`).join(", ")}.`,
    );
  }

  const rendered = body.replace(PLACEHOLDER_RE, (_all, name: string) => fields[name as ContractField]);

  // Belt and braces: nothing that still looks like a placeholder may leave.
  const leftover = templatePlaceholders(rendered);
  if (leftover.length > 0) {
    throw new Error(`Rendering left unresolved placeholders: ${leftover.join(", ")}`);
  }
  return rendered;
}
