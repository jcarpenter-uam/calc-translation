import { websocketController } from "./websocketController";
import { logger } from "../core/logger";
import { generateWsTicket } from "../utils/security";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import { userTenants } from "../models/userTenantModel";
import { users } from "../models/userModel";
import { eq, and, sql, desc, or, ilike, inArray, asc, isNull } from "drizzle-orm";

const MAX_INVITEES = 100;

function canAccessMeetingRecord(
  meeting: { host_id: string | null; attendees: string[] | null; tenant_id: string | null },
  user: { id: string; role: string },
  tenantId: string | null,
) {
  const currentAttendees = meeting.attendees || [];
  const isHost = meeting.host_id === user.id;
  const isAttendee = currentAttendees.includes(user.id);
  const isTenantAdmin = user.role === "tenant_admin" && meeting.tenant_id === tenantId;
  const isSuperAdmin = user.role === "super_admin";

  return isHost || isAttendee || isTenantAdmin || isSuperAdmin;
}

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

    if (!canAccessMeetingRecord(meeting, user, tenantId)) {
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
 * Returns meeting participants and their live connection presence.
 */
export const getMeetingParticipants = async ({ params: { id }, user, tenantId, set }: any) => {
  const userId = user?.id || "unknown_user";

  try {
    const [meeting] = await db
      .select({
        id: meetings.id,
        host_id: meetings.host_id,
        attendees: meetings.attendees,
        tenant_id: meetings.tenant_id,
      })
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!meeting) {
      set.status = 404;
      return { error: "Meeting not found" };
    }

    if (!canAccessMeetingRecord(meeting, user, tenantId)) {
      set.status = 403;
      return { error: "Not authorized to view this meeting" };
    }

    const attendeeIds = Array.from(new Set(meeting.attendees || []));
    const participantIds = Array.from(
      new Set([meeting.host_id, ...attendeeIds].filter(Boolean) as string[]),
    );

    const rows = participantIds.length
      ? await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            languageCode: users.languageCode,
            role: users.role,
          })
          .from(users)
          .where(and(inArray(users.id, participantIds), isNull(users.deletedAt)))
      : [];

    const connectedParticipantIds = Array.from(
      websocketController.getMeeting(id)?.participants.keys() || [],
    );
    const connectedSet = new Set(connectedParticipantIds);
    const attendeeSet = new Set(attendeeIds);

    const participants = rows.map((participant) => ({
      ...participant,
      isHost: participant.id === meeting.host_id,
      isInvited: attendeeSet.has(participant.id),
      isConnected: connectedSet.has(participant.id),
    }));

    logger.debug("Meeting participants retrieved.", {
      userId,
      meetingId: id,
      count: participants.length,
      connected: connectedParticipantIds.length,
    });

    return {
      participants,
      connectedCount: connectedParticipantIds.length,
    };
  } catch (err) {
    logger.error("Failed to fetch meeting participants.", {
      userId,
      meetingId: id,
      err,
    });
    set.status = 500;
    return { error: "Failed to fetch meeting participants" };
  }
};

/**
 * Generates a public 10-digit join code.
 */
function generateReadableId() {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

/**
 * Lists users available as invite candidates within the current tenant.
 */
export const listMeetingInvitees = async ({ query, user, tenantId, set }: any) => {
  const requesterId = user?.id || "unknown_user";

  if (!tenantId) {
    set.status = 400;
    return { error: "Missing tenant context" };
  }

  try {
    const q = typeof query?.q === "string" ? query.q.trim() : "";
    const rawLimit = Number(query?.limit ?? 20);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 100)
      : 20;

    const filters = [
      eq(userTenants.tenantId, tenantId),
      isNull(users.deletedAt),
      sql`${users.id} <> ${user.id}`,
    ];

    if (q.length > 0) {
      filters.push(
        or(
          ilike(users.name, `%${q}%`),
          ilike(users.email, `%${q}%`),
        )!,
      );
    }

    const invitees = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        languageCode: users.languageCode,
      })
      .from(userTenants)
      .innerJoin(users, eq(userTenants.userId, users.id))
      .where(and(...filters))
      .orderBy(asc(users.name), asc(users.id))
      .limit(limit);

    return { invitees };
  } catch (err) {
    logger.error("Failed to list meeting invitees.", {
      requesterId,
      tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to list invitees" };
  }
};

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
 * Creates an instant meeting with a title and tenant-scoped invitees.
 */
export const createQuickMeeting = async ({ body, user, tenantId, set }: any) => {
  const userId = user?.id || "unknown_user";
  logger.debug("Attempting to quick-create meeting.", { userId, tenantId });

  if (!tenantId) {
    set.status = 400;
    return { error: "Missing tenant context" };
  }

  try {
    const title = String(body?.title || "").trim();
    if (!title) {
      set.status = 400;
      return { error: "Meeting title is required" };
    }

    const rawAttendeeIds = Array.isArray(body?.attendeeIds)
      ? (body.attendeeIds as unknown[])
      : [];

    const attendeeIds = Array.from(
      new Set(
        rawAttendeeIds
          .map((value) => String(value))
          .map((value) => value.trim())
          .filter((value) => value.length > 0 && value !== user.id),
      ),
    );

    if (attendeeIds.length > MAX_INVITEES) {
      set.status = 400;
      return { error: `A maximum of ${MAX_INVITEES} attendees can be invited` };
    }

    if (attendeeIds.length > 0) {
      const scopedMembers = await db
        .select({ userId: userTenants.userId })
        .from(userTenants)
        .innerJoin(users, eq(userTenants.userId, users.id))
        .where(
          and(
            eq(userTenants.tenantId, tenantId),
            inArray(userTenants.userId, attendeeIds),
            isNull(users.deletedAt),
          ),
        );

      const allowedIds = new Set(scopedMembers.map((row) => row.userId));
      const invalidIds = attendeeIds.filter((id) => !allowedIds.has(id));
      if (invalidIds.length > 0) {
        set.status = 400;
        return { error: "One or more attendees are invalid for this tenant" };
      }
    }

    const readableId = generateReadableId();

    const [newMeeting] = await db
      .insert(meetings)
      .values({
        readable_id: readableId,
        topic: title,
        host_id: user.id,
        tenant_id: tenantId,
        attendees: attendeeIds,
        languages: [],
        method: "one_way",
      })
      .returning({
        id: meetings.id,
        readable_id: meetings.readable_id,
      });

    if (!newMeeting) {
      logger.error("Quick meeting insert returned no record.", { userId, tenantId });
      set.status = 500;
      return { error: "Failed to create meeting" };
    }

    return {
      message: "Quick meeting created successfully",
      meetingId: newMeeting.id,
      readableId: newMeeting.readable_id,
      invitedCount: attendeeIds.length,
    };
  } catch (err) {
    logger.error("Failed to quick-create meeting.", { userId, tenantId, err });
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
