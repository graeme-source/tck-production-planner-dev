/**
 * Website changelog helpers — pure (unit-tested). Turn theme commits into
 * changelog entries and decide which orders count for lead-time history.
 */

export const CHANGE_CATEGORIES = [
  "theme", "offer", "price", "delivery", "email", "ads", "ab_test", "external", "other",
] as const;
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];

/** Commit message → changelog title + detail, without git trailers
 *  (Co-Authored-By, Claude-Session…) that mean nothing to a reader. */
export function parseCommitMessage(message: string): { title: string; detail: string | null } {
  const lines = message.split("\n");
  const title = (lines[0] ?? "").trim();
  const body = lines.slice(1)
    .filter(l => !/^[A-Za-z-]+: \S/.test(l.trim()) || /^(Note|Why|Before|After):/.test(l.trim()))
    .join("\n")
    .trim();
  return { title, detail: body ? body.slice(0, 1200) : null };
}

/** Shopify's GitHub sync commits every theme-editor save with this
 *  subject — the commit says nothing about what changed, so the diff has
 *  to be read instead. */
export function isThemeEditorSave(title: string): boolean {
  return /^Update from Shopify\b/i.test(title);
}

/** Merge commits repeat changes already logged by their own commits. */
export function isMergeCommit(title: string): boolean {
  return /^Merge (branch|pull request|remote-tracking)/i.test(title);
}

/** Best-guess category from what a theme change touched. */
export function categoriseThemeChange(title: string, files: string[]): ChangeCategory {
  const t = title.toLowerCase();
  if (/free pack|offer|discount|announcement|promo|threshold/.test(t)) return "offer";
  if (/deliver|postcode|zapiet|cutoff/.test(t)) return "delivery";
  if (/price|£/.test(t)) return "price";
  if (files.length > 0 && files.every(f => f === "config/settings_data.json")) return "offer";
  return "theme";
}

/**
 * Orders whose delivery date wasn't the customer's own choice on the day
 * (subscription renewals, wholesale) would distort "earliest bookable".
 * Tag names come from the shop's own tagging; matched case-insensitively.
 */
export const LEAD_EXCLUDED_TAGS = ["subscription recurring order", "wholesale"];

export function countsForLeadHistory(tags: string[], cancelled: boolean): boolean {
  if (cancelled) return false;
  const lower = tags.map(t => t.trim().toLowerCase());
  return !LEAD_EXCLUDED_TAGS.some(x => lower.includes(x));
}
