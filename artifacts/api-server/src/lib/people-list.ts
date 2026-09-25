/**
 * The People list — who needs attention, and everyone's outstanding
 * return-to-work forms (Graeme, 2026-09-25 People redesign).
 *
 * Born from Graeme opening Return to Work and finding "nothing in there":
 * the page only ever listed the VIEWER's own absences, so the forms other
 * people owed were invisible to the very people meant to chase them. Here,
 * someone with People access sees everyone's; anyone else only their own.
 *
 * Pure — the route loads the rows; tests pin the rules.
 */

export interface OutstandingSpell {
  start: string;
  end: string;
  days: number;
  types: string[];
  sickness: boolean;
}

export interface OutstandingForm extends OutstandingSpell {
  userId: number;
  userName: string;
}

/**
 * Every return-to-work form a viewer should see as outstanding: all of them
 * for someone with People access, only their own otherwise. Newest absence
 * first so the freshest conversations lead.
 */
export function outstandingFormsForViewer(
  viewer: { id: number; hasPeopleAccess: boolean },
  dueByUser: ReadonlyMap<number, readonly OutstandingSpell[]>,
  names: ReadonlyMap<number, string>,
): OutstandingForm[] {
  const out: OutstandingForm[] = [];
  for (const [userId, spells] of dueByUser) {
    if (!viewer.hasPeopleAccess && userId !== viewer.id) continue;
    for (const s of spells) {
      out.push({ ...s, userId, userName: names.get(userId) ?? "Unknown" });
    }
  }
  return out.sort((a, b) => b.end.localeCompare(a.end) || a.userName.localeCompare(b.userName));
}

export interface PersonListFacts {
  id: number;
  name: string;
  isActive: boolean;
  formsNeeded: number;
  triggers: { sickness: boolean; lates: boolean };
}

/** A card that needs someone to act: a form owed or a policy trigger hit. */
export function personNeedsAction(p: PersonListFacts): boolean {
  return p.formsNeeded > 0 || p.triggers.sickness || p.triggers.lates;
}

/** Current staff before leavers; within each, people needing action first,
 *  most forms owed first, then by name. */
export function sortPeopleForList<P extends PersonListFacts>(people: readonly P[]): P[] {
  return [...people].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const na = personNeedsAction(a), nb = personNeedsAction(b);
    if (na !== nb) return na ? -1 : 1;
    if (a.formsNeeded !== b.formsNeeded) return b.formsNeeded - a.formsNeeded;
    return a.name.localeCompare(b.name);
  });
}
