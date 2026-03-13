import { Elysia } from "elysia";
import { verifyToken } from "../utils/security";
import { db } from "../core/database";
import { users } from "../models/userModel";
import { eq } from "drizzle-orm";
import { logger } from "../core/logger";

/**
 * Helper to fetch user from DB based on decoded JWT payload
 */
async function getAuthenticatedUser(payload: any) {
  if (!payload || !payload.userId) {
    logger.debug("Authentication payload is empty or missing userId.");
    return null;
  }

  logger.debug(`Fetching user record for ID: ${payload.userId}`);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.userId));

  if (!user) {
    logger.warn(
      `User ID ${payload.userId} found in token, but no matching record exists in the database.`,
    );
  }

  return user || null;
}

/**
 * API Middleware: Validates the HttpOnly 'auth_session' cookie.
 */
export const requireAuth = (app: Elysia) =>
  app
    .derive(async ({ cookie: { auth_session } }) => {
      const token = auth_session?.value;

      if (!token) {
        logger.debug("API Auth: No auth_session cookie found.");
      }

      const payload = token ? await verifyToken(token) : null;

      if (payload?.purpose === "websocket_ticket") {
        logger.warn(
          `API Auth: Rejected token with 'websocket_ticket' purpose for user ID: ${payload.userId}.`,
        );
        return { user: null, tenantId: null };
      }

      const user = await getAuthenticatedUser(payload);

      return {
        user,
        tenantId: (payload as any)?.tenantId || null,
      };
    })
    .onBeforeHandle(({ user, set, request }) => {
      if (!user) {
        const url = new URL(request.url);
        logger.warn(
          `Unauthorized API request blocked: ${request.method} ${url.pathname}`,
        );
        set.status = 401;
        return { error: "Unauthorized - API session required" };
      }

      logger.debug(`API Auth: Request authorized for ${user.email}`);
    });

/**
 * WebSocket Middleware: Validates the '?ticket=' query parameter.
 */
export const requireWsAuth = (app: Elysia) =>
  app
    .derive(async ({ query }) => {
      const ticket = query.ticket as string;

      if (!ticket) {
        logger.debug("WS Auth: No ticket query parameter found.");
      }

      const payload = ticket ? await verifyToken(ticket) : null;

      // Strict Check: Only allow tokens explicitly marked for WebSockets
      if (!payload || payload.purpose !== "websocket_ticket") {
        logger.warn(
          "WS Auth: Rejected ticket. Invalid payload or wrong token purpose.",
        );
        return { wsUser: null, wsTenantId: null };
      }

      const user = await getAuthenticatedUser(payload);
      return {
        wsUser: user,
        wsTenantId: (payload as any)?.tenantId || null,
      };
    })
    .onBeforeHandle(({ wsUser, set }) => {
      if (!wsUser) {
        logger.warn("Unauthorized WebSocket connection blocked.");
        set.status = 401;
        return "Unauthorized - Valid WebSocket ticket required";
      }

      logger.debug(`WS Auth: Connection authorized for ${wsUser.email}`);
    });

/**
 * Middleware: Enforces that the authenticated user has a specific role.
 * MUST be chained after `requireAuth`.
 */
export const requireRole = (allowedRoles: string[]) => (app: Elysia) =>
  app.onBeforeHandle(({ user, set }: any) => {
    if (!user || !allowedRoles.includes(user.role)) {
      logger.warn(
        `User ${user?.email} attempted to access restricted route requiring roles: ${allowedRoles.join(", ")}`,
      );
      set.status = 403;
      return { error: "Forbidden - Insufficient permissions" };
    }
  });
