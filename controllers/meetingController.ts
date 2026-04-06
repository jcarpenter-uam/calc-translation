import { websocketController } from "./websocketController";
import { logger } from "../core/logger";
import { generateWsTicket } from "../utils/security";
import { db } from "../core/database";
import { env } from "../core/config";
import { meetings } from "../models/meetingModel";
import { meetingTranscriptCacheService } from "../services/meetingTranscriptCacheService";
import {
  buildJoinMeetingPlan,
  getMeetingByReadableId,
  normalizeReadableMeetingId,
  persistJoinMeetingPlan,
} from "../services/meetingJoinService";
import { userTenants } from "../models/userTenantModel";
import { users } from "../models/userModel";
import { eq, and, desc, or, ilike, inArray, asc, isNull, sql } from "drizzle-orm";
import {
  buildOneWayTranscriptionConfig,
  getUniqueMeetingLanguages,
  validateSpokenLanguages,
} from "../utils/meetingPolicy";
import { parseBoundedInteger } from "../utils/pagination";
import {
  buildMeetingListVisibilityWhereClause,
  canAccessMeetingRecord,
  canDownloadMeetingTranscript,
} from "../utils/accessPolicy";
import { requireTenantContext } from "../utils/sessionPolicy";

const MAX_INVITEES = 100;

/**
 * Builds the native app join URL for meetings that are hosted inside this product.
 */
function buildNativeViewerJoinUrl(readableId: string) {
  const appOrigin = new URL(env.BASE_URL).origin;
  const joinUrl = new URL("/", appOrigin);
  joinUrl.searchParams.set("join", readableId);
  return joinUrl.toString();
}

/**
 * Accepts only valid absolute join URLs so integrations never persist malformed links.
 */
