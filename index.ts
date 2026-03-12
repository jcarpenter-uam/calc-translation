import { env } from "./core/config";
import { testDbConnection, runMigrations } from "./core/database";
import { logger } from "./core/logger";
import { Elysia } from "elysia";
import { meetingRoutes } from "./api/meetingRoutes";
import { websocketRoute } from "./api/websocketRoute";
import { authRoutes } from "./api/authRoutes";

// Test DB Connection
await testDbConnection();

// Execute migrations before starting the server
await runMigrations();

const app = new Elysia()
  .use(websocketRoute)
  .group("/api", (app) => app.use(meetingRoutes).use(authRoutes))
  .listen(env.PORT);

logger.info(`Server is running at ${app.server?.hostname}:${app.server?.port}`);
