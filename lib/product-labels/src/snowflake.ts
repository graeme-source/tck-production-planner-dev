/**
 * A snowflake drawn as plain shapes, for the "KEEP FROZEN" band. Barlow has
 * no snowflake glyph and the label printer is direct thermal (black only),
 * so it is six arms, each with two pairs of side branches, built as thin
 * rectangles (polygons) the rasteriser fills. All rectangles wind the same
 * way, so overlaps fill solid under the non-zero rule. Pure and tested.
 */
export type Point = [number, number];

/** A bar from a to b, `width` thick, as a 4-point polygon. */
function bar(a: Point, b: Point, width: number): Point[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2), ny = (dx / len) * (width / 2);
  return [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]];
}

/** Polygons for a snowflake of radius r centred on (cx, cy). */
export function snowflakeContours(cx: number, cy: number, r: number): Point[][] {
  const w = Math.max(2, r * 0.17);
  const out: Point[][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const at = (d: number): Point => [cx + Math.cos(a) * d, cy + Math.sin(a) * d];
    out.push(bar([cx, cy], at(r - w / 2), w));
    // Two pairs of side branches, angled out at 45°.
    for (const [base, len] of [[0.45, 0.32], [0.72, 0.24]] as const) {
      const p = at(r * base);
      for (const side of [-1, 1]) {
        const b = a + (side * Math.PI) / 4;
        out.push(bar(p, [p[0] + Math.cos(b) * r * len, p[1] + Math.sin(b) * r * len], w * 0.9));
      }
    }
  }
  return out;
}
