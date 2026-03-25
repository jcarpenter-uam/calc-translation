import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "../core/database";
import { logger } from "../core/logger";
import { tenants } from "../models/tenantModel";
import { users } from "../models/userModel";
import { userTenants } from "../models/userTenantModel";

const TENANT_ADMIN_EDITABLE_ROLES = new Set(["user", "tenant_admin"]);

/**
 * Resolves the effective tenant scope for admin user-management routes.
 */
async function resolveScopedTenantId({
  user,
  sessionTenantId,
  targetTenantId,
  set,
}: {
  user: { role?: string };
  sessionTenantId: string | null;
  targetTenantId: string;
  set: { status?: number };
}) {
  if (!sessionTenantId) {
    set.status = 400;
    return { error: "Missing tenant context", tenantId: null };
  }

  if (user.role === "tenant_admin") {
    if (targetTenantId !== sessionTenantId) {
      set.status = 403;
      return {
        error: "Tenant admins can only manage users in their own tenant",
        tenantId: null,
      };
    }

    return { error: null, tenantId: sessionTenantId };
  }

  if (user.role !== "super_admin") {
    set.status = 403;
    return { error: "Forbidden - Insufficient permissions", tenantId: null };
  }

  const [tenant] = await db
    .select({ id: tenants.tenantId })
    .from(tenants)
    .where(eq(tenants.tenantId, targetTenantId));

  if (!tenant) {
    set.status = 404;
    return { error: "Tenant not found", tenantId: null };
  }

  return { error: null, tenantId: targetTenantId };
}

/**
 * Lists tenants available for admin management.
 */
export const listTenants = async ({ user, tenantId, set }: any) => {
  const requesterId = user?.id || "unknown_user";

  if (!tenantId) {
    set.status = 400;
    return { error: "Missing tenant context" };
  }

  try {
    const scopedTenants =
      user.role === "super_admin"
        ? await db
            .select({
              id: tenants.tenantId,
              name: tenants.organizationName,
            })
            .from(tenants)
            .orderBy(asc(tenants.organizationName), asc(tenants.tenantId))
        : await db
            .select({
              id: tenants.tenantId,
              name: tenants.organizationName,
            })
            .from(tenants)
            .where(eq(tenants.tenantId, tenantId));

    return { tenants: scopedTenants };
  } catch (err) {
    logger.error("Failed to list tenants for admin routes.", {
      requesterId,
      tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to list tenants" };
  }
};

/**
 * Lists active users in a tenant with optional search and pagination.
 */
export const listTenantUsers = async ({ params, query, user, tenantId, set }: any) => {
  const requesterId = user?.id || "unknown_user";

  try {
    const targetTenantId = String(params.tenantId);
    const { tenantId: scopedTenantId, error } = await resolveScopedTenantId({
      user,
      sessionTenantId: tenantId,
      targetTenantId,
      set,
    });

    if (error || !scopedTenantId) {
      return { error: error || "Missing tenant context" };
    }

    const q = typeof query?.q === "string" ? query.q.trim() : "";
    const role = typeof query?.role === "string" ? query.role : null;
    const rawLimit = Number(query?.limit ?? 50);
    const rawOffset = Number(query?.offset ?? 0);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
      : 50;
    const offset = Number.isFinite(rawOffset)
      ? Math.max(Math.floor(rawOffset), 0)
      : 0;

    const filters = [
      eq(userTenants.tenantId, scopedTenantId),
      isNull(users.deletedAt),
    ];

    if (role) {
      filters.push(eq(users.role, role as any));
    }

    if (q.length > 0) {
      filters.push(
        or(
          ilike(users.name, `%${q}%`),
          ilike(users.email, `%${q}%`),
        )!,
      );
    }

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        languageCode: users.languageCode,
      })
      .from(userTenants)
      .innerJoin(users, eq(userTenants.userId, users.id))
      .where(and(...filters))
      .orderBy(asc(users.name), asc(users.id))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const tenantUsers = hasMore ? rows.slice(0, limit) : rows;

    logger.debug("Tenant user list retrieved.", {
      requesterId,
      tenantId: scopedTenantId,
      count: tenantUsers.length,
      q,
      role,
      limit,
      offset,
    });

    return {
      users: tenantUsers,
      pageInfo: {
        limit,
        offset,
        returned: tenantUsers.length,
        hasMore,
      },
    };
  } catch (err) {
    logger.error("Failed to list tenant users.", {
      requesterId,
      tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to list users" };
  }
};

/**
 * Updates another user in the requester's tenant.
 */
export const updateTenantUser = async ({ params, body, user, tenantId, set }: any) => {
  const requesterId = user?.id || "unknown_user";
  const targetUserId = String(params.id);

  try {
    const targetTenantId = String(params.tenantId);
    const { tenantId: scopedTenantId, error } = await resolveScopedTenantId({
      user,
      sessionTenantId: tenantId,
      targetTenantId,
      set,
    });

    if (error || !scopedTenantId) {
      return { error: error || "Missing tenant context" };
    }

    const [membership] = await db
      .select({ userId: userTenants.userId })
      .from(userTenants)
      .where(
        and(
          eq(userTenants.tenantId, scopedTenantId),
          eq(userTenants.userId, targetUserId),
        ),
      );

    if (!membership) {
      set.status = 404;
      return { error: "User not found in this tenant" };
    }

    const updatePayload: {
      role?: "user" | "tenant_admin" | "super_admin";
    } = {};

    if (body.role !== undefined) {
      if (
        user.role === "tenant_admin" &&
        !TENANT_ADMIN_EDITABLE_ROLES.has(body.role)
      ) {
        set.status = 403;
        return { error: "Tenant admins cannot assign super_admin role" };
      }
      updatePayload.role = body.role;
    }

    if (Object.keys(updatePayload).length === 0) {
      set.status = 400;
      return { error: "No valid fields provided for update" };
    }

    const [updatedUser] = await db
      .update(users)
      .set(updatePayload)
      .where(and(eq(users.id, targetUserId), isNull(users.deletedAt)))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        languageCode: users.languageCode,
      });

    if (!updatedUser) {
      set.status = 404;
      return { error: "User not found" };
    }

    logger.info("Tenant user updated.", {
      requesterId,
      tenantId: scopedTenantId,
      targetUserId,
    });

    return {
      message: "User updated successfully",
      user: updatedUser,
    };
  } catch (err) {
    logger.error("Failed to update tenant user.", {
      requesterId,
      tenantId,
      targetUserId,
      err,
    });
    set.status = 500;
    return { error: "Failed to update user" };
  }
};

