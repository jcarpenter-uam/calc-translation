import { env } from "./core/config";
import { testDbConnection } from "./core/database";
import { logger } from "./core/logger";
import { Elysia } from "elysia";
import { meetingRoutes } from "./api/meetingRoutes";
import { websocketRoute } from "./api/websocketRoute";

// Test DB Connection
await testDbConnection();

const app = new Elysia()
  .use(meetingRoutes)
  .use(websocketRoute)
  .listen(env.PORT);

logger.info(`Server is running at ${app.server?.hostname}:${app.server?.port}`);
