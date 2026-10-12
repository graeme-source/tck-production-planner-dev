/**
 * Recipe identity colours — ONE place that turns a recipe's primary colour
 * and optional secondary colour (migration 0185) into inline styles.
 * Objectives A and F: Graeme wants "red and yellow or red and orange" so each
 * recipe is easier to tell apart at a glance.
 *
 * Rule: with no secondary colour every shape returns exactly the style the
 * screens used before, so nothing changes until a second colour is picked.
 *
 * Shapes
 *   dot    small chip / dot / swatch — split diagonally, primary top-left
 *   band   vertical stripe or bar   — two stacked bands, primary on top
 *   strip  horizontal strip (card top edge) — primary left, secondary right
 *   text   recipe name in its colour — primary text, secondary underline
 *   chip   outlined pill (text + border in the colour) — secondary underline
 *          on the text, border stays primary
 *   fill   big filled header / background — primary fill, readable text
 *          worked out against the primary, and a clear secondary band along
 *          the bottom edge (never a blend)
 *
 * Pure (no React), so it is unit-tested.
 */
export type RecipeColourShape = "dot" | "band" | "strip" | "text" | "chip" | "fill";

export interface RecipeColourCss {
  [key: string]: string | number | undefined;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;

/** A usable colour string, or null for empty / missing. Anything non-empty
 *  that isn't hex is passed through untouched (CSS names, hsl(var(--x)),
 *  the ovens' rack fallbacks), so primary colours behave as they did. */
export function cleanColour(c: string | null | undefined): string | null {
  if (c == null) return null;
  const t = String(c).trim();
  return t === "" ? null : t;
}

/** Secondary colour actually worth drawing: present, and not the same as the
 *  primary (red + red would just look like a rendering glitch). */
export function effectiveSecondary(primary: string | null | undefined, secondary: string | null | undefined): string | null {
  const p = cleanColour(primary);
  const s = cleanColour(secondary);
  if (!p || !s) return null;
  if (p.toLowerCase() === s.toLowerCase()) return null;
  return s;
}

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim();
  if (HEX3.test(h)) h = "#" + h.slice(1).split("").map(ch => ch + ch).join("");
  if (!HEX6.test(h)) return null;
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance of a hex colour (0 = black, 1 = white); null if
 *  the colour isn't hex. */
export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const DARK_TEXT = "#111827";
export const LIGHT_TEXT = "#ffffff";

/** Text colour with the better WCAG contrast on the given background
 *  (always worked out against the PRIMARY colour). Non-hex → white. */
export function readableTextOn(background: string | null | undefined): string {
  const bg = cleanColour(background);
  const L = bg ? relativeLuminance(bg) : null;
  if (L == null) return LIGHT_TEXT;
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastDark = (L + 0.05) / ((relativeLuminance(DARK_TEXT) ?? 0) + 0.05);
  return contrastDark >= contrastWhite ? DARK_TEXT : LIGHT_TEXT;
}

/** Inline style for a recipe colour in the given shape. Returns {} when the
 *  recipe has no primary colour (callers keep their own fallback). */
export function recipeColourStyle(
  primary: string | null | undefined,
  secondary: string | null | undefined,
  shape: RecipeColourShape,
): RecipeColourCss {
  const p = cleanColour(primary);
  if (!p) return {};
  const s = effectiveSecondary(p, secondary);
  switch (shape) {
    case "dot":
      return s
        ? { background: `linear-gradient(135deg, ${p} 0 50%, ${s} 50% 100%)` }
        : { backgroundColor: p };
    case "band":
      return s
        ? { background: `linear-gradient(to bottom, ${p} 0 50%, ${s} 50% 100%)` }
        : { backgroundColor: p };
    case "strip":
      return s
        ? { background: `linear-gradient(to right, ${p} 0 50%, ${s} 50% 100%)` }
        : { backgroundColor: p };
    case "text":
      return s ? { color: p, ...underline(s) } : { color: p };
    case "chip":
      return s ? { color: p, borderColor: p, ...underline(s) } : { color: p, borderColor: p };
    case "fill":
      return s
        ? { backgroundColor: p, color: readableTextOn(p), boxShadow: `inset 0 -6px 0 0 ${s}` }
        : { backgroundColor: p, color: readableTextOn(p) };
  }
}

function underline(s: string): RecipeColourCss {
  return {
    textDecorationLine: "underline",
    textDecorationColor: s,
    textDecorationThickness: "3px",
    textUnderlineOffset: "4px",
    textDecorationSkipInk: "none",
  };
}
