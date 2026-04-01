import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../core/database";
import { meetings } from "../../models/meetingModel";
import { tenantDomains, tenantAuthConfigs, tenants } from "../../models/tenantModel";
import { users } from "../../models/userModel";
import { userTenants } from "../../models/userTenantModel";
import { encrypt } from "../../utils/fernet";
import { generateApiSessionToken } from "../../utils/security";
import {
  BASE_URL,
  cleanupTestData,
  trackTestTenants,
  trackTestUsers,
} from "../setup/utils/testHelpers";

describe("Tenant admin guardrails", () => {
  const seededMeetingId = "11111111-1111-4111-8111-111111111111";
  const tenantIds = ["tenant-guardrails-a", "tenant-guardrails-b"];
  const userIds = [
    "tenant-guardrails-super",
    "tenant-guardrails-admin",
    "tenant-guardrails-member",
  ];

  let superToken = "";
  let adminToken = "";
  let memberToken = "";

  beforeAll(async () => {
    trackTestTenants(...tenantIds);
    trackTestUsers(...userIds);

    await db
      .insert(tenants)
      .values([
        { tenantId: "tenant-guardrails-a", organizationName: "Tenant Guardrails A" },
        { tenantId: "tenant-guardrails-b", organizationName: "Tenant Guardrails B" },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values([
        {
          id: "tenant-guardrails-super",
          name: "Tenant Guardrails Super",
          email: "tenant-guardrails-super@test.com",
          languageCode: "en",
          role: "super_admin",
        },
        {
          id: "tenant-guardrails-admin",
          name: "Tenant Guardrails Admin",
          email: "tenant-guardrails-admin@test.com",
          languageCode: "en",
          role: "tenant_admin",
        },
        {
          id: "tenant-guardrails-member",
          name: "Tenant Guardrails Member",
          email: "tenant-guardrails-member@test.com",
          languageCode: "en",
          role: "user",
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(userTenants)
      .values([
        { userId: "tenant-guardrails-super", tenantId: "tenant-guardrails-a" },
        { userId: "tenant-guardrails-admin", tenantId: "tenant-guardrails-a" },
        { userId: "tenant-guardrails-member", tenantId: "tenant-guardrails-a" },
      ])
      .onConflictDoNothing();

    superToken = await generateApiSessionToken("tenant-guardrails-super", "tenant-guardrails-a");
    adminToken = await generateApiSessionToken("tenant-guardrails-admin", "tenant-guardrails-a");
    memberToken = await generateApiSessionToken("tenant-guardrails-member", "tenant-guardrails-a");
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("prevents tenant admins from deleting their own account", async () => {
    const response = await fetch(
      `${BASE_URL}/tenants/tenant-guardrails-a/users/tenant-guardrails-admin`,
      {
        method: "DELETE",
        headers: { Cookie: `auth_session=${adminToken}` },
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "You cannot delete your own account",
    });
  });

  it("forbids tenant admins from deleting tenants", async () => {
    const response = await fetch(`${BASE_URL}/tenants/tenant-guardrails-b`, {
      method: "DELETE",
      headers: { Cookie: `auth_session=${adminToken}` },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Forbidden - Insufficient permissions",
    });
  });

  it("deletes a tenant and its dependent records for super admins", async () => {
    await db
      .insert(tenantDomains)
      .values({
        tenantId: "tenant-guardrails-b",
        domain: "tenant-guardrails-b.test",
        providerType: "google",
      })
      .onConflictDoNothing();

    await db
      .insert(tenantAuthConfigs)
      .values({
        tenantId: "tenant-guardrails-b",
        providerType: "google",
        clientId: "guardrails-client-id",
        clientSecretEncrypted: encrypt("guardrails-client-secret"),
        tenantHint: null,
      })
      .onConflictDoNothing();

    await db
      .insert(meetings)
      .values({
        id: seededMeetingId,
        readable_id: "9999999999",
        topic: "Tenant Guardrails Meeting",
        scheduled_time: new Date(),
        host_id: "tenant-guardrails-super",
        tenant_id: "tenant-guardrails-b",
        languages: ["en"],
        method: "one_way",
        join_url: "https://example.test/meeting",
      } as any)
      .onConflictDoNothing();

    const response = await fetch(`${BASE_URL}/tenants/tenant-guardrails-b`, {
      method: "DELETE",
      headers: { Cookie: `auth_session=${superToken}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Tenant deleted successfully",
    });

    const [deletedTenant] = await db
      .select({ tenantId: tenants.tenantId })
      .from(tenants)
      .where(eq(tenants.tenantId, "tenant-guardrails-b"));
    const [deletedMeeting] = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(eq(meetings.id, seededMeetingId));

    expect(deletedTenant).toBeUndefined();
    expect(deletedMeeting).toBeUndefined();
  });
});
