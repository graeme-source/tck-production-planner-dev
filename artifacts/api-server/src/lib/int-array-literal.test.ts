import { describe, it, expect } from "vitest";
import { intArrayLiteral } from "./int-array-literal";

describe("intArrayLiteral", () => {
  // The shape Postgres accepts as a single parameter for `= ANY($1::int[])`.
  // Getting this wrong is what took the improvements list down on live:
  // Drizzle turns an interpolated JS array into `($1,$2,$3)`, and
  // `ANY(($1,$2,$3))` is not valid SQL.
  it("formats ids as a Postgres array literal", () => {
    expect(intArrayLiteral([1, 2, 3])).toBe("{1,2,3}");
  });

  it("handles a single id", () => {
    expect(intArrayLiteral([7])).toBe("{7}");
  });

  it("produces an empty literal for no ids", () => {
    // Callers should skip the query entirely, but `{}` is still valid and
    // matches nothing, rather than being a syntax error.
    expect(intArrayLiteral([])).toBe("{}");
  });

  it("coerces numeric strings, so an id from a query param is safe", () => {
    expect(intArrayLiteral(["4", "5"])).toBe("{4,5}");
  });

  // Ids come from the database, but the cast is what guarantees nothing
  // else can ride along in the literal.
  it("cannot carry anything but numbers", () => {
    expect(intArrayLiteral(["1); DROP TABLE improvements;--" as unknown as number])).toBe("{NaN}");
  });
});
