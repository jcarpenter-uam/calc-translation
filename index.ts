import { env } from "./core/config";
import { testDbConnection, runMigrations } from "./core/database";
import { logger } from "./core/logger";
import { Elysia } from "elysia";
import { meetingRoutes } from "./api/meetingRoutes";
import { websocketRoute } from "./api/websocketRoute";
import { authRoutes } from "./api/authRoutes";
import { requireWsAuth, requireAuth } from "./middlewares/authMiddleware";
import { metricRoutes } from "./api/metricRoutes";

const requestStartTimes = new WeakMap<Request, number>();

let app: ReturnType<typeof buildApp> | null = null;

/**
 * Builds the application with all hooks, routes, and guards.
 */
export function buildApp() {
  return new Elysia()
    .onRequest(({ request }) => {
      requestStartTimes.set(request, Date.now());
    })
    .onAfterHandle(({ request, set }) => {
      const start = requestStartTimes.get(request) || Date.now();
      const durationMs = Date.now() - start;
      requestStartTimes.delete(request);

      const url = new URL(request.url);
      const status = typeof set.status === "number" ? set.status : 200;
      const message = `${request.method} ${url.pathname} -> ${status} (${durationMs}ms)`;

      if (status >= 500) {
        logger.error(message);
        return;
      }

      if (status >= 400) {
        logger.warn(message);
        return;
      }

      logger.debug(message);
    })
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
    );
}

/**
 * Starts the HTTP and WebSocket server and applies startup checks.
 */
export async function startServer(port = env.PORT) {
  if (app?.server) {
    return app;
  }

  await testDbConnection();
  await runMigrations();

  const startedApp = buildApp().listen(port);
  app = startedApp;
  logger.info(
    `Server is running at ${startedApp.server?.hostname}:${startedApp.server?.port}`,
  );

  return startedApp;
}

/**
 * Stops the running server instance when available.
 */
export async function stopServer() {
  if (!app) {
    return;
  }

  app.stop();
  app = null;
}

if (import.meta.main) {
  await startServer();
}
