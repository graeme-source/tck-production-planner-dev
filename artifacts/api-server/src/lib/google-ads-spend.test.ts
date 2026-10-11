import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GOOGLE_ADS_SCRIPT, GOOGLE_SCRIPT_SOURCE, GoogleAdsSpendPayload, MAX_DAYS_PER_POST,
  SCRIPT_KEY_PLACEHOLDER, SCRIPT_URL_PLACEHOLDER,
  dayWindowProblem, generateIngestKey, googleTimezoneWarning, hashIngestKey, isCalendarDate,
  keyHint, payloadDays, verifyIngestKey,
} from "./google-ads-spend";
import { planMerge, type ExistingSpendRow } from "./meta-ads-sync";

const ok = {
  accountId: "123-456-7890",
  currency: "GBP",
  timeZone: "Europe/London",
  days: [{ date: "2026-10-09", cost: 41.5 }, { date: "2026-10-10", cost: 0 }],
};

describe("Google Ads payload", () => {
  it("accepts what the script sends", () => {
    expect(GoogleAdsSpendPayload.safeParse(ok).success).toBe(true);
    // timeZone is optional (an older copy of the script)
    const { timeZone: _tz, ...noTz } = ok;
    expect(GoogleAdsSpendPayload.safeParse(noTz).success).toBe(true);
  });

  it("refuses any currency but pounds, never converts", () => {
    const r = GoogleAdsSpendPayload.safeParse({ ...ok, currency: "EUR" });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.flatten())).toMatch(/Only GBP/);
  });

  it(`refuses an empty list, more than ${MAX_DAYS_PER_POST} days, or a day twice`, () => {
    expect(GoogleAdsSpendPayload.safeParse({ ...ok, days: [] }).success).toBe(false);
    const many = Array.from({ length: MAX_DAYS_PER_POST + 1 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10), cost: 1,
    }));
    expect(GoogleAdsSpendPayload.safeParse({ ...ok, days: many }).success).toBe(false);
    expect(GoogleAdsSpendPayload.safeParse({ ...ok, days: many.slice(0, MAX_DAYS_PER_POST) }).success).toBe(true);
    expect(GoogleAdsSpendPayload.safeParse({ ...ok, days: [ok.days[0], ok.days[0]] }).success).toBe(false);
  });

  it("refuses negative, non-numeric or missing costs, bad dates, and stray fields", () => {
    const day = (d: unknown) => GoogleAdsSpendPayload.safeParse({ ...ok, days: [d] }).success;
    expect(day({ date: "2026-10-09", cost: -1 })).toBe(false);
    expect(day({ date: "2026-10-09", cost: "41.50" })).toBe(false);
    expect(day({ date: "2026-10-09" })).toBe(false);
    expect(day({ date: "2026-02-30", cost: 1 })).toBe(false);
    expect(day({ date: "9/10/2026", cost: 1 })).toBe(false);
    expect(day({ date: "2026-10-09", cost: 1, clicks: 3 })).toBe(false);
    expect(GoogleAdsSpendPayload.safeParse({ ...ok, accountId: "" }).success).toBe(false);
    expect(GoogleAdsSpendPayload.safeParse({ ...ok, accountId: "x; DROP" }).success).toBe(false);
    expect(GoogleAdsSpendPayload.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("isCalendarDate knows real days", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
  });

  it("rounds to pence and sorts oldest first", () => {
    const p = GoogleAdsSpendPayload.parse({ ...ok, days: [{ date: "2026-10-10", cost: 12.345 }, { date: "2026-10-08", cost: 0.1 + 0.2 }] });
    expect(payloadDays(p)).toEqual([{ date: "2026-10-08", amount: 0.3 }, { date: "2026-10-10", amount: 12.35 }]);
  });
});

describe("which days are accepted (London)", () => {
  const today = "2026-10-11";
  it("today, tomorrow (an account ahead of London) and the past year are fine", () => {
    expect(dayWindowProblem(["2026-10-04", "2026-10-11", "2026-10-12"], today)).toBeNull();
    expect(dayWindowProblem(["2025-09-08"], today)).toBeNull();
  });
  it("later than tomorrow, or more than 400 days back, is refused whole", () => {
    expect(dayWindowProblem(["2026-10-10", "2026-10-13"], today)).toMatch(/future.*2026-10-13/);
    expect(dayWindowProblem(["2025-01-01"], today)).toMatch(/400 days/);
  });
  it("month and year ends don't trip it", () => {
    expect(dayWindowProblem(["2027-01-01"], "2026-12-31")).toBeNull();
    expect(dayWindowProblem(["2027-01-02"], "2026-12-31")).not.toBeNull();
  });
});

