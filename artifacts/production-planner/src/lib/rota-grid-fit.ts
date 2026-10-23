/**
 * Who's On Today — fit the team grid on one screen (Graeme, 2026-10-22:
 * "I have to scroll vertically to see the bottom of the list").
 *
 * Pure layout maths: given how many people each card holds and the space
 * left for the grid, pick the roomiest density and the fewest columns that
 * show every card without scrolling. The card heights below are upper
 * bounds for the matching CSS in components/whos-on-today-board.tsx; if a long name
 * wraps and the real grid still overflows, the slide passes `squeeze` to
 * step one option further down the list.
 */

export type RotaDensity = "roomy" | "compact" | "tight";

interface DensitySpec {
  /** Card height with one person in it (label + name + status + padding). */
  base: number;
  /** Extra height for each additional person in the same card. */
  perPerson: number;
  /** Narrowest a column may get before names become cramped. */
  minColWidth: number;
}

export const ROTA_DENSITIES: Record<RotaDensity, DensitySpec> = {
  // Measured in the browser 2026-10-22 (1180–1920 px wide, borders
  // included), rounded up a few px.
  roomy:   { base: 104, perPerson: 70, minColWidth: 260 },
  compact: { base: 88,  perPerson: 60, minColWidth: 220 },
  tight:   { base: 52,  perPerson: 32, minColWidth: 170 },
};

export const ROTA_GRID_GAP = 8;
const DENSITY_ORDER: RotaDensity[] = ["roomy", "compact", "tight"];
/** Big cards stop at 3 columns; smaller cards may use a 4th before the
 *  type shrinks again. Beyond 4 only as the "far too many people" fallback. */
const MAX_COLS: Record<RotaDensity, number> = { roomy: 3, compact: 4, tight: 4 };
const FALLBACK_MIN_COLS = 4;

export interface RotaGridInput {
  /** People per card, in display order (an empty station counts as 1 line). */
  peoplePerCard: number[];
  availableWidth: number;
  availableHeight: number;
  /** Measured-overflow correction: skip this many options that "should" fit. */
  squeeze?: number;
}

export interface RotaGridLayout {
  columns: number;
  density: RotaDensity;
  /** False only when even the last-resort layout is too tall. */
  fits: boolean;
}

function maxColsForWidth(width: number, d: RotaDensity): number {
  const w = ROTA_DENSITIES[d].minColWidth;
  return Math.max(1, Math.floor((width + ROTA_GRID_GAP) / (w + ROTA_GRID_GAP)));
}

/** Height of the grid when cards fill row by row in display order. */
export function rotaGridHeight(peoplePerCard: number[], columns: number, density: RotaDensity): number {
  if (peoplePerCard.length === 0) return 0;
  const spec = ROTA_DENSITIES[density];
  let total = 0;
  let rows = 0;
  for (let i = 0; i < peoplePerCard.length; i += columns) {
    const tallest = Math.max(1, ...peoplePerCard.slice(i, i + columns));
    total += spec.base + (tallest - 1) * spec.perPerson;
    rows++;
  }
  return total + (rows - 1) * ROTA_GRID_GAP;
}

export function chooseRotaGridLayout(input: RotaGridInput): RotaGridLayout {
  const { peoplePerCard, availableWidth, availableHeight } = input;
  const n = peoplePerCard.length;
  if (n === 0) return { columns: 1, density: "roomy", fits: true };
  let skip = Math.max(0, Math.floor(input.squeeze ?? 0));

  // One long column of wide cards wastes the screen once there are a few
  // people, so start at two columns when there's room for them.
  const minCols = n >= 5 ? 2 : 1;

  for (const d of DENSITY_ORDER) {
    const maxCols = Math.min(MAX_COLS[d], n, maxColsForWidth(availableWidth, d));
    for (let cols = Math.min(minCols, maxCols); cols <= maxCols; cols++) {
      if (rotaGridHeight(peoplePerCard, cols, d) <= availableHeight) {
        if (skip === 0) return { columns: cols, density: d, fits: true };
        skip--;
      }
    }
  }

  // Genuinely too many people (20+): tight cards, four columns or more —
  // as many as the width allows — rather than ever scrolling.
  const widest = Math.max(FALLBACK_MIN_COLS, maxColsForWidth(availableWidth, "tight"));
  for (let cols = FALLBACK_MIN_COLS + 1; cols <= Math.min(widest, n); cols++) {
    if (rotaGridHeight(peoplePerCard, cols, "tight") <= availableHeight) {
      if (skip === 0) return { columns: cols, density: "tight", fits: true };
      skip--;
    }
  }
  return { columns: Math.min(n, widest), density: "tight", fits: false };
}
