import { Elysia, t } from "elysia";
import {
  unifiedLogin,
  providerCallback,
  logout,
} from "../controllers/authController";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .post("/login", unifiedLogin, {
    body: t.Object({
      email: t.String({
        format: "email",
        message: "A valid email is required",
      }),
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
  .post("/logout", logout);
