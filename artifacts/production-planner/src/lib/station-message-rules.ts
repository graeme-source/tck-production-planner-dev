import { STATION_DEFAULT_REQUIRES_ACK } from "@workspace/messages";

/**
 * Which station messages block the screen, and in what order.
 *
 * A message sent with requiresAck locks the station behind a full-screen
 * notice until someone confirms it — shown ONE at a time, oldest first, so
 * the crew works through them in the order they were sent and none hides
 * behind another. Everything else stays a dismissable banner.
 */

export interface RoutableStationMessage {
  id: number;
  createdAt: string;
  requiresAck?: boolean;
}

export interface RoutedStationMessages<T> {
  /** The single must-acknowledge message to show now (oldest first), if any. */
  blocking: T | null;
  /** Further must-acknowledge messages queued behind it. */
  blockedQueue: T[];
  /** Ordinary messages, left in the order the server sent them. */
  banners: T[];
}

export function routeStationMessages<T extends RoutableStationMessage>(messages: T[]): RoutedStationMessages<T> {
  const banners: T[] = [];
  const mustAck: T[] = [];
  for (const m of messages) (m.requiresAck ? mustAck : banners).push(m);
  mustAck.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    blocking: mustAck[0] ?? null,
    blockedQueue: mustAck.slice(1),
    banners,
  };
}

/** "Must be confirmed" starts ticked for station messages — forgetting to
 *  tick it should never be how an urgent message fails to land (Graeme,
 *  2026-09-29). The one copy lives with the team-message rules. */
export const DEFAULT_REQUIRES_ACK = STATION_DEFAULT_REQUIRES_ACK;

/**
 * A message is shown ONLY on the screen of the station it was sent to —
 * must-confirm ones included (Graeme, 2026-09-29).
 *
 * Until then a must-confirm message also popped up on every other screen in
 * the app, and confirming it anywhere cleared it for everyone: Graeme sent
 * one to wrapping, it popped up on his own Business page, he dismissed it,
 * and wrapping never saw it. Nothing tells the app which iPad stands at which
 * station, so the station's own screen is the only place that is reliably
 * "the station".
 */
export function messageShowsOnScreen(targetStation: string, screenStation: string | null | undefined): boolean {
  return !!screenStation && targetStation === screenStation;
}
