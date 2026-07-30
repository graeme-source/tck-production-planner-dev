import { createDAVClient, type DAVCalendar } from "tsdav";
import ical, { type VEvent } from "node-ical";

// Minimal iCloud CalDAV reader for Founder Focus. Read-only by design: we
// list calendars and pull one day's events (meetings, kids' stuff from the
// shared family calendar) so the Today view can plan blocks around them.
// Auth is the founder's Apple ID + an app-specific password — never the real
// Apple ID password. Nothing is ever written back to the calendar here.

const ICLOUD_SERVER = "https://caldav.icloud.com";

export interface CalendarEvent {
  title: string;
  calendar: string;
  // Minutes from midnight, Europe/London, clamped to the requested day —
  // same convention as founder_blocks so the frontend merges them directly.
  startMin: number;
  endMin: number;
  allDay: boolean;
}

type Client = Awaited<ReturnType<typeof createDAVClient>>;

interface CachedAccount {
  client: Client;
  calendars: DAVCalendar[];
  expiry: number;
}

// Discovery (principal → home set → calendar list) costs several round
// trips, so keep the client for a while. Keyed by appleId|password so a
// credential change naturally misses the cache.
const accountCache = new Map<string, CachedAccount>();
const ACCOUNT_TTL_MS = 15 * 60 * 1000;

const eventsCache = new Map<string, { events: CalendarEvent[]; expiry: number }>();
const EVENTS_TTL_MS = 3 * 60 * 1000;

function calendarName(c: DAVCalendar): string {
  const dn = c.displayName;
  if (typeof dn === "string" && dn.trim()) return dn.trim();
  return "Calendar";
}

function supportsEvents(c: DAVCalendar): boolean {
  // iCloud exposes reminder lists (VTODO) and inbox-style collections too;
  // only VEVENT calendars belong in the day view.
  const comps = c.components;
  if (!Array.isArray(comps)) return true;
  return comps.includes("VEVENT");
}

async function getAccount(appleId: string, password: string): Promise<CachedAccount> {
  const key = `${appleId}|${password}`;
  const cached = accountCache.get(key);
  if (cached && Date.now() < cached.expiry) return cached;

  const client = await createDAVClient({
    serverUrl: ICLOUD_SERVER,
    credentials: { username: appleId, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
  const calendars = (await client.fetchCalendars()).filter(supportsEvents);
  const account: CachedAccount = { client, calendars, expiry: Date.now() + ACCOUNT_TTL_MS };
  accountCache.set(key, account);
  return account;
}

export interface CalendarInfo {
  /** Stable CalDAV collection URL — survives display-name changes, so
   *  the on/off preference is keyed on it. */
  url: string;
  name: string;
}

/** Connection test: authenticates and lists event calendars. Throws with a
 *  readable message on bad credentials or network trouble. */
export async function verifyCaldav(appleId: string, password: string): Promise<CalendarInfo[]> {
  try {
    const account = await getAccount(appleId, password);
    return account.calendars.map(c => ({ url: c.url, name: calendarName(c) }));
  } catch (err) {
    accountCache.delete(`${appleId}|${password}`);
    const msg = err instanceof Error ? err.message : String(err);
    // tsdav surfaces a failed iCloud sign-in as a missing principalUrl
    // rather than a 401, so treat that as bad credentials too.
    if (/401|unauthorized|credentials|principalUrl/i.test(msg)) {
      throw new Error("iCloud rejected the sign-in — check the Apple ID and app-specific password (generate one at account.apple.com → Sign-In & Security).");
    }
    throw new Error(`Could not reach iCloud CalDAV: ${msg}`);
  }
}

/** Europe/London UTC offset (minutes) at a given instant. */
function londonOffsetMin(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "longOffset",
  });
  const part = dtf.formatToParts(at).find(p => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Midnight in London on dateStr, as a real Date. */
function londonMidnight(dateStr: string): Date {
  const utcGuess = new Date(`${dateStr}T00:00:00Z`);
  return new Date(utcGuess.getTime() - londonOffsetMin(utcGuess) * 60_000);
}

export async function getDayEvents(
  appleId: string,
  password: string,
  dateStr: string,
  // Calendars the founder switched ON, keyed by collection URL. An
  // inclusion list by request (2026-07-30): calendars newly created in
  // Apple stay HIDDEN until explicitly enabled. `null` (no saved choice
  // yet) shows everything so a fresh connection isn't an empty day view.
  enabledUrls: ReadonlySet<string> | null = null,
): Promise<CalendarEvent[]> {
  const cacheKey = `${appleId}|${dateStr}|${enabledUrls ? [...enabledUrls].sort().join(",") : "*"}`;
  const cached = eventsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.events;

  const account = await getAccount(appleId, password);
  const dayStart = londonMidnight(dateStr);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const events: CalendarEvent[] = [];
  const activeCalendars = enabledUrls
    ? account.calendars.filter(c => enabledUrls.has(c.url))
    : account.calendars;

  await Promise.all(activeCalendars.map(async calendar => {
    const objects = await account.client.fetchCalendarObjects({
      calendar,
      timeRange: { start: dayStart.toISOString(), end: dayEnd.toISOString() },
    });
    for (const obj of objects) {
      if (!obj.data) continue;
      let parsed: ReturnType<typeof ical.parseICS>;
      try {
        parsed = ical.parseICS(obj.data);
      } catch {
        continue; // one malformed object must not sink the day view
      }
      for (const item of Object.values(parsed)) {
        if (!item || item.type !== "VEVENT") continue;
        const vevent = item as VEvent;
        // Expands RRULE/EXDATE/overrides into concrete instances inside the
        // window; non-recurring events pass through when they intersect it.
        let instances: Array<{ start: Date; end: Date }>;
        try {
          instances = ical.expandRecurringEvent(vevent, {
            from: dayStart,
            to: dayEnd,
            expandOngoing: true,
          }).map(i => ({ start: i.start as Date, end: i.end as Date }));
        } catch {
          continue;
        }
        const allDay = vevent.datetype === "date";
        for (const inst of instances) {
          const startMin = Math.max(0, Math.round((inst.start.getTime() - dayStart.getTime()) / 60_000));
          const endMin = Math.min(1440, Math.round((inst.end.getTime() - dayStart.getTime()) / 60_000));
          if (endMin <= 0 || startMin >= 1440) continue;
          events.push({
            title: (vevent.summary ?? "Busy").toString(),
            calendar: calendarName(calendar),
            startMin: allDay ? 0 : startMin,
            endMin: allDay ? 1440 : endMin,
            allDay,
          });
        }
      }
    }
  }));

  events.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  eventsCache.set(cacheKey, { events, expiry: Date.now() + EVENTS_TTL_MS });
  return events;
}

/** Drop cached clients/events, e.g. after credentials change. */
export function resetCaldavCache(): void {
  accountCache.clear();
  eventsCache.clear();
}
