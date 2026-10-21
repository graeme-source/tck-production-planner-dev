/**
 * The premium look for a ×2 / ×3 improvement (Graeme, 2026-10-21;
 * Objectives E and H): "Make more of a deal when someone gets a ×2 or ×3 ...
 * with a premium colour, so when we're scrolling past it's really obvious
 * it's a great one or a substantial one versus a standard improvement."
 *
 *   ×1 Standard    — unchanged.
 *   ×2 Great one   — gold: gold border, a gold strip along the top, a warm
 *                    tint, and a gold "★ Great one ×2" badge.
 *   ×3 Substantial — richer gold: deeper gradient tint, a thicker strip, a
 *                    soft gold glow, and a deep-gold "♛ Substantial ×3"
 *                    badge.
 *
 * Gold, not amber-400: ideas already wear an amber-400 edge on the feed, so
 * the premium cards keep their green improvement edge and go gold all the
 * way round instead — they can never be mistaken for an idea.
 *
 * One mapping for every list that shows improvements (the feed, the
 * improvement itself, the meeting slides, My improvements). Pure, so the
 * weight → look rule is tested.
 */
import { normaliseCreditWeight, type CreditWeight } from "./improvement-score";

export type PremiumTier = "standard" | "great" | "substantial";

export interface PremiumStyle {
  tier: PremiumTier;
  weight: CreditWeight;
  /** The words on the badge; null for a standard improvement (no badge). */
  badgeText: string | null;
  /** Which icon the badge carries. */
  icon: "star" | "crown" | null;
  /** Added to the card's own classes: border, tint, glow. */
  cardClass: string;
  /** The gold strip across the top of the card; "" for none. */
  stripClass: string;
  /** The badge's colours. */
  badgeClass: string;
  /** The badge's colours as hex — the lowest-contrast stop of each
   *  gradient — so the contrast can be checked in a test. The badge is a
   *  solid fill, the same in light and dark mode. */
  badgeContrast: { fg: string; bg: string } | null;
}

const STANDARD: PremiumStyle = {
  tier: "standard",
  weight: 1,
  badgeText: null,
  icon: null,
  cardClass: "",
  stripClass: "",
  badgeClass: "",
  badgeContrast: null,
};

const GREAT: PremiumStyle = {
  tier: "great",
  weight: 2,
  badgeText: "Great one ×2",
  icon: "star",
  cardClass:
    "border-amber-400 dark:border-amber-500/80 bg-gradient-to-br from-amber-50 via-card to-card dark:from-amber-950/40 dark:via-card dark:to-card shadow-md shadow-amber-500/10",
  stripClass: "h-1.5 bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-400",
  badgeClass:
    "bg-gradient-to-r from-amber-300 to-yellow-300 text-amber-950 ring-1 ring-amber-500/70 shadow-sm",
  // amber-950 on amber-300 (the darker stop).
  badgeContrast: { fg: "#451a03", bg: "#fcd34d" },
};

const SUBSTANTIAL: PremiumStyle = {
  tier: "substantial",
  weight: 3,
  badgeText: "Substantial ×3",
  icon: "crown",
  cardClass:
    "border-amber-500 dark:border-amber-400 ring-2 ring-amber-400/50 bg-gradient-to-br from-amber-100 via-yellow-50 to-amber-50 dark:from-amber-900/50 dark:via-amber-950/50 dark:to-card shadow-lg shadow-amber-500/30",
  stripClass: "h-2.5 bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-600",
  badgeClass:
    "bg-gradient-to-r from-amber-800 via-amber-700 to-amber-800 text-amber-50 ring-2 ring-yellow-400/80 shadow-md shadow-amber-600/30",
  // amber-50 on amber-700 (the lighter stop).
  badgeContrast: { fg: "#fffbeb", bg: "#b45309" },
};

export function premiumStyle(weight: unknown): PremiumStyle {
  const w = normaliseCreditWeight(weight);
  return w === 3 ? SUBSTANTIAL : w === 2 ? GREAT : STANDARD;
}

/** WCAG contrast ratio between two "#rrggbb" colours. */
export function contrastRatio(fg: string, bg: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace("#", ""), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