/**
 * Soft deletes a user in the current tenant.
 */
export const deleteTenantUser = async ({ params, user, tenantId, set }: any) => {
  const requesterId = user?.id || "unknown_user";
  const targetUserId = String(params.id);

  if (targetUserId === user.id) {
    set.status = 400;
    return { error: "You cannot delete your own account" };
  }

  try {
    const targetTenantId = String(params.tenantId);
    const { tenantId: scopedTenantId, error } = await resolveScopedTenantId({
      user,
      sessionTenantId: tenantId,
      targetTenantId,
      set,
    });

    if (error || !scopedTenantId) {
      return { error: error || "Missing tenant context" };
    }

    const [membership] = await db
      .select({ userId: userTenants.userId })
      .from(userTenants)
      .where(
        and(
          eq(userTenants.tenantId, scopedTenantId),
          eq(userTenants.userId, targetUserId),
        ),
      );

    if (!membership) {
      set.status = 404;
      return { error: "User not found in this tenant" };
    }

    const [deletedUser] = await db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(and(eq(users.id, targetUserId), isNull(users.deletedAt)))
      .returning({ id: users.id });

    if (!deletedUser) {
      set.status = 404;
      return { error: "User not found or already deleted" };
    }

    logger.info("Tenant user soft deleted.", {
      requesterId,
      tenantId: scopedTenantId,
      targetUserId,
    });

    return { message: "User deleted successfully" };
  } catch (err) {
    logger.error("Failed to delete tenant user.", {
      requesterId,
      tenantId,
      targetUserId,
      err,
    });
    set.status = 500;
    return { error: "Failed to delete user" };
  }
};
