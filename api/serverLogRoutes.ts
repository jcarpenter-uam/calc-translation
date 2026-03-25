import { Elysia, t } from "elysia";
import { getServerLogs } from "../controllers/serverLogController";

/**
 * Super-admin server log inspection routes.
 */
export const serverLogRoutes = new Elysia({ prefix: "/server-logs" }).get(
  "/",
  getServerLogs,
  {
    query: t.Object({
      lines: t.Optional(t.Numeric()),
    }),
  },
);
