/**
 * What an APC label loses when an address line is too long — said plainly
 * (Graeme, 2026-10-26): "I shouldn't have to read a whole paragraph ... to
 * see what's been lost ... put the Birmingham bit that's been lost in big red
 * writing, and also what has been truncated to ... is it possible to suggest
 * an edit ... to make sure we don't lose anything fundamental to the
 * delivery?"
 *
 * Given the line before and after shortening, this works out:
 *   lost        the words that won't be on the label
 *   safe        true when every lost part is already carried by something
 *               else (the town line, line 1, or it's just the wider area the
 *               postcode covers); false when a lost part could be what gets
 *               the box to the door; never guessed beyond that
 *   suggestion  a line that fits and keeps everything that matters, by
 *               dropping only the parts that repeat the town or name the
 *               wider area — null when no such line fits
 *
 * Pure. services/apc.ts normaliseAddress attaches it to its review flag.
 */

export const LABEL_LINE_MAX = 35;

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const parts = (line: string) => line.split(",").map(p => p.trim()).filter(Boolean);

/**
 * Wider areas a delivery never needs on the label once the post town and
 * postcode are there: counties (old and new), metropolitan areas, and the
 * big cities people add after their own town ("Sutton Coldfield,
 * Birmingham"). Only counted as safe when it ISN'T the town on the label.
 */
const WIDER_AREAS = new Set([
  // Cities people tack on after a suburb or nearby town.
  "birmingham", "manchester", "london", "liverpool", "leeds", "sheffield", "bristol", "newcastle", "newcastleupontyne",
  "nottingham", "leicester", "coventry", "bradford", "glasgow", "edinburgh", "cardiff", "belfast", "wolverhampton",
  // Metropolitan / ceremonial areas.
  "westmidlands", "greatermanchester", "greaterlondon", "merseyside", "southyorkshire", "westyorkshire", "northyorkshire",
  "eastyorkshire", "eastridingofyorkshire", "tyneandwear", "eastmidlands", "northwest", "northeast", "southwest", "southeast",
  // Counties.
  "bedfordshire", "berkshire", "buckinghamshire", "cambridgeshire", "cheshire", "cornwall", "cumbria", "derbyshire", "devon",
  "dorset", "durham", "countydurham", "essex", "gloucestershire", "hampshire", "herefordshire", "hertfordshire", "kent",
  "lancashire", "leicestershire", "lincolnshire", "norfolk", "northamptonshire", "northumberland", "nottinghamshire",
  "oxfordshire", "rutland", "shropshire", "somerset", "staffordshire", "suffolk", "surrey", "sussex", "eastsussex",
  "westsussex", "warwickshire", "wiltshire", "worcestershire", "isleofwight", "middlesex",
  "anglesey", "gwynedd", "conwy", "denbighshire", "flintshire", "wrexham", "powys", "ceredigion", "pembrokeshire",
  "carmarthenshire", "swansea", "glamorgan", "valeofglamorgan", "monmouthshire", "fife", "lothian", "midlothian",
  "eastlothian", "westlothian", "lanarkshire", "ayrshire", "renfrewshire", "aberdeenshire", "highland", "highlands",
  "perthshire", "angus", "argyll", "argyllandbute", "dumfriesandgalloway", "scottishborders", "borders", "stirlingshire",
]);

export interface AddressLossPart {
  text: string;
  /** Why it doesn't matter, or null when it might. */
  safeBecause: string | null;
}

export interface AddressLoss {
  field: "Address line 2" | "Town";
  /** The line as the customer typed it (after tidying). */
  original: string;
  /** What the label will say instead. */
  kept: string;
  /** What won't be on the label, in plain words ("Birmingham"). */
  lost: string;
  lostParts: AddressLossPart[];
  /** Every lost part is carried elsewhere — fine to book as it is. */
  safe: boolean;
  /** A line that fits and keeps everything that matters; null if none does.
   *  "" means "leave the line empty". */
  suggestion: { line: string; dropped: AddressLossPart[] } | null;
  /** The label as it will print. */
  label: { address1: string; address2: string | null; city: string; postcode: string | null };
}

function whySafe(part: string, ctx: { address1: string; city: string }): string | null {
  const k = key(part);
  if (!k) return "empty";
  const town = key(ctx.city);
  if (town && k.includes(town)) return `the town (${ctx.city}) is already on the label`;
  if (town && k !== town && WIDER_AREAS.has(k)) return `${part} is the wider area — the town and postcode cover it`;
  if (parts(ctx.address1).some(p => key(p) === k)) return "it's already in address line 1";
  return null;
}

/**
 * The words lost when `original` was cut to `kept`. Whole comma parts when
 * the cut fell on a comma; otherwise the cut-off tail of a part (shown as
 * the full part it came from, since half a word means nothing).
 */
function lostPartsOf(original: string, kept: string): string[] {
  const keptKeys = new Set(parts(kept).map(key));
  const keptKey = key(kept);
  return parts(original).filter(p => !keptKeys.has(key(p)) && !(keptKey.includes(key(p)) && key(p).length > 0));
}

export function explainAddressLoss(input: {
  field: AddressLoss["field"];
  original: string;
  kept: string;
  address1: string;
  address2: string | null;
  city: string;
  postcode?: string | null;
}): AddressLoss {
  const { field, original, kept, address1, city } = input;
  const ctx = { address1, city };
  const lostTexts = lostPartsOf(original, kept);
  const tail = original.slice(kept.length).replace(/^[\s,]+/, "").trim();
  const lostParts: AddressLossPart[] = (lostTexts.length ? lostTexts : tail ? [tail] : [])
    .map(text => ({ text, safeBecause: whySafe(text, ctx) }));

  // Suggest: keep every part that matters, drop the ones that don't, and
  // see if that fits.
  let suggestion: AddressLoss["suggestion"] = null;
  if (field === "Address line 2") {
    const all = parts(original).map(text => ({ text, safeBecause: whySafe(text, ctx) }));
    const keep = all.filter(p => p.safeBecause == null).map(p => p.text);
    const line = keep.join(", ");
    const dropped = all.filter(p => p.safeBecause != null);
    if (line.length <= LABEL_LINE_MAX && dropped.length > 0 && line !== kept) suggestion = { line, dropped };
  }

  return {
    field,
    original,
    kept,
    lost: lostParts.map(p => p.text).join(", "),
    lostParts,
    safe: lostParts.length > 0 && lostParts.every(p => p.safeBecause != null),
    suggestion,
    label: { address1, address2: input.address2, city, postcode: input.postcode ?? null },
  };
}
