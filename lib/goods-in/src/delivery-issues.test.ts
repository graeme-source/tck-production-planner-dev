import { describe, expect, it } from "vitest";
import {
  MAX_ISSUE_PHOTOS, damageReportFor, deliveryIssueReportEmail, issueEmailToldText, issueLinesOf,
  issuePhotoGate, newIssueLines, photoConfirmationText, photoPromptText, photoSentenceFor,
  receivedAfterDamage, reopenDamagedLine, issueEmailStatusText,
  type DeliveryEmailIssue, type DeliveryIssueOutcome, type IssueLine,
} from "./delivery-issues";

describe("receivedAfterDamage — the quantity booked in", () => {
  it("kept damage changes nothing", () => {
    expect(receivedAfterDamage(8, { quantity: 2, disposition: "kept" })).toBe(8);
  });
  it("rejected damage comes off what arrived", () => {
    expect(receivedAfterDamage(8, { quantity: 2, disposition: "rejected" })).toBe(6);
    expect(receivedAfterDamage(2.5, { quantity: 0.5, disposition: "rejected" })).toBe(2);
  });
  it("never below 0, and no damage = what arrived", () => {
    expect(receivedAfterDamage(3, { quantity: 5, disposition: "rejected" })).toBe(0);
    expect(receivedAfterDamage(3, null)).toBe(3);
    expect(receivedAfterDamage(-1, null)).toBe(0);
  });
});

describe("damageReportFor — what the server records", () => {
  it("records kept and rejected damage with the note trimmed", () => {
    expect(damageReportFor({ quantityReceived: 8, damage: { quantity: 2, disposition: "kept", note: "  2 bags split " } }))
      .toEqual({ quantity: 2, disposition: "kept", note: "2 bags split" });
    expect(damageReportFor({ quantityReceived: 6, damage: { quantity: 2, disposition: "rejected" } }))
      .toEqual({ quantity: 2, disposition: "rejected", note: null });
  });
  it("a whole delivery rejected as damaged is still recorded (received 0)", () => {
    expect(damageReportFor({ quantityReceived: 0, damage: { quantity: 8, disposition: "rejected" } })!.quantity).toBe(8);
  });
  it("nothing to record: no damage, no quantity, or kept damage on nothing kept", () => {
    expect(damageReportFor({ quantityReceived: 8, damage: null })).toBeNull();
    expect(damageReportFor({ quantityReceived: 8, damage: { quantity: 0, disposition: "kept" } })).toBeNull();
    expect(damageReportFor({ quantityReceived: 0, damage: { quantity: 2, disposition: "kept" } })).toBeNull();
  });
  it("kept damage can't be more than was booked in", () => {
    expect(damageReportFor({ quantityReceived: 3, damage: { quantity: 5, disposition: "kept" } })!.quantity).toBe(3);
  });
});

describe("reopenDamagedLine — the box shows what arrived", () => {
  it("adds a rejected damaged quantity back on, so saving again doesn't take it off twice", () => {
    const r = reopenDamagedLine({ savedQuantity: 6, damage: { quantity: 2, disposition: "rejected" } });
    expect(r).toEqual({ arrived: 8, wasReceived: true });
    expect(receivedAfterDamage(r.arrived, { quantity: 2, disposition: "rejected" })).toBe(6);
  });
  it("all rejected as damaged reopens as received at what arrived", () => {
    expect(reopenDamagedLine({ savedQuantity: 0, damage: { quantity: 8, disposition: "rejected" } })).toEqual({ arrived: 8, wasReceived: true });
  });
  it("kept or no damage: the saved quantity", () => {
    expect(reopenDamagedLine({ savedQuantity: 8, damage: { quantity: 2, disposition: "kept" } })).toEqual({ arrived: 8, wasReceived: true });
    expect(reopenDamagedLine({ savedQuantity: 0, damage: null })).toEqual({ arrived: 0, wasReceived: false });
  });
});

