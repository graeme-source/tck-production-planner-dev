/**
 * The kanban unit choices on the ingredient/supply editor (Graeme, 24 Nov
 * 2026: "Whatever the unit is, we should be able to select that from the
 * kanbans … when we've got 500 pieces left, we then order more"). The first
 * choice is always the item's OWN unit from Basics (pieces, kg, g, L…),
 * stored as "unit" and read in that unit everywhere — card, Orders page,
 * stock left (@workspace/units kanbanOrderPacks, kanban-stock-left.ts).
 *
 * The old "Weight (kg/g/L)" setting is only offered on items that still
 * have it: the Orders page reads its amounts as PACKS while the card reads
 * them as the item's unit, so new items shouldn't pick it.
 */
export type KanbanUnitValue = "unit" | "weight" | "pack" | "bottle" | "pallet";

const WORDS: Record<string, string> = { l: "litres", ml: "ml", g: "g", kg: "kg" };

/** The item's unit as it reads after a number: "pieces", "kg", "litres". */
export function unitWord(unit: string | null | undefined): string {
  const u = (unit ?? "").trim();
  if (!u) return "units";
  return WORDS[u.toLowerCase()] ?? u;
}

const cap = (s: string) => (/^(g|kg|ml)$/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1));
const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-GB") : String(Math.round(n * 1000) / 1000));

export function kanbanUnitOptions(args: {
  unit: string | null | undefined;
  packWeight: number | string | null | undefined;
  current: string | null | undefined;
}): Array<{ value: KanbanUnitValue; label: string }> {
  const word = unitWord(args.unit);
  const pw = Number(args.packWeight);
  const opts: Array<{ value: KanbanUnitValue; label: string }> = [];
  if (args.current === "weight") opts.push({ value: "weight", label: "Weight — old setting (Orders reads it as packs)" });
  opts.push({ value: "unit", label: `${cap(word)} — this item's own unit` });
  opts.push({ value: "pack", label: Number.isFinite(pw) && pw > 0 ? `Packs (${num(pw)} ${word} each)` : "Packs" });
  opts.push({ value: "bottle", label: "Bottles" });
  opts.push({ value: "pallet", label: "Pallets" });
  return opts;
}

/** The word shown beside the trigger and order boxes, so it's clear what
 *  the number counts. Null for the old "weight" setting (it's ambiguous). */
export function kanbanAmountWord(kanbanUnit: string | null | undefined, unit: string | null | undefined): string | null {
  switch (kanbanUnit) {
    case "unit": return unitWord(unit);
    case "pack": case "packs": return "packs";
    case "bottle": return "bottles";
    case "pallet": return "pallets";
    default: return null;
  }
}
