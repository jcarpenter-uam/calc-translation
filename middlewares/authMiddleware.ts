import { Elysia } from "elysia";
import { verifyToken } from "../utils/security";
import { db } from "../core/database";
import { users } from "../models/userModel";
import { eq } from "drizzle-orm";

/**
 * Helper to fetch user from DB based on decoded JWT payload
 */
async function getAuthenticatedUser(payload: any) {
  if (!payload || !payload.userId) return null;
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.userId));
  return user || null;
}

/**
 * API Middleware: Validates the HttpOnly 'auth_session' cookie.
 */
export const requireAuth = (app: Elysia) =>
  app
    .derive(async ({ cookie: { auth_session }, request }) => {
      const token = auth_session?.value;

      const payload = token ? await verifyToken(token) : null;

      if (payload?.purpose === "websocket_ticket") {
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
        set.status = 401;
        return { error: "Unauthorized - API session required" };
      }
    });

/**
 * WebSocket Middleware: Validates the '?ticket=' query parameter.
 */
export const requireWsAuth = (app: Elysia) =>
  app
    .derive(async ({ query }) => {
      const ticket = query.ticket as string;
      const payload = ticket ? await verifyToken(ticket) : null;

      // Strict Check: Only allow tokens explicitly marked for WebSockets
      if (!payload || payload.purpose !== "websocket_ticket") {
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
        set.status = 401;
        return "Unauthorized - Valid WebSocket ticket required";
      }
    });
