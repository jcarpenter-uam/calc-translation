import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../core/database";
import { users } from "../models/userModel";
import { meetings } from "../models/meetingModel";
import { tenants } from "../models/tenantModel";
import { inArray, eq } from "drizzle-orm";
import { generateApiSessionToken } from "../utils/security";
import {
  apiFetch,
  BASE_URL,
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
  let meetingIds: Record<string, string> = {}; // Stores internal UUIDs to test the detail endpoint

  beforeAll(async () => {
    // 1. Seed two distinct tenants
    await db
      .insert(tenants)
      .values([
        { tenantId: "rbac-tenant-1", organizationName: "RBAC Org 1" },
        { tenantId: "rbac-tenant-2", organizationName: "RBAC Org 2" },
      ])
      .onConflictDoNothing();

    // 2. Seed users with specific roles
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

    // 3. Mint JWTs representing the users assigned to their respective tenants
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

    // 4. Create Meetings using the API (this ensures the tenant_id gets stamped automatically based on the JWT)
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

    // 5. Backdoor User 2 into the T1 Admin meeting as an attendee so we can test the attendee access logic
    await db
      .update(meetings)
      .set({ attendees: ["rbac_user_2"] })
      .where(eq(meetings.id, meetingIds.t1admin!));
  });

  afterAll(async () => {
    // Teardown: Clean up meetings, users, and tenants to prevent database pollution
    await db.delete(meetings).where(inArray(meetings.host_id, testUserIds));
    await db.delete(users).where(inArray(users.id, testUserIds));
    await db.delete(tenants).where(inArray(tenants.tenantId, testTenantIds));
  });

  // --- TEST CASES ---

  it("1. Super Admin can see all meetings across all tenants", async () => {
    // Test the List Endpoint
    const listRes = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${tokens.super}` },
    });

    expect(listRes.status).toBe(200);
    const data = (await listRes.json()) as MeetingListResponse;
    const topics = data.meetings.map((m: any) => m.topic);

    expect(topics).toContain("User 1 Meeting");
    expect(topics).toContain("T1 Admin Meeting");
    expect(topics).toContain("T2 Admin Meeting");

    // Test the Detail Endpoint (Super admin querying a meeting from Tenant 2)
    const detailRes = await fetch(`${BASE_URL}/meeting/${meetingIds.t2admin}`, {
      headers: { Cookie: `auth_session=${tokens.super}` },
    });

    expect(detailRes.status).toBe(200);
  });

  it("2. Tenant Admin can see all meetings across their tenant ONLY", async () => {
    // --- Tenant 1 Admin ---
    const t1ListRes = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${tokens.t1admin}` },
    });
    const t1Data = (await t1ListRes.json()) as MeetingListResponse;
    const t1Topics = t1Data.meetings.map((m: any) => m.topic);

    expect(t1Topics).toContain("User 1 Meeting"); // They didn't host this, but it's in their org
    expect(t1Topics).toContain("T1 Admin Meeting"); // They hosted this
    expect(t1Topics).not.toContain("T2 Admin Meeting"); // Different org, should be hidden!

    // Ensure Tenant 1 Admin gets a 403 Forbidden if they try to fetch Tenant 2's meeting details directly
    const crossTenantRes = await fetch(
      `${BASE_URL}/meeting/${meetingIds.t2admin}`,
      {
        headers: { Cookie: `auth_session=${tokens.t1admin}` },
      },
    );
    expect(crossTenantRes.status).toBe(403);

    // --- Tenant 2 Admin ---
    const t2ListRes = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${tokens.t2admin}` },
    });
    const t2Data = (await t2ListRes.json()) as MeetingListResponse;
    const t2Topics = t2Data.meetings.map((m: any) => m.topic);

    expect(t2Topics).toContain("T2 Admin Meeting");
    expect(t2Topics).not.toContain("User 1 Meeting");
  });

  it("3. Regular User can only see meetings they hosted or explicitly attended", async () => {
    // --- User 1 (The Host) ---
    const u1ListRes = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${tokens.u1}` },
    });
    const u1Data = (await u1ListRes.json()) as MeetingListResponse;
    const u1Topics = u1Data.meetings.map((m: any) => m.topic);

    expect(u1Topics).toContain("User 1 Meeting"); // They hosted it
    expect(u1Topics).not.toContain("T1 Admin Meeting"); // Same tenant, but they weren't invited!

    // Ensure User 1 gets 403 on a meeting in their tenant they didn't attend
    const u1DetailRes = await fetch(
      `${BASE_URL}/meeting/${meetingIds.t1admin}`,
      {
        headers: { Cookie: `auth_session=${tokens.u1}` },
      },
    );
    expect(u1DetailRes.status).toBe(403);

    // --- User 2 (The Attendee) ---
    const u2ListRes = await fetch(`${BASE_URL}/meeting/list`, {
      headers: { Cookie: `auth_session=${tokens.u2}` },
    });
    const u2Data = (await u2ListRes.json()) as MeetingListResponse;
    const u2Topics = u2Data.meetings.map((m: any) => m.topic);

    expect(u2Topics).toContain("T1 Admin Meeting"); // They didn't host it, but they are an attendee
    expect(u2Topics).not.toContain("User 1 Meeting"); // They are not an attendee here

    // Ensure User 2 gets 200 OK on the meeting they attended
    const u2DetailRes = await fetch(
      `${BASE_URL}/meeting/${meetingIds.t1admin}`,
      {
        headers: { Cookie: `auth_session=${tokens.u2}` },
      },
    );
    expect(u2DetailRes.status).toBe(200);
  });
});
