/**
 * Reading a kanban card's QR code, in every shape one has ever been printed.
 *
 * This matters because the cards are physical. Whatever is printed on the
 * back of a card in the dry store today cannot be changed by deploying
 * code — so the scanner has to accept the old payloads forever, and any new
 * format has to arrive alongside them rather than instead of them.
 *
 * Three shapes:
 *   {"type":"ingredient","id":12}          the JSON blob on today's cards
 *   https://…/scan?type=ingredient&id=12   the deep-link form (see /scan)
 *   12                                     a bare id on the oldest cards
 *
 * The deep-link form is the one that lets someone use their phone's own
 * camera app: a native camera turns a URL into a tappable link, but shows
 * raw JSON as unhelpful text. Printing new cards in that form is what
 * unlocks scan-with-any-phone; this parser means both kinds work in the
 * meantime, so the reprint can be gradual instead of a flag day.
 */

export interface KanbanQrTarget {
  type: string;
  id: number;
}

export function parseKanbanQr(raw: string): KanbanQrTarget | null {
  const data = raw.trim();
  if (!data) return null;

  // 1. JSON payload — what the QR generator has always produced.
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && parsed.type && parsed.id != null) {
      const id = Number(parsed.id);
      if (Number.isInteger(id) && id > 0) return { type: String(parsed.type), id };
    }
  } catch {
    // Not JSON — fall through to the URL and bare-id forms.
  }

  // 2. A URL carrying type and id — the deep-link form. Matched by pattern
  //    rather than by parsing as a URL so it works whatever the host is
  //    (live, staging, someone's laptop).
  const query = data.match(/[?&]type=([\w-]+)&id=(\d+)/);
  if (query) {
    const id = Number(query[2]);
    if (Number.isInteger(id) && id > 0) return { type: query[1]!.replace(/-/g, "_"), id };
  }

  // 3. A path-style link: /scan/ingredient/12
  const path = data.match(/\/(ingredient|recipe|sub_recipe|sub-recipe)\/(\d+)(?:[?#]|$)/);
  if (path) {
    const id = Number(path[2]);
    if (Number.isInteger(id) && id > 0) return { type: path[1]!.replace(/-/g, "_"), id };
  }

  // 4. A bare number. Only ingredients were ever printed this way, and the
  //    kanban scan endpoint only accepts ingredients, so the assumption is
  //    safe rather than a guess.
  const bare = data.match(/^(\d+)$/);
  if (bare) {
    const id = Number(bare[1]);
    if (id > 0) return { type: "ingredient", id };
  }

  return null;
}
