import { websocketController } from "./websocketController";
import { logger } from "../core/logger";
import { generateWsTicket } from "../utils/security";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import { eq, and, sql, desc, or } from "drizzle-orm";

/**
 * Returns meetings visible to the requesting user under RBAC policy.
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

    if (user.role === "super_admin") {
      query = query as any;
    } else if (user.role === "tenant_admin") {
      query = query.where(eq(meetings.tenant_id, tenantId)) as any;
    } else {
      query = query.where(
        and(
          eq(meetings.tenant_id, tenantId),
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
 * Returns full details for a meeting when the user is authorized to view it.
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
 * Generates a public 10-digit join code.
 */
function generateReadableId() {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

/**
 * Creates a meeting record and returns its internal and public IDs.
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
 * Joins a user to a meeting and starts transcription workers when needed.
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

    const currentAttendees = dbMeeting.attendees || [];

    if (!currentAttendees.includes(user.id)) {
      currentAttendees.push(user.id);
    }

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

      websocketController.broadcastToMeeting(
        internalId,
        JSON.stringify({ type: "status", event: "meeting_started" }),
      );
    }

    // Start a new one-way worker when an active meeting gains a new language.
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
 * Ends a meeting when the requester is the host.
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
