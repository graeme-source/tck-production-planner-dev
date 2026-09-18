import { describe, it, expect } from "vitest";
import {
  readMetaAdsConfig,
  normaliseAccountId,
  notConnectedMessage,
  syncWindow,
  addDays,
  mapInsightRows,
  parseSpend,
  mergeVerdict,
  planMerge,
  checkTimezoneAlignment,
  DEFAULT_GRAPH_VERSION,
  REPORTING_TIMEZONE,
  type ExistingSpendRow,
} from "./meta-ads-sync";

// Anchor for every window test: Friday 18 September 2026.
const TODAY = "2026-09-18";

describe("readMetaAdsConfig", () => {
  it("is not connected, and does not throw, when neither variable is set", () => {
    const cfg = readMetaAdsConfig({});
    expect(cfg.connected).toBe(false);
    if (!cfg.connected) expect(cfg.reason).toBe("no-credentials");
  });

  it("names which half is missing, so the fix is obvious", () => {
    const noToken = readMetaAdsConfig({ META_AD_ACCOUNT_ID: "act_123" });
    expect(noToken.connected).toBe(false);
    if (!noToken.connected) expect(noToken.reason).toBe("no-token");

    const noAccount = readMetaAdsConfig({ META_ADS_TOKEN: "EAAG..." });
    expect(noAccount.connected).toBe(false);
    if (!noAccount.connected) expect(noAccount.reason).toBe("no-account-id");
  });

  it("treats whitespace-only values as absent (a blank Railway variable)", () => {
    const cfg = readMetaAdsConfig({ META_ADS_TOKEN: "   ", META_AD_ACCOUNT_ID: "  " });
    expect(cfg.connected).toBe(false);
    if (!cfg.connected) expect(cfg.reason).toBe("no-credentials");
  });

  it("connects when both are present, pinning the Graph version", () => {
    const cfg = readMetaAdsConfig({ META_ADS_TOKEN: "EAAG-token", META_AD_ACCOUNT_ID: "act_998877" });
    expect(cfg).toEqual({
      connected: true,
      token: "EAAG-token",
      accountId: "act_998877",
      graphVersion: DEFAULT_GRAPH_VERSION,
    });
  });

  it("lets the Graph version be overridden without a code change", () => {
    const cfg = readMetaAdsConfig({
      META_ADS_TOKEN: "t", META_AD_ACCOUNT_ID: "123", META_GRAPH_VERSION: "v23.0",
    });
    if (!cfg.connected) throw new Error("expected connected");
    expect(cfg.graphVersion).toBe("v23.0");
  });

  it("rejects an account id that isn't one, rather than calling Meta with junk", () => {
    const cfg = readMetaAdsConfig({ META_ADS_TOKEN: "t", META_AD_ACCOUNT_ID: "my ad account" });
    expect(cfg.connected).toBe(false);
    if (!cfg.connected) expect(cfg.reason).toBe("bad-account-id");
  });

  it("every not-connected reason has an honest human message", () => {
    for (const reason of ["no-credentials", "no-token", "no-account-id", "bad-account-id"] as const) {
      const msg = notConnectedMessage(reason);
      expect(msg.length).toBeGreaterThan(10);
      // Never a number, and never a claim that spend was zero.
      expect(msg).not.toMatch(/£0|spent nothing/i);
    }
  });
});

describe("normaliseAccountId", () => {
  it("accepts the act_ form, the bare digits, and odd casing/spacing", () => {
    expect(normaliseAccountId("act_1234567890")).toBe("act_1234567890");
    expect(normaliseAccountId("1234567890")).toBe("act_1234567890");
    expect(normaliseAccountId("  ACT_1234567890 ")).toBe("act_1234567890");
    expect(normaliseAccountId("act1234567890")).toBe("act_1234567890");
  });

  it("rejects anything that isn't an id", () => {
    expect(normaliseAccountId("")).toBeNull();
    expect(normaliseAccountId("act_")).toBeNull();
    expect(normaliseAccountId("act_12ab")).toBeNull();
    expect(normaliseAccountId("https://business.facebook.com/act_123")).toBeNull();
  });
});

