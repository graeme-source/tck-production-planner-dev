import { describe, expect, it } from "vitest";
import { headedParagraphsDocument, ingredientDeckDocument, mdBoldToRichRuns, richTextToPlain } from "./shopify-rich-text";

describe("Shopify rich text", () => {
  it("bolds the **allergen** segments of a deck", () => {
    expect(mdBoldToRichRuns("Flour (**Wheat**), Water")).toEqual([
      { type: "text", value: "Flour (" },
      { type: "text", value: "Wheat", bold: true },
      { type: "text", value: "), Water" },
    ]);
  });

  it("builds the deck document: deck, allergen statement with may-contain, disclaimer", () => {
    const doc = ingredientDeckDocument({ deckText: "**Milk**", mayContainStatement: "May contain nuts", disclaimer: "Check the pack." });
    expect(doc.children).toHaveLength(3);
    expect(doc.children[1].children.at(-1)).toEqual({ type: "text", value: " May contain nuts." });
    expect(doc.children[2].children[0]).toEqual({ type: "text", value: "Legal Disclaimer: ", bold: true });
  });

  it("leaves the disclaimer paragraph out when there isn't one", () => {
    expect(ingredientDeckDocument({ deckText: "Water", mayContainStatement: null, disclaimer: null }).children).toHaveLength(2);
  });

  it("headed paragraphs match the live cooking-instructions layout", () => {
    expect(headedParagraphsDocument([{ heading: "Storage:", text: "Keep cold." }]).children[0].children)
      .toEqual([{ type: "text", value: "Storage:\n", bold: true }, { type: "text", value: "Keep cold." }]);
  });

  it("flattens a stored value to plain text for previews, and never throws", () => {
    const doc = JSON.stringify(headedParagraphsDocument([{ heading: "A:", text: "one" }, { heading: "B:", text: "two" }]));
    expect(richTextToPlain(doc)).toBe("A:\none\nB:\ntwo");
    expect(richTextToPlain("not json")).toBe("not json");
    expect(richTextToPlain(null)).toBe("");
  });
});
