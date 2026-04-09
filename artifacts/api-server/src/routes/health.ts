import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { appEnv } from "../lib/app-env";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Tiny unauthenticated endpoint returning the deployment environment so
// the frontend can show a "STAGING" banner without needing login. Does
// not leak any sensitive info — just "production" | "staging" | "development".
router.get("/env", (_req, res) => {
  res.json({ appEnv: appEnv() });
});

export default router;
