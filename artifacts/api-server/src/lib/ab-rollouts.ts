/**
 * Shopify Rollouts → our A/B tests (Graeme, 2026-10-24: "pick up the rollout
 * test parameters so we can automatically look at that data for that
 * rollout period"). Pure mapping, tested; the fetch is in routes/ab-tests.ts.
 *
 * A Rollout's treatments each carry a split; a theme treatment's change is
 * a RolloutThemePublishChange naming the theme it publishes. The control
 * treatment has no change — it's "whatever theme is live", which our app
 * can't read (no read_themes scope), so its theme is the one the A/B
 * snippet reported most during the test that isn't a treatment theme.
 */
import type { AbVariant } from "./ab-results";

export interface RolloutNode {
  id: string;
  name: string;
  status: string;
  startedAt: string | null;
  concludedAt: string | null;
  createdAt: string;
  schedule: { activateAt: string; concludeAt: string | null } | null;
  treatments: {
    split: number;
    changes: { nodes: Array<{ __typename: string; theme?: { id: string; name: string } | null }> };
  }[];
}

export interface TestFromRollout {
  rolloutId: string;
  name: string;
  status: string;
  startedAt: string;
  endsAt: string | null;
  concludedAt: string | null;
  variants: AbVariant[];
}

export function themeNumericId(gid: string): number | null {
  const n = Number(gid.split("/").pop());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Only theme rollouts are website A/B tests; discount/catalog ones are skipped. */
export function testFromRollout(r: RolloutNode, seenThemes: { themeId: number; themeName: string | null; sessions: number }[]): TestFromRollout | null {
  const withTheme = r.treatments.map(t => {
    const change = t.changes.nodes.find(c => c.__typename === "RolloutThemePublishChange" && c.theme);
    return { split: t.split, theme: change?.theme ?? null };
  });
  if (!withTheme.some(t => t.theme)) return null;
  const treatmentIds = new Set(withTheme.map(t => (t.theme ? themeNumericId(t.theme.id) : null)).filter((x): x is number => x != null));
  const controlTheme = [...seenThemes].filter(s => !treatmentIds.has(s.themeId)).sort((a, b) => b.sessions - a.sessions)[0] ?? null;

  const variants: AbVariant[] = [];
  let n = 0;
  // Control first — the results compare everything against it.
  for (const t of [...withTheme].sort((a, b) => Number(!!a.theme) - Number(!!b.theme))) {
    if (!t.theme) {
      if (controlTheme) variants.push({ label: "Control", themeId: controlTheme.themeId, themeName: controlTheme.themeName, split: t.split });
      continue;
    }
    const id = themeNumericId(t.theme.id);
    if (id == null) continue;
    n++;
    variants.push({ label: treatmentIds.size > 1 ? `Treatment ${n}` : "Treatment", themeId: id, themeName: t.theme.name, split: t.split });
  }
  const startedAt = r.startedAt ?? r.schedule?.activateAt ?? r.createdAt;
  return {
    rolloutId: r.id, name: r.name, status: r.status, startedAt,
    endsAt: r.schedule?.concludeAt ?? null, concludedAt: r.concludedAt, variants,
  };
}

export const ROLLOUTS_QUERY = `{
  rollouts(first: 50, reverse: true) {
    nodes {
      id name status startedAt concludedAt createdAt
      schedule { activateAt concludeAt }
      treatments { split changes(first: 10) { nodes { __typename ... on RolloutThemePublishChange { theme { id name } } } } }
    }
  }
}`;
