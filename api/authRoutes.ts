import { Elysia, t } from "elysia";
import {
  unifiedLogin,
  providerCallback,
  getMe,
  logout,
} from "../controllers/authController";
import { requireAuth } from "../middlewares/authMiddleware";

/**
 * Authentication routes for SSO login, OAuth callback handling, and logout.
 */
export const authRoutes = new Elysia({ prefix: "/auth" })
  .get("/login", unifiedLogin, {
    query: t.Object({
      email: t.String({
        format: "email",
        message: "A valid email is required",
      }),
      returnTo: t.Optional(t.String()),
    }),
  })
  .get("/callback/:provider", providerCallback, {
    params: t.Object({
      provider: t.Union([t.Literal("google"), t.Literal("entra")]),
    }),
    query: t.Object({
      code: t.Optional(t.String()),
      state: t.Optional(t.String()),
      error: t.Optional(t.String()),
    }),
  })
  .use(requireAuth)
  .get("/me", getMe)
  .post("/logout", logout);
