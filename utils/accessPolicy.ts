import { and, eq, or, sql } from "drizzle-orm";
import { meetings } from "../models/meetingModel";

/**
 * Minimal user shape required for role and meeting access checks.
 */
export interface AccessPolicyUser {
  id: string;
  role?: string | null;
}

/**
 * Minimal meeting shape required for meeting visibility checks.
 */
export interface MeetingAccessRecord {
  host_id: string | null;
  attendees: string[] | null;
  tenant_id?: string | null;
}

/**
 * Returns whether the user has the super-admin role.
 */
export function isSuperAdmin(user: { role?: string | null } | null | undefined) {
  return user?.role === "super_admin";
}

/**
 * Returns whether the user has the tenant-admin role.
 */
export function isTenantAdmin(user: { role?: string | null } | null | undefined) {
  return user?.role === "tenant_admin";
}

/**
 * Returns whether the user has any role from the allowed role list.
 */
export function hasAllowedRole(
  user: { role?: string | null } | null | undefined,
  allowedRoles: readonly string[],
) {
  if (!user?.role) {
    return false;
  }

  return allowedRoles.includes(user.role);
}

/**
 * Returns whether the meeting is visible under the current RBAC policy.
 */
export function canAccessMeetingRecord(
  meeting: MeetingAccessRecord,
  user: AccessPolicyUser,
  tenantId: string | null,
) {
  const currentAttendees = meeting.attendees || [];
  const isHost = meeting.host_id === user.id;
  const isAttendee = currentAttendees.includes(user.id);
  const isScopedTenantAdmin = isTenantAdmin(user) && meeting.tenant_id === tenantId;

  return isHost || isAttendee || isScopedTenantAdmin || isSuperAdmin(user);
}

/**
 * Returns whether the transcript can be downloaded by the requesting user.
 */
export function canDownloadMeetingTranscript(
  meeting: Pick<MeetingAccessRecord, "host_id" | "attendees">,
  user: Pick<AccessPolicyUser, "id">,
) {
  const currentAttendees = meeting.attendees || [];
  return meeting.host_id === user.id || currentAttendees.includes(user.id);
}

/**
 * Builds the meeting-list visibility filter for the current user and tenant scope.
 */
export function buildMeetingListVisibilityWhereClause(
  user: AccessPolicyUser,
  tenantId: string,
) {
  if (isSuperAdmin(user)) {
    return undefined;
  }

  if (isTenantAdmin(user)) {
    return eq(meetings.tenant_id, tenantId);
  }

  return and(
    eq(meetings.tenant_id, tenantId),
    or(
      eq(meetings.host_id, user.id),
      sql`${meetings.attendees} @> ${JSON.stringify([user.id])}::jsonb`,
    ),
  );
}
