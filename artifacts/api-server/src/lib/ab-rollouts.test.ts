import { describe, it, expect } from "vitest";
import { testFromRollout, type RolloutNode, accessDeniedMessage } from "./ab-rollouts";

const rollout = (treatments: RolloutNode["treatments"]): RolloutNode => ({
  id: "gid://shopify/Rollout/1", name: "Main vs UPF free test", status: "ACTIVE",
  startedAt: "2026-10-24T06:30:00Z", concludedAt: null, createdAt: "2026-10-24T06:00:00Z",
  schedule: { activateAt: "2026-10-24T06:30:00Z", concludeAt: "2026-11-22T06:30:00Z" }, treatments,
});
const themeChange = (id: number, name: string) => ({ nodes: [{ __typename: "RolloutThemePublishChange", theme: { id: `gid://shopify/OnlineStoreTheme/${id}`, name } }] });

describe("Rollouts → A/B test", () => {
  it("control first (from the snippet's busiest other theme), then the treatment theme", () => {
    const t = testFromRollout(
      rollout([{ split: 50, changes: { nodes: [] } }, { split: 50, changes: themeChange(201516974454, "tck-theme/upf-free-test") }]),
      [{ themeId: 201516974454, themeName: "tck-theme/upf-free-test", sessions: 41 }, { themeId: 201620455798, themeName: "Copy of tck-theme/main", sessions: 42 }, { themeId: 5, themeName: "stray", sessions: 1 }],
    )!;
    expect(t.variants).toEqual([
      { label: "Control", themeId: 201620455798, themeName: "Copy of tck-theme/main", split: 50 },
      { label: "Treatment", themeId: 201516974454, themeName: "tck-theme/upf-free-test", split: 50 },
    ]);
    expect(t).toMatchObject({ name: "Main vs UPF free test", startedAt: "2026-10-24T06:30:00Z", endsAt: "2026-11-22T06:30:00Z" });
  });
  it("a rollout with no theme change (a discount rollout) isn't a website test", () => {
    expect(testFromRollout(rollout([{ split: 100, changes: { nodes: [{ __typename: "RolloutDiscountActivateChange" }] } }]), [])).toBeNull();
  });
  it("no snippet data yet: just the treatment until the control shows up", () => {
    const t = testFromRollout(rollout([{ split: 50, changes: { nodes: [] } }, { split: 50, changes: themeChange(2, "b") }]), [])!;
    expect(t.variants.map(v => v.label)).toEqual(["Treatment"]);
  });
});

// Regression (Graeme, 27 Oct 2026): read_rollouts was granted but the page
// still blamed it — Shopify was refusing the theme names (read_themes).
describe("accessDeniedMessage — say the permission Shopify actually wants", () => {
  it("names read_themes when that's what's missing", () => {
    const m = accessDeniedMessage("Access denied for theme field. Required access: `read_themes` access scope.");
    expect(m).toContain("read_themes");
    expect(m).not.toContain("read_rollouts");
  });
  it("names read_rollouts when that really is the missing one", () => {
    expect(accessDeniedMessage("Access denied for rollouts field. Required access: `read_rollouts` access scope.")).toContain("read_rollouts");
  });
  it("still says something useful when Shopify names nothing", () => {
    expect(accessDeniedMessage("Access denied")).toMatch(/didn't say/);
  });
});
