/**
 * Searching QuickBooks accounts as you type (Graeme, 26 Nov 2026: "when I
 * start typing in 'entertainment'… it should be a string search that
 * automatically changes as I type"). Every word typed must appear somewhere
 * in the name, its parent or its type, in any order and any case. Best
 * matches first: the name starting with what's typed, then a word in it
 * starting with it, then anywhere. Objective I.
 */
export interface QboPickerAccount { id: string; name: string; parent: string | null; type: string }

export interface AccountChoice extends QboPickerAccount {
  /** Already a category: its id, and whether it's hidden from the dropdown. */
  category: { id: number; hidden: boolean } | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function searchQboAccounts(
  accounts: ReadonlyArray<QboPickerAccount>,
  categories: ReadonlyArray<{ id: number; name: string; hidden: boolean }>,
  query: string,
  limit = 30,
): AccountChoice[] {
  const byName = new Map(categories.map(c => [norm(c.name), c]));
  const q = norm(query);
  const terms = q.split(" ").filter(Boolean);
  const scored: Array<{ a: AccountChoice; score: number; i: number }> = [];
  accounts.forEach((acc, i) => {
    const name = norm(acc.name);
    const hay = `${name} ${norm(acc.parent ?? "")} ${norm(acc.type)}`;
    if (!terms.every(t => hay.includes(t))) return;
    const score = !q ? 3
      : name.startsWith(q) ? 0
      : name.split(/[\s\-–:&/]+/).some(w => w.startsWith(terms[0])) ? 1
      : name.includes(q) ? 2 : 3;
    const c = byName.get(name);
    scored.push({ a: { ...acc, category: c ? { id: c.id, hidden: c.hidden } : null }, score, i });
  });
  // Ones already in the list (and showing) go last — they're in the dropdown.
  const last = (a: AccountChoice) => (a.category && !a.category.hidden ? 1 : 0);
  return scored
    .sort((x, y) => last(x.a) - last(y.a) || x.score - y.score || x.i - y.i)
    .slice(0, limit)
    .map(s => s.a);
}
