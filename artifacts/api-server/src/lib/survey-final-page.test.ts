import { describe, expect, it } from "vitest";
import { FINAL_LINK_PRESETS, currentOfferText, normaliseFinalLink, publicFinalPage, type FinalPageRow } from "./survey-final-page";

describe("normaliseFinalLink — only our shop", () => {
  it("accepts the presets as they are", () => {
    expect(normaliseFinalLink(FINAL_LINK_PRESETS.home.url)).toBe("https://thecalzonekitchen.co.uk/");
    expect(normaliseFinalLink(FINAL_LINK_PRESETS.menu.url)).toBe("https://thecalzonekitchen.co.uk/pages/menu");
  });

  it("accepts any https/http page on the shop and upgrades http to https", () => {
    expect(normaliseFinalLink("https://thecalzonekitchen.co.uk/collections/all?x=1")).toBe("https://thecalzonekitchen.co.uk/collections/all?x=1");
    expect(normaliseFinalLink("http://www.thecalzonekitchen.co.uk/products/start-order")).toBe("https://www.thecalzonekitchen.co.uk/products/start-order");
    expect(normaliseFinalLink("  HTTPS://TheCalzoneKitchen.co.uk/pages/menu ")).toBe("https://thecalzonekitchen.co.uk/pages/menu");
  });

  it("refuses other sites, look-alikes and tricks", () => {
    for (const bad of [
      "https://evil.example/", "https://thecalzonekitchen.co.uk.evil.example/", "https://evilthecalzonekitchen.co.uk/",
      "https://shop.thecalzonekitchen.co.uk/", "https://thecalzonekitchen.co.uk@evil.example/",
      "https://user:pass@thecalzonekitchen.co.uk/", "https://thecalzonekitchen.co.uk:8443/",
      "javascript:alert(1)", "//thecalzonekitchen.co.uk/", "/pages/menu", "mailto:x@thecalzonekitchen.co.uk",
      "ftp://thecalzonekitchen.co.uk/", "data:text/html,hi", "", "   ",
    ]) {
      expect(normaliseFinalLink(bad), bad).toBeNull();
    }
    expect(normaliseFinalLink(null)).toBeNull();
  });
});

const phases = [
  { startDate: "2026-10-12", endDate: "2026-10-18", offers: ["Free pack on orders over £39.95"], customerGroup: "all" },
  { startDate: "2026-10-19", endDate: "2026-10-25", offers: ["£5 off (Product)", "Free gravy pot"], customerGroup: "all" },
  { startDate: "2026-10-15", endDate: "2026-10-15", offers: ["New customers 20% off"], customerGroup: "new" },
];

describe("currentOfferText — today's offer from the calendar's phases, or nothing", () => {
  it("gives the offers running today for everyone", () => {
    expect(currentOfferText({ phases, today: "2026-10-15" })).toBe("Free pack on orders over £39.95");
    expect(currentOfferText({ phases, today: "2026-10-21" })).toBe("Free gravy pot");
  });

  it("is null when nothing runs today, or only a (Product) placeholder would show", () => {
    expect(currentOfferText({ phases, today: "2026-11-10" })).toBeNull();
    expect(currentOfferText({ phases: [{ ...phases[1], offers: ["£5 off (Product)"] }], today: "2026-10-21" })).toBeNull();
    expect(currentOfferText({ phases: [], today: "2026-10-15" })).toBeNull();
  });
});

describe("publicFinalPage", () => {
  const row: FinalPageRow = {
    finalPageEnabled: true,
    finalHeading: " Need a top up? ",
    finalHtml: "<p>Thanks!</p><script>alert(1)</script>",
    finalButtonLabel: "Order now",
    finalButtonUrl: "https://thecalzonekitchen.co.uk/pages/menu",
    finalShowOffer: true,
  };

  it("is null when switched off — the survey ends as before", () => {
    expect(publicFinalPage({ ...row, finalPageEnabled: false }, "Offer")).toBeNull();
  });

  it("sends a sanitised body, the checked button and the offer", () => {
    expect(publicFinalPage(row, "Free pack")).toEqual({
      heading: "Need a top up?",
      html: "<p>Thanks!</p>",
      button: { label: "Order now", url: "https://thecalzonekitchen.co.uk/pages/menu" },
      offer: "Free pack",
    });
  });

  it("drops a button whose link isn't on our shop, or has no label", () => {
    expect(publicFinalPage({ ...row, finalButtonUrl: "https://evil.example/" }, null)!.button).toBeNull();
    expect(publicFinalPage({ ...row, finalButtonLabel: "  " }, null)!.button).toBeNull();
  });

  it("leaves the offer out when not chosen or when there is none", () => {
    expect(publicFinalPage({ ...row, finalShowOffer: false }, "Free pack")!.offer).toBeNull();
    expect(publicFinalPage(row, null)!.offer).toBeNull();
  });
});