describe("issueLinesOf / newIssueLines — which lines are issues", () => {
  const lines = [
    { lineId: 1, name: "Diced Chicken", shelfLife: "accepted" as const, shelfLifeQuantityText: "8 packs", damage: null },
    { lineId: 2, name: "Flour", shelfLife: null, damage: { quantity: 2, disposition: "rejected" as const }, damageQuantityText: "2 bags" },
    { lineId: 3, name: "Eggs", shelfLife: null, damage: null },
    { lineId: 4, name: "Milk", shelfLife: "rejected" as const, shelfLifeReported: true, damage: { quantity: 1, disposition: "kept" as const }, damageReported: false },
  ];
  it("short shelf life (accepted or rejected) and damaged lines are issues; a plain line isn't", () => {
    const issues = issueLinesOf(lines);
    expect(issues.map(i => `${i.lineId}:${i.kind}`)).toEqual(["1:short_shelf_life", "2:damaged", "4:short_shelf_life", "4:damaged"]);
  });
  it("only issues not reported before need the photo", () => {
    expect(newIssueLines(issueLinesOf(lines)).map(i => `${i.lineId}:${i.kind}`)).toEqual(["1:short_shelf_life", "2:damaged", "4:damaged"]);
  });
  it("damage of 0 isn't an issue", () => {
    expect(issueLinesOf([{ lineId: 9, name: "X", shelfLife: null, damage: { quantity: 0, disposition: "kept" } }])).toEqual([]);
  });
});

describe("photo prompt and confirmation — every item, counted", () => {
  const chicken: IssueLine = { lineId: 1, kind: "short_shelf_life", name: "Diced Chicken", quantityText: "8 packs", alreadyReported: false };
  const flour: IssueLine = { lineId: 2, kind: "damaged", name: "Flour", quantityText: "2 bags", alreadyReported: false };

  it("states the count (Graeme's 8 packs of chicken)", () => {
    expect(photoPromptText([chicken])).toBe(
      `Lay out all 8 packs of Diced Chicken so every use-by date can be read, then take the photo. Add more photos if they don't all fit in one (up to ${MAX_ISSUE_PHOTOS}).`,
    );
    expect(photoConfirmationText([chicken])).toBe("All 8 packs of Diced Chicken are in the photo(s) with their use-by dates showing.");
  });
  it("damaged items", () => {
    expect(photoPromptText([flour])).toMatch(/^Lay out all 2 bags of Flour so all the damage can be seen/);
    expect(photoConfirmationText([flour])).toBe("All 2 damaged bags of Flour are in the photo(s), with the damage showing.");
  });
  it("both kinds", () => {
    expect(photoPromptText([chicken, flour])).toMatch(/^Lay out all 8 packs of Diced Chicken and 2 bags of Flour so every use-by date and all the damage can be seen/);
    expect(photoConfirmationText([chicken, flour])).toBe(
      "All 8 packs of Diced Chicken (use-by dates showing) and 2 damaged bags of Flour (damage showing) are in the photo(s).",
    );
  });
});

describe("issuePhotoGate — mandatory photo, no way round it", () => {
  it("nothing new to report: no photo needed (a re-save of reported issues)", () => {
    expect(issuePhotoGate({ newIssueCount: 0, uploadedPhotoCount: 0, allItemsConfirmed: false })).toEqual({ required: false, ok: true, message: null });
  });
  it("an issue with no uploaded photo can't be saved", () => {
    const g = issuePhotoGate({ newIssueCount: 1, uploadedPhotoCount: 0, allItemsConfirmed: true });
    expect(g.ok).toBe(false);
    expect(g.message).toBe("Take a photo of the affected items to finish receiving this delivery.");
  });
  it("needs the 'all items are in the photo(s)' tick", () => {
    expect(issuePhotoGate({ newIssueCount: 2, uploadedPhotoCount: 1, allItemsConfirmed: false }).ok).toBe(false);
    expect(issuePhotoGate({ newIssueCount: 2, uploadedPhotoCount: 1, allItemsConfirmed: true }).ok).toBe(true);
  });
  it(`up to ${MAX_ISSUE_PHOTOS} photos`, () => {
    expect(issuePhotoGate({ newIssueCount: 1, uploadedPhotoCount: MAX_ISSUE_PHOTOS, allItemsConfirmed: true }).ok).toBe(true);
    expect(issuePhotoGate({ newIssueCount: 1, uploadedPhotoCount: MAX_ISSUE_PHOTOS + 1, allItemsConfirmed: true }).ok).toBe(false);
  });
});

