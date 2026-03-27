import { and, eq, isNull } from "drizzle-orm";
import { db } from "../core/database";
import { logger } from "../core/logger";
import { userTenants } from "../models/userTenantModel";
import { users } from "../models/userModel";
import { isSuperAdmin } from "./accessPolicy";

/**
 * Decoded auth token payload used to rebuild request context.
 */
export interface AuthSessionPayload {
  userId?: unknown;
  tenantId?: unknown;
  purpose?: unknown;
}

/**
 * Result of resolving a request session from a decoded token payload.
 */
export interface ResolvedSessionContext {
  user: typeof users.$inferSelect | null;
  tenantId: string | null;
}

function getPayloadValue(payload: unknown, key: keyof AuthSessionPayload) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  return (payload as AuthSessionPayload)[key];
}

/**
 * Loads the authenticated user and validates the tenant context for non-super-admin sessions.
 */
export async function resolveSessionContext(
  payload: unknown,
): Promise<ResolvedSessionContext> {
  const userId = getPayloadValue(payload, "userId");
  if (typeof userId !== "string" || userId.length === 0) {
    logger.debug("Authentication payload is empty or missing userId.");
    return { user: null, tenantId: null };
  }

  logger.debug("Fetching user record from token payload.", {
    userId,
  });

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));

  if (!user) {
    logger.warn("Token references missing user record.", {
      userId,
    });
    return { user: null, tenantId: null };
  }

  const rawTenantId = getPayloadValue(payload, "tenantId");
  const tenantId =
    typeof rawTenantId === "string" && rawTenantId.trim().length > 0
      ? rawTenantId
      : null;

  if (!tenantId || isSuperAdmin(user)) {
    return { user, tenantId };
  }

  const [membership] = await db
    .select({ userId: userTenants.userId })
    .from(userTenants)
    .where(
      and(eq(userTenants.userId, user.id), eq(userTenants.tenantId, tenantId)),
    );

  if (!membership) {
    logger.warn("Token references tenant without active membership.", {
      userId: user.id,
      tenantId,
    });
    return { user: null, tenantId: null };
  }

  return { user, tenantId };
}

/**
 * Enforces that a request has an active tenant context before continuing.
 */
export function requireTenantContext(
  tenantId: string | null | undefined,
  set: { status?: number },
) {
  if (!tenantId) {
    set.status = 400;
    return null;
  }

  return tenantId;
}
