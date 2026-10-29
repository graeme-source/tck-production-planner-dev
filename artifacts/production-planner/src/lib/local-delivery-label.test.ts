import { describe, expect, it } from "vitest";
import { clampBoxes, localDeliveryBoxLabels, localDeliveryLabelHtml } from "./local-delivery-label";

const order = {
  name: "#136900",
  customer: { first_name: "Sam", last_name: "Jones" },
  shipping_address: { name: "Sam Jones", address1: "1 High Street", address2: "", city: "Mersley", zip: "AB1 2CD" },
};

describe("localDeliveryBoxLabels", () => {
  it("one label per box, numbered 1 of N to N of N", () => {
    const labels = localDeliveryBoxLabels(order, 2);
    expect(labels.map(l => `${l.box} of ${l.boxes}`)).toEqual(["1 of 2", "2 of 2"]);
    expect(labels[0]).toMatchObject({ orderName: "#136900", recipient: "Sam Jones", addressLines: ["1 High Street", "Mersley", "AB1 2CD"] });
  });

  it("falls back to the customer's name when the address has none", () => {
    expect(localDeliveryBoxLabels({ ...order, shipping_address: null }, 1)[0]).toMatchObject({ recipient: "Sam Jones", addressLines: [] });
  });

  it("never prints zero, a fraction, or a runaway number of boxes", () => {
    expect(clampBoxes(0)).toBe(1);
    expect(clampBoxes(2.4)).toBe(2);
    expect(clampBoxes(500)).toBe(20);
    expect(clampBoxes(Number.NaN)).toBe(1);
  });
});

describe("localDeliveryLabelHtml", () => {
  it("prints a page per box and escapes what the customer typed", () => {
    const html = localDeliveryLabelHtml(localDeliveryBoxLabels({ ...order, shipping_address: { ...order.shipping_address, name: "<b>Sam</b>" } }, 3));
    expect(html.match(/class="label"/g)).toHaveLength(3);
    expect(html).toContain("BOX 3 OF 3");
    expect(html).toContain("&lt;b&gt;Sam&lt;/b&gt;");
    expect(html).not.toContain("<b>Sam</b>");
  });
});
