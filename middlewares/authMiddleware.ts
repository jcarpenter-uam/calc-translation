import { Elysia } from "elysia";
import { verifyToken } from "../utils/security";
import { logger } from "../core/logger";
import { hasAllowedRole } from "../utils/accessPolicy";
import { resolveSessionContext } from "../utils/sessionPolicy";

/**
 * Validates the HttpOnly API session cookie and rejects WebSocket tickets on HTTP routes.
 */
export const requireAuth = (app: Elysia) =>
  app
    .derive(async ({ cookie: { auth_session } }) => {
      const token =
        typeof auth_session?.value === "string" ? auth_session.value : undefined;

      if (!token) {
        logger.debug("API Auth: No auth_session cookie found.");
      }

      const payload = token ? await verifyToken(token) : null;

      if (payload?.purpose === "websocket_ticket") {
        logger.warn("API auth rejected websocket ticket token.", {
          userId: payload.userId,
        });
        return { user: null, tenantId: null };
      }

      const { user, tenantId } = await resolveSessionContext(payload);

      return {
        user,
        tenantId,
      };
    })
    .onBeforeHandle(({ user, set, request }) => {
      if (!user) {
        const url = new URL(request.url);
        logger.warn("Unauthorized API request blocked.", {
          method: request.method,
          path: url.pathname,
        });
        set.status = 401;
        return { error: "Unauthorized - API session required" };
      }

      logger.debug("API request authorized.", {
        userId: user.id,
      });
    });

/**
 * Validates the WebSocket ticket query parameter and rejects normal API sessions.
 */
export const requireWsAuth = (app: Elysia) =>
  app
    .derive(async ({ query }) => {
      const ticket = query.ticket as string;

      if (!ticket) {
        logger.debug("WS Auth: No ticket query parameter found.");
      }

      const payload = ticket ? await verifyToken(ticket) : null;

      // WebSocket routes only accept short-lived tickets so API session cookies cannot be reused
      // as socket credentials.
      if (!payload || payload.purpose !== "websocket_ticket") {
        logger.warn("WebSocket auth rejected ticket.", {
          reason: !payload ? "missing_payload" : "wrong_token_purpose",
        });
        return { wsUser: null, wsTenantId: null };
      }

      const { user, tenantId } = await resolveSessionContext(payload);
      return {
        wsUser: user,
        wsTenantId: tenantId,
      };
    })
    .onBeforeHandle(({ wsUser, set }) => {
      if (!wsUser) {
        logger.warn("Unauthorized WebSocket connection blocked.");
        set.status = 401;
        return "Unauthorized - Valid WebSocket ticket required";
      }

      logger.debug("WebSocket connection authorized.", {
        userId: wsUser.id,
      });
    });

/**
 * Middleware: Enforces that the authenticated user has a specific role.
 * MUST be chained after `requireAuth`.
 */
export const requireRole = (allowedRoles: string[]) => (app: Elysia) =>
  app.onBeforeHandle(({ user, set }: any) => {
    const isAllowed = hasAllowedRole(user, allowedRoles);
    if (!isAllowed) {
      logger.warn("Access to restricted route denied by role policy.", {
        userId: user?.id,
        userRole: user?.role,
        allowedRoles,
      });
      set.status = 403;
      return { error: "Forbidden - Insufficient permissions" };
    }
  });
