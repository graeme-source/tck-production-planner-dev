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

// Protected routes
router.use("/users", usersRouter);
router.use("/category-defaults", categoryDefaultsRouter);
router.use("/suppliers", suppliersRouter);
router.use("/ingredients", ingredientsRouter);
router.use("/sub-recipes", subRecipesRouter);
router.use("/recipes", recipesRouter);
router.use("/production-plans", productionPlansRouter);
router.use("/dpt-settings", requireAdmin, dptSettingsRouter);
router.use("/timing-standards", timingStandardsRouter);
router.use("/dpt-calculator", dptCalculatorRouter);
router.use("/stock-entries", stockRouter);
router.use("/stock-items", stockItemsRouter);
router.use("/sales-entries", salesRouter);
router.use("/dispatch-orders", dispatchesRouter);
router.use("/shopify", shopifyRouter);
router.use("/page-permissions", pagePermissionsRouter);
router.use("/app-settings", appSettingsRouter);
router.use("/reports", reportsRouter);
router.use("/fulfilment", fulfilmentRouter);
router.use("/temperature-records", temperatureRecordsRouter);
router.use("/oven-events", ovenEventsRouter);
router.use("/storage-locations", storageLocationsRouter);
router.use("/stock-transfers", stockTransfersRouter);
router.use("/dpt-ingredient-requirements", dptIngredientRequirementsRouter);
router.use("/kanbans", kanbansRouter);
router.use("/orders", ordersRouter);
router.use("/deliveries", deliveriesRouter);
router.use("/stock-control", stockControlRouter);
router.use("/founder-panels", founderPanelsRouter);
router.use("/improvements", improvementsRouter);
router.use("/andon", andonRouter);
router.use("/qr", qrRouter);

export default router;
