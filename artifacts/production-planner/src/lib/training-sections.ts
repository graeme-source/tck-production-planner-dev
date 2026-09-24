/**
 * Training page — who sees what (Graeme, 2026-09-24).
 *
 * The Training section holds two kinds of matrix:
 *  - station matrices, built live from the SOPs on the front of each station.
 *    Self-service for EVERY colleague: people train themselves from them.
 *  - stored matrices (onboarding & sign-off), managed by hand. Manager-only,
 *    matching the server's requireAdminOrManager on /api/training — so a
 *    viewer's page never calls that API (it would only 403).
 * The station-training on/off switch stays admin-only, as on the server.
 */

export interface TrainingSections {
  /** Station SOP matrices — always shown. */
  stationMatrices: true;
  /** Stored onboarding/sign-off matrices + their management controls. */
  storedMatrices: boolean;
  /** The "Stations require training" enforcement switch. */
  enforceSwitch: boolean;
}

export function trainingSectionsFor(role: string | null | undefined): TrainingSections {
  const isAdmin = role === "admin";
  const isManager = isAdmin || role === "manager";
  return { stationMatrices: true, storedMatrices: isManager, enforceSwitch: isAdmin };
}

/** Where a station's matrix lives inside the Training section. No station →
 *  the Training page itself. Old /station-training links redirect here. */
export function stationTrainingPath(station?: string | null): string {
  const s = (station ?? "").trim();
  return s ? `/training/stations/${encodeURIComponent(s)}` : "/training";
}

export interface StationSummaryLike { station: string }

/** Split every known station into those with SOPs (a matrix each, in the
 *  order given) and those without (the quiet "no SOPs yet" list). Stations
 *  that only the API knows about are appended after the known ones. */
export function splitStations<T extends StationSummaryLike>(
  knownKeys: readonly string[],
  summaries: readonly T[],
): { withSops: T[]; without: string[] } {
  const byKey = new Map(summaries.map(s => [s.station, s]));
  const known = new Set(knownKeys);
  const keys = [...knownKeys, ...summaries.map(s => s.station).filter(k => !known.has(k))];
  const withSops: T[] = [];
  const without: string[] = [];
  for (const k of new Set(keys)) {
    const s = byKey.get(k);
    if (s) withSops.push(s); else without.push(k);
  }
  return { withSops, without };
}
