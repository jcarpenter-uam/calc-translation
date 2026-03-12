// controllers/meetingController.ts
import { websocketController } from "./websocketController";
import { logger } from "../core/logger";
import { generateWsTicket } from "../utils/security";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import { eq, and, sql } from "drizzle-orm";

export const startMeeting = async ({ body, user, tenantId, set }: any) => {
  const generatedId = `meeting-${crypto.randomUUID().split("-")[0]}`;

  // Check for memory collisions
  if (websocketController.getMeeting(generatedId)) {
    set.status = 409;
    return { error: "Collision detected, please try again" };
  }

  // Start the Soniox transcription session
  const session = websocketController.createMeeting(generatedId);
  await session.connect();

  // Save the new meeting to the database
  await db.insert(meetings).values({
    id: generatedId,
    topic: body?.topic || "Untitled Meeting",
    host: user.id,
    started_at: new Date(),
    attendees: [{ name: user.name || "Host", email: user.email }],
    languages: body?.languages || [],
    integration: body?.integration,
    scheduled_time: body?.scheduled_time ? new Date(body.scheduled_time) : null,
  });

  // Generate the short-lived WebSocket ticket using your security utility
  // We pass both the userId and the tenantId derived from the API session
  const wsTicket = await generateWsTicket(user.id, tenantId || "");

  logger.info(`Meeting '${generatedId}' started by user ${user.id}`);

  return {
    message: "Meeting started",
    meetingId: generatedId,
    token: wsTicket,
  };
};

export const joinMeeting = async ({
  params: { id },
  user,
  tenantId,
  set,
}: any) => {
  // Verify the meeting is currently active in memory
  const meeting = websocketController.getMeeting(id);
  if (!meeting) {
    set.status = 404;
    return { error: "Meeting not found or inactive" };
  }

  const newAttendee = { name: user.name || "Guest", email: user.email };

  // Safely append the user to the database attendees list
  const updatedMeeting = await db
    .update(meetings)
    .set({
      attendees: sql`coalesce(${meetings.attendees}, '[]'::jsonb) || ${JSON.stringify([newAttendee])}::jsonb`,
    })
    .where(eq(meetings.id, id))
    .returning();

  if (!updatedMeeting.length) {
    set.status = 404;
    return { error: "Meeting record not found in database" };
  }

  // Generate the WebSocket ticket for the joining user
  const wsTicket = await generateWsTicket(user.id, tenantId || "");

  logger.info(`User ${user.id} joined meeting '${id}'`);

  return {
    message: "Joined meeting",
    meetingId: id,
    token: wsTicket,
  };
};

export const endMeeting = async ({ params: { id }, user, set }: any) => {
  const meeting = websocketController.getMeeting(id);
  if (!meeting) {
    set.status = 404;
    return { error: "Meeting not found" };
  }

  // Update the database to mark the meeting as ended
  const updatedMeeting = await db
    .update(meetings)
    .set({ ended_at: new Date() })
    .where(
      and(
        eq(meetings.id, id),
        eq(meetings.host_id, user.id), // Strict check: only host can end
      ),
    )
    .returning();

  if (!updatedMeeting.length) {
    set.status = 403;
    return { error: "Not authorized to end this meeting" };
  }

  // Signal the end of the transcription session to Soniox
  try {
    await meeting.sonioxSession.finish();
  } catch (err) {
    logger.error(`Error finishing Soniox session for ${id}:`, err);
  }

  // Clear from memory
  websocketController.deleteMeeting(id);

  logger.info(`User ${user.id} ended meeting '${id}'`);

  return {
    message: "Meeting ended",
    meetingId: id,
  };
};
