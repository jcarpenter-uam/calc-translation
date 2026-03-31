import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  apiGet,
  cleanupTestUsers,
  createMeeting,
  createTestUser,
} from "./utils/testHelpers";
import { meetingTranscriptCacheService } from "../services/meetingTranscriptCacheService";

describe("Transcript download access", () => {
  let host: Awaited<ReturnType<typeof createTestUser>>;
  let attendee: Awaited<ReturnType<typeof createTestUser>>;
  let outsider: Awaited<ReturnType<typeof createTestUser>>;
  let tenantAdmin: Awaited<ReturnType<typeof createTestUser>>;
  const createdMeetingIds: string[] = [];

  beforeAll(async () => {
    host = await createTestUser("transcript-host", "Transcript Host", "en");
    attendee = await createTestUser("transcript-attendee", "Transcript Attendee", "es");
    outsider = await createTestUser("transcript-outsider", "Transcript Outsider", "fr");
    tenantAdmin = await createTestUser(
      "transcript-tenant-admin",
      "Transcript Tenant Admin",
      "de",
      "tenant_admin",
    );
  });

  afterAll(async () => {
    // Transcript cache artifacts outlive DB rows, so clear both storage layers during teardown.
    for (const meetingId of createdMeetingIds) {
      await meetingTranscriptCacheService.removeTranscriptArtifacts(meetingId);
      await meetingTranscriptCacheService.clearMeetingHistory(meetingId);
    }

    await cleanupTestUsers();
  });

  it("allows only the host or listed attendees to download archived transcripts", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Transcript Download",
      languages: ["en"],
    });
    createdMeetingIds.push(meeting.meetingId);

    // Join once so the attendee is written onto the meeting record before transcript download.
    await fetch(
      `http://localhost:${process.env.PORT || 8000}/api/meeting/join/${meeting.readableId}`,
      {
        method: "POST",
        headers: {
          Cookie: `auth_session=${attendee.token}`,
        },
      },
    );

    // Seed archived transcript output directly instead of depending on a live websocket/audio run.
    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId: meeting.meetingId,
      language: "en",
      text: "Archived transcript line",
      startedAtMs: 0,
      endedAtMs: 1500,
      speaker: null,
    });
    await meetingTranscriptCacheService.flushMeetingToVtt(meeting.meetingId);

    const hostResponse = await apiGet(
      `/meeting/${meeting.meetingId}/transcript/en`,
      host.token,
    );
    expect(hostResponse.status).toBe(200);
    expect(hostResponse.headers.get("content-type")).toContain("text/vtt");
    expect(hostResponse.headers.get("content-disposition")).toContain(
      'filename="Transcript_Download_',
    );
    expect(hostResponse.headers.get("content-disposition")).toMatch(
      /filename="Transcript_Download_\d{2}-\d{2}_en\.vtt"/,
    );
    expect(hostResponse.headers.get("content-disposition")).toContain('_en.vtt"');
    expect(await hostResponse.text()).toContain("Archived transcript line");

    const attendeeResponse = await apiGet(
      `/meeting/${meeting.meetingId}/transcript/en`,
      attendee.token,
    );
    expect(attendeeResponse.status).toBe(200);
    expect(await attendeeResponse.text()).toContain("Archived transcript line");

    const outsiderResponse = await apiGet(
      `/meeting/${meeting.meetingId}/transcript/en`,
      outsider.token,
    );
    expect(outsiderResponse.status).toBe(403);

    const tenantAdminResponse = await apiGet(
      `/meeting/${meeting.meetingId}/transcript/en`,
      tenantAdmin.token,
    );
    expect(tenantAdminResponse.status).toBe(403);
  });
});
