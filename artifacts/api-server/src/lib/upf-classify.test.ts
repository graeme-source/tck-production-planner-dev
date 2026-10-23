import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// Never reach the Anthropic API from a test, even on a machine with a key set.
vi.mock("./ai/claude", () => ({
  isClaudeConfigured: () => false,
  getClaudeClient: () => { throw new Error("no AI in tests"); },
  CLAUDE_MODELS: { haiku: "h", sonnet: "s", opus: "o" },
}));
import { fileURLToPath } from "node:url";
import {
  findUpfMarkers,
  markerOnlyVerdict,
  novaCacheKey,
  novaColumns,
  shouldAutoClassify,
  classifyDeclaration,
  type AutoNovaInput,
} from "./upf-classify";
import { parseBrakesProduct, type BrakesProductJson } from "./brakes-product";

const declOf = (code: string) => {
  const json = JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/brakes/brakes-${code}.occ.json`, import.meta.url)), "utf8")) as BrakesProductJson;
  return parseBrakesProduct(json).ingredients!;
};

const base: AutoNovaInput = {
  declaration: "Tomatoes, salt",
  previousDeclaration: null,
  novaSource: null,
  novaAnalyzedAt: null,
  perishable: true,
  manualThisSave: false,
};

describe("shouldAutoClassify — UPF analysis on every save with a declaration", () => {
  it("classifies a new ingredient that has a declaration", () => {
    expect(shouldAutoClassify(base)).toBe(true);
  });

  it("does nothing without a declaration", () => {
    expect(shouldAutoClassify({ ...base, declaration: "" })).toBe(false);
    expect(shouldAutoClassify({ ...base, declaration: "   " })).toBe(false);
    expect(shouldAutoClassify({ ...base, declaration: null })).toBe(false);
  });

  it("re-classifies when the declaration changed, even if it was analysed before", () => {
    expect(shouldAutoClassify({ ...base, previousDeclaration: "Tomatoes", novaSource: "ai", novaAnalyzedAt: new Date() })).toBe(true);
  });

  it("leaves an unchanged, already-analysed declaration alone (no AI spend on every save)", () => {
    expect(shouldAutoClassify({ ...base, previousDeclaration: "Tomatoes, salt", novaSource: "ai", novaAnalyzedAt: new Date() })).toBe(false);
  });

  it("fills in an unchanged declaration that was never analysed", () => {
    expect(shouldAutoClassify({ ...base, previousDeclaration: "Tomatoes, salt", novaAnalyzedAt: null })).toBe(true);
  });

  it("never overwrites a class a person set by hand", () => {
    expect(shouldAutoClassify({ ...base, previousDeclaration: "Tomatoes", novaSource: "manual", novaAnalyzedAt: new Date() })).toBe(false);
    expect(shouldAutoClassify({ ...base, manualThisSave: true })).toBe(false);
  });

  it("skips supplies (not food)", () => {
    expect(shouldAutoClassify({ ...base, perishable: false })).toBe(false);
  });
});

describe("findUpfMarkers", () => {
  it("finds the industrial ingredients in the real Brakes declarations", () => {
    expect(findUpfMarkers(declOf("85659"))).toEqual(["modified starch"]);
    expect(findUpfMarkers(declOf("85753"))).toEqual(["anti-foaming agent", "E900"]);
    expect(findUpfMarkers(declOf("149839"))).toEqual(["emulsifier", "dextrose", "dextrin", "caseinate", "phosphates"]);
  });

  it("finds nothing in a plain declaration", () => {
    expect(findUpfMarkers("Tomatoes (98%), salt, acidity regulator: citric acid")).toEqual([]);
    expect(findUpfMarkers("Wheat flour (WHEAT), water, yeast, salt")).toEqual([]);
    expect(findUpfMarkers(null)).toEqual([]);
  });

  it("knows flavourings, sweeteners, colours and E-number ranges", () => {
    expect(findUpfMarkers("Sugar, natural flavouring, colour (paprika extract), sweetener (sucralose), E471"))
      .toEqual(["flavourings", "colours", "sweeteners", "E471"]);
  });
});

describe("markerOnlyVerdict — fallback when the AI can't be reached", () => {
  it("markers present → NOVA 4 with the markers listed", () => {
    const v = markerOnlyVerdict(declOf("149839"))!;
    expect(v.novaClass).toBe(4);
    expect(v.markers).toContain("dextrose");
    expect(v.method).toBe("markers");
  });

  it("no markers → no verdict (stays unclassified, never guessed as 1-3)", () => {
    expect(markerOnlyVerdict("Tomatoes, salt")).toBeNull();
  });
});

describe("classifyDeclaration without an API key (tests never call the AI)", () => {
  it("falls back to the marker scan", async () => {
    const r = await classifyDeclaration({ name: "Chorizo", labelDeclaration: declOf("149839") });
    expect(r?.novaClass).toBe(4);
    expect(r?.method).toBe("markers");
  });

  it("returns null for a blank declaration", async () => {
    expect(await classifyDeclaration({ name: "X", labelDeclaration: "  " })).toBeNull();
  });
});

describe("novaCacheKey — scrape preview and save share one AI call", () => {
  it("ignores case, spacing and a trailing full stop", () => {
    expect(novaCacheKey({ labelDeclaration: "Water,  Sugar, Salt." })).toBe(novaCacheKey({ labelDeclaration: "water, sugar, salt" }));
  });
});

describe("novaColumns", () => {
  it("stores the class as AI-sourced with a timestamp", () => {
    const now = new Date("2026-10-23T09:00:00Z");
    expect(novaColumns({ novaClass: 4, markers: ["dextrose"], reasoning: "r", confidence: "high", method: "ai" }, now)).toEqual({
      novaClass: 4, novaMarkers: ["dextrose"], novaReasoning: "r", novaConfidence: "high", novaSource: "ai", novaAnalyzedAt: now,
    });
  });
});
