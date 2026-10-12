/**
 * What the morning meeting covers (Objective E: one honest set of numbers).
 *
 * The meeting is the main kitchen's huddle. Fried chicken is made in a
 * separate facility by its own people, who don't attend: "We don't want to
 * show fried chicken information in any of the stations apart from fried
 * chicken … The fried chicken people don't take part in the morning meeting"
 * (Graeme, 2026-10-12). Which lines are separate comes from the shared
 * kitchen-scope rule; which rota positions belong to them comes from the
 * founder's line-positions setting — no names here. Pure.
 */
import { isMainKitchen } from "@workspace/production-schedule";

/** "Test Product Prep": tomorrow's items that aren't on the core menu and so
 *  need prep attention today — test boxes, one-off specials, R&D batches.
 *  Only the main kitchen's own lines count. Fried chicken isn't on the core
 *  menu (it's a separate range, not a calzone), so the core-menu flag alone
 *  labelled every fried chicken bag a test product (2026-10-09: four fried
 *  chicken lines on Friday's slide for Monday's plan). */
export function testProductPrepItems<T extends { isCoreMenu: boolean | null; recipeCategory: string | null }>(items: readonly T[]): T[] {
  return items.filter(it => it.isCoreMenu !== true && isMainKitchen(it.recipeCategory));
}

/** True when a rota position works for a separate facility (see
 *  separateKitchenPositions in kitchen-scope). */
export function isSeparateKitchenPosition(position: string | null | undefined, separate: ReadonlySet<string>): boolean {
  return position != null && separate.has(position.trim().toLowerCase());
}

/** Who's On Today rows: a station whose every position belongs to a separate
 *  facility is dropped (its people are dropped too, so they don't land in
 *  "Also in today" instead). A station with no positions configured stays. */
export function meetingRotaStations<S extends { positions?: readonly string[] | null }>(stations: readonly S[], separate: ReadonlySet<string>): S[] {
  return stations.filter(st => {
    const ps = st.positions ?? [];
    return ps.length === 0 || !ps.every(p => isSeparateKitchenPosition(p, separate));
  });
}
