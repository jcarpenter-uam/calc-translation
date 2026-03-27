import { describe, expect, it } from "bun:test";
import {
  buildMeetingListVisibilityWhereClause,
  canAccessMeetingRecord,
  canDownloadMeetingTranscript,
  hasAllowedRole,
  isSuperAdmin,
  isTenantAdmin,
} from "../utils/accessPolicy";

describe("accessPolicy", () => {
  it("recognizes supported admin roles", () => {
    expect(isSuperAdmin({ role: "super_admin" })).toBe(true);
    expect(isSuperAdmin({ role: "tenant_admin" })).toBe(false);
    expect(isTenantAdmin({ role: "tenant_admin" })).toBe(true);
    expect(isTenantAdmin({ role: "user" })).toBe(false);
  });

  it("checks allowed roles defensively", () => {
    expect(hasAllowedRole({ role: "tenant_admin" }, ["tenant_admin"])).toBe(true);
    expect(hasAllowedRole({ role: "user" }, ["tenant_admin"])).toBe(false);
    expect(hasAllowedRole(null, ["super_admin"])).toBe(false);
  });

  it("allows meeting access for hosts, attendees, scoped tenant admins, and super admins", () => {
    // Keep one canonical record shape here so role-based visibility stays easy to reason about.
    const meeting = {
      host_id: "host-1",
      attendees: ["attendee-1"],
      tenant_id: "tenant-1",
    };

    expect(canAccessMeetingRecord(meeting, { id: "host-1", role: "user" }, "tenant-1")).toBe(
      true,
    );
    expect(
      canAccessMeetingRecord(meeting, { id: "attendee-1", role: "user" }, "tenant-1"),
    ).toBe(true);
    expect(
      canAccessMeetingRecord(meeting, { id: "admin-1", role: "tenant_admin" }, "tenant-1"),
    ).toBe(true);
    expect(
      canAccessMeetingRecord(meeting, { id: "super-1", role: "super_admin" }, "tenant-2"),
    ).toBe(true);
    expect(
      canAccessMeetingRecord(meeting, { id: "outsider-1", role: "tenant_admin" }, "tenant-2"),
    ).toBe(false);
  });

  it("limits transcript downloads to the host or attendees", () => {
    const meeting = {
      host_id: "host-1",
      attendees: ["attendee-1"],
    };

    expect(canDownloadMeetingTranscript(meeting, { id: "host-1" })).toBe(true);
    expect(canDownloadMeetingTranscript(meeting, { id: "attendee-1" })).toBe(true);
    expect(canDownloadMeetingTranscript(meeting, { id: "outsider-1" })).toBe(false);
  });

  it("builds a visibility clause only when tenant-scoped filtering is required", () => {
    // Super admins intentionally bypass tenant filtering, while all other roles receive a where
    // clause that scopes the list query.
    expect(
      buildMeetingListVisibilityWhereClause({ id: "super-1", role: "super_admin" }, "tenant-1"),
    ).toBeUndefined();
    expect(
      buildMeetingListVisibilityWhereClause({ id: "admin-1", role: "tenant_admin" }, "tenant-1"),
    ).toBeTruthy();
    expect(
      buildMeetingListVisibilityWhereClause({ id: "user-1", role: "user" }, "tenant-1"),
    ).toBeTruthy();
  });
});
