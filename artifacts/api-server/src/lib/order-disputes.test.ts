import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isDisputeStatusOpen,
  openDisputeLabels,
  hasManualChargebackTag,
  decideDispatch,
  isDisputeListStale,
  isHeldForChargeback,
  orderIdFromGid,
  chargebackHoldMessage,
  DISPATCH_PATHS,
  DISPUTE_LIST_STALE_AFTER_MS,
  type DispatchGateInput,
  type DirectDisputeCheck,
} from "./order-disputes";

const NOW = new Date("2026-10-19T12:00:00Z");
const FRESH = new Date(NOW.getTime() - 5 * 60_000);
const STALE = new Date(NOW.getTime() - DISPUTE_LIST_STALE_AFTER_MS - 60_000);

describe("dispute status → open/closed", () => {
  it("needs_response and under_review are open, in any case", () => {
    expect(isDisputeStatusOpen("NEEDS_RESPONSE")).toBe(true);
    expect(isDisputeStatusOpen("under_review")).toBe(true);
    expect(isDisputeStatusOpen("UNDER_REVIEW")).toBe(true);
  });
  it("won, lost, accepted and charge_refunded are closed", () => {
    for (const s of ["WON", "LOST", "ACCEPTED", "CHARGE_REFUNDED", "won", "lost"]) {
      expect(isDisputeStatusOpen(s)).toBe(false);
    }
  });
  it("an unknown status holds the order (fail safe)", () => {
    expect(isDisputeStatusOpen("SOMETHING_NEW")).toBe(true);
  });
  it("no status is not a dispute", () => {
    expect(isDisputeStatusOpen("")).toBe(false);
    expect(isDisputeStatusOpen(null)).toBe(false);
  });
  it("labels only the open disputes, chargebacks and inquiries alike", () => {
    expect(openDisputeLabels([
      { status: "UNDER_REVIEW", initiatedAs: "CHARGEBACK" },
      { status: "LOST", initiatedAs: "CHARGEBACK" },
      { status: "NEEDS_RESPONSE", initiatedAs: "INQUIRY" },
    ])).toEqual(["chargeback:under_review", "inquiry:needs_response"]);
    expect(openDisputeLabels([])).toEqual([]);
    expect(openDisputeLabels(null)).toEqual([]);
  });
});

describe("manual hold tag", () => {
  it("matches chargeback / chargeback-hold / dispute in a Shopify tag string", () => {
    expect(hasManualChargebackTag("2026-10-20, dispatch, Chargeback")).toBe(true);
    expect(hasManualChargebackTag(["Small Box", "chargeback-hold"])).toBe(true);
    expect(hasManualChargebackTag("dispute")).toBe(true);
  });
  it("does not match lookalikes or empty tags", () => {
    expect(hasManualChargebackTag("2026-10-20, dispatch, Small Box")).toBe(false);
    expect(hasManualChargebackTag("no-chargeback-risk")).toBe(false);
    expect(hasManualChargebackTag(null)).toBe(false);
  });
});

describe("the gate decision", () => {
  const base: DispatchGateInput = { orderLabel: "#137000", listed: null, listFetchedAt: FRESH, now: NOW };

  it("allows an order with no dispute on a fresh list", () => {
    expect(decideDispatch(base)).toEqual({ allowed: true });
  });
  it("refuses a listed order, with a message that says do not send", () => {
    const d = decideDispatch({ ...base, listed: ["chargeback:under_review"] });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe("OPEN_CHARGEBACK");
      expect(d.message).toContain("do not send");
      expect(d.message).toContain("#137000");
    }
  });
  it("refuses on a manual tag even when Shopify shows nothing", () => {
    expect(decideDispatch({ ...base, tags: "dispatch, chargeback" }).allowed).toBe(false);
    expect(decideDispatch({ ...base, direct: { ok: true, openLabels: [], tags: ["chargeback"] } }).allowed).toBe(false);
  });
  it("a successful direct check wins over the list both ways", () => {
    expect(decideDispatch({ ...base, listed: null, direct: { ok: true, openLabels: ["chargeback:needs_response"], tags: [] } }).allowed).toBe(false);
    // Dispute closed since the last refresh → released.
    expect(decideDispatch({ ...base, listed: ["chargeback:under_review"], direct: { ok: true, openLabels: [], tags: [] } }).allowed).toBe(true);
  });
  it("Shopify unreachable: a KNOWN disputed order stays held", () => {
    expect(decideDispatch({ ...base, listFetchedAt: STALE, listed: ["chargeback:under_review"], direct: { ok: false, error: "502" } }).allowed).toBe(false);
  });
  it("Shopify unreachable: an order not known disputed is allowed, with a warning (packing doesn't stop)", () => {
    const d = decideDispatch({ ...base, listFetchedAt: STALE, direct: { ok: false, error: "502" } });
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.warning).toMatch(/Couldn't check Shopify/);
  });
  it("stale list with no direct answer: allowed with a warning", () => {
    const d = decideDispatch({ ...base, listFetchedAt: STALE });
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.warning).toMatch(/out of date/);
  });
});

