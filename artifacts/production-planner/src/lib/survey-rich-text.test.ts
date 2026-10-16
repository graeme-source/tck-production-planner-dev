import { describe, expect, it } from "vitest";
import {
  FINAL_PAGE_DEFAULTS, alignFromClass, finalPageProblems, fontClass, fontKeyFromClass, isRichTextEmpty, isShopLink,
  linkChoiceFor, plainTextToHtml, sizeClass, sizeKeyFromClass,
} from "./survey-rich-text";

describe("font / size / align classes", () => {
  it("round-trips keys and classes", () => {
    expect(fontClass("heading")).toBe("tck-font-heading");
    expect(fontClass("body")).toBeNull();
    expect(sizeClass("large")).toBe("tck-size-large");
    expect(sizeClass("normal")).toBeNull();
    expect(fontKeyFromClass("x tck-font-serif")).toBe("serif");
    expect(sizeKeyFromClass("tck-size-small")).toBe("small");
    expect(alignFromClass("tck-align-left")).toBe("left");
    expect(alignFromClass("tck-align-right")).toBeNull();
  });
});

describe("plainTextToHtml", () => {
  it("keeps paragraph and line breaks and escapes markup", () => {
    expect(plainTextToHtml("A\nb\n\n<c> & d")).toBe("<p>A<br>b</p><p>&lt;c&gt; &amp; d</p>");
    expect(plainTextToHtml("  ")).toBe("");
  });
});

describe("isRichTextEmpty", () => {
  it("treats an empty editor as empty", () => {
    expect(isRichTextEmpty("<p></p>")).toBe(true);
    expect(isRichTextEmpty("<p><br></p><p>&nbsp;</p>")).toBe(true);
    expect(isRichTextEmpty("<p>Hi</p>")).toBe(false);
  });
});

describe("isShopLink — final page button", () => {
  it("allows our shop over http(s)", () => {
    expect(isShopLink("https://thecalzonekitchen.co.uk/")).toBe(true);
    expect(isShopLink("http://www.thecalzonekitchen.co.uk/pages/menu")).toBe(true);
  });
  it("refuses everything else", () => {
    for (const bad of ["https://evil.example/", "https://thecalzonekitchen.co.uk.evil.example/", "javascript:alert(1)",
      "//thecalzonekitchen.co.uk/", "/pages/menu", "https://a:b@thecalzonekitchen.co.uk/", ""]) {
      expect(isShopLink(bad), bad).toBe(false);
    }
  });
});

describe("linkChoiceFor + finalPageProblems", () => {
  const presets = [
    { key: "home", label: "Homepage", url: "https://thecalzonekitchen.co.uk/" },
    { key: "menu", label: "Menu", url: "https://thecalzonekitchen.co.uk/pages/menu" },
  ];
  it("recognises presets", () => {
    expect(linkChoiceFor("https://thecalzonekitchen.co.uk/pages/menu", presets)).toBe("menu");
    expect(linkChoiceFor("https://thecalzonekitchen.co.uk/products/x", presets)).toBe("custom");
  });
  it("flags a bad button only when the page is on", () => {
    const fp = { enabled: true, heading: "", html: "", buttonLabel: "Go", buttonUrl: "https://evil.example/", showOffer: false };
    expect(finalPageProblems(fp)).toHaveLength(1);
    expect(finalPageProblems({ ...fp, enabled: false })).toEqual([]);
    expect(finalPageProblems({ ...fp, buttonLabel: "", buttonUrl: "" })).toEqual([]);
    expect(finalPageProblems({ ...fp, buttonUrl: FINAL_PAGE_DEFAULTS.buttonUrl })).toEqual([]);
  });
});
