/** "12.3 boxes/hr · 150 packs/hr wrapped" — the small line under the room
 *  score (Graeme, 20 Nov 2026). */
export function roomSpeedsLine(r: { boxesPerHour: number | null; packsPerHour: number | null }): string {
  const parts = [
    r.boxesPerHour != null ? `${r.boxesPerHour.toFixed(1)} boxes/hr` : null,
    r.packsPerHour != null ? `${Math.round(r.packsPerHour)} packs/hr wrapped` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No packing or wrapping yet";
}
