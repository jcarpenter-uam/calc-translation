import { Elysia, t } from "elysia";
import {
  deleteTenantUser,
  listTenants,
  listTenantUsers,
  updateTenantUser,
} from "../controllers/tenantController";
import { requireRole } from "../middlewares/authMiddleware";

/**
 * Tenant-scoped admin routes for tenant discovery and user management.
 */
export const tenantRoutes = new Elysia({ prefix: "/tenants" })
  .use(requireRole(["tenant_admin", "super_admin"]))
  .get("/", listTenants)
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
      name: t.Optional(t.Nullable(t.String())),
      email: t.Optional(t.Nullable(t.String({ format: "email" }))),
      languageCode: t.Optional(
        t.Nullable(
          t.String({
            minLength: 2,
            maxLength: 10,
          }),
        ),
      ),
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
