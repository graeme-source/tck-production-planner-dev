import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IMPROVEMENT_PROMPT_TYPE, checklistSummary, isOptionalChecklistType, pinOptionalLast, shouldAddPromptOnCreate,
} from "./checklist-optional";

describe("optional checklist items never block completion", () => {
  it("the improvement question is optional; ordinary and dynamic items are not", () => {
    expect(isOptionalChecklistType(IMPROVEMENT_PROMPT_TYPE)).toBe(true);
    expect(isOptionalChecklistType(null)).toBe(false);
    expect(isOptionalChecklistType(undefined)).toBe(false);
    expect(isOptionalChecklistType("desserts_report")).toBe(false);
  });

  it("an unanswered optional item leaves a finished checklist at 100%", () => {
    const s = checklistSummary([
      { completed: true }, { completed: true },
      { completed: false, optional: true },
    ]);
    expect(s).toEqual({ total: 2, done: 2 });
  });

  it("answering the optional item doesn't inflate the count either", () => {
    const s = checklistSummary([
      { completed: true }, { completed: false },
      { completed: true, optional: true },
    ]);
    expect(s).toEqual({ total: 2, done: 1 });
  });

  it("a list with only the optional item has nothing required", () => {
    expect(checklistSummary([{ completed: false, optional: true }])).toEqual({ total: 0, done: 0 });
  });

  it("optional items close their section, others keep their order", () => {
    const out = pinOptionalLast([
      { id: 1 }, { id: 9, optional: true }, { id: 2 }, { id: 3, optional: false },
    ]);
    expect(out.map(i => i.id)).toEqual([1, 2, 3, 9]);
  });
});

describe("new closing checklists get the improvement question", () => {
  it("added with a station's first closing item", () => {
    expect(shouldAddPromptOnCreate({ category: "closing", dynamicDataType: null, stationHasPrompt: false })).toBe(true);
  });
  it("not when the station already has one — or once had it and removed it", () => {
    expect(shouldAddPromptOnCreate({ category: "closing", dynamicDataType: null, stationHasPrompt: true })).toBe(false);
  });
  it("not for opening or cleaning items", () => {
    expect(shouldAddPromptOnCreate({ category: "opening", dynamicDataType: null, stationHasPrompt: false })).toBe(false);
    expect(shouldAddPromptOnCreate({ category: "cleaning", dynamicDataType: null, stationHasPrompt: false })).toBe(false);
  });
  it("not when the item being created IS the question", () => {
    expect(shouldAddPromptOnCreate({ category: "closing", dynamicDataType: IMPROVEMENT_PROMPT_TYPE, stationHasPrompt: false })).toBe(false);
  });
});

// The migration itself is proved by running it twice inside a rolled-back
// transaction against a real database (see the commit). This guards the
// shape that makes a second run a no-op, so a later edit can't lose it.
describe("migration 0320 is safe to run twice", () => {
  const file = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../lib/db/migrations/0320_improvement_prompt_closing.sql",
  );
  const sql = readFileSync(file, "utf8");
  it("creates its table and index only if missing", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS improvement_prompt_answers/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS improvement_prompt_answers_day_idx/);
  });
  it("adds the item only to stations without one, active or removed", () => {
    const guard = sql.slice(sql.indexOf("NOT EXISTS ("));
    expect(guard).toMatch(/dynamic_data_type = 'improvement_prompt'/);
    expect(guard).not.toMatch(/is_active/);
  });
  it("uses the same type the server treats as optional", () => {
    expect(sql).toContain(`'${IMPROVEMENT_PROMPT_TYPE}'`);
  });
});
