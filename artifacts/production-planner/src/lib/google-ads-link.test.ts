import { describe, expect, it } from "vitest";
import { KEY_STAND_IN, ago, fillScript, linkHealth } from "./google-ads-link";

const ph = { url: "__APP_URL__", key: "__KEY__" };
const template = "var APP_URL = '__APP_URL__';\nvar KEY = '__KEY__';\n";

describe("fillScript", () => {
  it("puts in this app's address and the key", () => {
    expect(fillScript(template, ph, "https://app.example/api/ad-spend/google-ads", "tckga_abc"))
      .toBe("var APP_URL = 'https://app.example/api/ad-spend/google-ads';\nvar KEY = 'tckga_abc';\n");
  });
  it("without the key (shown once), leaves an obvious stand-in", () => {
    expect(fillScript(template, ph, "u", null)).toContain(`var KEY = '${KEY_STAND_IN}'`);
  });
});

describe("linkHealth", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  const base = { hasKey: true, lastReceivedAt: null, lastDayCount: null, lastFrom: null, lastTo: null };

  it("not set up / turned off / waiting", () => {
    expect(linkHealth({ ...base, hasKey: false }, now).headline).toBe("Not set up yet");
    expect(linkHealth({ ...base, hasKey: false, lastReceivedAt: "2026-10-10T06:00:00Z" }, now).headline).toBe("Turned off");
    expect(linkHealth(base, now).tone).toBe("waiting");
  });

  it("says when it last heard and what it got", () => {
    const h = linkHealth({ ...base, lastReceivedAt: "2026-10-11T09:00:00Z", lastDayCount: 8, lastFrom: "2026-10-04", lastTo: "2026-10-11" }, now);
    expect(h).toEqual({ tone: "good", headline: "Last received 3 hours ago", detail: "8 days (4 Oct – 11 Oct)." });
  });

  it("goes stale after a day and a half without a send", () => {
    const h = linkHealth({ ...base, lastReceivedAt: "2026-10-09T09:00:00Z", lastDayCount: 8, lastFrom: "2026-10-02", lastTo: "2026-10-09" }, now);
    expect(h.tone).toBe("stale");
    expect(h.headline).toBe("Last received 2 days ago");
    expect(h.detail).toMatch(/check the script's schedule/);
  });
});

describe("ago", () => {
  it("is coarse", () => {
    expect(ago(10_000)).toBe("just now");
    expect(ago(60_000)).toBe("1 minute ago");
    expect(ago(90 * 60_000)).toBe("2 hours ago");
    expect(ago(50 * 3_600_000)).toBe("2 days ago");
  });
});
