import { Elysia } from "elysia";
import { systemMetrics } from "../controllers/metricsController";

// TODO: Protect this route
export const metricRoutes = new Elysia({ prefix: "/metrics" }).get(
  "/",
  systemMetrics,
);
