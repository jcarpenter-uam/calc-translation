import { Elysia } from "elysia";
import { systemMetrics } from "../controllers/metricsController";

/**
 * Prometheus metrics route.
 */
export const metricRoutes = new Elysia({ prefix: "/metrics" }).get(
  "/",
  systemMetrics,
);
