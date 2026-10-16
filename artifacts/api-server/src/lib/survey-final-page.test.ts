import { describe, expect, it } from "vitest";
import type { CycleConfig } from "@workspace/marketing-calendar";
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

const offer = (id: number, name: string, featuresProduct = false) => ({
  id, code: `O${id}`, name, tag: null, colour: "green", featuresProduct, subjects: {},
});
const config: Pick<CycleConfig, "startDate" | "weeklyPlan" | "pauses" | "offers"> = {
  startDate: "2026-10-12",
  weeklyPlan: ["launch", null, "follow_up", "new_angle", "last_call", "free_slot", null],
  offers: [offer(1, "Free pack on orders over £39.95"), offer(2, "£5 off (Product)", true)],
  pauses: [{ id: 1, name: "Black Friday", startDate: "2026-11-01", endDate: "2026-12-04" }],
};

describe("currentOfferText — this week's offer, or nothing", () => {
  it("gives the week's offer wording", () => {
    expect(currentOfferText({ config, configured: true, today: "2026-10-15", weekProduct: null }))
      .toBe("Free pack on orders over £39.95");
  });

  it("fills the week's product", () => {
    expect(currentOfferText({ config, configured: true, today: "2026-10-21", weekProduct: "Chilli Beef" }))
      .toBe("£5 off Chilli Beef");
  });

  it("falls back to null when the offer needs a product and none is set", () => {
    expect(currentOfferText({ config, configured: true, today: "2026-10-21", weekProduct: null })).toBeNull();
  });

  it("falls back to null when the plan isn't set up, the week is paused, before the cycle, or there are no offers", () => {
    expect(currentOfferText({ config, configured: false, today: "2026-10-15", weekProduct: null })).toBeNull();
    expect(currentOfferText({ config, configured: true, today: "2026-11-10", weekProduct: null })).toBeNull();
    expect(currentOfferText({ config, configured: true, today: "2026-10-01", weekProduct: null })).toBeNull();
    expect(currentOfferText({ config: { ...config, offers: [] }, configured: true, today: "2026-10-15", weekProduct: null })).toBeNull();
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
