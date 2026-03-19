import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import ingredientsRouter from "./ingredients";
import subRecipesRouter from "./sub-recipes";
import recipesRouter from "./recipes";
import productionPlansRouter from "./production-plans";
import dptSettingsRouter from "./dpt-settings";
import timingStandardsRouter from "./timing-standards";
import dptCalculatorRouter from "./dpt-calculator";
import stockRouter from "./stock";
import salesRouter from "./sales";
import dispatchesRouter from "./dispatches";
import suppliersRouter from "./suppliers";
import usersRouter from "./users";
import categoryDefaultsRouter from "./category-defaults";
import shopifyRouter from "./shopify";
import pagePermissionsRouter from "./page-permissions";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use("/auth", authRouter);

// Auth guard for all routes below
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
});

// Admin-only middleware
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
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
router.use("/sales-entries", salesRouter);
router.use("/dispatch-orders", dispatchesRouter);
router.use("/shopify", shopifyRouter);
router.use("/page-permissions", pagePermissionsRouter);

export default router;
