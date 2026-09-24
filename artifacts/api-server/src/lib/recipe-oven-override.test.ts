import { describe, it, expect } from "vitest";
import { parseOvenOverride } from "./recipe-oven-override";

describe("parseOvenOverride", () => {
  it("accepts a temperature and time", () => {
    expect(parseOvenOverride({ ovenTempC: 200, ovenTimeSeconds: 360 })).toEqual({ ok: true, fields: { ovenTempC: 200, ovenTimeSeconds: 360 } });
  });

  it("leaves absent keys out so a body without them can't wipe a saved override", () => {
    expect(parseOvenOverride({ name: "Carnizone" })).toEqual({ ok: true, fields: {} });
    expect(parseOvenOverride({ ovenTempC: 200 })).toEqual({ ok: true, fields: { ovenTempC: 200 } });
  });

  it("clears with null or an empty form value", () => {
    expect(parseOvenOverride({ ovenTempC: null, ovenTimeSeconds: "" })).toEqual({ ok: true, fields: { ovenTempC: null, ovenTimeSeconds: null } });
  });

  it("rejects typos outside oven sanity limits", () => {
    expect(parseOvenOverride({ ovenTempC: 2000 }).ok).toBe(false);
    expect(parseOvenOverride({ ovenTimeSeconds: 6 }).ok).toBe(false);
    expect(parseOvenOverride({ ovenTempC: 200.5 }).ok).toBe(false);
    expect(parseOvenOverride({ ovenTempC: "hot" }).ok).toBe(false);
  });
});