describe("staleness + queue filter + helpers", () => {
  it("stale after 20 minutes, or never fetched", () => {
    expect(isDisputeListStale(FRESH, NOW)).toBe(false);
    expect(isDisputeListStale(STALE, NOW)).toBe(true);
    expect(isDisputeListStale(null, NOW)).toBe(true);
  });
  it("queue filter holds listed orders and manually tagged ones", () => {
    const open = new Set([1]);
    expect(isHeldForChargeback({ id: 1, tags: "" }, open)).toBe(true);
    expect(isHeldForChargeback({ id: 2, tags: "chargeback" }, open)).toBe(true);
    expect(isHeldForChargeback({ id: 3, tags: "dispatch" }, open)).toBe(false);
  });
  it("parses order gids", () => {
    expect(orderIdFromGid("gid://shopify/Order/13558714630518")).toBe(13558714630518);
    expect(orderIdFromGid("nope")).toBeNull();
  });
  it("manual-tag message says it's tagged", () => {
    expect(chargebackHoldMessage("#1", [], true)).toContain('tagged "chargeback"');
    expect(chargebackHoldMessage("#1", ["inquiry:needs_response"], false)).toContain("an inquiry (needs response)");
  });
});

// ── Regression: 19 Oct 2026 — an order with an open chargeback was sent ──
// for despatch. Every despatch path must refuse it, however it checks.
describe("REGRESSION: an order with an open dispute is refused at every despatch path", () => {
  /** What the gate is given for a path's mode in each situation. */
  function inputFor(mode: "live" | "list" | "listOnly", s: { listFresh: boolean; shopifyUp: boolean }): DispatchGateInput {
    const listFetchedAt = s.listFresh ? FRESH : STALE;
    const askShopify = mode === "live" || (mode === "list" && !s.listFresh);
    const direct: DirectDisputeCheck | undefined = askShopify
      ? (s.shopifyUp ? { ok: true, openLabels: ["chargeback:under_review"], tags: [] } : { ok: false, error: "Shopify down" })
      : undefined;
    // The order is on the stored list (it was disputed at the last refresh).
    return { orderLabel: "#136999", listed: ["chargeback:under_review"], listFetchedAt, now: NOW, direct };
  }

  for (const [path, mode] of Object.entries(DISPATCH_PATHS)) {
    for (const listFresh of [true, false]) {
      for (const shopifyUp of [true, false]) {
        it(`${path} (${mode}) — list ${listFresh ? "fresh" : "stale"}, Shopify ${shopifyUp ? "up" : "down"}`, () => {
          const d = decideDispatch(inputFor(mode, { listFresh, shopifyUp }));
          expect(d.allowed).toBe(false);
        });
      }
    }
  }

  it("a dispute opened since the last refresh is still caught where the path checks live", () => {
    for (const [path, mode] of Object.entries(DISPATCH_PATHS)) {
      if (mode !== "live") continue;
      const d = decideDispatch({
        orderLabel: path, listed: null, listFetchedAt: FRESH, now: NOW,
        direct: { ok: true, openLabels: ["chargeback:needs_response"], tags: [] },
      });
      expect(d.allowed).toBe(false);
    }
  });

  // Structural half: each listed route really calls the gate with its own key.
  const here = fileURLToPath(new URL(".", import.meta.url));
  const fulfilmentSrc = readFileSync(`${here}../routes/fulfilment.ts`, "utf8");
  const shopifySrc = readFileSync(`${here}../services/shopify.ts`, "utf8");

  function handlerBody(src: string, method: string, path: string): string | null {
    const start = src.indexOf(`router.${method.toLowerCase()}("${path}"`);
    if (start < 0) return null;
    const next = src.indexOf("\nrouter.", start + 1);
    return src.slice(start, next < 0 ? undefined : next);
  }

  for (const path of Object.keys(DISPATCH_PATHS)) {
    it(`${path} calls the chargeback gate with its own key`, () => {
      if (path === "shopify.fulfillOrder") {
        const fn = shopifySrc.slice(shopifySrc.indexOf("export async function fulfillOrder("));
        const body = fn.slice(0, fn.indexOf("\nexport "));
        expect(body).toContain(`DISPATCH_PATHS["shopify.fulfillOrder"]`);
        return;
      }
      const [method, route] = path.split(" ");
      const body = handlerBody(fulfilmentSrc, method, route);
      expect(body, `route ${path} not found in routes/fulfilment.ts`).not.toBeNull();
      expect(body).toContain(`"${path}"`);
    });
  }
});
