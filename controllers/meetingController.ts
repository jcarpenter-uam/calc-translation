import { websocketController } from "./websocketController";
import { logger } from "../core/logger";
import { generateWsTicket } from "../utils/security";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import { eq, and, sql } from "drizzle-orm";

/**
 * Generates a random 10-digit number as a string (e.g., "8234567890")
 */
function generateReadableId() {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

/**
 * Creates a new meeting record in the database.
 * This acts as the scheduling step; the real-time transcription session
 * is not actively started in memory until the host officially joins.
 *
 * @param {Object} context - The Elysia request context.
 * @param {Object} context.body - The request payload containing meeting configuration.
 * @param {string} [context.body.topic="Untitled Meeting"] - The topic or title of the meeting.
 * @param {string[]} [context.body.languages] - An array of language codes to be transcribed.
 * @param {string} [context.body.integration] - The third-party integration used (e.g., 'zoom', 'teams').
 * @param {string|Date} [context.body.scheduled_time] - The future date/time the meeting is scheduled for.
 * @param {Object} context.user - The authenticated user object provided by the auth middleware.
 * @param {string} context.user.id - The unique ID of the user creating the meeting (becomes the host_id).
 * @param {Object} context.set - The Elysia response state object (used for setting HTTP status codes).
 * @returns {Promise<{ message: string, meetingId: string, readableId: string }>}
 * A JSON response containing the success message, the internal database UUID (`meetingId`),
 * and the public 10-digit ID (`readableId`) that users will use to join.
 */
export const createMeeting = async ({ body, user, set }: any) => {
  const readableId = generateReadableId();

  const [newMeeting] = await db
    .insert(meetings)
    .values({
      readable_id: readableId,
      topic: body?.topic || "Untitled Meeting",
      host_id: user.id,
      attendees: [],
      languages: body?.languages || [],
      integration: body?.integration,
      scheduled_time: body?.scheduled_time
        ? new Date(body.scheduled_time)
        : null,
    })
    .returning({
      id: meetings.id,
      readable_id: meetings.readable_id,
    });

  logger.info(`Meeting '${newMeeting.id}' scheduled by ${user.id}`);

  return {
    message: "Meeting created successfully",
    meetingId: newMeeting.id,
    readableId: newMeeting.readable_id,
  };
};

/**
 * Joins a user to a meeting using the public readable ID.
 * If the joining user is the host and the meeting hasn't started, it dynamically
 * initializes the transcription session in memory.
 *
 * @param {Object} context - The Elysia request context.
 * @param {Object} context.params - URL parameters.
 * @param {string} context.params.id - The 10-digit public `readableId` of the meeting.
 * @param {Object} context.user - The authenticated user attempting to join.
 * @param {string} context.tenantId - The organization/tenant ID of the user.
 * @param {Object} context.set - The Elysia response state object.
 * @returns {Promise<{ message: string, meetingId: string, readableId: string, token: string, isActive: boolean, isHost: boolean } | { error: string }>}
 * Returns the WebSocket connection token and routing info. The frontend should use `isActive`
 * to determine whether to connect to the WebSocket immediately or display a Waiting Room.
 */
export const joinMeeting = async ({
  params: { id },
  user,
  tenantId,
  set,
}: any) => {
  const cleanReadableId = id.replace(/[\s-]/g, "");

  const [dbMeeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.readable_id, cleanReadableId));

  if (!dbMeeting) {
    set.status = 404;
    return { error: "Meeting not found" };
  }

  const internalId = dbMeeting.id;
  const isHost = dbMeeting.host_id === user.id;

  let activeMeeting = websocketController.getMeeting(internalId);

  const dbUpdatePayload: any = {
    attendees: sql`coalesce(${meetings.attendees}, '[]'::jsonb) || ${JSON.stringify([user.id])}::jsonb`,
  };

  if (!activeMeeting && isHost) {
    activeMeeting = websocketController.createMeeting(internalId);
    await activeMeeting.connect();
    logger.info(`Host ${user.id} initiated audio session for '${internalId}'`);

    dbUpdatePayload.started_at = new Date();
  }

  await db
    .update(meetings)
    .set(dbUpdatePayload)
    .where(eq(meetings.id, internalId));

  const wsTicket = await generateWsTicket(user.id, tenantId || "");

  logger.info(
    `User ${user.id} joined meeting '${internalId}' (Active: ${!!activeMeeting})`,
  );

  return {
    message: "Joined meeting",
    meetingId: internalId,
    readableId: cleanReadableId,
    token: wsTicket,
    isActive: !!activeMeeting,
    isHost: isHost,
  };
};

/**
 * Ends an active meeting.
 * Strictly verifies that the requesting user is the host before updating the
 * database timestamp, stopping the audio stream, and clearing the memory session.
 *
 * @param {Object} context - The Elysia request context.
 * @param {Object} context.params - URL parameters.
 * @param {string} context.params.id - The internal UUID (`meetingId`) of the session to end.
 * @param {Object} context.user - The authenticated user attempting to end the session.
 * @param {Object} context.set - The Elysia response state object.
 * @returns {Promise<{ message: string, meetingId: string } | { error: string }>}
 * Returns a success message or an error if the user is not authorized/meeting not found.
 */
export const endMeeting = async ({ params: { id }, user, set }: any) => {
  const meeting = websocketController.getMeeting(id);
  if (!meeting) {
    set.status = 404;
    return { error: "Meeting not found" };
  }

  const updatedMeeting = await db
    .update(meetings)
    .set({ ended_at: new Date() })
    .where(and(eq(meetings.id, id), eq(meetings.host_id, user.id)))
    .returning();

  if (!updatedMeeting.length) {
    set.status = 403;
    return { error: "Not authorized to end this meeting" };
  }

  websocketController.deleteMeeting(id);

  logger.info(`User ${user.id} ended meeting '${id}'`);

  return {
    message: "Meeting ended",
    meetingId: id,
  };
};