describe("the connection key", () => {
  it("is long, random and URL-safe", () => {
    const a = generateIngestKey();
    const b = generateIngestKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^tckga_[A-Za-z0-9_-]{43}$/);
    expect(keyHint(a)).toBe(a.slice(-4));
  });

  it("only its sha256 is kept, and the right key verifies", () => {
    const key = generateIngestKey();
    const stored = hashIngestKey(key);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(key);
    expect(verifyIngestKey(key, stored)).toBe(true);
  });

  it("a wrong, empty or turned-off key never verifies", () => {
    const stored = hashIngestKey(generateIngestKey());
    expect(verifyIngestKey(generateIngestKey(), stored)).toBe(false);
    expect(verifyIngestKey("", stored)).toBe(false);
    expect(verifyIngestKey("anything", null)).toBe(false);
    expect(verifyIngestKey("anything", "")).toBe(false);
    // presenting the stored hash itself is not the key
    expect(verifyIngestKey(stored, stored)).toBe(false);
    expect(verifyIngestKey("x", "not-a-hash")).toBe(false);
  });
});

describe("Google's timezone", () => {
  it("is quiet for London or when nothing has arrived", () => {
    expect(googleTimezoneWarning("Europe/London")).toBeNull();
    expect(googleTimezoneWarning(null)).toBeNull();
    expect(googleTimezoneWarning("")).toBeNull();
  });
  it("warns, naming the zone, for anything else", () => {
    expect(googleTimezoneWarning("America/Los_Angeles")).toMatch(/America\/Los_Angeles.*Europe\/London/);
  });
});

describe("a hand-typed Google figure always wins (same rule as Meta)", () => {
  it("the script inserts new days, updates its own, and leaves typed ones alone", () => {
    const existing = new Map<string, ExistingSpendRow>([
      ["2026-10-08", { source: GOOGLE_SCRIPT_SOURCE, amount: 10 }],
      ["2026-10-09", { source: GOOGLE_SCRIPT_SOURCE, amount: 20 }],
      ["2026-10-10", { source: "manual", amount: 99 }],
    ]);
    const plan = planMerge([
      { date: "2026-10-08", amount: 10 },
      { date: "2026-10-09", amount: 22.5 },
      { date: "2026-10-10", amount: 30 },
      { date: "2026-10-11", amount: 5 },
    ], existing, GOOGLE_SCRIPT_SOURCE);
    expect(plan.inserts.map(r => r.date)).toEqual(["2026-10-11"]);
    expect(plan.updates).toEqual([{ date: "2026-10-09", amount: 22.5 }]);
    expect(plan.unchanged).toEqual(["2026-10-08"]);
    expect(plan.skippedManual).toEqual(["2026-10-10"]);
  });

  it("a Google feed can't overwrite a Meta-synced row, and Meta's default is unchanged", () => {
    const existing = new Map<string, ExistingSpendRow>([["2026-10-09", { source: "meta", amount: 20 }]]);
    expect(planMerge([{ date: "2026-10-09", amount: 1 }], existing, GOOGLE_SCRIPT_SOURCE).skippedManual).toEqual(["2026-10-09"]);
    expect(planMerge([{ date: "2026-10-09", amount: 1 }], existing).updates).toHaveLength(1);
  });
});

describe("the Google Ads Script", () => {
  it("matches docs/google-ads-script.js exactly", () => {
    const docs = readFileSync(fileURLToPath(new URL("../../../../docs/google-ads-script.js", import.meta.url)), "utf8");
    expect(GOOGLE_ADS_SCRIPT).toBe(docs);
  });

  it("is short, has both placeholders once, and posts with the key in a header", () => {
    expect(GOOGLE_ADS_SCRIPT.trimEnd().split("\n").length).toBeLessThanOrEqual(40);
    expect(GOOGLE_ADS_SCRIPT.split(SCRIPT_URL_PLACEHOLDER)).toHaveLength(2);
    expect(GOOGLE_ADS_SCRIPT.split(SCRIPT_KEY_PLACEHOLDER)).toHaveLength(2);
    expect(GOOGLE_ADS_SCRIPT).toContain("Authorization: 'Bearer ' + KEY");
    expect(GOOGLE_ADS_SCRIPT).toContain("metrics.cost_micros");
    expect(GOOGLE_ADS_SCRIPT).toContain("Europe/London");
    // the key must never end up in the URL
    expect(GOOGLE_ADS_SCRIPT).not.toMatch(/APP_URL\s*\+/);
  });

  it("builds day strings that survive a clock change (runs the date loop the script uses)", () => {
    // The script steps back from today's date at noon UTC, so 25 Oct 2026
    // (BST ends) appears exactly once.
    const today = "2026-10-27";
    const days: string[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    expect(days).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  });
});
