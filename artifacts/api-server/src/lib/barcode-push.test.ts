import { describe, expect, it } from "vitest";
import { pushBarcodes, type LiveVariant, type PushLog, type PushRecord, type ShopifyBarcodePort } from "./barcode-push";

// A fake Shopify store and a fake database — no network, no DB.
function fakes(store: Record<string, LiveVariant>, opts: { blocked?: string | null; writeError?: Error } = {}) {
  const writes: Array<{ productId: string; variants: Array<{ variantId: string; barcode: string }> }> = [];
  const records: PushRecord[] = [];
  const logs: PushLog[] = [];
  const port: ShopifyBarcodePort = {
    async read(ids) { return new Map(ids.filter(id => store[id]).map(id => [id, store[id]])); },
    async blockedReason() { return opts.blocked ?? null; },
    async write(productId, variants) {
      if (opts.writeError) throw opts.writeError;
      writes.push({ productId, variants });
    },
  };
  const sink = { async record(r: PushRecord) { records.push(r); }, async log(e: PushLog) { logs.push(e); } };
  return { port, sink, writes, records, logs };
}

const v = (productId: string, barcode: string | null, status = "active"): LiveVariant => ({ productId, barcode, status, productTitle: "P", variantTitle: "V" });
const A = "5065018206054";
const B = "5065018206207";

describe("pushBarcodes (the one Shopify barcode writer)", () => {
  it("sends to blank and previously-ours variants, one call per product, and records 'sent'", async () => {
    const f = fakes({ "1": v("10", null), "2": v("10", A), "3": v("20", null, "draft") });
    const r = await pushBarcodes([
      { variantId: "1", ours: B, replaceable: [], clubSpecial: false },
      { variantId: "2", ours: B, replaceable: [A], clubSpecial: false },
      { variantId: "3", ours: B, replaceable: [], clubSpecial: false },
    ], f.port, f.sink);
    expect(f.writes).toEqual([
      { productId: "10", variants: [{ variantId: "1", barcode: B }, { variantId: "2", barcode: B }] },
      { productId: "20", variants: [{ variantId: "3", barcode: B }] },
    ]);
    expect(r.map(x => x.outcome)).toEqual(["send", "send", "send"]);
    expect(f.records.every(x => x.state === "sent" && x.live?.barcode === B)).toBe(true);
    expect(f.logs.find(l => l.variantId === "2")).toMatchObject({ from: A, to: B, result: "ok" });
  });

  it("never overwrites a different number Shopify holds — records a disagreement", async () => {
    const f = fakes({ "1": v("10", A) });
    const [r] = await pushBarcodes([{ variantId: "1", ours: B, replaceable: [null], clubSpecial: false }], f.port, f.sink);
    expect(r.outcome).toBe("conflict");
    expect(f.writes).toEqual([]);
    expect(f.records[0]).toMatchObject({ state: "conflict", from: A, barcode: B });
  });

  it("skips archived products and the Club Special, even when forced", async () => {
    const f = fakes({ "1": v("10", null, "archived"), "2": v("11", A) });
    const r = await pushBarcodes([
      { variantId: "1", ours: B, replaceable: [], clubSpecial: false, force: true },
      { variantId: "2", ours: B, replaceable: [], clubSpecial: true, force: true },
    ], f.port, f.sink);
    expect(r.map(x => x.outcome)).toEqual(["skip-archived", "skip-club-special"]);
    expect(f.writes).toEqual([]);
    expect(f.records.map(x => x.state)).toEqual(["skipped", "skipped"]);
    expect(f.records[1].message).toBe("Managed by hand in Shopify");
  });

  it("writes blocked → waiting to send, nothing written", async () => {
    const f = fakes({ "1": v("10", null) }, { blocked: "Shopify writes are switched off on this server" });
    const [r] = await pushBarcodes([{ variantId: "1", ours: A, replaceable: [], clubSpecial: false }], f.port, f.sink);
    expect(r.outcome).toBe("waiting");
    expect(f.writes).toEqual([]);
    expect(f.records[0]).toMatchObject({ state: "waiting", barcode: A, message: "Shopify writes are switched off on this server" });
    expect(f.logs[0]).toMatchObject({ result: "waiting", to: A });
  });

  it("the guard's own refusal at write time is also 'waiting', not a failure", async () => {
    const blockedErr = Object.assign(new Error("Shopify writes are switched off"), { code: "SHOPIFY_WRITES_BLOCKED" });
    const f = fakes({ "1": v("10", null) }, { writeError: blockedErr });
    const [r] = await pushBarcodes([{ variantId: "1", ours: A, replaceable: [], clubSpecial: false }], f.port, f.sink);
    expect(r.outcome).toBe("waiting");
    expect(f.records[0].state).toBe("waiting");
  });

  it("a Shopify error is recorded as 'failed' with the reason (never thrown at the save)", async () => {
    const f = fakes({ "1": v("10", null) }, { writeError: new Error("Barcode is invalid") });
    const [r] = await pushBarcodes([{ variantId: "1", ours: A, replaceable: [], clubSpecial: false }], f.port, f.sink);
    expect(r.outcome).toBe("failed");
    expect(f.records[0]).toMatchObject({ state: "failed" });
    expect(f.records[0].message).toContain("Barcode is invalid");
  });

  it("nothing to send when Shopify already has it, or we have none (never blanks Shopify)", async () => {
    const f = fakes({ "1": v("10", A), "2": v("10", A) });
    const r = await pushBarcodes([
      { variantId: "1", ours: A, replaceable: [], clubSpecial: false },
      { variantId: "2", ours: null, replaceable: [], clubSpecial: false, force: true },
    ], f.port, f.sink);
    expect(r.map(x => x.outcome)).toEqual(["already", "nothing"]);
    expect(f.writes).toEqual([]);
    expect(f.logs).toEqual([]);
    expect(f.records.map(x => x.state)).toEqual(["sent"]);
  });
});
