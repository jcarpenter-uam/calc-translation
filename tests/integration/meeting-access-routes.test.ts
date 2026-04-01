import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../../core/database";
import { meetings } from "../../models/meetingModel";
import { userTenants } from "../../models/userTenantModel";
import {
  BASE_URL,
  cleanupTestUsers,
  createMeeting,
  createTestUser,
} from "../setup/utils/testHelpers";

describe("Meeting access routes", () => {
  let host: Awaited<ReturnType<typeof createTestUser>>;
  let guest: Awaited<ReturnType<typeof createTestUser>>;
  let staleMember: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    host = await createTestUser("meeting-access-host", "Meeting Access Host", "en");
    guest = await createTestUser("meeting-access-guest", "Meeting Access Guest", "es");
    staleMember = await createTestUser(
      "meeting-access-stale",
      "Meeting Access Stale",
      "fr",
    );
  });

  afterAll(async () => {
    await cleanupTestUsers();
  });

  it("denies meeting details before join, then grants access after join and persists attendee language", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Join Access Coverage",
      languages: ["en"],
    });

    const detailBeforeJoin = await fetch(`${BASE_URL}/meeting/${meeting.meetingId}`, {
      headers: { Cookie: `auth_session=${guest.token}` },
    });
    expect(detailBeforeJoin.status).toBe(403);

    // Join should accept the user-facing formatted readable id, not just the normalized digits.
    const joinResponse = await fetch(
      `${BASE_URL}/meeting/join/${meeting.readableId.slice(0, 3)}-${meeting.readableId.slice(3)}`,
      {
        method: "POST",
        headers: { Cookie: `auth_session=${guest.token}` },
      },
    );

    expect(joinResponse.status).toBe(200);
    const joined = (await joinResponse.json()) as {
      token: string;
      isActive: boolean;
      isHost: boolean;
    };
    expect(joined.token).toBeTruthy();
    expect(joined.isActive).toBe(false);
    expect(joined.isHost).toBe(false);

    const detailAfterJoin = await fetch(`${BASE_URL}/meeting/${meeting.meetingId}`, {
      headers: { Cookie: `auth_session=${guest.token}` },
    });
    expect(detailAfterJoin.status).toBe(200);

    // Joining doubles as invite acceptance, so both attendees and one-way languages should update.
    const [savedMeeting] = await db
      .select({ attendees: meetings.attendees, languages: meetings.languages })
      .from(meetings)
      .where(eq(meetings.id, meeting.meetingId));

    expect(savedMeeting?.attendees).toContain(guest.id);
    expect(savedMeeting?.languages).toEqual(["en", "es"]);
  });

  it("marks the host as active when they join their own meeting", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Host Join Coverage",
      languages: ["en"],
    });

    const joinResponse = await fetch(`${BASE_URL}/meeting/join/${meeting.readableId}`, {
      method: "POST",
      headers: { Cookie: `auth_session=${host.token}` },
    });

    expect(joinResponse.status).toBe(200);
    const joined = (await joinResponse.json()) as { isActive: boolean; isHost: boolean };
    expect(joined.isActive).toBe(true);
    expect(joined.isHost).toBe(true);
  });

  it("rejects existing tokens after tenant membership is removed", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Stale Membership Coverage",
      languages: ["en"],
    });

    // Removing membership simulates a stale token after an admin revokes tenant access.
    await db
      .delete(userTenants)
      .where(
        and(
          eq(userTenants.userId, staleMember.id),
          eq(userTenants.tenantId, "test-tenant"),
        ),
      );

    const listResponse = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${staleMember.token}` },
    });
    expect(listResponse.status).toBe(401);

    // The same stale token should fail consistently across list and join routes.
    const joinResponse = await fetch(`${BASE_URL}/meeting/join/${meeting.readableId}`, {
      method: "POST",
      headers: { Cookie: `auth_session=${staleMember.token}` },
    });
    expect(joinResponse.status).toBe(401);
  });
});
