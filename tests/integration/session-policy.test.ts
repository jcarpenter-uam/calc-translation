import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "../../core/database";
import { tenants } from "../../models/tenantModel";
import { users } from "../../models/userModel";
import { userTenants } from "../../models/userTenantModel";
import { requireTenantContext, resolveSessionContext } from "../../utils/sessionPolicy";
import { cleanupTestData, trackTestTenants, trackTestUsers } from "../setup/utils/testHelpers";

describe("sessionPolicy", () => {
  const tenantId = "session-policy-tenant";
  const userIds = [
    "session_policy_user",
    "session_policy_other",
    "session_policy_super",
  ];

  beforeAll(async () => {
    trackTestTenants(tenantId);
    trackTestUsers(...userIds);

    await db
      .insert(tenants)
      .values({ tenantId, organizationName: "Session Policy Tenant" })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values([
        {
          id: "session_policy_user",
          name: "Session Policy User",
          email: "session_policy_user@test.com",
          languageCode: "en",
          role: "user" as any,
        },
        {
          id: "session_policy_other",
          name: "Session Policy Other",
          email: "session_policy_other@test.com",
          languageCode: "es",
          role: "user" as any,
        },
        {
          id: "session_policy_super",
          name: "Session Policy Super",
          email: "session_policy_super@test.com",
          languageCode: "en",
          role: "super_admin" as any,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(userTenants)
      .values([{ userId: "session_policy_user", tenantId }])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("resolves a regular user only when tenant membership exists", async () => {
    const resolved = await resolveSessionContext({
      userId: "session_policy_user",
      tenantId,
    });

    expect(resolved.user?.id).toBe("session_policy_user");
    expect(resolved.tenantId).toBe(tenantId);
  });

  it("rejects a regular user token whose tenant membership is missing", async () => {
    // The user record exists, but the session should still fail because tenant scope is stale.
    const resolved = await resolveSessionContext({
      userId: "session_policy_other",
      tenantId,
    });

    expect(resolved.user).toBeNull();
    expect(resolved.tenantId).toBeNull();
  });

  it("allows super admins to resolve without tenant membership", async () => {
    const resolved = await resolveSessionContext({
      userId: "session_policy_super",
      tenantId,
    });

    expect(resolved.user?.id).toBe("session_policy_super");
    expect(resolved.tenantId).toBe(tenantId);
  });

  it("marks missing tenant context as a bad request", () => {
    const set: { status?: number } = {};

    expect(requireTenantContext(null, set)).toBeNull();
    expect(set.status).toBe(400);
  });
});
