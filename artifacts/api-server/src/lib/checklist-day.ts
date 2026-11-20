/**
 * Which plan holds a station's checklist TODAY (Graeme, 20 Nov 2026: "whenever
 * we go to any checklist, that is recording the checklist for today … we're
 * not going to be ever completing checks for yesterday or tomorrow"). One
 * rule, on the server, for every path into a checklist — the dashboard,
 * Production Plans, Switch checklist — so they can never show different
 * ticks. Same rule as the dashboard's station links
 * (production-planner lib/station-plan-target.ts): dough prep and prep work
 * a day ahead on the plan they're making for; every other station works on
 * today's plan.
 */
export type ChecklistPlanKind = "today" | "next-dough" | "next-prep";

const LOOKS_AHEAD: Record<string, ChecklistPlanKind> = {
  dough_prep: "next-dough",
  prep: "next-prep",
  main_prep: "next-prep",
  prep_bases: "next-prep",
  prep_meat: "next-prep",
};

export function checklistPlanKind(stationType: string): ChecklistPlanKind {
  return LOOKS_AHEAD[stationType] ?? "today";
}
