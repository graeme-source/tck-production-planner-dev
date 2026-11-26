import { describe, it, expect } from "vitest";
import { matchesTransactionSearch } from "./finance-transaction-search";

const klayvio = { supplier: "Klayvio", descriptor: "Klayvio", amount: "755.1", lineDate: "2026-11-06", cardholder: "Lorna" };

describe("matchesTransactionSearch", () => {
  it("finds a charge by supplier, amount or date, as typed", () => {
    for (const q of ["kla", "KLAY", "755", "£755.10", "755.10", "6 nov", "nov", "2026-11-06", "lorna", "kla 755"]) {
      expect(matchesTransactionSearch(klayvio, q)).toBe(true);
    }
  });
  it("needs every word, and shows everything with nothing typed", () => {
    expect(matchesTransactionSearch(klayvio, "kla 52")).toBe(false);
    expect(matchesTransactionSearch(klayvio, "oct")).toBe(false);
    expect(matchesTransactionSearch(klayvio, "  ")).toBe(true);
  });
});
