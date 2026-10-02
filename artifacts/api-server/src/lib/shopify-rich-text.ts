/**
 * Shopify `rich_text_field` metafield documents — the ONE place the app builds
 * them (Objective A: label data generated, not re-keyed). Used by the
 * recipe page's "Push deck to website" and by the test-box product creator.
 *
 * Shape (as stored on the live products, read 2026-10-02):
 *   {"type":"root","children":[{"type":"paragraph","children":[
 *      {"type":"text","value":"Storage:\n","bold":true}, {"type":"text","value":"…"}]}]}
 */

export type RichRun = { type: "text"; value: string; bold?: boolean };
export type RichParagraph = { type: "paragraph"; children: RichRun[] };
export type RichRoot = { type: "root"; children: RichParagraph[] };

/** Convert the deck's markdown-style **Allergen** markers into rich-text
 *  runs. Split on `**`: odd segments are the bolded ones. */
export function mdBoldToRichRuns(text: string): RichRun[] {
  const runs: RichRun[] = [];
  text.split("**").forEach((part, i) => {
    if (!part) return;
    runs.push(i % 2 === 1 ? { type: "text", value: part, bold: true } : { type: "text", value: part });
  });
  return runs;
}

/**
 * The ingredient-deck document the storefront renders on product pages
 * (`custom.ingredient_deck`): the deck paragraph (allergens bold), the
 * standard allergen statement (+ "may contain"), and the legal disclaimer.
 */
export function ingredientDeckDocument(input: {
  deckText: string;
  mayContainStatement: string | null;
  disclaimer: string | null;
}): RichRoot {
  const children: RichParagraph[] = [{ type: "paragraph", children: mdBoldToRichRuns(input.deckText) }];
  const allergenRuns: RichRun[] = [
    { type: "text", value: "Allergens are shown in " },
    { type: "text", value: "Bold", bold: true },
    { type: "text", value: "." },
  ];
  if (input.mayContainStatement) {
    allergenRuns.push({ type: "text", value: ` ${input.mayContainStatement.trim().replace(/\.?$/, ".")}` });
  }
  children.push({ type: "paragraph", children: allergenRuns });
  if (input.disclaimer) {
    children.push({
      type: "paragraph",
      children: [
        { type: "text", value: "Legal Disclaimer: ", bold: true },
        { type: "text", value: input.disclaimer },
      ],
    });
  }
  return { type: "root", children };
}

/** Headed paragraphs ("Storage:\n" bold, then the text) — the cooking
 *  instructions layout. */
export function headedParagraphsDocument(sections: Array<{ heading: string; text: string }>): RichRoot {
  return {
    type: "root",
    children: sections.map(s => ({
      type: "paragraph",
      children: [{ type: "text", value: `${s.heading}\n`, bold: true }, { type: "text", value: s.text }],
    })),
  };
}

/** Plain text of a stored rich-text value, for previews. Never throws. */
export function richTextToPlain(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const doc = JSON.parse(value) as { children?: Array<{ children?: Array<{ value?: string }> }> };
    return (doc.children ?? [])
      .map(p => (p.children ?? []).map(r => r.value ?? "").join(""))
      .join("\n")
      .trim();
  } catch {
    return value;
  }
}
