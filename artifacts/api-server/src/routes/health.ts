import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { appEnv, blockShopifyWrites } from "../lib/app-env";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Tiny unauthenticated endpoint returning the deployment environment so
// the frontend can show a "STAGING" banner without needing login. Does
// not leak any sensitive info — just "production" | "staging" | "development",
// plus whether Shopify writes are blocked on this instance, so a dev machine
// pointed at the live store can be checked at a glance before testing.
router.get("/env", (_req, res) => {
  res.json({ appEnv: appEnv(), shopifyWritesBlocked: blockShopifyWrites() });
});

export default router;