describe("syncWindow", () => {
  it("backfills ~90 days, inclusive of today, on the first ever run", () => {
    const w = syncWindow({ today: TODAY, lastSyncedDate: null });
    expect(w.until).toBe(TODAY);
    expect(w.since).toBe("2026-06-21"); // 90 days inclusive
    expect(w.reason).toBe("first-run-backfill");
    // Exactly 90 days end to end.
    expect(addDays(w.since, 89)).toBe(w.until);
  });

  it("re-fetches the trailing 48 hours on a routine run, not just new days", () => {
    // Yesterday is already synced; a naive sync would fetch only today.
    const w = syncWindow({ today: TODAY, lastSyncedDate: "2026-09-17" });
    expect(w.reason).toBe("trailing-refetch");
    expect(w.since).toBe("2026-09-16");
    expect(w.until).toBe(TODAY);
  });

  it("re-fetches the trailing window even when today is already synced", () => {
    // This is the case that silently under-reports without rule 1: the sync
    // ran this morning, so lastSyncedDate is today, and there is nothing
    // "new" to fetch — but today's and yesterday's figures are still moving.
    const w = syncWindow({ today: TODAY, lastSyncedDate: TODAY });
    expect(w.since).toBe("2026-09-16");
    expect(w.until).toBe(TODAY);
    expect(w.reason).toBe("trailing-refetch");
  });

  it("reaches back past its own last day after an outage, leaving no gap", () => {
    // Sync last succeeded on the 10th; days 11-18 are missing AND the 9th/10th
    // may have settled since. Start before the last synced day, not after it.
    const w = syncWindow({ today: TODAY, lastSyncedDate: "2026-09-10" });
    expect(w.reason).toBe("catch-up");
    expect(w.since).toBe("2026-09-08");
    expect(w.until).toBe(TODAY);
  });

  it("never asks for more than the backfill bound after a very long outage", () => {
    const w = syncWindow({ today: TODAY, lastSyncedDate: "2024-01-01" });
    expect(w.reason).toBe("backfill-floor");
    expect(w.since).toBe("2026-06-21");
    expect(addDays(w.since, 89)).toBe(w.until);
  });

  it("honours custom bounds", () => {
    const w = syncWindow({ today: TODAY, lastSyncedDate: null, backfillDays: 7 });
    expect(w.since).toBe("2026-09-12");
    const t = syncWindow({ today: TODAY, lastSyncedDate: TODAY, trailingDays: 5 });
    expect(t.since).toBe("2026-09-13");
  });

  it("clamps a future lastSyncedDate so since never passes until", () => {
    // Clock skew between instances, or a row written with tomorrow's date.
    const w = syncWindow({ today: TODAY, lastSyncedDate: "2027-01-01", trailingDays: 0 });
    expect(w.since <= w.until).toBe(true);
    expect(w.until).toBe(TODAY);
  });

  it("crosses month and year boundaries correctly", () => {
    expect(syncWindow({ today: "2026-01-01", lastSyncedDate: "2025-12-31" }).since).toBe("2025-12-30");
    expect(syncWindow({ today: "2026-03-01", lastSyncedDate: "2026-02-28" }).since).toBe("2026-02-27");
  });

  it("crosses a BST→GMT clock change without losing or repeating a day", () => {
    // UK clocks go back on 25 October 2026. Day arithmetic is calendar-based,
    // not 24h-based, so the 25th must still be exactly one day after the 24th.
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-26", -1)).toBe("2026-10-25");
    const w = syncWindow({ today: "2026-10-26", lastSyncedDate: "2026-10-25" });
    expect(w.since).toBe("2026-10-24");
  });
});

