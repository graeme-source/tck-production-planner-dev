/**
 * Totalling a prep step.
 *
 * A step's total is the weight of the tub or the bottle you end up with, so
 * the lines have to be added in one unit. Grams and millilitres come down to
 * kilos; anything already in kg or litres is taken at face value, which is
 * what the paper sheet does (a litre of ketchup is a kilo of ketchup as far
 * as the fryer is concerned).
 *
 * Pure so it can be tested — the rest of the section building is database
 * walking and can't be.
 */
export interface PrepTotalLine { unit: string; qty: number }

export function sectionTotalKg(lines: PrepTotalLine[]): number {
  let total = 0;
  for (const l of lines) {
    const q = Number(l.qty) || 0;
    total += l.unit === "g" || l.unit === "ml" ? q / 1000 : q;
  }
  return Math.round(total * 1000) / 1000;
}
