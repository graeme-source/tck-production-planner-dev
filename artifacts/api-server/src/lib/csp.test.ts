import { describe, it, expect } from "vitest";
import { CSP_DIRECTIVES } from "./csp";

describe("CSP_DIRECTIVES", () => {
  // Regression: without blob: in img-src every picked photo failed to load
  // in the browser before upload ("Couldn't read one of those photos").
  it("lets the browser load photos picked from the device (blob:)", () => {
    expect(CSP_DIRECTIVES.imgSrc).toContain("blob:");
    expect(CSP_DIRECTIVES.mediaSrc).toContain("blob:");
  });
  it("keeps scripts and the default locked to this site", () => {
    expect(CSP_DIRECTIVES.defaultSrc).toEqual(["'self'"]);
    expect(CSP_DIRECTIVES.scriptSrc).not.toContain("blob:");
    expect(CSP_DIRECTIVES.scriptSrc).not.toContain("https:");
  });
});
