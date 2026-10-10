/**
 * Print lengths — millimetres, typographic points and printer dots.
 *
 * Label layout works in printer dots (a 203 dpi printer lays down 8 dots per
 * millimetre); template settings are in millimetres and type sizes in points.
 * Every conversion goes through here so the on-screen proof and the printed
 * label can never disagree about how big something is.
 *
 *   1 inch = 25.4 mm = 72 pt = dpi dots
 */

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}

export function ptToMm(pt: number): number {
  return (pt / PT_PER_INCH) * MM_PER_INCH;
}

export function mmToDots(mm: number, dpi: number): number {
  return (mm / MM_PER_INCH) * dpi;
}

export function dotsToMm(dots: number, dpi: number): number {
  return (dots / dpi) * MM_PER_INCH;
}

export function ptToDots(pt: number, dpi: number): number {
  return (pt / PT_PER_INCH) * dpi;
}

export function dotsToPt(dots: number, dpi: number): number {
  return (dots / dpi) * PT_PER_INCH;
}
