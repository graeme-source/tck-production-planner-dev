import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ingredientsRouter from "./ingredients";
import subRecipesRouter from "./sub-recipes";
import recipesRouter from "./recipes";
import productionPlansRouter from "./production-plans";
import stockRouter from "./stock";
import salesRouter from "./sales";
import dispatchesRouter from "./dispatches";
import suppliersRouter from "./suppliers";
import usersRouter from "./users";
import categoryDefaultsRouter from "./category-defaults";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/users", usersRouter);
router.use("/category-defaults", categoryDefaultsRouter);
router.use("/suppliers", suppliersRouter);
router.use("/ingredients", ingredientsRouter);
router.use("/sub-recipes", subRecipesRouter);
router.use("/recipes", recipesRouter);
router.use("/production-plans", productionPlansRouter);
router.use("/stock-entries", stockRouter);
router.use("/sales-entries", salesRouter);
router.use("/dispatch-orders", dispatchesRouter);

export default router;
