import { and, asc, eq, isNull } from "drizzle-orm";
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
  requestedTenantId,
  set,
}: {
  user: { role?: string };
  sessionTenantId: string | null;
  requestedTenantId: string | null;
  set: { status?: number };
}) {
  if (!sessionTenantId) {
    set.status = 400;
    return { error: "Missing tenant context", tenantId: null };
  }

  if (user.role === "tenant_admin") {
    if (requestedTenantId && requestedTenantId !== sessionTenantId) {
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

  const scopedTenantId = requestedTenantId || sessionTenantId;

  const [tenant] = await db
    .select({ id: tenants.tenantId })
    .from(tenants)
    .where(eq(tenants.tenantId, scopedTenantId));

  if (!tenant) {
    set.status = 404;
    return { error: "Tenant not found", tenantId: null };
  }

  return { error: null, tenantId: scopedTenantId };
}

/**
 * Returns the authenticated user profile with tenant details.
 */
export const getMe = async ({ user, tenantId, set }: any) => {
  const userId = user?.id || "unknown_user";

  try {
    const [tenant] = tenantId
      ? await db
          .select({
            id: tenants.tenantId,
            name: tenants.organizationName,
          })
          .from(tenants)
          .where(eq(tenants.tenantId, tenantId))
      : [];

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        languageCode: user.languageCode,
      },
      tenant: tenant || null,
    };
  } catch (err) {
    logger.error("Failed to load current user profile.", {
      userId,
      tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to fetch current user profile" };
  }
};

/**
 * Updates the authenticated user's language preference.
 */
export const updateMe = async ({ user, body, set }: any) => {
  const userId = user?.id || "unknown_user";

  try {
    const [updatedUser] = await db
      .update(users)
      .set({ languageCode: body.languageCode })
      .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
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

    logger.info("User language preference updated.", {
      userId,
      languageCode: body.languageCode,
    });

    return {
      message: "Language updated successfully",
      user: updatedUser,
    };
  } catch (err) {
    logger.error("Failed to update current user profile.", {
      userId,
      err,
    });
    set.status = 500;
    return { error: "Failed to update profile" };
  }
};

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
 * Lists all active users in the current tenant.
 */
export const listUsers = async ({ user, tenantId, query, set }: any) => {
  const requesterId = user?.id || "unknown_user";

  try {
    const requestedTenantId =
      typeof query?.tenantId === "string" ? query.tenantId : null;
    const { tenantId: scopedTenantId, error } = await resolveScopedTenantId({
      user,
      sessionTenantId: tenantId,
      requestedTenantId,
      set,
    });

    if (error || !scopedTenantId) {
      return { error: error || "Missing tenant context" };
    }

    const tenantUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        languageCode: users.languageCode,
      })
      .from(userTenants)
      .innerJoin(users, eq(userTenants.userId, users.id))
      .where(
        and(eq(userTenants.tenantId, scopedTenantId), isNull(users.deletedAt)),
      );

    logger.debug("Tenant user list retrieved.", {
      requesterId,
      tenantId: scopedTenantId,
      count: tenantUsers.length,
    });

    return { users: tenantUsers };
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
export const updateUser = async ({
  params,
  body,
  query,
  user,
  tenantId,
  set,
}: any) => {
  const requesterId = user?.id || "unknown_user";
  const targetUserId = String(params.id);

  try {
    const requestedTenantId =
      typeof body?.tenantId === "string"
        ? body.tenantId
        : typeof query?.tenantId === "string"
          ? query.tenantId
          : null;
    const { tenantId: scopedTenantId, error } = await resolveScopedTenantId({
      user,
      sessionTenantId: tenantId,
      requestedTenantId,
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
      name?: string | null;
      email?: string | null;
      languageCode?: string | null;
      role?: "user" | "tenant_admin" | "super_admin";
    } = {};

    if (body.name !== undefined) {
      updatePayload.name = body.name;
    }
    if (body.email !== undefined) {
      updatePayload.email = body.email;
    }
    if (body.languageCode !== undefined) {
      updatePayload.languageCode = body.languageCode;
    }
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
export const deleteUser = async ({ params, query, user, tenantId, set }: any) => {
  const requesterId = user?.id || "unknown_user";
  const targetUserId = String(params.id);

  if (targetUserId === user.id) {
    set.status = 400;
    return { error: "You cannot delete your own account" };
  }

  try {
    const requestedTenantId =
      typeof query?.tenantId === "string" ? query.tenantId : null;
    const { tenantId: scopedTenantId, error } = await resolveScopedTenantId({
      user,
      sessionTenantId: tenantId,
      requestedTenantId,
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
