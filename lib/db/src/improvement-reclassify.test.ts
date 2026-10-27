import { describe, expect, it } from "vitest";
import { currentRole, planReclassify, reclassifyTimelineNote } from "./improvement-reclassify";

// Graeme's case (27 Oct 2026): an idea logged with two "before" photos that
// were really a before and an after.
const twoBefores = [{ id: 11, phase: "before" }, { id: 12, phase: "before" }];

describe("planReclassify — idea to improvement", () => {
  it("turns an idea with two befores into an improvement with one of each", () => {
    const plan = planReclassify({
      kind: "improvement",
      currentStatus: "submitted_for_review",
      evidence: twoBefores,
      assignments: [{ id: 11, role: "before" }, { id: 12, role: "after" }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.statusChange).toBe("to_improvement");
    expect(plan.phases).toEqual([{ id: 11, phase: "before" }, { id: 12, phase: "after" }]);
    expect(plan.changed).toEqual([{ id: 12, phase: "after" }]);
    expect(plan.beforeCount).toBe(1);
    expect(plan.afterCount).toBe(1);
    expect(plan.removesCredit).toBe(false);
  });

  it("refuses an improvement with no after photo — the after is what makes it count", () => {
    const plan = planReclassify({
      kind: "improvement",
      currentStatus: "submitted_for_review",
      evidence: twoBefores,
      assignments: [{ id: 11, role: "before" }, { id: 12, role: "before" }],
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toMatch(/After/);
  });

  it("refuses an improvement with no photos at all", () => {
    const plan = planReclassify({ kind: "improvement", currentStatus: "submitted_for_review", evidence: [] });
    expect(plan.ok).toBe(false);
  });

  it("accepts an after with no before (the normal 'Skip — there isn't one' case)", () => {
    const plan = planReclassify({
      kind: "improvement",
      currentStatus: "submitted_for_review",
      evidence: [{ id: 5, phase: "before" }],
      assignments: [{ id: 5, role: "after" }],
    });
    expect(plan.ok && plan.afterCount === 1 && plan.beforeCount === 0).toBe(true);
  });

  it("refuses a photo that isn't one of this improvement's own (another improvement's, a comment photo, the stitched clip)", () => {
    const plan = planReclassify({
      kind: "improvement",
      currentStatus: "submitted_for_review",
      evidence: twoBefores,
      assignments: [{ id: 11, role: "before" }, { id: 99, role: "after" }],
    });
    expect(plan.ok).toBe(false);
  });

  it("refuses the same photo given twice", () => {
    const plan = planReclassify({
      kind: "improvement",
      currentStatus: "submitted_for_review",
      evidence: twoBefores,
      assignments: [{ id: 12, role: "after" }, { id: 12, role: "before" }],
    });
    expect(plan.ok).toBe(false);
  });

  it("keeps a photo that wasn't sent on its current side, reading no phase as before", () => {
    const plan = planReclassify({
      kind: "improvement",
      currentStatus: "submitted_for_review",
      evidence: [{ id: 1, phase: null }, { id: 2, phase: "before" }],
      assignments: [{ id: 2, role: "after" }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // The legacy no-phase photo is written as an explicit "before".
    expect(plan.phases).toEqual([{ id: 1, phase: "before" }, { id: 2, phase: "after" }]);
    expect(plan.changed).toEqual([{ id: 1, phase: "before" }, { id: 2, phase: "after" }]);
  });

  it("only re-sorts the photos on something that is already an improvement", () => {
    const plan = planReclassify({
      kind: "improvement",
      currentStatus: "complete",
      evidence: [{ id: 1, phase: "after" }, { id: 2, phase: "after" }],
      assignments: [{ id: 1, role: "before" }],
    });
    expect(plan.ok && plan.statusChange).toBe("none");
  });

  it("treats the legacy to-do statuses as ideas", () => {
    const plan = planReclassify({
      kind: "improvement",
      currentStatus: "acknowledged",
      evidence: [{ id: 1, phase: "before" }],
      assignments: [{ id: 1, role: "after" }],
    });
    expect(plan.ok && plan.statusChange).toBe("to_improvement");
  });
});

describe("planReclassify — back to an idea", () => {
  it("puts every photo back to before", () => {
    const plan = planReclassify({
      kind: "idea",
      currentStatus: "awaiting_approval",
      evidence: [{ id: 1, phase: "before" }, { id: 2, phase: "after" }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.statusChange).toBe("to_idea");
    expect(plan.phases.every(p => p.phase === "before")).toBe(true);
    expect(plan.removesCredit).toBe(false);
  });

  it("refuses an after photo on an idea", () => {
    const plan = planReclassify({
      kind: "idea",
      currentStatus: "complete",
      evidence: twoBefores,
      assignments: [{ id: 12, role: "after" }],
    });
    expect(plan.ok).toBe(false);
  });

  it("flags that an approved improvement loses its credit", () => {
    const plan = planReclassify({ kind: "idea", currentStatus: "complete", evidence: twoBefores });
    expect(plan.ok && plan.removesCredit).toBe(true);
  });

  it("an idea with no photos can stay an idea", () => {
    const plan = planReclassify({ kind: "idea", currentStatus: "submitted_for_review", evidence: [] });
    expect(plan.ok && plan.statusChange).toBe("none");
  });
});

describe("currentRole", () => {
  it("reads only 'after' as after", () => {
    expect(currentRole("after")).toBe("after");
    expect(currentRole("before")).toBe("before");
    expect(currentRole(null)).toBe("before");
  });
});

describe("reclassifyTimelineNote", () => {
  it("says what changed in plain words", () => {
    const plan = planReclassify({
      kind: "improvement",
      currentStatus: "submitted_for_review",
      evidence: twoBefores,
      assignments: [{ id: 12, role: "after" }],
    });
    if (!plan.ok) throw new Error("expected ok");
    expect(reclassifyTimelineNote(plan)).toBe("Changed this from an idea to an improvement — 1 before photo and 1 after photo.");
  });

  it("says when going back to an idea took the credit away", () => {
    const plan = planReclassify({ kind: "idea", currentStatus: "complete", evidence: twoBefores });
    if (!plan.ok) throw new Error("expected ok");
    expect(reclassifyTimelineNote(plan)).toBe(
      "Changed this back to an idea — it no longer counts as a finished improvement. 2 before photos.",
    );
  });
});
