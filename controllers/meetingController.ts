import { websocketController } from "./websocketController";
import { logger } from "../core/logger";
import { generateWsTicket } from "../utils/security";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import { eq, and, sql, desc, or } from "drizzle-orm";

/**
 * Retrieves a lightweight list of all meetings associated with the requesting user.
 * * @param {Object} context.user - The authenticated user.
 * @param {Object} context.set - The Elysia response state object.
 */
export const getMeetingsList = async ({ user, tenantId, set }: any) => {
  const userId = user?.id || "unknown_user";
  logger.debug("Meeting list requested.", {
    userId,
    userRole: user.role,
    tenantId,
  });

  try {
    let query = db
      .select({
        id: meetings.id,
        readable_id: meetings.readable_id,
        topic: meetings.topic,
        scheduled_time: meetings.scheduled_time,
        started_at: meetings.started_at,
        ended_at: meetings.ended_at,
      })
      .from(meetings);

    // RBAC Logic Application
    if (user.role === "super_admin") {
      // Super admins see literally everything across all tenants
      query = query as any;
    } else if (user.role === "tenant_admin") {
      // Tenant admins see all meetings, but STRICTLY within their own organization
      query = query.where(eq(meetings.tenant_id, tenantId)) as any;
    } else {
      // Regular users only see meetings they host or are invited to
      query = query.where(
        and(
          eq(meetings.tenant_id, tenantId), // Safety boundary
          or(
            eq(meetings.host_id, user.id),
            sql`${meetings.attendees} @> ${JSON.stringify([user.id])}::jsonb`,
          ),
        ),
      ) as any;
    }

    const meetingList = await query.orderBy(desc(meetings.scheduled_time));

    logger.debug("Meeting list retrieved.", { userId, count: meetingList.length });
    return { meetings: meetingList };
  } catch (err) {
    logger.error("Error fetching meeting list.", { userId, tenantId, err });
    set.status = 500;
    return { error: "Failed to fetch meetings" };
  }
};

/**
 * Retrieves the full details of a specific meeting.
 * * @param {Object} context.params.id - The internal UUID (`meetingId`) to fetch.
 * @param {Object} context.user - The authenticated user.
 * @param {Object} context.set - The Elysia response state object.
 */
export const getMeetingDetails = async ({
  params: { id },
  user,
  tenantId,
  set,
}: any) => {
  const userId = user?.id || "unknown_user";
  logger.debug("Meeting details requested.", { userId, meetingId: id, tenantId });

  try {
    const [meeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!meeting) {
      logger.warn(
        "Meeting details requested for missing meeting.",
        { userId, meetingId: id },
      );
      set.status = 404;
      return { error: "Meeting not found" };
    }

    // RBAC Security Check
    const currentAttendees = meeting.attendees || [];
    const isHost = meeting.host_id === user.id;
    const isAttendee = currentAttendees.includes(user.id);
    const isTenantAdmin =
      user.role === "tenant_admin" && meeting.tenant_id === tenantId;
    const isSuperAdmin = user.role === "super_admin";

    if (!isHost && !isAttendee && !isTenantAdmin && !isSuperAdmin) {
      logger.warn(
        "Meeting details access denied.",
        { userId, meetingId: id, tenantId },
      );
      set.status = 403;
      return { error: "Not authorized to view this meeting" };
    }

    logger.debug("Meeting details retrieved.", { userId, meetingId: id });
    return { meeting };
  } catch (err) {
    logger.error("Error fetching meeting details.", {
      userId,
      meetingId: id,
      err,
    });
    set.status = 500;
    return { error: "Failed to fetch meeting details" };
  }
};

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
 * @param {Object} context.set - The Elysia response state object (used for setting HTTP status codes).
 * @returns {Promise<{ message: string, meetingId: string, readableId: string }>}
 * A JSON response containing the success message, the internal database UUID (`meetingId`),
 * and the public 10-digit ID (`readableId`) that users will use to join.
 */
