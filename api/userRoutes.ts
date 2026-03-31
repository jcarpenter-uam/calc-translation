import { Elysia, t } from "elysia";
import {
  getCalendarEvents,
  getMe,
  syncMyCalendar,
  updateMe,
} from "../controllers/userController";

/**
 * User profile and tenant-admin user management routes.
 */
export const userRoutes = new Elysia()
  .get("/user/me", getMe)
  .get("/user/calendar/events", getCalendarEvents, {
    query: t.Object({
      limit: t.Optional(t.Numeric()),
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
    }),
  })
  .post("/user/calendar/sync", syncMyCalendar, {
    body: t.Optional(
      t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
    ),
  })
  .patch("/user/me", updateMe, {
    body: t.Object({
      languageCode: t.String({
        minLength: 2,
        maxLength: 10,
      }),
    }),
  });
