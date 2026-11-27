import { describe, expect, it } from "vitest";
import {
  addMoreToBridgeJob, applyBridgeProgress, BRIDGE_LEASE_MS, cancelBridgeJob, canClaimBridgeJob, claimBridgeJob, expireBridgeJobIfStale, finishBridgeJob, bridgePackerView, packsLabelled,
  pageForSeq, parseBackLabelPrinterSetting, retryBridgeJob, runsFor, totalLabels, type BridgeJob,
} from "./bridge-job";

const TODAY = "2026-11-27";
const T0 = 1_000_000;

function job(over: Partial<BridgeJob> = {}): BridgeJob {
  return { state: "queued", runs: runsFor(120, 1), printed: 0, claimedBy: null, leaseUntil: null, printDate: TODAY, pauseReason: null, error: null, ...over };
}

describe("runs", () => {
  it("one label per pack, or a pair: every first label then every second", () => {
    expect(runsFor(120, 1)).toEqual([{ page: 0, copies: 120 }]);
    expect(runsFor(3, 2)).toEqual([{ page: 0, copies: 3 }, { page: 1, copies: 3 }]);
    expect(totalLabels(runsFor(3, 2))).toBe(6);
    expect(runsFor(0, 1)).toEqual([]);
  });

  it("finds the label for each place in the run", () => {
    const runs = [...runsFor(3, 2), ...runsFor(1, 2)];
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(s => pageForSeq(runs, s))).toEqual([0, 0, 0, 1, 1, 1, 0, 1]);
    expect(pageForSeq(runs, 8)).toBeNull();
    expect(pageForSeq(runs, -1)).toBeNull();
  });

  it("counts packs that got a label, not sheets", () => {
    expect(packsLabelled(runsFor(120, 1), 47)).toBe(47);
    expect(packsLabelled(runsFor(50, 2), 70)).toBe(50); // all firsts + 20 seconds
    expect(packsLabelled(runsFor(50, 2), 0)).toBe(0);
  });
});

describe("claiming a run", () => {
  it("a bridge claims a queued run and it starts printing", () => {
    const j = claimBridgeJob(job(), "wrap-pc", T0, TODAY);
    expect(j).toMatchObject({ state: "printing", claimedBy: "wrap-pc", leaseUntil: T0 + BRIDGE_LEASE_MS, printed: 0 });
  });

  it("a restarted bridge takes its own run straight back, printed count kept", () => {
    const held = job({ state: "paused", claimedBy: "wrap-pc", leaseUntil: T0 + 60_000, printed: 47, pauseReason: "out-of-labels" });
    expect(canClaimBridgeJob(held, "wrap-pc", T0, TODAY)).toBe(true);
    const j = claimBridgeJob(held, "wrap-pc", T0, TODAY);
    expect(j.printed).toBe(47);
    expect(j.state).toBe("paused");
  });

  it("another bridge waits for the lease to lapse — the run is never printed twice at once", () => {
    const held = job({ state: "printing", claimedBy: "wrap-pc", leaseUntil: T0 + 10 });
    expect(canClaimBridgeJob(held, "other-pc", T0, TODAY)).toBe(false);
    expect(() => claimBridgeJob(held, "other-pc", T0, TODAY)).toThrow();
    expect(canClaimBridgeJob(held, "other-pc", T0 + 11, TODAY)).toBe(true);
  });

  it("never claims a finished run, or one dated another day", () => {
    for (const state of ["done", "failed", "cancelled", "expired"] as const) expect(canClaimBridgeJob(job({ state }), "wrap-pc", T0, TODAY)).toBe(false);
    expect(canClaimBridgeJob(job({ printDate: "2026-11-26" }), "wrap-pc", T0, TODAY)).toBe(false);
  });
});

describe("progress", () => {
  const running = () => claimBridgeJob(job(), "wrap-pc", T0, TODAY);

  it("counts up label by label and keeps the lease alive", () => {
    const r = applyBridgeProgress(running(), { bridgeId: "wrap-pc", printed: 1 }, T0 + 5000);
    expect(r).toMatchObject({ stop: false, total: 120 });
    expect(r.job).toMatchObject({ printed: 1, state: "printing", leaseUntil: T0 + 5000 + BRIDGE_LEASE_MS });
  });

  it("pauses when the roll runs out, with the count so far, and resumes by itself", () => {
    const paused = applyBridgeProgress(running(), { bridgeId: "wrap-pc", printed: 47, paused: "out-of-labels", detail: "Error, PaperOut, Printing" }, T0).job;
    expect(paused).toMatchObject({ state: "paused", printed: 47, pauseReason: "out-of-labels" });
    expect(bridgePackerView(paused, true)).toEqual({ count: "47 of 120 printed", message: "Out of labels — put a new roll in; it carries on by itself.", tone: "warning" });
    const resumed = applyBridgeProgress(paused, { bridgeId: "wrap-pc", printed: 48 }, T0 + 1).job;
    expect(resumed).toMatchObject({ state: "printing", printed: 48, pauseReason: null, error: null });
  });

  it("the printed count never goes down and never passes the total", () => {
    const at47 = applyBridgeProgress(running(), { bridgeId: "wrap-pc", printed: 47 }, T0).job;
    expect(applyBridgeProgress(at47, { bridgeId: "wrap-pc", printed: 12 }, T0).job.printed).toBe(47);
    expect(applyBridgeProgress(at47, { bridgeId: "wrap-pc", printed: 999 }, T0).job.printed).toBe(120);
  });

  it("a bridge that lost the run is told to stop and changes nothing", () => {
    const r = applyBridgeProgress(running(), { bridgeId: "other-pc", printed: 5 }, T0);
    expect(r.stop).toBe(true);
    expect(r.job.printed).toBe(0);
  });

  it("after cancel the bridge is told to stop, but the label that came out still counts", () => {
    const at10 = applyBridgeProgress(running(), { bridgeId: "wrap-pc", printed: 10 }, T0).job;
    const cancelled = cancelBridgeJob(at10);
    const r = applyBridgeProgress(cancelled, { bridgeId: "wrap-pc", printed: 11 }, T0);
    expect(r.stop).toBe(true);
    expect(r.job).toMatchObject({ state: "cancelled", printed: 11 });
    expect(bridgePackerView(r.job, true).message).toBe("Cancelled — 109 not printed.");
  });
});

