import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import { tenants } from "../models/tenantModel";
import { users } from "../models/userModel";
import { userTenants } from "../models/userTenantModel";
import { generateApiSessionToken } from "../utils/security";
import {
  BASE_URL,
  cleanupTestData,
  trackTestTenants,
  trackTestUsers,
} from "./utils/testHelpers";

describe("Quick Meeting Routes", () => {
  const tenantOneId = "quick-tenant-1";
  const tenantTwoId = "quick-tenant-2";
  const testUserIds = [
    "quick_host",
    "quick_attendee_a",
    "quick_attendee_b",
    "quick_other_tenant_user",
  ];

  let hostToken = "";

  beforeAll(async () => {
    trackTestTenants(tenantOneId, tenantTwoId);
    trackTestUsers(...testUserIds);

    await db
      .insert(tenants)
      .values([
        { tenantId: tenantOneId, organizationName: "Quick Tenant One" },
        { tenantId: tenantTwoId, organizationName: "Quick Tenant Two" },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values([
        {
          id: "quick_host",
          name: "Quick Host",
          email: "quick_host@test.com",
          languageCode: "en",
          role: "user" as any,
        },
        {
          id: "quick_attendee_a",
          name: "Quick Attendee Alpha",
          email: "quick_attendee_a@test.com",
          languageCode: "es",
          role: "user" as any,
        },
        {
          id: "quick_attendee_b",
          name: "Quick Attendee Beta",
          email: "quick_attendee_b@test.com",
          languageCode: "fr",
          role: "tenant_admin" as any,
        },
        {
          id: "quick_other_tenant_user",
          name: "Other Tenant User",
          email: "quick_other_tenant_user@test.com",
          languageCode: "de",
          role: "user" as any,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(userTenants)
      .values([
        { userId: "quick_host", tenantId: tenantOneId },
        { userId: "quick_attendee_a", tenantId: tenantOneId },
        { userId: "quick_attendee_b", tenantId: tenantOneId },
        { userId: "quick_other_tenant_user", tenantId: tenantTwoId },
      ])
      .onConflictDoNothing();

    hostToken = await generateApiSessionToken("quick_host", tenantOneId);
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("lists invitees scoped to tenant and supports search", async () => {
    const response = await fetch(
      `${BASE_URL}/meeting/invitees?q=Alpha&limit=10`,
      {
        headers: { Cookie: `auth_session=${hostToken}` },
      },
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(Array.isArray(data.invitees)).toBe(true);
    expect(data.invitees.length).toBe(1);
    expect(data.invitees[0].id).toBe("quick_attendee_a");
  });

  it("creates quick meeting with tenant-scoped invitees", async () => {
    const response = await fetch(`${BASE_URL}/meeting/quick-create`, {
      method: "POST",
      headers: {
        Cookie: `auth_session=${hostToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Instant Alignment",
        attendeeIds: ["quick_attendee_a", "quick_attendee_b"],
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.meetingId).toBeTruthy();
    expect(data.readableId).toBeTruthy();
    expect(data.invitedCount).toBe(2);

    const [savedMeeting] = await db
      .select({
        topic: meetings.topic,
        hostId: meetings.host_id,
        tenantId: meetings.tenant_id,
        attendees: meetings.attendees,
      })
      .from(meetings)
      .where(eq(meetings.id, data.meetingId));

    expect(savedMeeting?.topic).toBe("Instant Alignment");
    expect(savedMeeting?.hostId).toBe("quick_host");
    expect(savedMeeting?.tenantId).toBe(tenantOneId);
    expect(savedMeeting?.attendees).toEqual([
      "quick_attendee_a",
      "quick_attendee_b",
    ]);

    const participantsResponse = await fetch(
      `${BASE_URL}/meeting/${data.meetingId}/participants`,
      {
        headers: { Cookie: `auth_session=${hostToken}` },
      },
    );

    expect(participantsResponse.status).toBe(200);
    const participantsData = (await participantsResponse.json()) as any;
    expect(Array.isArray(participantsData.participants)).toBe(true);

    const participantIds = participantsData.participants.map((entry: any) => entry.id);
    expect(participantIds).toContain("quick_host");
    expect(participantIds).toContain("quick_attendee_a");
    expect(participantIds).toContain("quick_attendee_b");

    const hostEntry = participantsData.participants.find(
      (entry: any) => entry.id === "quick_host",
    );
    expect(hostEntry.isHost).toBe(true);
  });

  it("rejects cross-tenant invitees during quick meeting creation", async () => {
    const response = await fetch(`${BASE_URL}/meeting/quick-create`, {
      method: "POST",
      headers: {
        Cookie: `auth_session=${hostToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Cross Tenant Attempt",
        attendeeIds: ["quick_attendee_a", "quick_other_tenant_user"],
      }),
    });

    expect(response.status).toBe(400);
    const data = (await response.json()) as any;
    expect(data.error).toContain("invalid");

    const [crossTenantMeeting] = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(
        and(
          eq(meetings.host_id, "quick_host"),
          eq(meetings.topic, "Cross Tenant Attempt"),
        ),
      );

    expect(crossTenantMeeting).toBeUndefined();
  });
});