describe("mapInsightRows", () => {
  const window = { since: "2026-09-16", until: "2026-09-18" };

  it("maps Meta's day rows to spend_date/amount, parsing the string spend", () => {
    const { rows, discarded } = mapInsightRows([
      { date_start: "2026-09-16", date_stop: "2026-09-16", spend: "142.17" },
      { date_start: "2026-09-17", date_stop: "2026-09-17", spend: "98.5" },
      { date_start: "2026-09-18", date_stop: "2026-09-18", spend: "12" },
    ], window);
    expect(rows).toEqual([
      { date: "2026-09-16", amount: 142.17 },
      { date: "2026-09-17", amount: 98.5 },
      { date: "2026-09-18", amount: 12 },
    ]);
    expect(discarded).toEqual([]);
  });

  it("keeps a genuine zero — a real £0 day is data, not a missing day", () => {
    const { rows } = mapInsightRows([{ date_start: "2026-09-17", spend: "0" }], window);
    expect(rows).toEqual([{ date: "2026-09-17", amount: 0 }]);
  });

  it("discards unreadable spend rather than turning it into a zero", () => {
    // A zero would read as "we spent nothing", which is a much worse claim
    // than "we don't know" — so these days get no row at all.
    const { rows, discarded } = mapInsightRows([
      { date_start: "2026-09-16", spend: "not-a-number" },
      { date_start: "2026-09-17", spend: null },
      { date_start: "2026-09-18" },
    ], window);
    expect(rows).toEqual([]);
    expect(discarded).toHaveLength(3);
    for (const d of discarded) expect(d.reason).toMatch(/unreadable spend/);
  });

  it("drops rows outside the requested window and malformed dates", () => {
    const { rows, discarded } = mapInsightRows([
      { date_start: "2026-09-01", spend: "50" },
      { date_start: "not a date", spend: "50" },
      { date_start: "2026-09-17", spend: "50" },
      null,
      "nonsense",
    ], window);
    expect(rows).toEqual([{ date: "2026-09-17", amount: 50 }]);
    expect(discarded).toHaveLength(4);
  });

  it("sums a day that arrives split across rows", () => {
    const { rows } = mapInsightRows([
      { date_start: "2026-09-17", spend: "10.01" },
      { date_start: "2026-09-17", spend: "20.02" },
    ], window);
    expect(rows).toEqual([{ date: "2026-09-17", amount: 30.03 }]);
  });

  it("sorts by date and survives a non-list response", () => {
    const { rows } = mapInsightRows([
      { date_start: "2026-09-18", spend: "3" },
      { date_start: "2026-09-16", spend: "1" },
    ], window);
    expect(rows.map(r => r.date)).toEqual(["2026-09-16", "2026-09-18"]);

    expect(mapInsightRows({ error: "boom" }, window).rows).toEqual([]);
    expect(mapInsightRows(null, window).rows).toEqual([]);
    expect(mapInsightRows(undefined, window).rows).toEqual([]);
  });
});

describe("parseSpend", () => {
  it("reads Meta's decimal strings and plain numbers", () => {
    expect(parseSpend("42.17")).toBe(42.17);
    expect(parseSpend("0")).toBe(0);
    expect(parseSpend(42.176)).toBe(42.18);
    expect(parseSpend("1e3")).toBe(1000);
  });

  it("refuses negatives, blanks and nonsense", () => {
    expect(parseSpend("-5")).toBeNull();
    expect(parseSpend("")).toBeNull();
    expect(parseSpend("   ")).toBeNull();
    expect(parseSpend("£42")).toBeNull();
    expect(parseSpend(Number.NaN)).toBeNull();
    expect(parseSpend(null)).toBeNull();
    expect(parseSpend(undefined)).toBeNull();
    expect(parseSpend({})).toBeNull();
  });
});

