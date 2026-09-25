/**
 * How Settings → Team & Access names each person's People access (Graeme,
 * 2026-09-25). The state itself is decided on the server
 * (api-server lib/people-access-rules.ts, peopleAccessState).
 */
export type PeopleAccessState = "none" | "pin_needed" | "ready";

export function peopleAccessLabel(state: PeopleAccessState): { label: string; tone: "muted" | "warn" | "good" } {
  switch (state) {
    case "ready": return { label: "Access — private PIN set", tone: "good" };
    case "pin_needed": return { label: "Access — private PIN not set yet", tone: "warn" };
    default: return { label: "No access", tone: "muted" };
  }
}

/** Why this person's switch can't be flipped by the viewer, or null if it can. */
export function peopleAccessToggleBlocked(input: {
  viewerCanGrant: boolean;
  rowIsFounder: boolean;
  rowHasAccess: boolean;
}): string | null {
  if (!input.viewerCanGrant) return "Only Graeme can change this.";
  if (input.rowIsFounder && input.rowHasAccess) return "Your own access can't be removed — you're the one who grants it.";
  return null;
}
