import { describe, it, expect } from "vitest";
import { formatUkDate, parseUkDate, isPastIsoDate, isIsoDate, maskUkDateInput } from "./index";

describe("parseUkDate (typed → stored ISO)", () => {
  it("reads DD/MM/YYYY and DDMMYYYY", () => {
    expect(parseUkDate("14/05/1990")).toBe("1990-05-14");
    expect(parseUkDate("14051990")).toBe("1990-05-14");
    expect(parseUkDate(" 4/5/1990 ")).toBe("1990-05-04");
    expect(parseUkDate("14-05-1990")).toBe("1990-05-14");
  });

  it("keeps an ISO date as it is (what the old date picker stored)", () => {
    expect(parseUkDate("1990-05-14")).toBe("1990-05-14");
  });

  it("29/02 on a leap year is real; not on a non-leap year", () => {
    expect(parseUkDate("29/02/2000")).toBe("2000-02-29");
    expect(parseUkDate("29022024")).toBe("2024-02-29");
    expect(parseUkDate("29/02/2023")).toBeNull();
    expect(parseUkDate("29/02/1900")).toBeNull(); // century, not a leap year
  });

  it("rejects dates that don't exist and junk", () => {
    expect(parseUkDate("31/02/1990")).toBeNull();
    expect(parseUkDate("31/04/1990")).toBeNull();
    expect(parseUkDate("00/05/1990")).toBeNull();
    expect(parseUkDate("14/13/1990")).toBeNull();
    expect(parseUkDate("14/05/90")).toBeNull();
    expect(parseUkDate("1405199")).toBeNull();
    expect(parseUkDate("")).toBeNull();
    expect(parseUkDate("yesterday")).toBeNull();
  });

  it("is not fooled into US order: 05/14/1990 isn't a date", () => {
    expect(parseUkDate("05/14/1990")).toBeNull();
  });
});

describe("formatUkDate (stored ISO → shown)", () => {
  it("shows DD/MM/YYYY", () => {
    expect(formatUkDate("1990-05-14")).toBe("14/05/1990");
    expect(formatUkDate("2024-02-29")).toBe("29/02/2024");
  });
  it("leaves anything that isn't an ISO date alone", () => {
    expect(formatUkDate("—")).toBe("—");
    expect(formatUkDate("2023-02-29")).toBe("2023-02-29");
  });
  it("round-trips", () => {
    expect(parseUkDate(formatUkDate("1999-01-02"))).toBe("1999-01-02");
  });
});

describe("isPastIsoDate (date of birth)", () => {
  it("must be a real date before today", () => {
    expect(isPastIsoDate("1990-05-14", "2026-10-27")).toBe(true);
    expect(isPastIsoDate("2026-10-27", "2026-10-27")).toBe(false);
    expect(isPastIsoDate("2030-01-01", "2026-10-27")).toBe(false);
    expect(isPastIsoDate("1990-02-31", "2026-10-27")).toBe(false);
    expect(isIsoDate("1990-02-31")).toBe(false);
  });
});

describe("maskUkDateInput", () => {
  it("adds the slashes as you type", () => {
    expect(maskUkDateInput("14")).toBe("14");
    expect(maskUkDateInput("1405")).toBe("14/05");
    expect(maskUkDateInput("14051990")).toBe("14/05/1990");
    expect(maskUkDateInput("14/05/1990")).toBe("14/05/1990");
    expect(maskUkDateInput("140519901")).toBe("14/05/1990");
  });
});