describe("deliveryIssueReportEmail — one email per receive", () => {
  const shortChicken: DeliveryEmailIssue = {
    kind: "short_shelf_life", productName: "Diced Chicken Breast", quantityText: "8 packs",
    useByDate: "2026-10-17", days: 1, minDays: 3, decision: "accepted",
  };
  const damagedFlour: DeliveryEmailIssue = {
    kind: "damaged", productName: "Flour", quantityText: "2 bags", note: "2 bags split", disposition: "rejected",
  };
  const base = {
    supplierName: "Brakes", recipientName: "Pat Example", orderNumber: 1234, deliveryDate: "2026-10-16",
    receivedByName: "Sam", photoCount: 1,
  };

  it("one short-dated line: every fact the supplier needs, and the photo", () => {
    const e = deliveryIssueReportEmail({ ...base, issues: [shortChicken] });
    expect(e.subject).toBe("Short shelf life on delivery — Diced Chicken Breast — Fri 16 Oct (our order #1234)");
    for (const s of [
      "Dear Pat,", "Supplier: Brakes", "Our order number: #1234", "Delivery date: Fri 16 Oct 2026", "Checked in by: Sam",
      "Diced Chicken Breast — short shelf life", "Quantity: 8 packs", "Use-by date received: Sat 17 Oct 2026",
      "Shelf life on arrival: 1 day", "Minimum shelf life agreed: 3 days", "What we did: Accepted (to be used or frozen before the use-by date)",
      "Photo attached showing all 8 packs of Diced Chicken Breast and their use-by dates.", "The Calzone Kitchen",
    ]) expect(e.text).toContain(s);
    expect(e.html).toContain("Diced Chicken Breast");
  });

  it("every issue line in ONE email — short-dated and damaged together", () => {
    const e = deliveryIssueReportEmail({ ...base, photoCount: 2, issues: [shortChicken, { ...shortChicken, productName: "Eggs", decision: "rejected" }, damagedFlour] });
    expect(e.subject).toBe("Problems with our delivery — 3 items — Fri 16 Oct (our order #1234)");
    expect(e.text).toContain("Eggs — short shelf life");
    expect(e.text).toContain("What we did: Rejected — not received into our stock");
    expect(e.text).toContain("Flour — damaged / broken");
    expect(e.text).toContain("Quantity damaged: 2 bags");
    expect(e.text).toContain("Damage: 2 bags split");
    expect(e.text).toContain("2 photos attached showing all 8 packs of Diced Chicken Breast, 8 packs of Eggs and 2 bags of Flour and their use-by dates and the damage.");
  });

  it("damaged only", () => {
    const e = deliveryIssueReportEmail({ ...base, issues: [{ ...damagedFlour, disposition: "kept", note: null }] });
    expect(e.subject).toBe("Damaged on delivery — Flour — Fri 16 Oct (our order #1234)");
    expect(e.text).toContain("What we did: Kept (we'll use what we can)");
    expect(e.text).not.toContain("Damage:");
    expect(e.text).not.toContain("shelf life agreed");
  });

  it("greets politely without a name, and never leaks HTML", () => {
    const e = deliveryIssueReportEmail({ ...base, recipientName: null, issues: [{ ...damagedFlour, productName: "Fish & <Chips>", note: "<b>split</b>" }] });
    expect(e.text.startsWith("Hello,")).toBe(true);
    expect(e.html).toContain("Fish &amp; &lt;Chips&gt;");
    expect(e.html).not.toContain("<Chips>");
    expect(e.html).not.toContain("<b>split</b>");
  });

  describe("account number and product codes (Graeme, 21 Oct 2026)", () => {
    const coded: DeliveryEmailIssue = { ...shortChicken, productName: "British Red Tractor Diced Chicken Breast", productCode: "70946" };

    it("account number near the top, product code on the line, in text and HTML", () => {
      const e = deliveryIssueReportEmail({ ...base, accountNumber: "1867332", issues: [coded] });
      const lines = e.text.split("\n");
      // First fact after the intro.
      expect(lines[4]).toBe("Account number: 1867332");
      expect(e.text).toContain("British Red Tractor Diced Chicken Breast — short shelf life\n  Product code: 70946\n  Quantity: 8 packs");
      expect(e.html).toContain("Account number</td><td style=\"padding:4px 0;font-weight:600;\">1867332");
      expect(e.html).toContain("Product code</td><td style=\"padding:4px 0;font-weight:600;\">70946");
      // The one-product subject already names it, so it carries the code.
      expect(e.subject).toBe("Short shelf life on delivery — British Red Tractor Diced Chicken Breast (code 70946) — Fri 16 Oct (our order #1234)");
    });

    it("no account number, no code: those lines are left out — never 'null'", () => {
      for (const accountNumber of [null, undefined, "", "   "]) {
        const e = deliveryIssueReportEmail({ ...base, accountNumber, issues: [{ ...shortChicken, productCode: accountNumber }] });
        expect(e.text).not.toContain("Account number");
        expect(e.text).not.toContain("Product code");
        expect(e.html).not.toContain("Account number");
        expect(e.html).not.toContain("Product code");
        expect(e.text).not.toContain("null");
        expect(e.subject).toBe("Short shelf life on delivery — Diced Chicken Breast — Fri 16 Oct (our order #1234)");
      }
    });

    it("several lines: each carries its own code (odd formats kept as stored); the subject doesn't list products", () => {
      const e = deliveryIssueReportEmail({
        ...base, accountNumber: " 1867332 ", photoCount: 2,
        issues: [
          coded,
          { ...shortChicken, productName: "Diced Chicken Thigh", productCode: null },
          { ...damagedFlour, productCode: "A 125111" },
        ],
      });
      expect(e.text).toContain("Account number: 1867332");
      expect(e.text).toContain("British Red Tractor Diced Chicken Breast — short shelf life\n  Product code: 70946");
      expect(e.text).toContain("Diced Chicken Thigh — short shelf life\n  Quantity: 8 packs");
      expect(e.text).toContain("Flour — damaged / broken\n  Product code: A 125111\n  Quantity damaged: 2 bags");
      expect(e.text.match(/Product code:/g)).toHaveLength(2);
      expect(e.subject).toBe("Problems with our delivery — 3 items — Fri 16 Oct (our order #1234)");
    });

    it("codes are HTML-escaped", () => {
      const e = deliveryIssueReportEmail({ ...base, accountNumber: "<1>", issues: [{ ...damagedFlour, productCode: "F&150200" }] });
      expect(e.html).toContain("&lt;1&gt;");
      expect(e.html).toContain("F&amp;150200");
    });
  });

  it("photo sentence counts the photos", () => {
    expect(photoSentenceFor([shortChicken], 3)).toBe("3 photos attached showing all 8 packs of Diced Chicken Breast and their use-by dates.");
    expect(photoSentenceFor([damagedFlour], 1)).toBe("Photo attached showing all 2 bags of Flour and the damage.");
  });
});

