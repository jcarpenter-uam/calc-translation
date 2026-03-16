import { Elysia, t } from "elysia";
import {
  getMeetingsList,
  getMeetingDetails,
  createMeeting,
  joinMeeting,
  endMeeting,
} from "../controllers/meetingController";

/**
 * Meeting routes for listing, creating, joining, and ending meetings.
 */
export const meetingRoutes = new Elysia({ prefix: "/meeting" })
  .get("/list", getMeetingsList)
  .get("/:id", getMeetingDetails)
  .post("/create", createMeeting, {
    body: t.Object({
      topic: t.Optional(t.String()),
      languages: t.Optional(t.Array(t.String())),
      method: t.Optional(t.Union([t.Literal("one_way"), t.Literal("two_way")])),
      integration: t.Optional(t.String()),
      scheduled_time: t.Optional(t.String()),
    }),
  })
  .post("/join/:id", joinMeeting)
  .post("/end/:id", endMeeting);
