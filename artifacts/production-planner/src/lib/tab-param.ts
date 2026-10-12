/**
 * A page's tab kept in the address as ?tab=… so links can land on a tab and
 * reloads keep it. The first allowed tab is the default and leaves no ?tab.
 */

/** Which tab a ?query asks for, falling back to the first allowed one. */
export function tabFromSearch<K extends string>(search: string, allowed: readonly K[]): K {
  const asked = new URLSearchParams(search).get("tab");
  return (allowed as readonly string[]).includes(asked ?? "") ? (asked as K) : allowed[0];
}

/** The ?query for a tab, keeping any other parameters ("" when none). */
export function searchForTab<K extends string>(search: string, tab: K, allowed: readonly K[]): string {
  const params = new URLSearchParams(search);
  if (tab === allowed[0]) params.delete("tab");
  else params.set("tab", tab);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
