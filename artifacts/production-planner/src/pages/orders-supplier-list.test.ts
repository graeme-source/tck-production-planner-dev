import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Split dropdown was empty (Graeme, 2026-11-04): it was given a supplier
// list that only loaded while the kanban search was open.
describe("Orders page supplier list", () => {
  const page = readFileSync(new URL("./orders.tsx", import.meta.url), "utf8");

  it("loads one list, not gated on the kanban search", () => {
    expect(page.match(/fetch\(`\$\{BASE\}\/api\/suppliers`/g)).toHaveLength(1);
    expect(page).toContain("const allSuppliers = pickerSuppliers;");
  });

  it("gives that list to the Split dialog", () => {
    expect(page).toMatch(/<OrderSplitDialog[\s\S]*?suppliers=\{allSuppliers\}/);
  });
});
