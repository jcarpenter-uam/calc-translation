import { Elysia, t } from "elysia";
import {
  chooseLoginProvider,
  unifiedLogin,
  providerCallback,
  logout,
} from "../controllers/authController";
import { requireAuth } from "../middlewares/authMiddleware";

/**
 * Authentication routes for SSO login, OAuth callback handling, and logout.
 */
export const authRoutes = new Elysia({ prefix: "/auth" })
  .post("/login", unifiedLogin, {
    body: t.Object({
      email: t.String({
        format: "email",
        message: "A valid email is required",
      }),
      returnTo: t.Optional(t.String()),
    }),
  })
  .get("/login", unifiedLogin, {
    query: t.Object({
      email: t.String({
        format: "email",
        message: "A valid email is required",
      }),
      returnTo: t.Optional(t.String()),
    }),
  })
  .post("/login/choose", chooseLoginProvider, {
    body: t.Object({
      email: t.String({
        format: "email",
        message: "A valid email is required",
      }),
      tenantId: t.String({ minLength: 1 }),
      providerType: t.Union([t.Literal("google"), t.Literal("entra")]),
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
  .post("/logout", logout);
