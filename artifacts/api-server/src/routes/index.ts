import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import ingredientsRouter from "./ingredients";
import subRecipesRouter from "./sub-recipes";
import recipesRouter from "./recipes";
import productionPlansRouter from "./production-plans";
import dptSettingsRouter from "./dpt-settings";
import timingStandardsRouter from "./timing-standards";
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
import temperatureRecordsRouter from "./temperature-records";
import ovenEventsRouter from "./oven-events";
import invitesRouter from "./invites";
import storageLocationsRouter from "./storage-locations";
import stockTransfersRouter from "./stock-transfers";
import dptIngredientRequirementsRouter from "./dpt-ingredient-requirements";
import kanbansRouter from "./kanbans";
import ordersRouter from "./orders";
import deliveriesRouter from "./deliveries";
import stockControlRouter from "./stock-control";
import founderPanelsRouter from "./founder-panels";
import improvementsRouter from "./improvements";
import andonRouter from "./andon";
import qrRouter from "./qr";
import pnlRouter from "./pnl";
import checklistsRouter from "./checklists";
import notificationsRouter from "./notifications";
import employeesRouter from "./employees";
import riskAssessmentsRouter from "./risk-assessments";
import complianceActionsRouter from "./compliance-actions";
import standardsRouter from "./standards";
import aiRouter from "./ai";
import recipeDesignerRouter from "./recipe-designer";
import morningMeetingsRouter from "./morning-meetings";
import ingredientScrapeRouter from "./ingredient-scrape";
import upfRouter from "./upf";
import formsRouter from "./forms";
import systemUpdatesRouter from "./system-updates";
import labelStockRouter from "./label-stock";
import icePacksRouter from "./ice-packs";
import wholesaleBagsRouter from "./wholesale-bags";
import bundlesRouter from "./bundles";
import trainingRouter from "./training";
import onboardingRouter from "./onboarding";
import goveeRouter from "./govee";
import visitorsRouter from "./visitors";
import collectionsRouter from "./collections";
import recipeCollectionsRouter from "./recipe-collections";
import queuedProductionRouter from "./queued-production";
import caseOrdersRouter from "./case-orders";
import founderFocusRouter from "./founder-focus";
import todosRouter from "./todos";
import founderSalesRouter from "./founder-sales";
import surveysRouter from "./surveys";
import { runBackup } from "../lib/backup";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/auth", invitesRouter);
router.use(storageRouter);

// Auth guard for all routes below
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
});

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
router.use("/onboarding", onboardingRouter);
router.use("/category-defaults", categoryDefaultsRouter);
router.use("/suppliers", suppliersRouter);
router.use("/ingredients", ingredientsRouter);
router.use("/ingredients", ingredientScrapeRouter);
router.use("/upf", upfRouter);
router.use("/sub-recipes", subRecipesRouter);
router.use("/recipes", recipesRouter);
router.use("/recipe-collections", recipeCollectionsRouter);
router.use("/queued-production", queuedProductionRouter);
router.use("/production-plans", productionPlansRouter);
router.use("/dpt-settings", requireAdminOrManager, dptSettingsRouter);
router.use("/timing-standards", timingStandardsRouter);
router.use("/dpt-calculator", dptCalculatorRouter);
router.use("/stock-entries", stockRouter);
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
router.use("/temperature-records", temperatureRecordsRouter);
router.use("/oven-events", ovenEventsRouter);
router.use("/storage-locations", storageLocationsRouter);
router.use("/stock-transfers", stockTransfersRouter);
router.use("/dpt-ingredient-requirements", dptIngredientRequirementsRouter);
router.use("/kanbans", kanbansRouter);
router.use("/orders", ordersRouter);
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
// Customer surveys — admin builds/reads them here; the public submission API
// is a separate unauthenticated router mounted directly in app.ts.
router.use("/surveys", requireAdmin, surveysRouter);
router.use("/founder-focus", founderFocusRouter);
router.use("/founder-sales", founderSalesRouter);
router.use("/improvements", improvementsRouter);
router.use("/andon", andonRouter);
router.use("/qr", qrRouter);
router.use("/pnl", pnlRouter);
router.use("/checklists", checklistsRouter);
router.use("/notifications", notificationsRouter);
router.use("/employees", employeesRouter);
router.use("/risk-assessments", riskAssessmentsRouter);
router.use("/compliance-actions", complianceActionsRouter);
router.use("/standards", standardsRouter);
router.use("/ai", aiRouter);
router.use("/morning-meetings", morningMeetingsRouter);
router.use("/forms", formsRouter);
router.use("/system-updates", systemUpdatesRouter);
router.use("/label-stock", labelStockRouter);
router.use("/ice-packs", icePacksRouter);
router.use("/wholesale-bags", requireAdminOrManager, wholesaleBagsRouter);
router.use("/bundles", requireAdminOrManager, bundlesRouter);
router.use("/training", requireAdminOrManager, trainingRouter);
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
