import { describe, expect, it } from "vitest";
import { compileDataQuery, DataQueryError, MOST_ROWS, shapeRows, type Dataset } from "./jane-data-query";

const dataset: Dataset = {
  name: "built",
  about: "test",
  pageKey: "/plans",
  sql: "SELECT day, recipe, batches, ok FROM somewhere",
  columns: [
    { name: "day", type: "date" },
    { name: "recipe", type: "text" },
    { name: "batches", type: "number" },
    { name: "ok", type: "boolean" },
  ],
};

const refused = (query: object) => expect(() => compileDataQuery(dataset, { dataset: "built", ...query })).toThrow(DataQueryError);

describe("compileDataQuery", () => {
  it("returns plain rows, every column by default", () => {
    const { text, params, outputColumns } = compileDataQuery(dataset, { dataset: "built" });
    expect(outputColumns).toEqual(["day", "recipe", "batches", "ok"]);
    expect(text).toContain("FROM (SELECT day, recipe, batches, ok FROM somewhere) AS t");
    expect(params).toEqual([101]);
  });

  it("totals by week for the chorizo kind of question", () => {
    const { text, params, outputColumns } = compileDataQuery(dataset, {
      dataset: "built",
      filters: [{ column: "recipe", op: "contains", value: "chorizo" }, { column: "day", op: "gte", value: "2026-10-01" }],
      groupBy: ["day:week"],
      metrics: [{ fn: "sum", column: "batches" }],
      orderBy: [{ column: "day_week_starting" }],
    });
    expect(outputColumns).toEqual(["day_week_starting", "sum_batches"]);
    expect(text).toContain(`GROUP BY to_char(date_trunc('week', t."day"::timestamp), 'YYYY-MM-DD')`);
    expect(text).toContain(`t."recipe" ILIKE $1`);
    expect(text).toContain(`t."day" >= $2::date`);
    expect(text).toContain(`ORDER BY "day_week_starting" ASC`);
    expect(params).toEqual(["%chorizo%", "2026-10-01", 101]);
  });

  it("puts every value in as a parameter, never into the text", () => {
    const attack = `'; DROP TABLE users; --`;
    const { text, params } = compileDataQuery(dataset, { dataset: "built", filters: [{ column: "recipe", op: "eq", value: attack }] });
    expect(text).not.toContain("DROP");
    expect(params).toContain(attack);
  });

  it("treats wildcards in a search as plain characters", () => {
    const { params } = compileDataQuery(dataset, { dataset: "built", filters: [{ column: "recipe", op: "contains", value: "100%_x\\" }] });
    expect(params[0]).toBe("%100\\%\\_x\\\\%");
  });

  it("refuses anything that isn't a column of the dataset", () => {
    refused({ columns: ["password"] });
    refused({ columns: [`recipe" FROM users --`] });
    refused({ filters: [{ column: "email", op: "eq", value: "x" }] });
    refused({ groupBy: ["recipe, password"] });
    refused({ groupBy: ["recipe:week"] });
    refused({ groupBy: ["day:week:x"] });
    refused({ metrics: [{ fn: "sum", column: "password" }] });
    refused({ orderBy: [{ column: "password" }] });
  });

  it("refuses functions and operators outside the short list", () => {
    refused({ metrics: [{ fn: "pg_read_file", column: "recipe" }] });
    refused({ filters: [{ column: "recipe", op: "; DROP", value: "x" }] });
    refused({ groupBy: ["day:pg_sleep"] });
    refused({ orderBy: [{ column: "recipe", direction: "asc; DROP TABLE users" }], columns: ["recipe"] });
  });

  it("refuses values of the wrong kind", () => {
    refused({ filters: [{ column: "batches", op: "gt", value: "lots" }] });
    refused({ filters: [{ column: "day", op: "gte", value: "last week" }] });
    refused({ filters: [{ column: "day", op: "gte", value: "2026-13-45" }] });
    refused({ filters: [{ column: "ok", op: "eq", value: "yes" }] });
    refused({ filters: [{ column: "batches", op: "contains", value: "1" }] });
    refused({ metrics: [{ fn: "sum", column: "recipe" }] });
    refused({ metrics: [{ fn: "avg" }] });
  });

  it("matches text whatever its case", () => {
    const eq = compileDataQuery(dataset, { dataset: "built", filters: [{ column: "recipe", op: "eq", value: "Carnizone" }] });
    expect(eq.text).toContain(`lower(t."recipe") = lower($1)`);
    const many = compileDataQuery(dataset, { dataset: "built", filters: [{ column: "recipe", op: "in", value: ["A", "b"] }] });
    expect(many.params[0]).toEqual(["a", "b"]);
  });

  it("won't mix plain rows with totals, or sort by something not returned", () => {
    refused({ columns: ["recipe"], metrics: [{ fn: "count" }] });
    refused({ columns: ["recipe"], orderBy: [{ column: "day" }] });
  });

  it("caps the rows however many are asked for", () => {
    expect(compileDataQuery(dataset, { dataset: "built", limit: 100_000 }).limit).toBe(MOST_ROWS);
    expect(compileDataQuery(dataset, { dataset: "built", limit: -5 }).limit).toBe(1);
  });

  it("copes with a form filled in badly", () => {
    refused({ filters: "recipe = 1" });
    refused({ groupBy: [{ column: "recipe" }] });
    refused({ filters: [null] });
    refused({ metrics: [null] });
  });
});

describe("shapeRows", () => {
  it("flags rows left out and tidies what it returns", () => {
    const shaped = shapeRows([{ a: 1.23456, b: "x".repeat(500) }, { a: 2, b: "y" }], 1);
    expect(shaped.truncated).toBe(true);
    expect(shaped.rowCount).toBe(1);
    expect(shaped.rows[0].a).toBe(1.23);
    expect(String(shaped.rows[0].b).length).toBe(401);
  });

  it("isn't truncated when everything fits", () => {
    expect(shapeRows([{ a: 1 }], 1).truncated).toBe(false);
  });
});
