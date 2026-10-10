import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import ingredientsRouter from "./ingredients";
import subRecipesRouter from "./sub-recipes";
import subRecipePrepTimeRouter from "./sub-recipe-prep-time";
import userToursRouter from "./user-tours";
import testRequestsRouter from "./test-requests";
import recipesRouter from "./recipes";
import recipeArchiveRouter from "./recipe-archive";
import productionPlansRouter from "./production-plans";
import buildingTablesRouter from "./building-tables";
import buildingTargetFinishRouter from "./building-target-finish";
import dptSettingsRouter from "./dpt-settings";
import timingStandardsRouter from "./timing-standards";
import timingHealthRouter from "./timing-health";
import teamEfficiencyRouter from "./team-efficiency";
import dptCalculatorRouter from "./dpt-calculator";
import stockRouter from "./stock";
import stockItemsRouter from "./stock-items";
import stockGatingRouter from "./stock-gating";
import salesRouter from "./sales";
import dispatchesRouter from "./dispatches";
import suppliersRouter from "./suppliers";
import usersRouter from "./users";
import categoryDefaultsRouter from "./category-defaults";
import shopifyRouter from "./shopify";
import pagePermissionsRouter from "./page-permissions";
import appSettingsRouter from "./app-settings";
import reportsRouter from "./reports";
import fulfilmentRouter from "./fulfilment";
import fulfilmentAvailabilityRouter from "./fulfilment-availability";
import apcBookingIssuesRouter from "./apc-booking-issues";
import dptSuggestionsRouter from "./dpt-suggestions";
import temperatureRecordsRouter from "./temperature-records";
import ovenEventsRouter from "./oven-events";
import invitesRouter from "./invites";
import storageLocationsRouter from "./storage-locations";
import stockTransfersRouter from "./stock-transfers";
import dptIngredientRequirementsRouter from "./dpt-ingredient-requirements";
import kanbansRouter from "./kanbans";
import ordersRouter from "./orders";
import supplierPricingRouter from "./supplier-pricing";
import deliveriesRouter from "./deliveries";
import unexpectedDeliveriesRouter from "./unexpected-deliveries";
import stockControlRouter from "./stock-control";
import eightPackStockRouter from "./eight-pack-stock";
import founderPanelsRouter from "./founder-panels";
import improvementsRouter from "./improvements";
import andonRouter from "./andon";
import qrRouter from "./qr";
import pnlRouter from "./pnl";
import checklistsRouter from "./checklists";
import curiosityRouter from "./curiosity";
import notificationsRouter from "./notifications";
import employeesRouter from "./employees";
import returnToWorkRouter from "./return-to-work";
import stationMessagesRouter from "./station-messages";
import messagesRouter from "./messages";
import contactsRouter from "./contacts";
import apcPostcodeOverridesRouter from "./apc-postcode-overrides";
import staffEmergencyContactsRouter from "./staff-emergency-contacts";
import employeeReviewsRouter from "./employee-reviews";
import peopleRouter from "./people";
import { requirePeopleUnlock } from "../middleware/people-unlock";
import { requireFreshPinForAttributingWrites } from "../middleware/pin-enforce";
import friedChickenRouter from "./fried-chicken";
import riskAssessmentsRouter from "./risk-assessments";
import complianceActionsRouter from "./compliance-actions";
import standardsRouter from "./standards";
import aiRouter from "./ai";
import recipeDesignerRouter from "./recipe-designer";
import morningMeetingsRouter from "./morning-meetings";
import endOfDayRouter from "./end-of-day";
import qualityRejectsRouter from "./quality-rejects";
import wrappingStorageUndoRouter from "./wrapping-storage-undo";
import buildingEditRouter from "./building-edit";
import extraPacksRouter from "./extra-packs";
import defectsRouter from "./defects";
import slowMeatRouter, { slowMeatPlanGuard } from "./slow-meat";
import leanReviewsRouter from "./lean-reviews";
import leanCurriculumRouter from "./lean-curriculum";
import ingredientScrapeRouter from "./ingredient-scrape";
import upfRouter from "./upf";
import formsRouter from "./forms";
import systemUpdatesRouter from "./system-updates";
import labelStockRouter from "./label-stock";
import printJobsRouter from "./print-jobs";
import prepLinkedCompletionsRouter from "./prep-linked-completions";
import planMoveRouter from "./plan-move";
import dictationRouter from "./dictation";
import icePacksRouter from "./ice-packs";
import wholesaleBagsRouter from "./wholesale-bags";
import bundlesRouter from "./bundles";
import trainingRouter from "./training";
import trainingAcknowledgeRouter from "./training-acknowledge";
import stationTrainingRouter from "./station-training";
import incidentsRouter from "./incidents";
import onboardingRouter from "./onboarding";
import goveeRouter from "./govee";
import visitorsRouter from "./visitors";
import collectionsRouter from "./collections";
import recipeCollectionsRouter from "./recipe-collections";
import queuedProductionRouter from "./queued-production";
import caseOrdersRouter from "./case-orders";
import founderFocusRouter from "./founder-focus";
import founderAdSpendRouter from "./founder-ad-spend";
import metaAdsRouter from "./meta-ads";
import todosRouter from "./todos";
import founderSalesRouter from "./founder-sales";
import revenueTargetsRouter from "./revenue-targets";
import marketingCalendarRouter from "./marketing-calendar";
import marketingEmailsRouter from "./marketing-emails";
import marketingApprovalsRouter from "./marketing-approvals";
import marketingTodosRouter from "./marketing-todos";
import testBoxesRouter from "./test-boxes";
import testBoxShopifyRouter from "./test-box-shopify";
import testBoxProductionRouter from "./test-box-production";
import founderNumbersRouter from "./founder-numbers";
import surveysRouter from "./surveys";
import financeRouter from "./finance";
import featuresRouter from "./features";
import contractsRouter from "./contracts";
import uploadedContractsRouter from "./uploaded-contracts";
import starterFormsRouter from "./starter-forms";
import issuePipelineMachineRouter from "./issue-pipeline-machine";
import issuePipelineRouter from "./issue-pipeline";
import peopleAccessRouter from "./people-access";
import personDocumentsRouter from "./person-documents";
import productLabelsRouter from "./product-labels";
import { runBackup } from "../lib/backup";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/auth", invitesRouter);
router.use(storageRouter);
// Issue pipeline MACHINE API — the scheduled Claude Code session has no
// session cookie, so it mounts here, above the session guard. It is NOT
// public: the router's own first middleware demands the ISSUE_PIPELINE_TOKEN
// bearer on every path (503 when the env var is unset).
router.use("/issue-pipeline/machine", issuePipelineMachineRouter);

