// Seed the initial Risk Assessments content on first startup.
//
// Idempotent: only runs if the risk_assessments table is empty. Subsequent
// startups are no-ops, so any user edits in the admin UI are preserved.
//
// What gets seeded:
//   • A Fire Risk Assessment skeleton (admin pastes the full body via the UI
//     from TCK-Factory-Fire-Risk-Assessment-DRAFT-v1.md)
//   • The 22 action-plan items (A1–A22) from the FRA draft, as one-off
//     compliance actions due "soon"
//   • Standard recurring compliance items (weekly alarm test, monthly EL, etc.)
//     so the dashboard immediately shows a live to-do list on first visit.

import { db, riskAssessmentsTable, complianceActionsTable } from "@workspace/db";
import { count } from "drizzle-orm";

const FIRE_RA_STARTER_BODY = `# Fire Risk Assessment — The Calzone Kitchen Ltd

**Status:** DRAFT — paste the full content from \`TCK-Factory-Fire-Risk-Assessment-DRAFT-v1.md\` into this body when reviewing, then save.

**Assessor:** Graeme Carter (draft); competent reviewer to be appointed.

This in-app copy tracks the action plan and completion log. The narrative body (premises details, hazards, escape routes, etc.) is intended to be the same document as the markdown draft stored in \`Docs/Risk Assessments/2026/\`.

## Next steps

1. Open this document in edit mode and paste the full FRA content from the markdown draft.
2. Work through the action plan below — each item is also a compliance task with a due date. Mark complete as you deal with them.
3. Book a competent fire risk assessor to review this draft before filing with insurance.
`;

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type SeedAction = {
  title: string;
  description?: string;
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  dueInDays: number;
  recurrence?: "none" | "weekly" | "monthly" | "quarterly" | "six_monthly" | "annually" | "three_yearly" | "five_yearly";
  assignedToName?: string;
};