describe("mergeVerdict — hand-entered always wins", () => {
  it("inserts a day that has no row yet", () => {
    expect(mergeVerdict(null, 100)).toEqual({ action: "insert", reason: "no row for this day yet" });
    expect(mergeVerdict(undefined, 100).action).toBe("insert");
  });

  it("NEVER overwrites a hand-entered figure, even a very different one", () => {
    const typed: ExistingSpendRow = { source: "manual", amount: 250 };
    const verdict = mergeVerdict(typed, 9999);
    expect(verdict.action).toBe("skip");
    expect(verdict.reason).toMatch(/hand-entered/);
  });

  it("does not overwrite a hand-entered zero either", () => {
    // A typed 0 means "we genuinely spent nothing" and must survive a sync
    // that thinks otherwise.
    expect(mergeVerdict({ source: "manual", amount: 0 }, 480).action).toBe("skip");
  });

  it("updates a synced figure when Meta's number has moved", () => {
    // The trailing re-fetch's whole purpose: yesterday settled upwards.
    const verdict = mergeVerdict({ source: "meta", amount: 120.0 }, 143.55);
    expect(verdict).toEqual({ action: "update", reason: "the synced figure has changed" });
  });

  it("is idempotent — re-syncing an unchanged day writes nothing", () => {
    const verdict = mergeVerdict({ source: "meta", amount: 143.55 }, 143.55);
    expect(verdict).toEqual({ action: "skip", reason: "unchanged since the last sync" });
  });

  it("compares at 2dp, so float noise doesn't cause a pointless write", () => {
    expect(mergeVerdict({ source: "meta", amount: 0.1 + 0.2 }, 0.3).action).toBe("skip");
  });

  it("treats an unrecognised source as hand-entered, not as fair game", () => {
    // Fail safe: if a future source string appears, don't clobber it.
    expect(mergeVerdict({ source: "imported", amount: 5 }, 10).action).toBe("skip");
  });
});

describe("planMerge", () => {
  it("splits a window into inserts, updates, pinned days and no-ops", () => {
    const existing = new Map<string, ExistingSpendRow>([
      ["2026-09-16", { source: "meta", amount: 100 }],   // unchanged
      ["2026-09-17", { source: "meta", amount: 90 }],    // settled upward
      ["2026-09-18", { source: "manual", amount: 500 }], // typed — untouchable
    ]);
    const plan = planMerge([
      { date: "2026-09-15", amount: 80 },
      { date: "2026-09-16", amount: 100 },
      { date: "2026-09-17", amount: 118.4 },
      { date: "2026-09-18", amount: 42 },
    ], existing);

    expect(plan.inserts).toEqual([{ date: "2026-09-15", amount: 80 }]);
    expect(plan.updates).toEqual([{ date: "2026-09-17", amount: 118.4 }]);
    expect(plan.unchanged).toEqual(["2026-09-16"]);
    expect(plan.skippedManual).toEqual(["2026-09-18"]);
  });

  it("running the same plan twice is a complete no-op the second time", () => {
    const existing = new Map<string, ExistingSpendRow>();
    const incoming = [{ date: "2026-09-17", amount: 118.4 }];

    const first = planMerge(incoming, existing);
    expect(first.inserts).toHaveLength(1);

    // Apply it, the way the sync would, then re-run over the same data.
    for (const row of [...first.inserts, ...first.updates]) {
      existing.set(row.date, { source: "meta", amount: row.amount });
    }
    const second = planMerge(incoming, existing);
    expect(second.inserts).toEqual([]);
    expect(second.updates).toEqual([]);
    expect(second.unchanged).toEqual(["2026-09-17"]);
  });

  it("an empty response changes nothing", () => {
    const plan = planMerge([], new Map([["2026-09-17", { source: "meta", amount: 90 }]]));
    expect(plan).toEqual({ inserts: [], updates: [], skippedManual: [], unchanged: [] });
  });
});

describe("checkTimezoneAlignment", () => {
  it("is aligned when the ad account reports in London", () => {
    const check = checkTimezoneAlignment("Europe/London");
    expect(check).toEqual({
      aligned: true, accountTimezone: "Europe/London", expected: REPORTING_TIMEZONE, warning: null,
    });
  });

  it("warns, naming both zones, when the account is somewhere else", () => {
    const check = checkTimezoneAlignment("America/Los_Angeles");
    expect(check.aligned).toBe(false);
    expect(check.warning).toContain("America/Los_Angeles");
    expect(check.warning).toContain("Europe/London");
  });

  it("warns when Meta didn't tell us the timezone at all", () => {
    for (const value of [null, undefined, "", "   "]) {
      const check = checkTimezoneAlignment(value);
      expect(check.aligned).toBe(false);
      expect(check.accountTimezone).toBeNull();
      expect(check.warning).toBeTruthy();
    }
  });
});
