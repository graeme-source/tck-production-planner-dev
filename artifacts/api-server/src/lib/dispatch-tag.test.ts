import { describe, it, expect } from "vitest";
import {
  isDispatchTagged,
  isCollectionOrder,
  isPartOfDespatchWave,
  needsDispatchApproval,
} from "./dispatch-tag";

describe("isDispatchTagged", () => {
  it("finds the tag among others", () => {
    expect(isDispatchTagged("2026-08-26, large box, dispatch")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isDispatchTagged("small box,  Dispatch ")).toBe(true);
    expect(isDispatchTagged("DISPATCH")).toBe(true);
  });

  it("matches whole tags only", () => {
    expect(isDispatchTagged("dispatched")).toBe(false);
    expect(isDispatchTagged("no-dispatch")).toBe(false);
    expect(isDispatchTagged("pre dispatch check")).toBe(false);
  });

  it("is false for an order with no tags", () => {
    expect(isDispatchTagged("")).toBe(false);
    expect(isDispatchTagged(null)).toBe(false);
    expect(isDispatchTagged(undefined)).toBe(false);
  });

  // Regression: an untagged order must never be treated as approved, because
  // that is what lets a courier label be raised before anyone signed the
  // order off for dispatch (Graeme, 2026-08-29).
  it("does not approve an order that is only box-tagged", () => {
    expect(isDispatchTagged("large box, wholesale")).toBe(false);
  });
});

// The exact tag string the website writes on a collection order, taken from
// live orders #133662 and #133833 (2026-09-03).
const REAL_COLLECTION = "2026-09-04, Collection, Collection Order, Small Box";

describe("isCollectionOrder", () => {
  it("recognises a real collection order from the website", () => {
    expect(isCollectionOrder(REAL_COLLECTION)).toBe(true);
  });

  it("accepts every form the website has used, whatever the case", () => {
    expect(isCollectionOrder("2026-09-04, collection")).toBe(true);
    expect(isCollectionOrder("2026-09-04, Collections")).toBe(true);
    expect(isCollectionOrder("2026-09-04, COLLECTION ORDER")).toBe(true);
  });

  it("matches whole tags only", () => {
    expect(isCollectionOrder("no-collection")).toBe(false);
    expect(isCollectionOrder("collections-team")).toBe(false);
    expect(isCollectionOrder("ready for collection soon")).toBe(false);
  });

  it("is false for an ordinary courier order", () => {
    expect(isCollectionOrder("2026-09-04, Small Box, dispatch")).toBe(false);
    expect(isCollectionOrder("")).toBe(false);
    expect(isCollectionOrder(null)).toBe(false);
  });
});

describe("collections are not part of the despatch wave", () => {
  // Regression (Graeme, 2026-09-03): two collection orders due for collection
  // on the 4th sat on the wave being packed on the 3rd — they share the date
  // tag but not the working day. The consignment screen reported them as
  // "2 orders aren't tagged for dispatch yet", which is a red error against
  // orders that must NEVER carry the dispatch tag.
  it("never chases a collection order for the dispatch tag", () => {
    expect(needsDispatchApproval(REAL_COLLECTION)).toBe(false);
    expect(isPartOfDespatchWave(REAL_COLLECTION)).toBe(false);
  });

  // The other half of the same rule: hiding collections must not quietly hide
  // a courier order that genuinely has not been approved yet, because an
  // untagged order never gets a label.
  it("still chases a genuinely untagged courier order", () => {
    expect(needsDispatchApproval("2026-09-04, Small Box")).toBe(true);
    expect(needsDispatchApproval("2026-09-04, Large Box, local-delivery")).toBe(true);
  });

  it("leaves an already-approved courier order alone", () => {
    expect(needsDispatchApproval("2026-09-04, Small Box, dispatch")).toBe(false);
    expect(isPartOfDespatchWave("2026-09-04, Small Box, dispatch")).toBe(true);
  });

  // A collection stays out of the chase even on the rare day someone has
  // hand-tagged it in Shopify.
  it("ignores a hand-added dispatch tag on a collection", () => {
    expect(isPartOfDespatchWave("2026-09-04, Collection, dispatch")).toBe(false);
  });
});
