import { env } from "./core/config";
import { testDbConnection } from "./core/database";
import { logger } from "./core/logger";
import { Elysia } from "elysia";
import { meetingRoutes } from "./api/meetingRoutes";

// Test DB Connection
await testDbConnection();

const app = new Elysia()
  .group("/api/meeting", (app) => app.use(meetingRoutes))
  .listen(env.PORT);

logger.info(`Server is running at ${app.server?.hostname}:${app.server?.port}`);
