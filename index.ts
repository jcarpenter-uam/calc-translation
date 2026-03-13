import { env } from "./core/config";
import { testDbConnection, runMigrations } from "./core/database";
import { logger } from "./core/logger";
import { Elysia } from "elysia";
import { meetingRoutes } from "./api/meetingRoutes";
import { websocketRoute } from "./api/websocketRoute";
import { authRoutes } from "./api/authRoutes";
import { requireWsAuth, requireAuth } from "./middlewares/authMiddleware";
import { metricRoutes } from "./api/metricRoutes";

// Test DB Connection
await testDbConnection();

// Execute migrations before starting the server
await runMigrations();

const app = new Elysia()
  // Mount the isolated WebSocket routes
  .guard({}, (wsApp) => wsApp.use(requireWsAuth).use(websocketRoute))

  // Mount the API routes
  .group("/api", (api) =>
    api
      .use(authRoutes)
      .use(metricRoutes)
      .guard({}, (protectedApi) =>
        protectedApi.use(requireAuth).use(meetingRoutes),
      ),
  )
  .listen(env.PORT);

logger.info(`Server is running at ${app.server?.hostname}:${app.server?.port}`);