// Action plan items A1–A22 from the FRA draft (Apr 2026). These are all
// one-off (recurrence = none); the Fire Warden / Responsible Person clears
// them over the first few months.
const FIRE_RA_ACTIONS: SeedAction[] = [
  { title: "Survey all internal doors on escape routes; identify FD30 doors vs non-fire-rated", description: "Walk every internal door on an escape route. Record: top-edge certification label (FD30/FD60); intumescent strip; cold smoke seal; self-closer; gap between door and frame ≤4mm.", category: "fire", priority: "high", dueInDays: 28, assignedToName: "Graeme Carter" },
  { title: "Install FD30 self-closing doors where missing on escape routes", description: "Dependent on the survey (previous action). Especially important at the top and bottom of the staircase.", category: "fire", priority: "high", dueInDays: 56 },
  { title: "Obtain fire alarm installation/commissioning certificate and zonal plan", description: "Fike TwinflexPro² 2-zone panel. Confirm BS 5839-1 category (target L2 minimum). Laminate a zone plan and mount next to the panel.", category: "fire", priority: "high", dueInDays: 28, assignedToName: "Graeme Carter" },
  { title: "Appoint BS 5839-1 6-monthly fire alarm service contractor", description: "Including annual battery capacity test.", category: "fire", priority: "medium", dueInDays: 56 },
  { title: "Review smoke vs heat detectors above cooking equipment", description: "Building Room (above pizza oven) and Prep area (above combi steamer / induction hobs) — smoke detectors will false-alarm; heat or multi-sensor detectors recommended.", category: "fire", priority: "medium", dueInDays: 56 },
  { title: "Appoint BAFE SP101 fire extinguisher service contractor; audit current stock", description: "Upgrade to the schedule in §5.3 of the FRA.", category: "fire", priority: "high", dueInDays: 42 },
  { title: "Install Wet Chemical extinguisher + fire blanket at pizza oven", description: "6L Wet Chemical 75F + 1.2m × 1.2m fire blanket.", category: "fire", priority: "high", dueInDays: 42 },
  { title: "Install signage for muster point (back of car park opposite factory front door)", description: "Muster point location chosen: back of the car park, directly opposite the factory's front door. Remaining task: install a photoluminescent \"Fire Assembly Point\" post/sign at the chosen spot, and confirm it is at least 15m from the building, clear of vehicle manoeuvring, and not obstructing FRS access.", category: "fire", priority: "high", dueInDays: 21, assignedToName: "Graeme Carter" },
  { title: "Install Fire Action Notice at every MCP and at the muster point", description: "Use the template in Docs/Risk Assessments/2026/TCK-Fire-Action-Notice.md. Include Lorna's name as primary Fire Warden.", category: "fire", priority: "high", dueInDays: 14 },
  { title: "Book Lorna Brown's fire warden refresher training + appoint Deputy Fire Warden", description: "Lorna was trained within the last 18 months. A refresher is due this year, and a deputy needs initial training.", category: "training", priority: "high", dueInDays: 42, assignedToName: "Graeme Carter" },
  { title: "Hold first fire drill at the new factory", description: "Document the drill (time to evacuate, muster point head-count, learnings) in the completion notes of this action.", category: "fire", priority: "high", dueInDays: 56, assignedToName: "Lorna Brown" },
  { title: "Confirm PAT test cycle with electrical contractor; start PAT register", description: "6-monthly for moveable appliances in a kitchen; 12-monthly for fixed equipment. Per IET Code of Practice.", category: "electrical", priority: "medium", dueInDays: 56 },
  { title: "Confirm or book fixed wiring inspection (EICR)", description: "5-yearly for commercial premises. Consumer unit is landlord-managed — liaise.", category: "electrical", priority: "medium", dueInDays: 56 },
  { title: "Confirm contractor sign-in process + introduce hot-work permit-to-work template", description: "Visitor sign-in book is in place at front door; extend to contractors. Permit-to-work for any welding / grinding / torching.", category: "fire", priority: "medium", dueInDays: 28 },
  { title: "Verify internal recycling-bin placement ≥2m from heat sources", description: "Storage area + Prep area recycling bins must not be near ovens, combi steamer, or consumer unit.", category: "fire", priority: "low", dueInDays: 14, assignedToName: "Lorna Brown" },
  { title: "Remove first-floor windows from any evacuation plan as escape route", description: "Windows are 350mm openable width — does not meet 450×450mm minimum under AD B1. Update any signage or plans that imply they are an escape.", category: "fire", priority: "medium", dueInDays: 14 },
  { title: "Implement daily escape-route clearance check (opening checklist)", description: "Packing crates, trolleys, pallets must not block escape routes — especially at the stair foot and goods-in/out area.", category: "fire", priority: "medium", dueInDays: 7 },
  { title: "Measure travel distances from furthest points on both floors to nearest exit", description: "Must be ≤18m single direction or ≤45m with alternative routes. Record on the floor plan.", category: "fire", priority: "medium", dueInDays: 28 },
  { title: "Designate external smoking area (or adopt fully no-smoking-on-site policy)", description: "Per §4.7 of the FRA: open-air, ≥10m from building, ≥10m from muster point, ≥6m from bins, metal sand receptacle, signage.", category: "fire", priority: "medium", dueInDays: 28 },
  { title: "Appoint competent fire risk assessor to review this draft FRA", description: "IFE-registered / IFSM / BAFE SP205. Budget £400–£800.", category: "fire", priority: "high", dueInDays: 56, assignedToName: "Graeme Carter" },
  { title: "Review cleaning-chemical SDSs; relocate flammables or upgrade under-stair cupboard to FD30", description: "Under-stair storage is beneath the sole first-floor escape route. Any flammable product (H224/H225/H226) requires either relocation to an external COSHH store or upgrading the cupboard to fire-resisting construction.", category: "fire", priority: "high", dueInDays: 28 },
  { title: "Document Lone Working Policy (fire-safety provisions)", description: "Cover early starters, end-of-day lock-up, check-in/check-out WhatsApp routine, no gas oven alone, closing-down checklist. See §6.6 of the FRA.", category: "fire", priority: "high", dueInDays: 28 },
];

