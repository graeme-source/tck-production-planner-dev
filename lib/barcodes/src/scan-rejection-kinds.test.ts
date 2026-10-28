import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCAN_REJECTION_KINDS } from "./scan";

// Regression (28 Oct 2026): "typed-not-scanned" was added to the scan box and
// the API but not to the table's CHECK constraint, so those refusals never
// saved. The newest migration that sets the constraint must allow every kind.
describe("packing scan rejection kinds", () => {
  it("the database constraint allows every kind the scan box can log", () => {
    const dir = join(__dirname, "../../db/migrations");
    const latest = readdirSync(dir).filter(f => f.endsWith(".sql")).sort()
      .map(f => readFileSync(join(dir, f), "utf8"))
      .filter(sql => /ADD\s+CONSTRAINT\s+packing_scan_rejections_kind|CONSTRAINT\s+packing_scan_rejections_kind\s+CHECK/i.test(sql))
      .at(-1)!;
    const allowed = [...latest.matchAll(/packing_scan_rejections_kind[\s\S]*?CHECK\s*\(kind IN \(([^)]*)\)/gi)].at(-1)![1];
    for (const kind of SCAN_REJECTION_KINDS) expect(allowed).toContain(`'${kind}'`);
  });
});
