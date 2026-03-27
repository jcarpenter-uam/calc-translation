import { Elysia, t } from "elysia";
import {
  createTenant,
  deleteTenant,
  getTenantSettings,
  getAllTenantSettings,
  deleteTenantUser,
  listAllTenantUsers,
  listTenants,
  listTenantUsers,
  updateTenantSettings,
  updateTenantUser,
} from "../controllers/tenantController";
import { requireRole } from "../middlewares/authMiddleware";

/**
 * Tenant-admin and super-admin routes for tenant settings and membership management.
 */
export const tenantRoutes = new Elysia({ prefix: "/tenants" })
  .use(requireRole(["tenant_admin", "super_admin"]))
  .post("/", createTenant, {
    body: t.Object({
      tenantId: t.String({ minLength: 1 }),
      organizationName: t.Optional(t.Nullable(t.String())),
      domains: t.Array(
        t.Object({
          domain: t.String({ minLength: 1 }),
          providerType: t.Union([t.Literal("google"), t.Literal("entra")]),
        }),
      ),
      authConfigs: t.Array(
        t.Object({
          providerType: t.Union([t.Literal("google"), t.Literal("entra")]),
          clientId: t.String({ minLength: 1 }),
          clientSecret: t.Optional(t.Nullable(t.String())),
          tenantHint: t.Optional(t.Nullable(t.String())),
        }),
      ),
    }),
  })
  .get("/", listTenants)
  .get("/settings", getAllTenantSettings)
  .get("/users", listAllTenantUsers, {
    query: t.Object({
      q: t.Optional(t.String()),
      role: t.Optional(
        t.Union([
          t.Literal("user"),
          t.Literal("tenant_admin"),
          t.Literal("super_admin"),
        ]),
      ),
      limit: t.Optional(t.Numeric()),
      offset: t.Optional(t.Numeric()),
    }),
  })
  .get("/:tenantId/settings", getTenantSettings, {
    params: t.Object({
      tenantId: t.String(),
    }),
  })
  .patch("/:tenantId/settings", updateTenantSettings, {
    params: t.Object({
      tenantId: t.String(),
    }),
    body: t.Object({
      organizationName: t.Optional(t.Nullable(t.String())),
      domains: t.Array(
        t.Object({
          domain: t.String({ minLength: 1 }),
          providerType: t.Union([t.Literal("google"), t.Literal("entra")]),
        }),
      ),
      authConfigs: t.Array(
        t.Object({
          providerType: t.Union([t.Literal("google"), t.Literal("entra")]),
          clientId: t.String({ minLength: 1 }),
          clientSecret: t.Optional(t.Nullable(t.String())),
          tenantHint: t.Optional(t.Nullable(t.String())),
        }),
      ),
    }),
  })
  .delete("/:tenantId", deleteTenant, {
    params: t.Object({
      tenantId: t.String(),
    }),
  })
  .get("/:tenantId/users", listTenantUsers, {
    params: t.Object({
      tenantId: t.String(),
    }),
    query: t.Object({
      q: t.Optional(t.String()),
      role: t.Optional(
        t.Union([
          t.Literal("user"),
          t.Literal("tenant_admin"),
          t.Literal("super_admin"),
        ]),
      ),
      limit: t.Optional(t.Numeric()),
      offset: t.Optional(t.Numeric()),
    }),
  })
  .patch("/:tenantId/users/:id", updateTenantUser, {
    params: t.Object({
      tenantId: t.String(),
      id: t.String(),
    }),
    body: t.Object({
      role: t.Optional(
        t.Union([
          t.Literal("user"),
          t.Literal("tenant_admin"),
          t.Literal("super_admin"),
        ]),
      ),
    }),
  })
  .delete("/:tenantId/users/:id", deleteTenantUser, {
    params: t.Object({
      tenantId: t.String(),
      id: t.String(),
    }),
  });
