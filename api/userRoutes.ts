import { Elysia, t } from "elysia";
import {
  deleteUser,
  getMe,
  listTenants,
  listUsers,
  updateMe,
  updateUser,
} from "../controllers/userController";
import { requireRole } from "../middlewares/authMiddleware";

/**
 * User profile and tenant-admin user management routes.
 */
export const userRoutes = new Elysia()
  .get("/user/me", getMe)
  .patch("/user/me", updateMe, {
    body: t.Object({
      languageCode: t.String({
        minLength: 2,
        maxLength: 10,
      }),
    }),
  })
  .group("/tenants", (tenantApp) =>
    tenantApp
      .use(requireRole(["tenant_admin", "super_admin"]))
      .get("/", listTenants),
  )
  .group("/users", (usersApp) =>
    usersApp
      .use(requireRole(["tenant_admin", "super_admin"]))
      .get("/", listUsers, {
        query: t.Object({
          tenantId: t.Optional(t.String()),
        }),
      })
      .patch("/:id", updateUser, {
        params: t.Object({
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
          tenantId: t.Optional(t.String()),
        }),
        query: t.Object({
          tenantId: t.Optional(t.String()),
        }),
      })
      .delete("/:id", deleteUser, {
        params: t.Object({
          id: t.String(),
        }),
        query: t.Object({
          tenantId: t.Optional(t.String()),
        }),
      }),
  );
