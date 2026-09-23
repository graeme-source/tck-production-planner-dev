import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { BIG_BODY_JSON_ROUTES } from "./big-body-routes";

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "routes");

describe("BIG_BODY_JSON_ROUTES", () => {
  it("keeps the recipe-designer chat limit that once shipped as dead router-level code", () => {
    expect(BIG_BODY_JSON_ROUTES["/api/recipe-designer/chat"]).toBe("30mb");
  });

  it("keeps the label-photo scrape limit", () => {
    expect(BIG_BODY_JSON_ROUTES["/api/ingredients/scrape-photo"]).toBe("10mb");
  });

  it("uses absolute /api/ paths (they are matched at app level, before the router)", () => {
    for (const path of Object.keys(BIG_BODY_JSON_ROUTES)) {
      expect(path, `${path} must start with /api/`).toMatch(/^\/api\//);
    }
  });
});

describe("no body parsers inside route files", () => {
  // Regression guard for a bug that shipped: recipe-designer.ts attached
  // express.json({ limit: "30mb" }) to its /chat route, but the app-level
  // express.json({ limit: "1mb" }) parser runs first and consumes (or 413s)
  // the body, so the router-level parser was dead code and real >1 MB image
  // attachments failed. A bigger limit only works mounted path-scoped in
  // app.ts BEFORE the global parser — that is what lib/big-body-routes.ts
  // is for. This test fails the build if anyone reintroduces the trap.
  it("no file under src/routes/ calls express.json/text/urlencoded/raw", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        const src = readFileSync(full, "utf8");
        if (/express\.(json|text|urlencoded|raw)\s*\(/.test(src)) {
          offenders.push(entry.name);
        }
      }
    };
    walk(ROUTES_DIR);
    expect(
      offenders,
      `Router-level body parsers are dead code — the app-level parser runs first. ` +
      `Add the path to lib/big-body-routes.ts instead. Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
