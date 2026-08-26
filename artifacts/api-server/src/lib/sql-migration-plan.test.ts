import { describe, it, expect } from "vitest";
import { planSqlMigrations, migrationNumber } from "./sql-migration-plan";

describe("migrationNumber", () => {
  it("reads the numeric prefix", () => {
    expect(migrationNumber("0057_lean_curriculum_planner.sql")).toBe(57);
  });

  it("rejects files that aren't migrations", () => {
    expect(migrationNumber("README.md")).toBeNull();
    expect(migrationNumber("0057_lean_curriculum_planner.sql.bak")).toBeNull();
    expect(migrationNumber("57_short_prefix.sql")).toBeNull();
  });
});

describe("planSqlMigrations", () => {
  it("baselines pre-runner history and runs only what's newer", () => {
    const plan = planSqlMigrations(
      ["0055_lean_lesson_reviews.sql", "0056_meeting_trial_welcome.sql", "0057_lean_curriculum_planner.sql", "0058_lesson_video_recommendation.sql"],
      new Set(),
      56,
    );
    expect(plan.markOnly).toEqual(["0055_lean_lesson_reviews.sql", "0056_meeting_trial_welcome.sql"]);
    expect(plan.run).toEqual(["0057_lean_curriculum_planner.sql", "0058_lesson_video_recommendation.sql"]);
  });

  it("does nothing for files already recorded as applied", () => {
    const plan = planSqlMigrations(
      ["0057_lean_curriculum_planner.sql", "0058_lesson_video_recommendation.sql"],
      new Set(["0057_lean_curriculum_planner.sql"]),
      56,
    );
    expect(plan.markOnly).toEqual([]);
    expect(plan.run).toEqual(["0058_lesson_video_recommendation.sql"]);
  });

  it("keeps the historical duplicate numbers in a stable filename order", () => {
    const plan = planSqlMigrations(
      ["0017_add_sku_barcodes.sql", "0017_add_partial_packs_and_builder_presence.sql"],
      new Set(),
      56,
    );
    expect(plan.markOnly).toEqual([
      "0017_add_partial_packs_and_builder_presence.sql",
      "0017_add_sku_barcodes.sql",
    ]);
  });

  it("runs files in filename order regardless of directory order", () => {
    const plan = planSqlMigrations(
      ["0059_b.sql", "0057_lean.sql", "0058_video.sql"],
      new Set(),
      56,
    );
    expect(plan.run).toEqual(["0057_lean.sql", "0058_video.sql", "0059_b.sql"]);
  });

  it("never executes a file that doesn't look like a migration", () => {
    const plan = planSqlMigrations(["notes.txt", "0057_lean.sql~", "meta"], new Set(), 56);
    expect(plan.markOnly).toEqual([]);
    expect(plan.run).toEqual([]);
  });

  it("is a no-op once everything is recorded", () => {
    const files = ["0057_lean.sql", "0058_video.sql"];
    const plan = planSqlMigrations(files, new Set(files), 56);
    expect(plan.markOnly).toEqual([]);
    expect(plan.run).toEqual([]);
  });
});
