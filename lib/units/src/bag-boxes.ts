import { packNoun } from "./order-quantity";

/**
 * Issue #407: the Mozzarella Load card says "27 x 2kg bags"; the builders
 * fetch cheese by the box, so say the boxes too — "4 boxes + 3 bags".
 *
 * The box size is the ingredient's own pack weight (and its pack name), in
 * the same unit as `bagWeight`, so changing it in Ingredients changes the
 * card. Returns null — card stays as it was — when there is no pack weight,
 * when a box isn't a whole number of bags (2 or more), or when the load is
 * less than one full box.
 */
export interface BagsAsBoxes {
  boxes: number;
  looseBags: number;
  bagsPerBox: number;
  /** e.g. "4 boxes + 3 bags", "5 boxes", "1 box + 1 bag" */
  label: string;
}

export function bagsAsBoxes(
  bags: number,
  bagWeight: number,
  packWeight: number | string | null | undefined,
  unit: string,
  packName?: string | null,
): BagsAsBoxes | null {
  const pw = Number(packWeight);
  if (!Number.isFinite(bags) || bags <= 0 || !Number.isFinite(pw) || pw <= 0 || !(bagWeight > 0)) return null;
  const ratio = pw / bagWeight;
  const bagsPerBox = Math.round(ratio);
  if (bagsPerBox < 2 || Math.abs(ratio - bagsPerBox) > 1e-6) return null;
  const whole = Math.round(bags);
  const boxes = Math.floor(whole / bagsPerBox);
  if (boxes < 1) return null;
  const looseBags = whole - boxes * bagsPerBox;
  const boxPart = `${boxes} ${packNoun(unit, boxes, packName)}`;
  const label = looseBags > 0 ? `${boxPart} + ${looseBags} ${looseBags === 1 ? "bag" : "bags"}` : boxPart;
  return { boxes, looseBags, bagsPerBox, label };
}
