/**
 * Settings → Team & Access: the decisions behind the one-list redesign
 * (Graeme, 2026-09-30). Pure, no I/O — the screen (components/team-access/)
 * renders what these say.
 *
 * The tab used to show every name twice: once in the users table and again
 * in the Feature grants cards. Now there is one card per person, and one
 * Access modal that answers "what can this person open, and why?". The
 * access rule itself is NOT decided here — decideAccess in
 * @workspace/feature-registry is the rule, and the server's /api/features
 * already reports each feature's baseline role (a page's comes from Page
 * Access). This file only turns those facts into what each switch shows.
 */
import { roleMeets, type Role } from "@workspace/feature-registry";

export const ROLE_LABEL: Record<Role, string> = { viewer: "Viewer", manager: "Manager", admin: "Admin" };

export function roleLabel(role: string): string {
  return ROLE_LABEL[role as Role] ?? role;
}

// ── One feature switch ─────────────────────────────────────────────────

export type FeatureFacts = {
  /** The role that gets it with no grant (null = none — founder-only or retired). */
  baselineRole: Role | null;
  founderOnly?: boolean;
  /** In the database but no longer in the registry: nothing checks it. */
  retired?: boolean;
};

export type SwitchState = {
  /** Can they use it (from any source)? */
  on: boolean;
  /** May the viewer move this switch? */
  editable: boolean;
  /** Where the access comes from. */
  source: "founder" | "role" | "grant" | "none";
  /** Plain-English reason shown under the switch, if any. */
  note: string | null;
};

export function featureSwitchState(input: {
  feature: FeatureFacts;
  targetRole: string;
  targetIsFounder: boolean;
  /** Does this person hold a feature_grants row for it? */
  granted: boolean;
  viewerIsFounder: boolean;
}): SwitchState {
  const { feature, targetRole, targetIsFounder, granted, viewerIsFounder } = input;
  // Graeme's own account opens everything, founder-only features included.
  if (targetIsFounder) {
    return { on: true, editable: false, source: "founder", note: "Graeme's account — has everything" };
  }
  // The Business: no role opens it, not even admin, and only Graeme hands it out.
  if (feature.founderOnly) {
    return {
      on: granted,
      editable: viewerIsFounder,
      source: granted ? "grant" : "none",
      note: viewerIsFounder ? null : "Only Graeme can change this",
    };
  }
  // A leftover grant for something the app no longer checks: it can only be tidied away.
  if (feature.retired) {
    return {
      on: granted,
      editable: granted,
      source: granted ? "grant" : "none",
      note: "Nothing in the app checks this any more — switch it off to tidy it away",
    };
  }
  if (feature.baselineRole && roleMeets(targetRole, feature.baselineRole)) {
    // Grants only ever add, so role-given access can't be switched off here —
    // the lever for that is their role or the page's level on the board.
    return { on: true, editable: false, source: "role", note: `Included with ${roleLabel(targetRole)}` };
  }
  return { on: granted, editable: true, source: granted ? "grant" : "none", note: null };
}

/** The SOP-training state of a grant, as the grants screen has always shown it. */
export function trainingBadge(input: {
  granted: boolean;
  requiredSopId: number | null;
  trained: boolean | undefined;
  gateEnforced: boolean;
}): null | { label: string; tone: "good" | "warn" } {
  if (!input.granted || input.requiredSopId == null) return null;
  if (input.trained) return { label: "Trained", tone: "good" };
  return { label: input.gateEnforced ? "Locked — awaiting SOP training" : "Not yet trained on the SOP", tone: "warn" };
}

// ── The person card ────────────────────────────────────────────────────

/** How many things this person has been handed on top of their role. */
export function extrasCount(input: {
  features: Array<FeatureFacts & { key: string }>;
  grantedKeys: ReadonlySet<string>;
  targetRole: string;
  targetIsFounder: boolean;
}): number {
  if (input.targetIsFounder) return 0;
  let n = 0;
  for (const f of input.features) {
    if (!input.grantedKeys.has(f.key) || f.retired) continue;
    const s = featureSwitchState({
      feature: f, targetRole: input.targetRole, targetIsFounder: false, granted: true, viewerIsFounder: true,
    });
    if (s.source === "grant") n++;
  }
  return n;
}

/** "Viewer + 3 extras", "Manager · People access", "Founder". */
export function accessSummary(input: {
  role: string;
  isFounder: boolean;
  extras: number;
  peopleAccess: boolean;
}): string {
  if (input.isFounder) return "Founder";
  let s = roleLabel(input.role);
  if (input.extras > 0) s += ` + ${input.extras} extra${input.extras === 1 ? "" : "s"}`;
  if (input.peopleAccess) s += " · People access";
  return s;
}

// ── Who may change this account ────────────────────────────────────────

/**
 * Mirrors the server's rule 3 (api-server lib/user-admin-rules.ts,
 * checkUserWrite) so the modal can say up front why an account is locked
 * rather than letting someone type and then fail. The server still decides;
 * its refusal is shown as-is if this ever disagrees.
 */
export function accountLockedReason(input: {
  viewerIsFounder: boolean;
  viewerId: number;
  target: { id: number; isFounder: boolean; hasPeopleAccess: boolean };
}): string | null {
  const { viewerIsFounder, viewerId, target } = input;
  if (viewerIsFounder || viewerId === target.id) return null;
  if (target.isFounder) return "This is Graeme's account — only Graeme can change it.";
  if (target.hasPeopleAccess) return "This account has People access — only Graeme or its owner can change it.";
  return null;
}

// ── The list ───────────────────────────────────────────────────────────

/** Search by name or email (every word must match), then split active from inactive. */
export function filterTeam<T extends { name: string; email?: string | null; isActive: boolean }>(
  people: readonly T[],
  search: string,
): { active: T[]; inactive: T[] } {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (p: T) => {
    if (terms.length === 0) return true;
    const hay = `${p.name} ${p.email ?? ""}`.toLowerCase();
    return terms.every(t => hay.includes(t));
  };
  const sorted = people.filter(matches).slice().sort((a, b) => a.name.localeCompare(b.name));
  return { active: sorted.filter(p => p.isActive), inactive: sorted.filter(p => !p.isActive) };
}

// ── Page access board ──────────────────────────────────────────────────

export const PAGE_LEVELS: Array<{ level: Role; title: string; short: string }> = [
  { level: "viewer", title: "Everyone (Viewer)", short: "everyone" },
  { level: "manager", title: "Managers and above", short: "managers+" },
  { level: "admin", title: "Admins only", short: "admins only" },
];

export function groupPagesByLevel<T extends { minRole: Role }>(pages: readonly T[]): Record<Role, T[]> {
  const out: Record<Role, T[]> = { viewer: [], manager: [], admin: [] };
  for (const p of pages) (out[p.minRole] ?? out.viewer).push(p);
  return out;
}

/** "24 pages: 17 everyone, 5 managers+, 2 admins only". */
export function pageBoardSummary(pages: ReadonlyArray<{ minRole: Role }>): string {
  const g = groupPagesByLevel(pages);
  const parts = PAGE_LEVELS.map(l => `${g[l.level].length} ${l.short}`);
  return `${pages.length} page${pages.length === 1 ? "" : "s"}: ${parts.join(", ")}`;
}
