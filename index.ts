import { env } from "./core/config";
import { testDbConnection, runMigrations } from "./core/database";
import { logger } from "./core/logger";
import { Elysia } from "elysia";
import { meetingRoutes } from "./api/meetingRoutes";
import { websocketRoute } from "./api/websocketRoute";
import { authRoutes } from "./api/authRoutes";
import { requireWsAuth, requireAuth } from "./middlewares/authMiddleware";

// Test DB Connection
await testDbConnection();

// Execute migrations before starting the server
await runMigrations();

const app = new Elysia()
  // Log every incoming request
  .onRequest(({ request }) => {
    const url = new URL(request.url);
    logger.debug(`Incoming Request: ${request.method} ${url.pathname}`);
  })

  // Catch and log routing errors (like 404s or wrong methods)
  .onError(({ code, error, request }) => {
    const url = new URL(request.url);

    if (code === "NOT_FOUND") {
      logger.warn(`404 Not Found: ${request.method} ${url.pathname}`);
    } else {
      logger.error(
        `Error [${code}]: ${error.message} on ${request.method} ${url.pathname}`,
      );
    }
  })

  // Mount the isolated WebSocket routes
  .guard({}, (wsApp) => wsApp.use(requireWsAuth).use(websocketRoute))

  // Mount the API routes
  .group("/api", (api) =>
    api
      .use(authRoutes)
      .guard({}, (protectedApi) =>
        protectedApi.use(requireAuth).use(meetingRoutes),
      ),
  )
  .listen(env.PORT);

logger.info(`Server is running at ${app.server?.hostname}:${app.server?.port}`);