// Auth guard for all routes below
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
});

// Daily PIN lock, server side: writes that put a person's name on work
// (batches, table claims, checklist ticks, HACCP logs, packing/wrapping
// records…) are refused with 423 PIN_REQUIRED once the session's PIN is due
// (4am UTC / 10pm London). The list and rules: lib/pin-enforce.ts.
router.use(requireFreshPinForAttributingWrites);

// Admin-only middleware
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin") {
    next();
    return;
  }
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      if (user.role === "admin") { next(); return; }
    }
  }
  res.status(403).json({ error: "Admin access required" });
}

async function requireAdminOrManager(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin" || req.session.userRole === "manager") {
    next();
    return;
  }
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      if (user.role === "admin" || user.role === "manager") { next(); return; }
    }
  }
  res.status(403).json({ error: "Manager access required" });
}

// Protected routes
router.use("/users", usersRouter);
router.use("/todos", todosRouter);
router.use("/test-requests", testRequestsRouter);
router.use("/onboarding", onboardingRouter);
router.use("/category-defaults", categoryDefaultsRouter);
router.use("/suppliers", suppliersRouter);
router.use("/ingredients", ingredientsRouter);
router.use("/ingredients", ingredientScrapeRouter);
router.use("/upf", upfRouter);
// Standard prep time (autosaved on its own) — before the main router so its
// /:id/standard-prep-minutes paths are matched here.
router.use("/sub-recipes", subRecipePrepTimeRouter);
router.use("/sub-recipes", subRecipesRouter);
router.use("/recipes", recipeArchiveRouter);
router.use("/recipes", recipesRouter);
router.use("/recipe-collections", recipeCollectionsRouter);
router.use("/queued-production", queuedProductionRouter);
// Wonky + dog bin counters on plan items. Mounted BEFORE the frozen
// production-plans router so its paths (including the wonky ones moved out
// of it) are answered here.
router.use("/production-plans", qualityRejectsRouter);
// Taking wrapped packs back out of the fridge/freezer (the wrapping undo) —
// moved out of the frozen router 2026-10-08; refuses unconfirmed requests.
router.use("/production-plans", wrappingStorageUndoRouter);
// Building station "Edit production numbers" (batches + extra packs for one
// recipe, staged and saved in one transaction) — ahead of the frozen router.
router.use("/production-plans", buildingEditRouter);
// Extra packs + / − (building lines and the ovens) — moved out of the
// frozen router 2026-10-09; picks a building line when the ovens tap.
router.use("/production-plans", extraPacksRouter);
// Slow-meat tray limit check on plan create/save — also ahead of the frozen
// router, so no new code goes in production-plans.ts.
router.use("/production-plans", slowMeatPlanGuard);
router.use("/slow-meat", slowMeatRouter);
router.use("/production-plans", productionPlansRouter);
// Who is actually on each building table (last batch recorder + who opened
// it) — read-only, feeds the dashboard chooser and the building lock.
router.use("/building-tables", buildingTablesRouter);
// Builders' target finish time at 20 batches/hour — read-only, both tables.
router.use("/building-target-finish", buildingTargetFinishRouter);
router.use("/dpt-settings", requireAdminOrManager, dptSettingsRouter);
router.use("/timing-standards", timingStandardsRouter);
// Missing/stale schedule timing inputs + suggestions (manager/admin, read-only).
router.use("/timing-health", timingHealthRouter);
router.use("/team-efficiency", teamEfficiencyRouter);
router.use("/dpt-calculator", dptCalculatorRouter);
router.use("/stock-entries", stockRouter);
router.use("/eight-pack-stock", eightPackStockRouter);
router.use("/stock-items", stockItemsRouter);
router.use("/stock-gating", stockGatingRouter);
router.use("/sales-entries", salesRouter);
router.use("/dispatch-orders", dispatchesRouter);
router.use("/shopify", shopifyRouter);
router.use("/page-permissions", pagePermissionsRouter);
router.use("/app-settings", appSettingsRouter);
router.use("/reports", reportsRouter);
router.use("/fulfilment", fulfilmentRouter);
router.use("/fulfilment", fulfilmentAvailabilityRouter);
router.use("/fulfilment", apcBookingIssuesRouter);
router.use("/dpt-suggestions", dptSuggestionsRouter);
router.use("/temperature-records", temperatureRecordsRouter);
router.use("/oven-events", ovenEventsRouter);
router.use("/storage-locations", storageLocationsRouter);
router.use("/stock-transfers", stockTransfersRouter);
router.use("/dpt-ingredient-requirements", dptIngredientRequirementsRouter);
router.use("/kanbans", kanbansRouter);
router.use("/orders", ordersRouter);
// Primary + secondary supplier pack prices — minimum-order top-ups on Orders.
router.use("/supplier-pricing", supplierPricingRouter);
// Unexpected deliveries first: the deliveries router's GET /:id would
// otherwise read "unexpected" as a purchase-order id.
router.use("/deliveries/unexpected", unexpectedDeliveriesRouter);
router.use("/deliveries", deliveriesRouter);
// Collections — goods leaving the unit. Same audience as deliveries: anyone
// on the floor may be the one who meets the driver.
router.use("/collections", collectionsRouter);
// Case orders — planning is manager/admin, but the freezer-bag counting
// endpoint inside is used from the wrapping station by whoever is on it, so
// the router is mounted for all logged-in users and does not gate reads.
router.use("/case-orders", caseOrdersRouter);
router.use("/stock-control", stockControlRouter);
router.use("/founder-panels", founderPanelsRouter);
// Finance / VAT reconciliation — access gated inside the router (admin or
// isBookkeeper); mailbox settings admin-only at the route layer.
router.use("/finance", financeRouter);
// Feature grants (cherry-picked access, optional SOP-training gate).
router.use("/features", featuresRouter);
// Customer surveys — admin builds/reads them here; the public submission API
// is a separate unauthenticated router mounted directly in app.ts.
router.use("/surveys", requireAdmin, surveysRouter);
// Ad spend is the Numbers page's (founder + founder.numbers grantees) and
// must be mounted before founder-focus, whose whole router is founder-only.
router.use("/founder-focus/ad-spend", founderAdSpendRouter);
router.use("/founder-focus", founderFocusRouter);
// Meta Marketing API ad-spend sync — status + manual refresh for the
// Numbers page. Founder-gated inside the router; a no-op until the
// META_ADS_TOKEN / META_AD_ACCOUNT_ID env vars exist.
router.use("/meta-ads", metaAdsRouter);
// Old contracts filed on a person's record (uploaded PDF / photo): HR-records
// accounts + the employee themself only, guarded inside. Mounted BEFORE
// /contracts so "/uploaded" never reaches that router's "/:id".
router.use("/contracts/uploaded", uploadedContractsRouter);
// Employment contracts: founder-only surfaces guard themselves per-route
// inside the router; /mine and /:id are owner-scoped there too.
router.use("/contracts", contractsRouter);
// Starter forms: owner-scoped + HR-records access, guarded inside the router.
router.use("/starter-forms", starterFormsRouter);
router.use("/founder-sales", founderSalesRouter);
// Monthly revenue targets (minimum + per-month stretch): read by founder.numbers
// and founder.sales grantees, changed by the founder only — guarded inside.
router.use("/revenue-targets", revenueTargetsRouter);
// Marketing calendar (Sales & Marketing page): founder + "founder.sales"
// grantees, guarded inside the router.
// Planned emails on the calendar (same access, guarded inside the router).
router.use("/marketing-calendar/emails", marketingEmailsRouter);
// Approvals (2026-09-30): see founder.sales; approve = "marketing.approve_emails".
router.use("/marketing-calendar/approvals", marketingApprovalsRouter);
// To-dos on the calendar (2026-10-01): your own only; the founder may add
// other calendar users'. Read-only, guarded inside the router.
router.use("/marketing-calendar/todos", marketingTodosRouter);
router.use("/marketing-calendar", marketingCalendarRouter);
// Test-box scheduling (same access as Sales & Marketing, guarded inside).
// /:id/shopify/* — draft Shopify products for a box (guarded inside; writes
// also need manager/admin and go through the Shopify write guard).
router.use("/test-boxes", testBoxShopifyRouter);
router.use("/test-boxes", testBoxProductionRouter);
router.use("/test-boxes", testBoxesRouter);
// Numbers page trend graphs — founder account only, gated inside the router.
router.use("/founder-numbers", founderNumbersRouter);
router.use("/improvements", improvementsRouter);
router.use("/andon", andonRouter);
// Issue pipeline people side: Graeme's Fix queue (founder-gated per route)
// and each reporter's own "your report has been fixed" notices.
router.use("/issue-pipeline", issuePipelineRouter);
router.use("/qr", qrRouter);
router.use("/pnl", pnlRouter);
router.use("/checklists", checklistsRouter);
// Curiosity Time waste-spotting walks — every team member does these from
// the station checklist; the route file guards its own settings endpoints.
router.use("/curiosity", curiosityRouter);
router.use("/notifications", notificationsRouter);
router.use("/employees", employeesRouter);
// Return-to-work forms: private (colleague + named RTW managers), guarded
// per-route inside via middleware/rtw-access.ts.
router.use("/return-to-work", returnToWorkRouter);
// Old station-message endpoints: a shim over team messages for screens
// still running yesterday's app (routes/station-messages.ts).
router.use("/station-messages", stationMessagesRouter);
// Team messages — the WhatsApp-style chat (stations, people, Everyone,
// replies, @mentions). Signed-in only; who sees what is enforced inside.
router.use("/messages", messagesRouter);
// Contacts directory: anyone signed in reads; managers/admins edit (guarded
// inside routes/contacts.ts).
router.use("/contacts", contactsRouter);
// What APC customer service said about a postcode restriction: anyone
// signed in records (the packer makes the call); clearing is guarded inside.
router.use("/apc-postcode-overrides", apcPostcodeOverridesRouter);
// Staff emergency contacts: your own for everyone; colleagues' for
// managers/admins (every reveal logged); the People record's copy behind
// People access + private PIN. Guarded per route inside.
router.use("/staff-emergency-contacts", staffEmergencyContactsRouter);
// People section: anyone with People access must have SET their private
// PIN (428 until they do) and unlocked People with it recently (423)
// (middleware/people-unlock.ts); everyone else passes straight through to
// their own record.
router.use("/employee-reviews", requirePeopleUnlock, employeeReviewsRouter);
// People — the list and each person's record (routes/people.ts): People
// access only (403 otherwise, checked inside), private PIN set + unlocked.
router.use("/people", requirePeopleUnlock, peopleRouter);
// Documents on a person's record (routes/person-documents.ts). The People
// side sits behind requirePeopleUnlock + People access INSIDE the router,
// after /mine — the employee's own shared documents, which must never ask
// for the People PIN. Founder-only documents are re-checked per request.
router.use("/person-documents", personDocumentsRouter);
// Who has People access — the founder's per-person switch in Settings →
// Team & Access. Admin read, founder-only write, guarded inside the router.
router.use("/people-access", peopleAccessRouter);
// Product labels Stage 1 — template, per-recipe settings, live versions.
// Reads for anyone signed in; writes manager/admin (guarded inside).
router.use("/product-labels", productLabelsRouter);
router.use("/fried-chicken", friedChickenRouter);
router.use("/risk-assessments", riskAssessmentsRouter);
router.use("/compliance-actions", complianceActionsRouter);
router.use("/standards", standardsRouter);
router.use("/ai", aiRouter);
router.use("/morning-meetings", morningMeetingsRouter);
router.use("/end-of-day", endOfDayRouter);
// Defects: anyone signed in may record one; edits, deletes and the type list
// are guarded inside the router (routes/defects.ts).
router.use("/defects", defectsRouter);
// One-off walkthroughs, per signed-in person (routes/user-tours.ts).
router.use("/user-tours", userToursRouter);
// Per-user, so NOT behind the manager guard — every team member completes
// their own weekly lesson review (route file guards each endpoint).
router.use("/lean-reviews", leanReviewsRouter);
// Designing the curriculum is a manager-and-above job — the whole planner
// (backlog, plan order, lesson writing, locking a week in) sits behind the
// same guard as the training matrix it keeps in step with.
router.use("/lean-curriculum", requireAdminOrManager, leanCurriculumRouter);
router.use("/forms", formsRouter);
router.use("/system-updates", systemUpdatesRouter);
router.use("/label-stock", labelStockRouter);
// Prep-room label printing. Open to all logged-in staff — anyone opening a
// bag of chicken prints the label; the bridge endpoints inside carry their
// own token auth.
router.use("/print-jobs", printJobsRouter);
router.use("/prep-linked-completions", prepLinkedCompletionsRouter);
router.use("/plan-move", planMoveRouter);
router.use("/dictation", dictationRouter);
router.use("/ice-packs", icePacksRouter);
router.use("/wholesale-bags", requireAdminOrManager, wholesaleBagsRouter);
router.use("/bundles", requireAdminOrManager, bundlesRouter);
router.use("/training", requireAdminOrManager, trainingRouter);
// Accident & incident diary — a manager's HACCP due-diligence tool.
router.use("/incidents", requireAdminOrManager, incidentsRouter);
// Self-service "I've read and understood" from the document viewer — every
// colleague confirms their own reading, so no manager guard; the router
// scopes everything to the session user.
router.use("/training-ack", trainingAcknowledgeRouter);
// Station SOP training — every colleague reviews the SOPs on the front of
// the stations they work, from the station gate or the matrix. Writes are
// scoped to the session user; the kill switch inside is admin-only.
router.use("/station-training", stationTrainingRouter);
router.use("/govee", goveeRouter);
// Visitor book. Open to all logged-in staff — anyone on the floor may be the
// one who greets a visitor and hands them the iPad.
router.use("/visitors", visitorsRouter);

// Caz assistant. Open to ALL logged-in staff — the route itself gives each
// user only the read tools their role permits, and reserves recipe-design /
// memory writes for the founder (was mounted behind requireFounder before Caz
// opened up; the founder gate now lives inside the route per-capability).
router.use("/recipe-designer", recipeDesignerRouter);

router.post("/backup/trigger", requireAdmin, (_req: Request, res: Response) => {
  res.json({ status: "started", message: "Backup triggered" });
  runBackup().catch((err) => {
    console.error("[backup] Manual trigger failed:", err instanceof Error ? err.message : String(err));
  });
});

export default router;
