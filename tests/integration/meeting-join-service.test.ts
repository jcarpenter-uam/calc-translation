import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../core/database";
import { meetings } from "../../models/meetingModel";
import { tenants } from "../../models/tenantModel";
import { users } from "../../models/userModel";
import {
  buildJoinMeetingPlan,
  buildRealtimeJoinState,
  getJoinLanguageLimitMessage,
  getMeetingByReadableId,
  normalizeReadableMeetingId,
  persistJoinMeetingPlan,
} from "../../services/meetingJoinService";
import { cleanupTestData, trackTestTenants, trackTestUsers } from "../setup/utils/testHelpers";

describe("meetingJoinService", () => {
  const tenantId = "meeting-join-service-tenant";
  const userIds = ["meeting_join_host", "meeting_join_guest", "meeting_join_extra"];
  let meetingId = "";

  beforeAll(async () => {
    trackTestTenants(tenantId);
    trackTestUsers(...userIds);

    await db
      .insert(tenants)
      .values({ tenantId, organizationName: "Meeting Join Service Tenant" })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values([
        {
          id: "meeting_join_host",
          name: "Meeting Join Host",
          email: "meeting_join_host@test.com",
          languageCode: "en",
          role: "user" as any,
        },
        {
          id: "meeting_join_guest",
          name: "Meeting Join Guest",
          email: "meeting_join_guest@test.com",
          languageCode: "es",
          role: "user" as any,
        },
        {
          id: "meeting_join_extra",
          name: "Meeting Join Extra",
          email: "meeting_join_extra@test.com",
          languageCode: "de",
          role: "user" as any,
        },
      ])
      .onConflictDoNothing();

    const [meeting] = await db
      .insert(meetings)
      .values({
        readable_id: "1234567890",
        topic: "Join Service Meeting",
        host_id: "meeting_join_host",
        tenant_id: tenantId,
        attendees: ["meeting_join_host"],
        languages: ["en"],
        method: "one_way",
      })
      .returning({ id: meetings.id });

    // Reuse one persisted meeting so the tests cover both pure planning helpers and DB-backed
    // lookups/persistence.
    meetingId = meeting!.id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("normalizes readable meeting ids entered by users", () => {
    expect(normalizeReadableMeetingId("123-456 7890")).toBe("1234567890");
  });

  it("loads meetings by readable id", async () => {
    const meeting = await getMeetingByReadableId("1234567890");

    expect(meeting?.id).toBe(meetingId);
    expect(meeting?.topic).toBe("Join Service Meeting");
  });

  it("derives host and activity state from persisted and realtime meeting data", async () => {
    const meeting = await getMeetingByReadableId("1234567890");
    expect(meeting).toBeTruthy();

    const realtimeState = buildRealtimeJoinState(
      meeting!,
      { isHostSendingAudio: true, audioSessionCount: 1 },
      { id: "meeting_join_guest", languageCode: "es" },
    );

    expect(realtimeState.isHost).toBe(false);
    expect(realtimeState.isAudioRunning).toBe(true);
    expect(realtimeState.isActiveNow).toBe(true);
  });

  it("builds a join plan that appends attendees and expands one-way languages", async () => {
    const meeting = await getMeetingByReadableId("1234567890");
    expect(meeting).toBeTruthy();

    const joinPlan = buildJoinMeetingPlan(
      meeting!,
      { id: "meeting_join_guest", languageCode: "es" },
      { isHostSendingAudio: false, audioSessionCount: 0 },
    );

    expect(joinPlan.isHost).toBe(false);
    expect(joinPlan.addedLanguage).toBe(true);
    expect(joinPlan.languageLimitExceeded).toBe(false);
    expect(joinPlan.updatePayload.attendees).toContain("meeting_join_guest");
    expect(joinPlan.updatePayload.languages).toEqual(["en", "es"]);
  });

  it("flags when a one-way meeting has reached its language cap", () => {
    // This synthetic record keeps the cap test independent from prior persistence assertions.
    const joinPlan = buildJoinMeetingPlan(
      {
        id: "meeting-cap",
        readable_id: "cap-id",
        passcode: null,
        join_url: null,
        method: "one_way",
        languages: ["en", "es", "fr", "de", "it"],
        integration: null,
        scheduled_time: null,
        started_at: null,
        ended_at: null,
        host_id: "meeting_join_host",
        attendees: ["meeting_join_host"],
        topic: "Cap Meeting",
        tenant_id: tenantId,
      },
      { id: "meeting_join_extra", languageCode: "pt" },
      null,
    );

    expect(joinPlan.languageLimitExceeded).toBe(true);
    expect(getJoinLanguageLimitMessage()).toContain("at most 5 spoken languages");
  });

  it("persists the join plan back to the meeting record", async () => {
    await persistJoinMeetingPlan(meetingId, {
      attendees: ["meeting_join_host", "meeting_join_guest"],
      languages: ["en", "es"],
    });

    const [savedMeeting] = await db
      .select({ attendees: meetings.attendees, languages: meetings.languages })
      .from(meetings)
      .where(eq(meetings.id, meetingId));

    expect(savedMeeting?.attendees).toEqual(["meeting_join_host", "meeting_join_guest"]);
    expect(savedMeeting?.languages).toEqual(["en", "es"]);
  });
});
