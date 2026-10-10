/**
 * A 1-bit bitmap and a scanline filler (pure, tested) — the label is drawn
 * at printer resolution, one pixel per printer dot, black or white, exactly
 * as a thermal head prints it. No anti-aliasing: a grey pixel doesn't exist
 * on the printer, so it mustn't exist on the proof either.
 *
 * Shapes are filled by sampling each pixel's centre with the non-zero
 * winding rule (how font outlines are defined).
 */

export class Bitmap {
  readonly data: Uint8Array;
  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8Array(width * height);
  }
  get(x: number, y: number): number {
    return this.data[y * this.width + x];
  }
  /** Rows packed 8 pixels per byte, most significant bit first, 1 = black —
   *  the layout PNG, TSPL BITMAP and ZPL ^GF all use (TSPL inverts). */
  packedRows(): { bytesPerRow: number; bytes: Uint8Array } {
    const bytesPerRow = Math.ceil(this.width / 8);
    const bytes = new Uint8Array(bytesPerRow * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.data[y * this.width + x]) bytes[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return { bytesPerRow, bytes };
  }
  blackCount(): number {
    let n = 0;
    for (const v of this.data) n += v;
    return n;
  }
}

export type Point = [number, number];

/** Fill an axis-aligned rectangle (dot coordinates, pixel-centre rule). */
export function fillRect(bm: Bitmap, x: number, y: number, w: number, h: number, value = 1): void {
  const x0 = Math.max(0, Math.ceil(x - 0.5));
  const x1 = Math.min(bm.width, Math.ceil(x + w - 0.5));
  const y0 = Math.max(0, Math.ceil(y - 0.5));
  const y1 = Math.min(bm.height, Math.ceil(y + h - 0.5));
  for (let py = y0; py < y1; py++) bm.data.fill(value, py * bm.width + x0, py * bm.width + x1);
}

export function fillCircle(bm: Bitmap, cx: number, cy: number, r: number, value = 1): void {
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(bm.height - 1, Math.ceil(cy + r));
  for (let py = y0; py <= y1; py++) {
    const dy = py + 0.5 - cy;
    if (Math.abs(dy) > r) continue;
    const half = Math.sqrt(r * r - dy * dy);
    const x0 = Math.max(0, Math.ceil(cx - half - 0.5));
    const x1 = Math.min(bm.width, Math.ceil(cx + half - 0.5));
    if (x1 > x0) bm.data.fill(value, py * bm.width + x0, py * bm.width + x1);
  }
}

/** Path commands as opentype.js produces them (y grows downwards). */
export type PathCmd =
  | { type: "M" | "L"; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Z" };

/** Curves → straight segments, fine enough that the error is well under
 *  a dot. Returns closed contours. */
export function flattenPath(cmds: PathCmd[]): Point[][] {
  const contours: Point[][] = [];
  let cur: Point[] = [];
  let px = 0;
  let py = 0;
  const steps = (len: number) => Math.max(2, Math.min(64, Math.ceil(len / 1.5)));
  for (const c of cmds) {
    if (c.type === "M") {
      if (cur.length > 1) contours.push(cur);
      cur = [[c.x, c.y]];
      px = c.x; py = c.y;
    } else if (c.type === "L") {
      cur.push([c.x, c.y]);
      px = c.x; py = c.y;
    } else if (c.type === "Q") {
      const n = steps(Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x - c.x1, c.y - c.y1));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push([u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y]);
      }
      px = c.x; py = c.y;
    } else if (c.type === "C") {
      const n = steps(Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push([
          u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        ]);
      }
      px = c.x; py = c.y;
    } else if (c.type === "Z") {
      if (cur.length > 1) contours.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) contours.push(cur);
  return contours;
}

/** Fill closed contours with the non-zero winding rule, sampling pixel centres. */
export function fillContours(bm: Bitmap, contours: Point[][], value = 1): void {
  type Edge = { x0: number; y0: number; x1: number; y1: number; dir: number };
  const edges: Edge[] = [];
  let minY = Infinity, maxY = -Infinity;
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const [ax, ay] = c[i];
      const [bx, by] = c[(i + 1) % c.length];
      if (ay === by) continue;
      edges.push(ay < by ? { x0: ax, y0: ay, x1: bx, y1: by, dir: 1 } : { x0: bx, y0: by, x1: ax, y1: ay, dir: -1 });
      minY = Math.min(minY, ay, by);
      maxY = Math.max(maxY, ay, by);
    }
  }
  if (!edges.length) return;
  const rowStart = Math.max(0, Math.floor(minY));
  const rowEnd = Math.min(bm.height - 1, Math.ceil(maxY));
  const xs: Array<{ x: number; dir: number }> = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    const sy = row + 0.5;
    xs.length = 0;
    for (const e of edges) {
      if (sy < e.y0 || sy >= e.y1) continue;
      xs.push({ x: e.x0 + ((sy - e.y0) * (e.x1 - e.x0)) / (e.y1 - e.y0), dir: e.dir });
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      winding += xs[i].dir;
      if (winding === 0) continue;
      const x0 = Math.max(0, Math.ceil(xs[i].x - 0.5));
      const x1 = Math.min(bm.width, Math.ceil(xs[i + 1].x - 0.5));
      if (x1 > x0) bm.data.fill(value, row * bm.width + x0, row * bm.width + x1);
    }
  }
}
