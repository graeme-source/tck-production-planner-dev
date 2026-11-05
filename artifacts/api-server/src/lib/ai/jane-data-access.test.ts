import { describe, expect, it } from "vitest";
import type { Role } from "../page-access-rules";
import { JANE_DATA_GUIDE, canSeePage, queryDataTool, visibleDatasets, type JaneAccess } from "./jane-data-access";
import { datasetByName, JANE_DATASETS } from "./jane-datasets";

const pages: Record<string, Role> = { "/stock": "manager", "/suppliers": "manager", "/sales": "manager" };
const person = (role: Role, grantedPages: string[] = [], overrides: Record<string, Role> = {}): JaneAccess => ({
  role,
  minRoleFor: (page) => overrides[page] ?? pages[page] ?? "viewer",
  grantedPages: new Set(grantedPages),
});
const names = (access: JaneAccess) => visibleDatasets(access).map((d) => d.name);

describe("what each person can read through Jane", () => {
  it("gives a viewer the open pages and nothing behind a manager gate", () => {
    const seen = names(person("viewer"));
    expect(seen).toEqual(expect.arrayContaining(["production_by_recipe", "prep_ticks", "purchase_orders", "issues", "waste"]));
    for (const hidden of ["stock_counts", "suppliers", "fridge_temperatures", "cooked_temperatures", "visitors", "team_efficiency"]) {
      expect(seen).not.toContain(hidden);
    }
  });

  it("gives a manager everything in the list", () => {
    expect(names(person("manager"))).toHaveLength(JANE_DATASETS.length);
  });

  it("follows a page's level when an admin changes it", () => {
    expect(names(person("viewer", [], { "/plans": "manager" }))).not.toContain("production_by_recipe");
    expect(names(person("viewer", [], { "/stock": "viewer" }))).toContain("stock_counts");
  });

  it("honours a page granted to one person, the same as the app", () => {
    const access = person("viewer", ["/stock"]);
    expect(canSeePage(access, "/stock")).toBe(true);
    expect(names(access)).toContain("stock_counts");
  });

  it("a grant to Reports doesn't open the manager-only tabs", () => {
    expect(names(person("viewer", ["/reports"]))).not.toContain("fridge_temperatures");
  });

  it("offers Jane only the datasets this person can see", () => {
    const access = person("viewer");
    const tool = queryDataTool(visibleDatasets(access));
    expect(tool.description).toContain("production_by_recipe");
    expect(tool.description).not.toContain("fridge_temperatures");
    expect(tool.description).not.toContain(datasetByName("stock_counts")!.about);
    const schema = tool.input_schema as { properties: { dataset: { enum: string[] } } };
    expect(schema.properties.dataset.enum).toEqual(names(access));
  });

  it("the example in the tool's own description is a real query", () => {
    expect(datasetByName("production_by_recipe")?.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["plan_date", "batches_built", "recipe"]));
    expect(queryDataTool(JANE_DATASETS).description).toContain("batches_built");
  });

  it("tells Jane where the line is", () => {
    for (const word of ["finance", "founder", "People section", "private records", "customer details"]) expect(JANE_DATA_GUIDE).toContain(word);
  });
});
