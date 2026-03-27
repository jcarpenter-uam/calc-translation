import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../core/database";
import { users } from "../models/userModel";
import { meetings } from "../models/meetingModel";
import { tenants } from "../models/tenantModel";
import { userTenants } from "../models/userTenantModel";
import { eq } from "drizzle-orm";
import { generateApiSessionToken } from "../utils/security";
import {
  apiFetch,
  BASE_URL,
  trackTestUsers,
  trackTestTenants,
  cleanupTestData,
  type CreateMeetingResponse,
} from "./utils/testHelpers";

interface MeetingListResponse {
  meetings: Array<{ topic: string }>;
}

describe("Role-Based Access Control (RBAC)", () => {
  const testTenantIds = ["rbac-tenant-1", "rbac-tenant-2"];
  const testUserIds = [
    "rbac_super",
    "rbac_t1_admin",
    "rbac_t2_admin",
    "rbac_user_1",
    "rbac_user_2",
  ];

  let tokens: Record<string, string> = {};
  let meetingIds: Record<string, string> = {};

  beforeAll(async () => {
    trackTestTenants(...testTenantIds);
    trackTestUsers(...testUserIds);

    await db
      .insert(tenants)
      .values([
        { tenantId: "rbac-tenant-1", organizationName: "RBAC Org 1" },
        { tenantId: "rbac-tenant-2", organizationName: "RBAC Org 2" },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values([
        {
          id: "rbac_super",
          name: "Super",
          email: "super@test.com",
          languageCode: "en",
          role: "super_admin" as any,
        },
        {
          id: "rbac_t1_admin",
          name: "T1 Admin",
          email: "t1@test.com",
          languageCode: "en",
          role: "tenant_admin" as any,
        },
        {
          id: "rbac_t2_admin",
          name: "T2 Admin",
          email: "t2@test.com",
          languageCode: "en",
          role: "tenant_admin" as any,
        },
        {
          id: "rbac_user_1",
          name: "User 1",
          email: "u1@test.com",
          languageCode: "en",
          role: "user" as any,
        },
        {
          id: "rbac_user_2",
          name: "User 2",
          email: "u2@test.com",
          languageCode: "en",
          role: "user" as any,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(userTenants)
      .values([
        { userId: "rbac_super", tenantId: "rbac-tenant-1" },
        { userId: "rbac_t1_admin", tenantId: "rbac-tenant-1" },
        { userId: "rbac_t2_admin", tenantId: "rbac-tenant-2" },
        { userId: "rbac_user_1", tenantId: "rbac-tenant-1" },
        { userId: "rbac_user_2", tenantId: "rbac-tenant-1" },
      ])
      .onConflictDoNothing();

    tokens.super = await generateApiSessionToken("rbac_super", "rbac-tenant-1");
    tokens.t1admin = await generateApiSessionToken(
      "rbac_t1_admin",
      "rbac-tenant-1",
    );
    tokens.t2admin = await generateApiSessionToken(
      "rbac_t2_admin",
      "rbac-tenant-2",
    );
    tokens.u1 = await generateApiSessionToken("rbac_user_1", "rbac-tenant-1");
    tokens.u2 = await generateApiSessionToken("rbac_user_2", "rbac-tenant-1");

    const u1Meeting = await apiFetch<CreateMeetingResponse>(
      "/meeting/create",
      tokens.u1,
      {
      topic: "User 1 Meeting",
      },
    );
    const t1AdminMeeting = await apiFetch<CreateMeetingResponse>(
      "/meeting/create",
      tokens.t1admin,
      {
      topic: "T1 Admin Meeting",
      },
    );
    const t2AdminMeeting = await apiFetch<CreateMeetingResponse>(
      "/meeting/create",
      tokens.t2admin,
      {
      topic: "T2 Admin Meeting",
      },
    );

    meetingIds.u1 = u1Meeting.meetingId;
    meetingIds.t1admin = t1AdminMeeting.meetingId;
    meetingIds.t2admin = t2AdminMeeting.meetingId;

    // Promote one regular user to attendee status so the suite covers explicit invite access as
    // well as host/admin visibility.
    await db
      .update(meetings)
      .set({ attendees: ["rbac_user_2"] })
      .where(eq(meetings.id, meetingIds.t1admin!));
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("1. Super Admin can see all meetings across all tenants", async () => {
    const listRes = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${tokens.super}` },
    });

    expect(listRes.status).toBe(200);
    const data = (await listRes.json()) as MeetingListResponse;
    const topics = data.meetings.map((m: any) => m.topic);

    expect(topics).toContain("User 1 Meeting");
    expect(topics).toContain("T1 Admin Meeting");
    expect(topics).toContain("T2 Admin Meeting");

    const detailRes = await fetch(`${BASE_URL}/meeting/${meetingIds.t2admin}`, {
      headers: { Cookie: `auth_session=${tokens.super}` },
    });

    expect(detailRes.status).toBe(200);
  });

  it("2. Tenant Admin can see all meetings across their tenant ONLY", async () => {
    const t1ListRes = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${tokens.t1admin}` },
    });
    const t1Data = (await t1ListRes.json()) as MeetingListResponse;
    const t1Topics = t1Data.meetings.map((m: any) => m.topic);

    expect(t1Topics).toContain("User 1 Meeting");
    expect(t1Topics).toContain("T1 Admin Meeting");
    expect(t1Topics).not.toContain("T2 Admin Meeting");

    // Detail access should enforce the same tenant boundary as the list endpoint.
    const crossTenantRes = await fetch(
      `${BASE_URL}/meeting/${meetingIds.t2admin}`,
      {
        headers: { Cookie: `auth_session=${tokens.t1admin}` },
      },
    );
    expect(crossTenantRes.status).toBe(403);

    const t2ListRes = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${tokens.t2admin}` },
    });
    const t2Data = (await t2ListRes.json()) as MeetingListResponse;
    const t2Topics = t2Data.meetings.map((m: any) => m.topic);

    expect(t2Topics).toContain("T2 Admin Meeting");
    expect(t2Topics).not.toContain("User 1 Meeting");
  });

  it("3. Regular User can only see meetings they hosted or explicitly attended", async () => {
    const u1ListRes = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${tokens.u1}` },
    });
    const u1Data = (await u1ListRes.json()) as MeetingListResponse;
    const u1Topics = u1Data.meetings.map((m: any) => m.topic);

    expect(u1Topics).toContain("User 1 Meeting");
    expect(u1Topics).not.toContain("T1 Admin Meeting");

    const u1DetailRes = await fetch(
      `${BASE_URL}/meeting/${meetingIds.t1admin}`,
      {
        headers: { Cookie: `auth_session=${tokens.u1}` },
      },
    );
    expect(u1DetailRes.status).toBe(403);

    const u2ListRes = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${tokens.u2}` },
    });
    const u2Data = (await u2ListRes.json()) as MeetingListResponse;
    const u2Topics = u2Data.meetings.map((m: any) => m.topic);

    expect(u2Topics).toContain("T1 Admin Meeting");
    expect(u2Topics).not.toContain("User 1 Meeting");

    const u2DetailRes = await fetch(
      `${BASE_URL}/meeting/${meetingIds.t1admin}`,
      {
        headers: { Cookie: `auth_session=${tokens.u2}` },
      },
    );
    expect(u2DetailRes.status).toBe(200);
  });
});
