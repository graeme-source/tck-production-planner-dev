import { describe, expect, it } from "vitest";
import { parseSecondaryColour } from "./recipe-secondary-colour";

describe("parseSecondaryColour", () => {
  it("leaves the saved colour alone when the body doesn't carry the key", () => {
    expect(parseSecondaryColour({ name: "x" })).toEqual({ ok: true, fields: {} });
    expect(parseSecondaryColour({ secondaryColor: undefined })).toEqual({ ok: true, fields: {} });
    expect(parseSecondaryColour(null)).toEqual({ ok: true, fields: {} });
  });

  it("None (null or empty) clears it", () => {
    expect(parseSecondaryColour({ secondaryColor: null })).toEqual({ ok: true, fields: { secondaryColor: null } });
    expect(parseSecondaryColour({ secondaryColor: "" })).toEqual({ ok: true, fields: { secondaryColor: null } });
  });

  it("accepts a 6-digit hex, stored lower case", () => {
    expect(parseSecondaryColour({ secondaryColor: "#FACC15" })).toEqual({ ok: true, fields: { secondaryColor: "#facc15" } });
  });

  it("refuses anything else", () => {
    for (const bad of ["red", "#fff", "#12345g", 42, "javascript:alert(1)"]) {
      expect(parseSecondaryColour({ secondaryColor: bad }).ok).toBe(false);
    }
  });
});