function normalizeJoinUrl(joinUrl: unknown) {
  if (typeof joinUrl !== "string") {
    return null;
  }

  const trimmedJoinUrl = joinUrl.trim();
  if (!trimmedJoinUrl) {
    return null;
  }

  try {
    return new URL(trimmedJoinUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Sanitizes meeting metadata into a filesystem-friendly download filename segment.
 */
function sanitizeTranscriptFilenamePart(value: string | null | undefined, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const sanitized = value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || fallback;
}

/**
 * Chooses the most relevant meeting date for transcript filenames.
 */
function resolveTranscriptFilenameDate(meeting: {
  ended_at?: Date | string | null;
  started_at?: Date | string | null;
  scheduled_time?: Date | string | null;
}) {
  const candidate = meeting.ended_at || meeting.started_at || meeting.scheduled_time;
  const parsed = candidate ? new Date(candidate) : new Date();

  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    return `${String(fallback.getUTCMonth() + 1).padStart(2, "0")}-${String(fallback.getUTCDate()).padStart(2, "0")}`;
  }

  return `${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
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

  const scopedTenantId = requireTenantContext(tenantId, set);
  if (!scopedTenantId) {
    return { error: "Missing tenant context" };
  }

  try {
    const visibilityFilter = buildMeetingListVisibilityWhereClause(
      user,
      scopedTenantId,
    );

    const query = db
      .select({
        id: meetings.id,
        readable_id: meetings.readable_id,
        topic: meetings.topic,
        scheduled_time: meetings.scheduled_time,
        started_at: meetings.started_at,
        ended_at: meetings.ended_at,
      })
      .from(meetings)
      .where(visibilityFilter as any);

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

    const [transcriptLanguages, summaryLanguages] = await Promise.all([
      meetingTranscriptCacheService.listTranscriptLanguages(id),
      meetingTranscriptCacheService.listSummaryLanguages(id),
    ]);

    logger.debug("Meeting details retrieved.", { userId, meetingId: id });
    return {
      meeting: {
        ...meeting,
        transcript_languages: transcriptLanguages,
        summary_languages: summaryLanguages,
      },
    };
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
 * Downloads an archived per-language VTT transcript for a meeting participant or host.
 */
export const downloadMeetingTranscript = async ({
  params: { id, language },
  user,
  set,
}: any) => {
  const userId = user?.id || "unknown_user";

  try {
    const [meeting] = await db
      .select({
        id: meetings.id,
        readable_id: meetings.readable_id,
        topic: meetings.topic,
        scheduled_time: meetings.scheduled_time,
        started_at: meetings.started_at,
        ended_at: meetings.ended_at,
        host_id: meetings.host_id,
        attendees: meetings.attendees,
      })
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!meeting) {
      set.status = 404;
      return { error: "Meeting not found" };
    }

    if (!canDownloadMeetingTranscript(meeting, user)) {
      logger.warn("Transcript download access denied.", {
        userId,
        meetingId: id,
        language,
      });
      set.status = 403;
      return { error: "Not authorized to download this transcript" };
    }

    const transcriptPath = meetingTranscriptCacheService.getTranscriptOutputPath(
      id,
      language,
    );
    const transcriptFile = Bun.file(transcriptPath);

    if (!(await transcriptFile.exists())) {
      set.status = 404;
      return { error: "Transcript not found" };
    }

    const safeTitle = sanitizeTranscriptFilenamePart(
      meeting.topic || meeting.readable_id || meeting.id,
      "meeting",
    );
    const transcriptDate = resolveTranscriptFilenameDate(meeting);
    const safeLanguage = String(language).replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";

    set.headers["content-type"] = "text/vtt; charset=utf-8";
    set.headers["content-disposition"] =
      `attachment; filename="${safeTitle}_${transcriptDate}_${safeLanguage}.vtt"`;

    logger.info("Transcript download served.", {
      userId,
      meetingId: id,
      language,
    });

    return transcriptFile;
  } catch (err) {
    logger.error("Failed to download meeting transcript.", {
      userId,
      meetingId: id,
      language,
      err,
    });
    set.status = 500;
    return { error: "Failed to download transcript" };
  }
};

/**
 * Downloads an archived per-language markdown summary for a meeting participant or host.
 */
export const downloadMeetingSummary = async ({
  params: { id, language },
  user,
  set,
}: any) => {
  const userId = user?.id || "unknown_user";

  try {
    const [meeting] = await db
      .select({
        id: meetings.id,
        readable_id: meetings.readable_id,
        topic: meetings.topic,
        scheduled_time: meetings.scheduled_time,
        started_at: meetings.started_at,
        ended_at: meetings.ended_at,
        host_id: meetings.host_id,
        attendees: meetings.attendees,
      })
      .from(meetings)
      .where(eq(meetings.id, id));

    if (!meeting) {
      set.status = 404;
      return { error: "Meeting not found" };
    }

    if (!canDownloadMeetingTranscript(meeting, user)) {
      logger.warn("Meeting summary download access denied.", {
        userId,
        meetingId: id,
        language,
      });
      set.status = 403;
      return { error: "Not authorized to download this summary" };
    }

    const summaryPath = meetingTranscriptCacheService.getMeetingSummaryOutputPath(id, language);
    const summaryFile = Bun.file(summaryPath);

    if (!(await summaryFile.exists())) {
      set.status = 404;
      return { error: "Summary not found" };
    }

    const safeTitle = sanitizeTranscriptFilenamePart(
      meeting.topic || meeting.readable_id || meeting.id,
      "meeting",
    );
    const summaryDate = resolveTranscriptFilenameDate(meeting);
    const safeLanguage = String(language).replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";

    set.headers["content-type"] = "text/markdown; charset=utf-8";
    set.headers["content-disposition"] =
      `attachment; filename="${safeTitle}_${summaryDate}_${safeLanguage}_summary.md"`;

    logger.info("Meeting summary download served.", {
      userId,
      meetingId: id,
      language,
    });

    return summaryFile;
  } catch (err) {
    logger.error("Failed to download meeting summary.", {
      userId,
      meetingId: id,
      language,
      err,
    });
    set.status = 500;
    return { error: "Failed to download summary" };
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

  const scopedTenantId = requireTenantContext(tenantId, set);
  if (!scopedTenantId) {
    return { error: "Missing tenant context" };
  }

  try {
    const q = typeof query?.q === "string" ? query.q.trim() : "";
    const limit = parseBoundedInteger(query?.limit, {
      defaultValue: 20,
      min: 1,
      max: 100,
    });

    const filters = [
      eq(userTenants.tenantId, scopedTenantId),
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

  const scopedTenantId = requireTenantContext(tenantId, set);
  if (!scopedTenantId) {
    return { error: "Missing tenant context" };
  }

  try {
    const method = body?.method || "one_way";
    const spokenLanguages = getUniqueMeetingLanguages(body?.spoken_languages);
    const integration = body?.integration === "zoom" ? "zoom" : "native";

    const spokenLanguageValidation = validateSpokenLanguages(method, spokenLanguages);
    if (!spokenLanguageValidation.ok) {
      set.status = 400;
      return { error: spokenLanguageValidation.error };
    }

    const readableId = generateReadableId();
    const zoomJoinUrl = normalizeJoinUrl(body?.join_url);

    if (integration === "zoom" && !zoomJoinUrl) {
      set.status = 400;
      return { error: "Zoom meetings require a valid meeting URL" };
    }

    const joinUrl = integration === "zoom"
      ? zoomJoinUrl
      : buildNativeViewerJoinUrl(readableId);

    const [newMeeting] = await db
      .insert(meetings)
      .values({
        readable_id: readableId,
        topic: body?.topic || "Untitled Meeting",
        host_id: user.id,
        tenant_id: scopedTenantId,
        join_url: joinUrl,
        attendees: [],
        spoken_languages: spokenLanguages,
        viewer_languages: [],
        integration,
        method,
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
      joinUrl,
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

  const scopedTenantId = requireTenantContext(tenantId, set);
  if (!scopedTenantId) {
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
              eq(userTenants.tenantId, scopedTenantId),
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
        tenant_id: scopedTenantId,
        attendees: attendeeIds,
        spoken_languages: [],
        viewer_languages: [],
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
 * Joins a user to a meeting and issues websocket access for the live room.
 */
export const joinMeeting = async ({
  params: { id },
  user,
  tenantId,
  set,
}: any) => {
  const userId = user?.id || "unknown_user";
  const cleanReadableId = normalizeReadableMeetingId(id);

  logger.debug("Attempting to join meeting.", {
    userId,
    readableId: cleanReadableId,
    tenantId,
  });

  try {
    const dbMeeting = await getMeetingByReadableId(cleanReadableId);

    if (!dbMeeting) {
      logger.warn(
        "Join attempted for missing meeting.",
        { userId, readableId: cleanReadableId },
      );
      set.status = 404;
      return { error: "Meeting not found" };
    }

    if (dbMeeting.tenant_id !== tenantId) {
      logger.info("Allowing authenticated cross-tenant meeting join.", {
        userId,
        readableId: cleanReadableId,
        meetingTenantId: dbMeeting.tenant_id,
        tenantId,
      });
    }

    const internalId = dbMeeting.id;

    websocketController.initMeeting(internalId, dbMeeting.host_id ?? undefined);

    const activeMeeting = websocketController.getMeeting(internalId);
    const joinPlan = buildJoinMeetingPlan(
      dbMeeting,
      user,
      activeMeeting
        ? {
            isHostSendingAudio: activeMeeting.isHostSendingAudio,
            audioSessionCount: activeMeeting.audioSessions.size,
          }
        : null,
    );

    // If the host is already live, add the new language session immediately so late joiners start
    // receiving transcript output without waiting for a restart.
    if (joinPlan.method === "one_way" && joinPlan.userLanguage && !joinPlan.isHost) {
      const addedViewerLanguage = websocketController.registerViewerLanguageRequest(
        internalId,
        joinPlan.userLanguage,
      );

      if (addedViewerLanguage && activeMeeting?.isHostSendingAudio) {
        const newSession = websocketController.addTranscriptionSession(
          internalId,
          joinPlan.userLanguage,
          buildOneWayTranscriptionConfig(joinPlan.userLanguage),
        );

        await newSession?.session.connect();
      }

      if (addedViewerLanguage) {
        logger.info(
          activeMeeting?.isHostSendingAudio
            ? "Started dynamic one-way session while host audio was live."
            : "Registered dynamic one-way session for future audio start.",
          {
            meetingId: internalId,
            language: joinPlan.userLanguage,
            triggeredBy: userId,
          },
        );
      }
    }

    await persistJoinMeetingPlan(internalId, joinPlan.updatePayload);

    const wsTicketTenantId = tenantId || dbMeeting.tenant_id;
    if (!wsTicketTenantId) {
      set.status = 400;
      return { error: "Missing tenant context" };
    }

    const wsTicket = await generateWsTicket(user.id, wsTicketTenantId);

    logger.info(
      "User joined meeting.",
      {
        meetingId: internalId,
        userId,
        isActive: joinPlan.isActiveNow,
          isHost: joinPlan.isHost,
        },
      );

    return {
      message: "Joined meeting",
      meetingId: internalId,
      readableId: cleanReadableId,
      token: wsTicket,
      isActive: joinPlan.isActiveNow,
      isHost: joinPlan.isHost,
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

    await websocketController.deleteMeeting(id);

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
