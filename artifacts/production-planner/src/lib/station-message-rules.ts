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