export const createMeeting = async ({ body, user, tenantId, set }: any) => {
  const userId = user?.id || "unknown_user";
  logger.debug("Attempting to create meeting.", { userId, tenantId });

  try {
    const readableId = generateReadableId();

    const [newMeeting] = await db
      .insert(meetings)
      .values({
        readable_id: readableId,
        topic: body?.topic || "Untitled Meeting",
        host_id: user.id,
        tenant_id: tenantId,
        attendees: [],
        languages: body?.languages || [],
        integration: body?.integration,
        method: body?.method || "one_way",
        scheduled_time: body?.scheduled_time
          ? new Date(body.scheduled_time)
          : null,
      })
      .returning({
        id: meetings.id,
        readable_id: meetings.readable_id,
      });

    if (!newMeeting) {
      logger.error("Meeting insert returned no record.", { userId, tenantId });
      set.status = 500;
      return { error: "Failed to create meeting" };
    }

    logger.info("Meeting created successfully.", {
      meetingId: newMeeting.id,
      userId,
      tenantId,
    });

    return {
      message: "Meeting created successfully",
      meetingId: newMeeting.id,
      readableId: newMeeting.readable_id,
    };
  } catch (err) {
    logger.error("Failed to create meeting.", { userId, tenantId, err });
    set.status = 500;
    return { error: "Failed to create meeting" };
  }
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
  const userId = user?.id || "unknown_user";
  const cleanReadableId = id.replace(/[\s-]/g, "");

  logger.debug("Attempting to join meeting.", {
    userId,
    readableId: cleanReadableId,
    tenantId,
  });

  try {
    const [dbMeeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.readable_id, cleanReadableId));

    if (!dbMeeting) {
      logger.warn(
        "Join attempted for missing meeting.",
        { userId, readableId: cleanReadableId },
      );
      set.status = 404;
      return { error: "Meeting not found" };
    }

    const internalId = dbMeeting.id;
    const isHost = dbMeeting.host_id === user.id;

    websocketController.initMeeting(internalId, dbMeeting.host_id ?? undefined);

    let activeMeeting = websocketController.getMeeting(internalId);

    const isAudioRunning = activeMeeting
      ? activeMeeting.audioSessions.size > 0
      : false;

    // Grab the existing array from the database record (fallback to empty)
    const currentAttendees = dbMeeting.attendees || [];

    // Add the user ONLY if they aren't already in the list
    if (!currentAttendees.includes(user.id)) {
      currentAttendees.push(user.id);
    }

    // Pass the clean TypeScript array directly to Drizzle
    const dbUpdatePayload: any = {
      attendees: currentAttendees,
    };

    const method = dbMeeting.method || "one_way";
    let currentLanguages = dbMeeting.languages || [];
    const userLanguage = user.languageCode;

    if (
      method === "one_way" &&
      userLanguage &&
      !currentLanguages.includes(userLanguage)
    ) {
      currentLanguages.push(userLanguage);
      dbUpdatePayload.languages = currentLanguages;
    }

    if (!isAudioRunning && isHost) {
      activeMeeting = websocketController.getMeeting(internalId);

      if (method === "two_way" && currentLanguages.length >= 2) {
        const [languageA, languageB] = currentLanguages;
        if (!languageA || !languageB) {
          logger.warn(
            "Skipping two-way session startup due to incomplete language configuration.",
            { meetingId: internalId, userId },
          );
          set.status = 400;
          return { error: "Meeting language configuration is incomplete" };
        }

        // Spin up the single bilingual session
        const session = websocketController.addTranscriptionSession(
          internalId,
          "two_way",
          {
            enableSpeakerDiarization: true,
            translation: {
              type: "two_way",
              language_a: languageA,
              language_b: languageB,
            },
          },
        );
        await session?.connect();
      } else {
        // Spin up individual sessions for the pre-configured languages
        for (const lang of currentLanguages) {
          const session = websocketController.addTranscriptionSession(
            internalId,
            lang,
            {
              enableSpeakerDiarization: true,
              translation: { type: "one_way", target_language: lang },
            },
          );
          await session?.connect();
        }
      }

      logger.info("Host started meeting.", {
        meetingId: internalId,
        hostId: userId,
      });
      dbUpdatePayload.started_at = new Date();

      // Notify any attendees who are already subscribed in the waiting room
      websocketController.broadcastToMeeting(
        internalId,
        JSON.stringify({ type: "status", event: "meeting_started" }),
      );
    }

    // Only spin up a standalone session if the audio engines are ALREADY running,
    // and we just added a brand new language to the database in Step 1.
    if (
      isAudioRunning &&
      method === "one_way" &&
      userLanguage &&
      dbUpdatePayload.languages
    ) {
      const newSession = websocketController.addTranscriptionSession(
        internalId,
        userLanguage,
        {
          enableSpeakerDiarization: true,
          translation: { type: "one_way", target_language: userLanguage },
        },
      );

      await newSession?.connect();
      logger.info(
        "Started dynamic one-way session.",
        {
          meetingId: internalId,
          language: userLanguage,
          triggeredBy: userId,
        },
      );
    }

    await db
      .update(meetings)
      .set(dbUpdatePayload)
      .where(eq(meetings.id, internalId));

    const wsTicket = await generateWsTicket(user.id, tenantId || "");
    const isActiveNow = isAudioRunning || isHost;

    logger.info(
      "User joined meeting.",
      {
        meetingId: internalId,
        userId,
        isActive: isActiveNow,
        isHost,
      },
    );

    return {
      message: "Joined meeting",
      meetingId: internalId,
      readableId: cleanReadableId,
      token: wsTicket,
      isActive: isActiveNow,
      isHost: isHost,
    };
  } catch (err) {
    logger.error(
      "Failed to join meeting.",
      { err },
    );
    set.status = 500;
    return { error: "Failed to join meeting" };
  }
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
  const userId = user?.id || "unknown_user";
  logger.debug("Attempting to end meeting.", { userId, meetingId: id });

  try {
    const meeting = websocketController.getMeeting(id);
    if (!meeting) {
      logger.warn(
        "Attempted to end non-existent or inactive meeting.",
        { userId, meetingId: id },
      );
      set.status = 404;
      return { error: "Meeting not found" };
    }

    const updatedMeeting = await db
      .update(meetings)
      .set({ ended_at: new Date() })
      .where(and(eq(meetings.id, id), eq(meetings.host_id, user.id)))
      .returning();

    if (!updatedMeeting.length) {
      logger.warn(
        "Authorization check failed while ending meeting.",
        { userId, meetingId: id },
      );
      set.status = 403;
      return { error: "Not authorized to end this meeting" };
    }

    websocketController.deleteMeeting(id);

    logger.info("Meeting ended successfully.", { userId, meetingId: id });

    return {
      message: "Meeting ended",
      meetingId: id,
    };
  } catch (err) {
    logger.error("Failed to end meeting.", { userId, meetingId: id, err });
    set.status = 500;
    return { error: "Failed to end meeting" };
  }
};
