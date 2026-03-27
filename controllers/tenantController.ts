import { and, asc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { db } from "../core/database";
import { logger } from "../core/logger";
import { tenantAuthConfigs, tenantDomains, tenants } from "../models/tenantModel";
import { meetings } from "../models/meetingModel";
import { users } from "../models/userModel";
import { userTenants } from "../models/userTenantModel";
import { encrypt } from "../utils/fernet";
import { parsePaginationWindow, paginateRows } from "../utils/pagination";
import { SUPPORTED_AUTH_PROVIDERS } from "../utils/authProviders";
import { isSuperAdmin, isTenantAdmin } from "../utils/accessPolicy";
import { requireTenantContext } from "../utils/sessionPolicy";

const TENANT_ADMIN_EDITABLE_ROLES = new Set(["user", "tenant_admin"]);
const SUPPORTED_PROVIDER_TYPES = new Set<string>(SUPPORTED_AUTH_PROVIDERS);

type TenantSettingsInput = {
  organizationName?: string | null;
  domains?: Array<{
    domain: string;
    providerType: string;
  }>;
  authConfigs?: Array<{
    providerType: string;
    clientId: string;
    clientSecret?: string | null;
    tenantHint?: string | null;
  }>;
};

/**
 * Normalizes provider identifiers so domain and auth config records compare reliably.
 */
function normalizeProviderType(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Normalizes tenant domains before validation and persistence.
 */
function normalizeDomain(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Validates tenant settings and returns normalized domain/provider records.
 */
function validateTenantSettingsInput(
  body: TenantSettingsInput,
  set: { status?: number },
) {
  const normalizedDomains = (body.domains || []).map((entry) => ({
    domain: normalizeDomain(String(entry.domain || "")),
    providerType: normalizeProviderType(String(entry.providerType || "")),
  }));
  const normalizedAuthConfigs = (body.authConfigs || []).map((entry) => ({
    providerType: normalizeProviderType(String(entry.providerType || "")),
    clientId: String(entry.clientId || "").trim(),
    clientSecret:
      entry.clientSecret === undefined || entry.clientSecret === null
        ? null
        : String(entry.clientSecret).trim(),
    tenantHint:
      entry.tenantHint === undefined || entry.tenantHint === null
        ? null
        : String(entry.tenantHint).trim() || null,
  }));

  const domainSet = new Set<string>();
  for (const entry of normalizedDomains) {
    if (!entry.domain) {
      set.status = 400;
      return { error: "Domains must not be empty", domains: [], authConfigs: [] };
    }
    if (!SUPPORTED_PROVIDER_TYPES.has(entry.providerType)) {
      set.status = 400;
      return {
        error: `Unsupported provider type for domain ${entry.domain}`,
        domains: [],
        authConfigs: [],
      };
    }
    const domainProviderKey = `${entry.domain}:${entry.providerType}`;
    if (domainSet.has(domainProviderKey)) {
      set.status = 400;
      return {
        error: `Duplicate domain/provider pair: ${entry.domain} (${entry.providerType})`,
        domains: [],
        authConfigs: [],
      };
    }
    domainSet.add(domainProviderKey);
  }

  const providerSet = new Set<string>();
  for (const entry of normalizedAuthConfigs) {
    if (!SUPPORTED_PROVIDER_TYPES.has(entry.providerType)) {
      set.status = 400;
      return {
        error: `Unsupported auth provider: ${entry.providerType}`,
        domains: [],
        authConfigs: [],
      };
    }
    if (!entry.clientId) {
      set.status = 400;
      return {
        error: `Client ID is required for provider ${entry.providerType}`,
        domains: [],
        authConfigs: [],
      };
    }
    if (providerSet.has(entry.providerType)) {
      set.status = 400;
      return {
        error: `Duplicate auth provider: ${entry.providerType}`,
        domains: [],
        authConfigs: [],
      };
    }
    providerSet.add(entry.providerType);
  }

  return {
    error: null,
    domains: normalizedDomains,
    authConfigs: normalizedAuthConfigs,
  };
}

/**
 * Loads the tenant settings payload expected by the admin UI.
 */
async function getTenantSettingsPayload(scopedTenantId: string) {
  const [tenant] = await db
    .select({
      id: tenants.tenantId,
      name: tenants.organizationName,
    })
    .from(tenants)
    .where(eq(tenants.tenantId, scopedTenantId));

  const domains = await db
    .select({
      domain: tenantDomains.domain,
      providerType: tenantDomains.providerType,
    })
    .from(tenantDomains)
    .where(eq(tenantDomains.tenantId, scopedTenantId))
    .orderBy(asc(tenantDomains.domain));

  const authConfigs = await db
    .select({
      providerType: tenantAuthConfigs.providerType,
      clientId: tenantAuthConfigs.clientId,
      tenantHint: tenantAuthConfigs.tenantHint,
    })
    .from(tenantAuthConfigs)
    .where(eq(tenantAuthConfigs.tenantId, scopedTenantId))
    .orderBy(asc(tenantAuthConfigs.providerType));

  return {
    tenant,
    domains,
    authConfigs: authConfigs.map((config) => ({
      ...config,
      hasSecret: true,
    })),
  };
}

/**
 * Loads editable settings for every tenant in super-admin overview mode.
 */
async function getAllTenantSettingsPayloads() {
  const tenantRows = await db
    .select({ id: tenants.tenantId })
    .from(tenants)
    .orderBy(asc(tenants.organizationName), asc(tenants.tenantId));

  return Promise.all(
    tenantRows.map((tenant) => getTenantSettingsPayload(tenant.id)),
  );
}

/**
 * Replaces tenant settings in one transaction while preserving existing secrets when omitted.
 */
async function persistTenantSettings(
  scopedTenantId: string,
  body: TenantSettingsInput,
  set: { status?: number },
) {
  const { error, domains, authConfigs } = validateTenantSettingsInput(body, set);
  if (error) {
    return { error };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(tenants)
      .set({ organizationName: body.organizationName?.trim() || null })
      .where(eq(tenants.tenantId, scopedTenantId));

    await tx.delete(tenantDomains).where(eq(tenantDomains.tenantId, scopedTenantId));

    if (domains.length > 0) {
      await tx.insert(tenantDomains).values(
        domains.map((entry) => ({
          domain: entry.domain,
          tenantId: scopedTenantId,
          providerType: entry.providerType,
        })),
      );
    }

    const existingConfigs = await tx
      .select({
        providerType: tenantAuthConfigs.providerType,
        clientSecretEncrypted: tenantAuthConfigs.clientSecretEncrypted,
      })
      .from(tenantAuthConfigs)
      .where(eq(tenantAuthConfigs.tenantId, scopedTenantId));

    const existingConfigMap = new Map(
      existingConfigs.map((config) => [config.providerType, config.clientSecretEncrypted]),
    );

    await tx
      .delete(tenantAuthConfigs)
      .where(eq(tenantAuthConfigs.tenantId, scopedTenantId));

    if (authConfigs.length > 0) {
      await tx.insert(tenantAuthConfigs).values(
        authConfigs.map((entry) => {
          // The UI may intentionally omit secrets on edit, so keep the stored value unless a
          // replacement secret is provided explicitly.
          const nextSecret = entry.clientSecret || existingConfigMap.get(entry.providerType);
          if (!nextSecret) {
            throw new Error(`Missing client secret for provider ${entry.providerType}`);
          }

          return {
            tenantId: scopedTenantId,
            providerType: entry.providerType,
            clientId: entry.clientId,
            clientSecretEncrypted: entry.clientSecret
              ? encrypt(entry.clientSecret)
              : nextSecret,
            tenantHint: entry.providerType === "entra" ? entry.tenantHint : null,
          };
        }),
      );
    }
  });

  return { error: null };
}

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
  const scopedSessionTenantId = requireTenantContext(sessionTenantId, set);
  if (!scopedSessionTenantId) {
    return { error: "Missing tenant context", tenantId: null };
  }

  if (isTenantAdmin(user)) {
    if (targetTenantId !== scopedSessionTenantId) {
      set.status = 403;
      return {
        error: "Tenant admins can only manage users in their own tenant",
        tenantId: null,
      };
    }

    return { error: null, tenantId: scopedSessionTenantId };
  }

  if (!isSuperAdmin(user)) {
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

  const scopedTenantId = requireTenantContext(tenantId, set);
  if (!scopedTenantId) {
    return { error: "Missing tenant context" };
  }

  try {
    const scopedTenants =
      isSuperAdmin(user)
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
            .where(eq(tenants.tenantId, scopedTenantId));

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
 * Lists active users across all tenants for super-admin overview mode.
 */
export const listAllTenantUsers = async ({ query, user, tenantId, set }: any) => {
  const requesterId = user?.id || "unknown_user";

  const scopedTenantId = requireTenantContext(tenantId, set);
  if (!scopedTenantId) {
    return { error: "Missing tenant context" };
  }

  if (!isSuperAdmin(user)) {
    set.status = 403;
    return { error: "Forbidden - Insufficient permissions" };
  }

  try {
    const q = typeof query?.q === "string" ? query.q.trim() : "";
    const role = typeof query?.role === "string" ? query.role : null;
    const { limit, offset } = parsePaginationWindow(query, {
      defaultLimit: 100,
      maxLimit: 500,
    });

    const filters = [isNull(users.deletedAt)];

    if (role) {
      filters.push(eq(users.role, role as any));
    }

    if (q.length > 0) {
      filters.push(
        or(
          ilike(users.name, `%${q}%`),
          ilike(users.email, `%${q}%`),
          ilike(tenants.organizationName, `%${q}%`),
          ilike(userTenants.tenantId, `%${q}%`),
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
        tenantId: userTenants.tenantId,
        tenantName: tenants.organizationName,
      })
      .from(userTenants)
      .innerJoin(users, eq(userTenants.userId, users.id))
      .innerJoin(tenants, eq(userTenants.tenantId, tenants.tenantId))
      .where(and(...filters))
      .orderBy(asc(tenants.organizationName), asc(users.name), asc(users.id))
      .limit(limit + 1)
      .offset(offset);

    const { items: tenantUsers, hasMore } = paginateRows(rows, limit);

    logger.debug("All-tenant user list retrieved.", {
      requesterId,
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
    logger.error("Failed to list all-tenant users.", {
      requesterId,
      tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to list users" };
  }
};

/**
 * Returns editable settings for a tenant.
 */
export const getTenantSettings = async ({ params, user, tenantId, set }: any) => {
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

    const payload = await getTenantSettingsPayload(scopedTenantId);
    if (!payload.tenant) {
      set.status = 404;
      return { error: "Tenant not found" };
    }

    return payload;
  } catch (err) {
    logger.error("Failed to get tenant settings.", {
      requesterId,
      tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to load tenant settings" };
  }
};

/**
 * Returns editable settings for all tenants for super-admin overview mode.
 */
export const getAllTenantSettings = async ({ user, tenantId, set }: any) => {
  const requesterId = user?.id || "unknown_user";

  const scopedTenantId = requireTenantContext(tenantId, set);
  if (!scopedTenantId) {
    return { error: "Missing tenant context" };
  }

  if (!isSuperAdmin(user)) {
    set.status = 403;
    return { error: "Forbidden - Insufficient permissions" };
  }

  try {
    const payload = await getAllTenantSettingsPayloads();
    return { tenants: payload };
  } catch (err) {
    logger.error("Failed to load all tenant settings.", {
      requesterId,
      tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to load tenant settings" };
  }
};

/**
 * Updates tenant metadata, domains, and auth config.
 */
export const updateTenantSettings = async ({ params, body, user, tenantId, set }: any) => {
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

    const result = await persistTenantSettings(scopedTenantId, body, set);
    if (result.error) {
      return result;
    }

    const payload = await getTenantSettingsPayload(scopedTenantId);

    logger.info("Tenant settings updated.", {
      requesterId,
      tenantId: scopedTenantId,
    });

    return {
      message: "Tenant settings updated successfully",
      ...payload,
    };
  } catch (err) {
    logger.error("Failed to update tenant settings.", {
      requesterId,
      tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to update tenant settings" };
  }
};

/**
 * Creates a new tenant with optional auth routing configuration.
 */
export const createTenant = async ({ body, user, set }: any) => {
  const requesterId = user?.id || "unknown_user";

  if (!isSuperAdmin(user)) {
    set.status = 403;
    return { error: "Forbidden - Insufficient permissions" };
  }

  const nextTenantId = String(body.tenantId || "").trim();
  if (!nextTenantId) {
    set.status = 400;
    return { error: "Tenant ID is required" };
  }

  try {
    const [existingTenant] = await db
      .select({ id: tenants.tenantId })
      .from(tenants)
      .where(eq(tenants.tenantId, nextTenantId));

    if (existingTenant) {
      set.status = 409;
      return { error: "Tenant already exists" };
    }

    await db.insert(tenants).values({
      tenantId: nextTenantId,
      organizationName: body.organizationName?.trim() || null,
    });

    const result = await persistTenantSettings(nextTenantId, body, set);
    if (result.error) {
      await db.delete(tenants).where(eq(tenants.tenantId, nextTenantId));
      return result;
    }

    const payload = await getTenantSettingsPayload(nextTenantId);

    logger.info("Tenant created.", {
      requesterId,
      tenantId: nextTenantId,
    });

    return {
      message: "Tenant created successfully",
      ...payload,
    };
  } catch (err) {
    logger.error("Failed to create tenant.", {
      requesterId,
      tenantId: body?.tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to create tenant" };
  }
};

/**
 * Deletes a tenant and its dependent tenant-scoped data.
 */
export const deleteTenant = async ({ params, user, tenantId, set }: any) => {
  const requesterId = user?.id || "unknown_user";

  const scopedTenantId = requireTenantContext(tenantId, set);
  if (!scopedTenantId) {
    return { error: "Missing tenant context" };
  }

  if (user?.role !== "super_admin") {
    set.status = 403;
    return { error: "Forbidden - Insufficient permissions" };
  }

  try {
    const targetTenantId = String(params.tenantId);
    const [existingTenant] = await db
      .select({ id: tenants.tenantId })
      .from(tenants)
      .where(eq(tenants.tenantId, targetTenantId));

    if (!existingTenant) {
      set.status = 404;
      return { error: "Tenant not found" };
    }

    await db.transaction(async (tx) => {
      await tx.delete(meetings).where(eq(meetings.tenant_id, targetTenantId));
      await tx.delete(tenants).where(eq(tenants.tenantId, targetTenantId));
    });

    logger.info("Tenant deleted.", {
      requesterId,
      tenantId: targetTenantId,
    });

    return { message: "Tenant deleted successfully" };
  } catch (err) {
    logger.error("Failed to delete tenant.", {
      requesterId,
      tenantId: scopedTenantId,
      targetTenantId: params?.tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to delete tenant" };
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
    const { limit, offset } = parsePaginationWindow(query, {
      defaultLimit: 50,
      maxLimit: 200,
    });

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

    const { items: tenantUsers, hasMore } = paginateRows(rows, limit);

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
 * Updates another user's global role after confirming the target belongs to the scoped tenant.
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
      if (isTenantAdmin(user) && !TENANT_ADMIN_EDITABLE_ROLES.has(body.role)) {
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
 * Soft deletes a user account after confirming the target belongs to the scoped tenant.
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

    // User records are global today, so this deactivates the account everywhere once the
    // tenant-scope membership check passes.
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
