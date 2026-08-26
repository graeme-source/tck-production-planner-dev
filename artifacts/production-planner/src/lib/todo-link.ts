/**
 * Resolve a to-do task's stored `url` into something clickable.
 *
 * Tasks carry two kinds of link: pages of this app stored as app-relative
 * paths ("/lean-review?week=next"), and external sites ("supplier.co.uk").
 * App paths must be kept relative — prefixing a scheme turns the first
 * path segment into a hostname ("https:///lean-review" → DNS lookup for
 * "lean-review"), which is exactly the bug this helper exists to prevent.
 */
export type ResolvedTodoLink = {
  href: string;
  /** Short text for the button: hostname for external links, path for app pages. */
  label: string;
  /** External links open in a new tab; app pages navigate in the same tab. */
  external: boolean;
};

export function resolveTodoLink(url: string): ResolvedTodoLink {
  const trimmed = url.trim();
  if (trimmed.startsWith("/")) {
    const label = trimmed.replace(/^\/+/, "").split(/[?#]/)[0] || "this app";
    return { href: trimmed, label, external: false };
  }
  const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let label = trimmed;
  try {
    label = new URL(href).hostname.replace(/^www\./, "");
  } catch {
    /* unparseable — show the raw text */
  }
  return { href, label, external: true };
}
