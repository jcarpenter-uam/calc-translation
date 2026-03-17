import { Elysia, t } from "elysia";
import { getMe, updateMe } from "../controllers/userController";

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
  });
