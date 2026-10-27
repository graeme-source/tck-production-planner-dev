import { describe, expect, it } from "vitest";
import { countSync, decidePush, decideSync, stateFor, MANAGED_BY_HAND } from "./index";

const A = "5065018206054";
const B = "5065018206207";
const live = (barcode: string | null, status = "active") => ({ barcode, status });

describe("push: app → Shopify", () => {
  it("sends when Shopify is blank", () => {
    expect(decidePush({ ours: A, shopify: live(null), clubSpecial: false }).outcome).toBe("send");
  });
  it("sends when Shopify holds the number we had before (a change made in the app)", () => {
    expect(decidePush({ ours: B, shopify: live(A), clubSpecial: false, replaceable: [A] }).outcome).toBe("send");
  });
  it("nothing to send when Shopify already has it (UPC vs EAN padding ignored)", () => {
    expect(decidePush({ ours: A, shopify: live(` ${A}`), clubSpecial: false }).outcome).toBe("already");
    expect(decidePush({ ours: "036000291452", shopify: live("0036000291452"), clubSpecial: false }).outcome).toBe("already");
  });
  it("conflict: Shopify has a different number that isn't ours — never overwritten automatically", () => {
    const d = decidePush({ ours: B, shopify: live(A), clubSpecial: false, replaceable: [null] });
    expect(d.outcome).toBe("conflict");
    expect(d.reason).toContain(A);
  });
  it("'Send ours to Shopify' (force) replaces a different number", () => {
    expect(decidePush({ ours: B, shopify: live(A), clubSpecial: false, force: true }).outcome).toBe("send");
  });
  it("never writes to an archived product; drafts are fine", () => {
    expect(decidePush({ ours: A, shopify: live(null, "ARCHIVED"), clubSpecial: false, force: true }).outcome).toBe("skip-archived");
    expect(decidePush({ ours: A, shopify: live(null, "draft"), clubSpecial: false }).outcome).toBe("send");
  });
  it("never writes to the Calzone Club Special, even forced", () => {
    const d = decidePush({ ours: A, shopify: live(null), clubSpecial: true, force: true });
    expect(d).toEqual({ outcome: "skip-club-special", reason: MANAGED_BY_HAND });
  });
  it("never blanks Shopify's barcode", () => {
    expect(decidePush({ ours: null, shopify: live(A), clubSpecial: false, force: true }).outcome).toBe("nothing");
  });
  it("blocked writes → waiting to send (the save itself is unaffected)", () => {
    const d = decidePush({ ours: A, shopify: live(null), clubSpecial: false, blocked: "Shopify writes are switched off on this server" });
    expect(d).toEqual({ outcome: "waiting", reason: "Shopify writes are switched off on this server" });
    // A disagreement is still a disagreement while blocked.
    expect(decidePush({ ours: B, shopify: live(A), clubSpecial: false, blocked: "x" }).outcome).toBe("conflict");
  });
  it("gone from Shopify", () => {
    expect(decidePush({ ours: A, shopify: null, clubSpecial: false }).outcome).toBe("not-in-shopify");
  });
  it("stored state per outcome", () => {
    expect(stateFor("send")).toBe("sending");
    expect(stateFor("already")).toBe("sent");
    expect(stateFor("waiting")).toBe("waiting");
    expect(stateFor("conflict")).toBe("conflict");
    expect(stateFor("skip-archived")).toBe("skipped");
    expect(stateFor("nothing")).toBeNull();
  });
});

describe("preview / bulk sync of existing differences", () => {
  const base = { clubSpecial: false, appOwned: true, current: true };
  it("overwrite, fill, adopt, same", () => {
    expect(decideSync({ ...base, ours: B, shopify: live(A) }).action).toBe("overwrite");
    expect(decideSync({ ...base, ours: A, shopify: live(null) }).action).toBe("fill");
    expect(decideSync({ ...base, ours: null, shopify: live(A) }).action).toBe("adopt");
    expect(decideSync({ ...base, ours: A, shopify: live(A) }).action).toBe("same");
  });
  it("skips the Club Special, archived products, retired products and gone variants", () => {
    expect(decideSync({ ...base, clubSpecial: true, ours: B, shopify: live(A) })).toEqual({ action: "skip", reason: MANAGED_BY_HAND });
    expect(decideSync({ ...base, ours: B, shopify: live(A, "archived") }).action).toBe("skip");
    expect(decideSync({ ...base, current: false, ours: null, shopify: live(A) }).action).toBe("skip");
    expect(decideSync({ ...base, ours: A, shopify: null }).action).toBe("skip");
  });
  it("never adopts back a code a person moved away, or another product's code", () => {
    expect(decideSync({ ...base, ours: null, shopify: live(A), clearedByPerson: true }).action).toBe("skip");
    expect(decideSync({ ...base, ours: null, shopify: live(A), heldElsewhere: true }).action).toBe("skip");
  });
  it("a listing that follows Shopify is never pushed", () => {
    expect(decideSync({ ...base, appOwned: false, ours: B, shopify: live(A) }).action).toBe("skip");
  });
  it("counts", () => {
    expect(countSync(["overwrite", "fill", "fill", "adopt", "skip"])).toEqual({ overwrite: 1, fill: 2, adopt: 1, same: 0, skip: 1 });
  });
});