// Recurring compliance items — the "fire log book" equivalent. Each recurs
// automatically when marked complete.
const RECURRING_COMPLIANCE_ACTIONS: SeedAction[] = [
  { title: "Weekly fire alarm test — rotate call point", description: "Press a different MCP each week in rotation; verify all sounders activate. BS 5839-1 §44.", category: "fire", priority: "medium", dueInDays: 7, recurrence: "weekly", assignedToName: "Lorna Brown" },
  { title: "Monthly emergency-lighting flick test", description: "Simulate mains failure for 30 seconds on each EL unit; verify all units illuminate. BS 5266-1.", category: "fire", priority: "medium", dueInDays: 30, recurrence: "monthly", assignedToName: "Lorna Brown" },
  { title: "Monthly fire extinguisher visual check", description: "Each extinguisher: pin intact, gauge in green, no damage, correct location, sign visible. Record in notes.", category: "fire", priority: "medium", dueInDays: 30, recurrence: "monthly", assignedToName: "Lorna Brown" },
  { title: "Monthly fire door check", description: "Each fire door on escape routes: self-closer working, intumescent strip intact, gap ≤4mm, no damage.", category: "fire", priority: "medium", dueInDays: 30, recurrence: "monthly", assignedToName: "Lorna Brown" },
  { title: "6-monthly fire alarm service (contractor)", description: "BS 5839-1 §45. Should include battery capacity test annually.", category: "fire", priority: "high", dueInDays: 180, recurrence: "six_monthly" },
  { title: "6-monthly extract canopy deep clean (TR19)", description: "Specialist kitchen extract cleaning to TR19 specification.", category: "fire", priority: "medium", dueInDays: 180, recurrence: "six_monthly" },
  { title: "Annual fire drill", description: "Full evacuation, time to clear, head-count at muster point. Log result.", category: "fire", priority: "high", dueInDays: 365, recurrence: "annually", assignedToName: "Lorna Brown" },
  { title: "Annual fire extinguisher service (BAFE)", description: "By BAFE SP101-registered engineer.", category: "fire", priority: "high", dueInDays: 365, recurrence: "annually" },
  { title: "Annual emergency-lighting 3-hour test", description: "BS 5266-1 — full duration test; verify all units remain illuminated for 3 hours.", category: "fire", priority: "high", dueInDays: 365, recurrence: "annually" },
  { title: "Annual Gas Safe inspection — pizza oven + unvented boiler", description: "Gas Safe registered engineer. Keep certificate for 3 years minimum.", category: "gas", priority: "high", dueInDays: 365, recurrence: "annually" },
  { title: "Annual FRA review", description: "Revisit every section; update for any changes to layout, equipment, staffing. Re-run hazard identification.", category: "fire", priority: "high", dueInDays: 365, recurrence: "annually", assignedToName: "Graeme Carter" },
  { title: "3-yearly fire warden refresher training", description: "IOSH Fire Safety for Fire Wardens or equivalent.", category: "training", priority: "medium", dueInDays: 365 * 3, recurrence: "three_yearly", assignedToName: "Lorna Brown" },
  { title: "5-yearly fixed wiring inspection (EICR)", description: "BS 7671 commercial premises inspection. Liaise with landlord (consumer unit is landlord-managed).", category: "electrical", priority: "high", dueInDays: 365 * 5, recurrence: "five_yearly" },
  { title: "5-yearly fire extinguisher extended service", description: "BAFE-registered contractor — extended service at 5 years, full replacement at 20.", category: "fire", priority: "medium", dueInDays: 365 * 5, recurrence: "five_yearly" },
];

export async function seedRiskAssessmentsIfNeeded() {
  try {
    const [{ value }] = await db.select({ value: count() }).from(riskAssessmentsTable);
    if (Number(value) > 0) {
      // Already seeded — do nothing.
      return;
    }
    console.log("[seed-risk-assessments] seeding Fire Risk Assessment + initial actions…");

    const [fireRa] = await db.insert(riskAssessmentsTable).values({
      assessmentType: "fire",
      title: "Fire Risk Assessment — TCK Factory",
      bodyMarkdown: FIRE_RA_STARTER_BODY,
      status: "draft",
      reviewFrequencyMonths: 12,
      nextReviewDue: addDaysIso(365),
    }).returning();

    const allActions = [
      ...FIRE_RA_ACTIONS.map(a => ({ ...a, riskAssessmentId: fireRa.id })),
      ...RECURRING_COMPLIANCE_ACTIONS.map(a => ({ ...a, riskAssessmentId: fireRa.id })),
    ];

    for (const a of allActions) {
      await db.insert(complianceActionsTable).values({
        riskAssessmentId: a.riskAssessmentId,
        title: a.title,
        description: a.description ?? null,
        category: a.category,
        priority: a.priority,
        status: "open",
        dueDate: addDaysIso(a.dueInDays),
        recurrence: a.recurrence ?? "none",
        assignedToName: a.assignedToName ?? null,
      });
    }

    console.log(`[seed-risk-assessments] seeded Fire RA #${fireRa.id} with ${allActions.length} compliance actions`);
  } catch (err) {
    console.error("[seed-risk-assessments] failed (non-fatal):", err);
  }
}
