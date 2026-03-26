import { Elysia, t } from "elysia";
import {
  getMeetingsList,
  getMeetingDetails,
  getMeetingParticipants,
  createMeeting,
  createQuickMeeting,
  listMeetingInvitees,
  joinMeeting,
  endMeeting,
} from "../controllers/meetingController";

/**
 * Meeting routes for listing, creating, joining, and ending meetings.
 */
export const meetingRoutes = new Elysia({ prefix: "/meeting" })
  .get("/list", getMeetingsList)
  .get("/invitees", listMeetingInvitees, {
    query: t.Object({
      q: t.Optional(t.String()),
      limit: t.Optional(t.Numeric()),
    }),
  })
  .get("/:id/participants", getMeetingParticipants)
  .get("/:id", getMeetingDetails)
  .post("/create", createMeeting, {
    body: t.Object({
      topic: t.Optional(t.String()),
      languages: t.Optional(t.Array(t.String())),
      method: t.Optional(t.Union([t.Literal("one_way"), t.Literal("two_way")])),
      integration: t.Optional(t.String()),
      join_url: t.Optional(t.String()),
      scheduled_time: t.Optional(t.String()),
    }),
  })
  .post("/quick-create", createQuickMeeting, {
    body: t.Object({
      title: t.String({
        minLength: 1,
        maxLength: 150,
      }),
      attendeeIds: t.Optional(t.Array(t.String())),
    }),
  })
  .post("/join/:id", joinMeeting)
  .post("/end/:id", endMeeting);