describe("issueEmailToldText — what the receiver sees", () => {
  const o: DeliveryIssueOutcome = {
    supplierName: "Brakes", recipientName: "Pat Example",
    reported: [{ lineId: 1, kind: "short_shelf_life", ingredientName: "Diced Chicken" }, { lineId: 2, kind: "damaged", ingredientName: "Flour" }],
    alreadyReported: 0, emailStatus: "sent", emailError: null, photoCount: 2,
  };
  it("names who was emailed — never the address", () => {
    expect(issueEmailToldText(o)).toEqual({ ok: true, text: "Emailed Pat Example at Brakes with 2 photos about the Diced Chicken and Flour." });
    expect(issueEmailToldText({ ...o, recipientName: null, photoCount: 1 })!.text).toBe("Emailed Brakes with the photo about the Diced Chicken and Flour.");
  });
  it("says plainly when nobody was told", () => {
    expect(issueEmailToldText({ ...o, emailStatus: "no_address" })!.ok).toBe(false);
    expect(issueEmailToldText({ ...o, emailStatus: "failed", emailError: "timeout" })!.text).toMatch(/^Couldn't email Pat Example at Brakes about the Diced Chicken and Flour \(timeout\)/);
    expect(issueEmailToldText({ ...o, emailStatus: "skipped" })!.ok).toBe(false);
  });
  it("nothing new reported: nothing to say", () => {
    expect(issueEmailToldText({ ...o, reported: [], emailStatus: null, alreadyReported: 2 })).toBeNull();
  });
  it("status text for a reopened delivery", () => {
    expect(issueEmailStatusText({ emailStatus: "sent", emailError: null, emailedToName: "James Clarke" }, "Brakes")).toEqual({ ok: true, text: "Emailed James Clarke at Brakes." });
    expect(issueEmailStatusText({ emailStatus: "failed", emailError: "x", emailedToName: null }, "Brakes").ok).toBe(false);
  });
});
