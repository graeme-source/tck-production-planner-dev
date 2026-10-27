/**
 * Reads the change areas (migration 0300) for the station-changes routes and
 * the System Updates feed. Areas are data; the rules that use them are pure,
 * in @workspace/station-changes.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { ChangeArea } from "@workspace/station-changes";

const toRows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

interface AreaRow {
  key: string;
  label: string;
  kind: ChangeArea["kind"];
  sort_order: number;
  station_types: string[] | null;
  applies_to_all_stations: boolean;
  path_hints: string[] | null;
  word_hints: string[] | null;
}

/** All areas in display order. Empty (never throws) if the table doesn't
 *  exist yet — callers then simply tag nothing. */
export async function loadChangeAreas(): Promise<ChangeArea[]> {
  try {
    const rows = toRows<AreaRow>(await db.execute(sql`
      SELECT key, label, kind, sort_order, station_types, applies_to_all_stations, path_hints, word_hints
        FROM change_areas ORDER BY sort_order, key
    `));
    return rows.map(r => ({
      key: r.key,
      label: r.label,
      kind: r.kind,
      sortOrder: Number(r.sort_order),
      stationTypes: r.station_types ?? [],
      appliesToAllStations: !!r.applies_to_all_stations,
      pathHints: r.path_hints ?? [],
      wordHints: r.word_hints ?? [],
    }));
  } catch (err) {
    console.warn("[change-areas] couldn't load areas:", err instanceof Error ? err.message : err);
    return [];
  }
}