describe("finishing", () => {
  const at = (printed: number) => applyBridgeProgress(claimBridgeJob(job(), "wrap-pc", T0, TODAY), { bridgeId: "wrap-pc", printed }, T0).job;

  it("done when every label is out", () => {
    const j = finishBridgeJob(at(119), { bridgeId: "wrap-pc", printed: 120, ok: true });
    expect(j).toMatchObject({ state: "done", printed: 120, claimedBy: null });
    expect(bridgePackerView(j, true)).toMatchObject({ count: "120 of 120 printed", message: "Done ✓", tone: "done" });
  });

  it("a failure keeps the count and the reason", () => {
    const j = finishBridgeJob(at(30), { bridgeId: "wrap-pc", printed: 30, ok: false, error: "Windows has no printer called Godex" });
    expect(j).toMatchObject({ state: "failed", printed: 30, error: "Windows has no printer called Godex" });
    expect(retryBridgeJob(j, TODAY)).toMatchObject({ state: "queued", printed: 30, claimedBy: null });
  });

  it("a run that grew while printing goes back to the queue for the rest", () => {
    const grown = addMoreToBridgeJob(at(120), runsFor(5, 1), TODAY);
    expect(grown.state).toBe("printing");
    const j = finishBridgeJob(grown, { bridgeId: "wrap-pc", printed: 120, ok: true });
    expect(j).toMatchObject({ state: "queued", printed: 120 });
    expect(totalLabels(j.runs)).toBe(125);
  });

  it("a cancelled run stays cancelled when the bridge finishes", () => {
    const j = finishBridgeJob(cancelBridgeJob(at(10)), { bridgeId: "wrap-pc", printed: 10, ok: true });
    expect(j.state).toBe("cancelled");
  });
});

describe("print N more, cancelBridgeJob, expiry", () => {
  it("print N more on a finished run reopens it from the printed count", () => {
    const done = job({ state: "done", printed: 120 });
    const more = addMoreToBridgeJob(done, runsFor(4, 1), TODAY);
    expect(more).toMatchObject({ state: "queued", printed: 120, claimedBy: null });
    expect(totalLabels(more.runs)).toBe(124);
    expect(bridgePackerView(more, true).count).toBe("120 of 124 printed");
  });

  it("print N more is refused on another day", () => {
    expect(() => addMoreToBridgeJob(job({ state: "done", printDate: "2026-11-26" }), runsFor(1, 1), TODAY)).toThrow(/another day/);
  });

  it("can't cancel a finished run", () => {
    expect(() => cancelBridgeJob(job({ state: "done" }))).toThrow();
  });

  it("an unfinished run from yesterday expires", () => {
    expect(expireBridgeJobIfStale(job({ state: "paused", printDate: "2026-11-26" }), TODAY).state).toBe("expired");
    expect(expireBridgeJobIfStale(job({ state: "done", printDate: "2026-11-26" }), TODAY).state).toBe("done");
    expect(expireBridgeJobIfStale(job(), TODAY).state).toBe("queued");
  });

  it("tells the packer when the printer computer is away", () => {
    expect(bridgePackerView(job(), false).tone).toBe("warning");
    expect(bridgePackerView(job({ state: "printing", printed: 3 }), true)).toMatchObject({ count: "3 of 120 printed", message: "Printing…" });
  });
});

describe("the printer setting", () => {
  it("reads the printer name and bridge; empty is off", () => {
    expect(parseBackLabelPrinterSetting(JSON.stringify({ printerName: " Godex G500 ", station: "wrapping" }))).toEqual({ printerName: "Godex G500", station: "wrapping" });
    expect(parseBackLabelPrinterSetting(JSON.stringify({ printerName: "ZDesigner ZD421" }))).toEqual({ printerName: "ZDesigner ZD421", station: "wrapping" });
    expect(parseBackLabelPrinterSetting(JSON.stringify({ printerName: "" }))).toBeNull();
    expect(parseBackLabelPrinterSetting("not json")).toBeNull();
    expect(parseBackLabelPrinterSetting(null)).toBeNull();
  });
});
