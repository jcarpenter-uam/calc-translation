import { eq } from "drizzle-orm";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import {
  addOneWayMeetingLanguage,
  getUniqueMeetingLanguages,
  MAX_ONE_WAY_LANGUAGES,
} from "../utils/meetingPolicy";

/**
 * Minimal meeting state needed from the real-time controller during join flow.
 */
export interface ActiveRealtimeMeetingState {
  isHostSendingAudio: boolean;
  audioSessionCount: number;
}

/**
 * Minimal meeting user shape needed for join policy decisions.
 */
export interface JoinMeetingUser {
  id: string;
  languageCode?: string | null;
}

/**
 * Database payload returned after resolving a readable meeting ID.
 */
export type JoinableMeeting = typeof meetings.$inferSelect;

/**
 * Persisted meeting changes required when a user joins.
 */
export interface JoinMeetingUpdatePayload {
  attendees: string[];
  languages?: string[];
}

/**
 * Result of applying join policy to a meeting/user pair.
 */
export interface JoinMeetingPlan {
  internalId: string;
  isHost: boolean;
  isActiveNow: boolean;
  method: string;
  userLanguage: string | null;
  addedLanguage: boolean;
  updatePayload: JoinMeetingUpdatePayload;
  languageLimitExceeded: boolean;
}

/**
 * Normalizes human-entered join codes before lookup.
 */
export function normalizeReadableMeetingId(readableId: string) {
  return readableId.replace(/[\s-]/g, "");
}

/**
 * Loads a meeting by its public readable ID.
 */
export async function getMeetingByReadableId(readableId: string) {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.readable_id, readableId));

  return meeting || null;
}

/**
 * Derives the real-time state flags used by the join response.
 */
export function buildRealtimeJoinState(
  meeting: JoinableMeeting,
  activeMeeting: ActiveRealtimeMeetingState | null,
  user: JoinMeetingUser,
) {
  const isHost = meeting.host_id === user.id;
  const isAudioRunning = activeMeeting?.isHostSendingAudio ?? false;
  const hasMeetingStarted =
    Boolean(meeting.started_at) || Boolean(activeMeeting?.audioSessionCount);

  return {
    internalId: meeting.id,
    isHost,
    isAudioRunning,
    isActiveNow: hasMeetingStarted || isHost,
  };
}

/**
 * Applies attendee/language join policy and returns the meeting update payload.
 */
export function buildJoinMeetingPlan(
  meeting: JoinableMeeting,
  user: JoinMeetingUser,
  activeMeeting: ActiveRealtimeMeetingState | null,
): JoinMeetingPlan {
  const realtimeState = buildRealtimeJoinState(meeting, activeMeeting, user);
  const currentAttendees = [...(meeting.attendees || [])];

  if (!currentAttendees.includes(user.id)) {
    currentAttendees.push(user.id);
  }

  const method = meeting.method || "one_way";
  const currentLanguages = getUniqueMeetingLanguages(meeting.languages);
  const userLanguage = user.languageCode || null;
  const nextLanguages =
    method === "one_way"
      ? addOneWayMeetingLanguage(currentLanguages, userLanguage)
      : { languages: currentLanguages, added: false, limitExceeded: false };

  return {
    internalId: realtimeState.internalId,
    isHost: realtimeState.isHost,
    isActiveNow: realtimeState.isActiveNow,
    method,
    userLanguage,
    addedLanguage: nextLanguages.added,
    languageLimitExceeded: nextLanguages.limitExceeded,
    updatePayload: nextLanguages.added
      ? { attendees: currentAttendees, languages: nextLanguages.languages }
      : { attendees: currentAttendees },
  };
}

/**
 * Persists join-side meeting changes after policy checks pass.
 */
export async function persistJoinMeetingPlan(
  meetingId: string,
  updatePayload: JoinMeetingUpdatePayload,
) {
  await db.update(meetings).set(updatePayload).where(eq(meetings.id, meetingId));
}

/**
 * Human-readable validation message for one-way language cap errors.
 */
export function getJoinLanguageLimitMessage() {
  return `One-way meetings can include at most ${MAX_ONE_WAY_LANGUAGES} spoken languages`;
}
