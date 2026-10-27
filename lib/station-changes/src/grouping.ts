/**
 * Which changes show where: the morning meeting (station work only, one
 * headline per station) and each station's "What's changed?" panel.
 */
import type { ChangeArea } from "./types";

export const DEFAULT_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

interface Tagged { areas: readonly string[] }
interface Dated { createdAt: string }

/** Entries created in the last `days` days (inclusive of now), newest first.
 *  Unparseable dates are left out rather than guessed. */
export function withinDays<T extends Dated>(entries: readonly T[], now: Date, days = DEFAULT_WINDOW_DAYS): T[] {
  const cutoff = now.getTime() - days * DAY_MS;
  return entries
    .filter(e => {
      const t = Date.parse(e.createdAt);
      return Number.isFinite(t) && t >= cutoff && t <= now.getTime() + 60_000;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Areas the team sees in the morning meeting: stations and planning. */
export function isTeamArea(area: ChangeArea): boolean {
  return area.kind === "station" || area.kind === "planning";
}

export interface MeetingGroup<T> {
  area: ChangeArea;
  entries: Array<T & { alsoIn: ChangeArea[] }>;
}

/**
 * The meeting slide: station and planning changes only, each under ONE
 * headline — its first team area in display order — so nothing is read out
 * twice; `alsoIn` names the other team areas it touches. Office and
 * untagged entries are left out. Groups come in the areas' display order;
 * empty groups never appear.
 */
export function groupForMeeting<T extends Tagged>(entries: readonly T[], areas: readonly ChangeArea[]): MeetingGroup<T>[] {
  const team = [...areas].filter(isTeamArea).sort((a, b) => a.sortOrder - b.sortOrder);
  const byKey = new Map(team.map(a => [a.key, a] as const));
  const groups = new Map<string, MeetingGroup<T>>();
  for (const e of entries) {
    const mine = team.filter(a => e.areas.includes(a.key));
    if (mine.length === 0) continue;
    const [primary, ...rest] = mine;
    const g = groups.get(primary.key) ?? { area: byKey.get(primary.key)!, entries: [] };
    g.entries.push({ ...e, alsoIn: rest });
    groups.set(primary.key, g);
  }
  return team.map(a => groups.get(a.key)).filter((g): g is MeetingGroup<T> => !!g);
}

/** The area keys whose changes show on one station screen: areas listing
 *  that station, plus "every station" areas. */
export function areaKeysForStation(stationType: string, areas: readonly ChangeArea[]): Set<string> {
  return new Set(
    areas
      .filter(a => a.kind === "station" && (a.appliesToAllStations || a.stationTypes.includes(stationType)))
      .map(a => a.key),
  );
}

/** One station's changes, newest first. */
export function changesForStation<T extends Tagged & Dated>(
  entries: readonly T[],
  areas: readonly ChangeArea[],
  stationType: string,
  now: Date,
  days = DEFAULT_WINDOW_DAYS,
): T[] {
  const keys = areaKeysForStation(stationType, areas);
  if (keys.size === 0) return [];
  return withinDays(entries, now, days).filter(e => e.areas.some(k => keys.has(k)));
}
