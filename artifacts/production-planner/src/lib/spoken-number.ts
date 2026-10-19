/**
 * A dictated amount → a number (Graeme, 19 Oct 2026: "always have a dictate
 * button on station text/number entry"). Objective F.
 *
 * Speech recognition hands back whatever it heard: usually digits ("550",
 * "12.4 kg", "1,200 grams") but sometimes words ("five hundred and fifty",
 * "twelve point four", "two and a half"). This turns either into a number,
 * ignoring unit words and fillers ("about 12 kilos"). Anything it can't
 * read with confidence is null — the box is then left alone, never filled
 * with a guess.
 */

const ONES: Record<string, number> = {
  zero: 0, nought: 0, oh: 0, nil: 0, none: 0, nothing: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const FRACTIONS: Record<string, number> = { half: 0.5, halves: 0.5, quarter: 0.25, quarters: 0.25 };

/** Words that carry no number: units, fillers. */
const IGNORED = new Set([
  "g", "gs", "gram", "grams", "gramme", "grammes",
  "kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramme", "kilogrammes",
  "l", "litre", "litres", "liter", "liters", "ml",
  "pack", "packs", "bottle", "bottles", "each", "piece", "pieces", "box", "boxes",
  "about", "around", "roughly", "approximately", "approx", "maybe", "exactly", "just", "of", "it's", "its", "is",
  "there", "there's", "we", "have", "got", "left", "um", "erm", "uh", "er",
]);

/** "1,200" → "1200" but "12,4" (a misheard decimal) → "12.4". */
function normaliseDigits(text: string): string {
  return text
    .replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
    .replace(/(\d),(\d)/g, "$1.$2");
}

export function parseSpokenNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let text = normaliseDigits(String(raw).toLowerCase().trim());
  if (text === "") return null;
  // "550g" → "550 g"; hyphens and stray punctuation → spaces.
  text = text.replace(/(\d)([a-z])/g, "$1 $2").replace(/[-–—]/g, " ").replace(/[^a-z0-9.'\s]/g, " ");
  // A trailing full stop the recogniser adds ("550.") isn't a decimal.
  text = text.replace(/(\d)\.(?!\d)/g, "$1");
  const tokens = text.split(/\s+/).filter(Boolean);

  let total = 0;        // completed thousands
  let current = 0;      // the part under a thousand being built
  let sawNumber = false;
  let decimals: string | null = null; // digits after "point"
  let fraction = 0;
  let pendingA = false; // "a" before hundred/thousand/half/quarter
  let lastWasDigits = false; // two digit strings in a row ("5 500") are ambiguous

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (IGNORED.has(t)) continue;
    if (t === "and" || t === "&") continue;
    if (t === "a" || t === "an") { pendingA = true; continue; }

    if (decimals != null) {
      // After "point": each spoken digit (or a digit string) is decimals.
      if (/^\d+$/.test(t)) { decimals += t; continue; }
      if (t in ONES && ONES[t]! < 10) { decimals += String(ONES[t]); continue; }
      return null;
    }
    if (t === "point" || t === "dot" || t === "decimal") {
      if (!sawNumber) { sawNumber = true; } // "point five" = 0.5
      decimals = "";
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(t)) {
      if (lastWasDigits) return null;
      // "12 hundred" etc. are handled by the multiplier words below.
      current += Number(t);
      sawNumber = true;
      lastWasDigits = true;
      continue;
    }
    lastWasDigits = false;
    if (t in ONES) { current += ONES[t]!; sawNumber = true; pendingA = false; continue; }
    if (t in TENS) { current += TENS[t]!; sawNumber = true; continue; }
    if (t === "hundred") {
      current = (current === 0 && (pendingA || !sawNumber) ? 1 : current) * 100;
      sawNumber = true; pendingA = false;
      continue;
    }
    if (t === "thousand") {
      total += (current === 0 && (pendingA || !sawNumber) ? 1 : current) * 1000;
      current = 0; sawNumber = true; pendingA = false;
      continue;
    }
    if (t in FRACTIONS) {
      // "a half" / "two and a half" / "three quarters".
      const prev = tokens[i - 1];
      const count = prev === "three" && t.startsWith("quarter") ? 3 : 1;
      if (count === 3) current -= 3; // "three" was read as a whole number
      fraction += FRACTIONS[t]! * count;
      sawNumber = true; pendingA = false;
      continue;
    }
    // A word we don't understand: don't guess.
    return null;
  }

  if (!sawNumber) return null;
  let value = total + current + fraction;
  if (decimals != null) {
    if (decimals === "") return null;
    value += Number(`0.${decimals}`);
  }
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
}
