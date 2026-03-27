import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../core/database";
import { tenantAuthConfigs, tenantDomains, tenants } from "../models/tenantModel";
import { users } from "../models/userModel";
import { userTenants } from "../models/userTenantModel";
import { decrypt, encrypt } from "../utils/fernet";
import { generateApiSessionToken } from "../utils/security";
import {
  BASE_URL,
  cleanupTestData,
  trackTestTenants,
  trackTestUsers,
} from "./utils/testHelpers";

describe("User Routes", () => {
  const tenantOneId = "users-tenant-1";
  const tenantTwoId = "users-tenant-2";

  const testUserIds = [
    "users_super",
    "users_t1_admin",
    "users_t2_admin",
    "users_t1_member_a",
    "users_t1_member_b",
    "users_t2_member",
    "users_t2_member_delete",
  ];

  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    trackTestTenants(tenantOneId, tenantTwoId);
    trackTestUsers(...testUserIds);

    await db
      .insert(tenants)
      .values([
        { tenantId: tenantOneId, organizationName: "Users Tenant One" },
        { tenantId: tenantTwoId, organizationName: "Users Tenant Two" },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values([
        {
          id: "users_super",
          name: "Users Super",
          email: "users_super@test.com",
          languageCode: "en",
          role: "super_admin" as any,
        },
        {
          id: "users_t1_admin",
          name: "Tenant One Admin",
          email: "users_t1_admin@test.com",
          languageCode: "en",
          role: "tenant_admin" as any,
        },
        {
          id: "users_t2_admin",
          name: "Tenant Two Admin",
          email: "users_t2_admin@test.com",
          languageCode: "en",
          role: "tenant_admin" as any,
        },
        {
          id: "users_t1_member_a",
          name: "Tenant One Member A",
          email: "users_t1_member_a@test.com",
          languageCode: "es",
          role: "user" as any,
        },
        {
          id: "users_t1_member_b",
          name: "Tenant One Member B",
          email: "users_t1_member_b@test.com",
          languageCode: "fr",
          role: "user" as any,
        },
        {
          id: "users_t2_member",
          name: "Tenant Two Member",
          email: "users_t2_member@test.com",
          languageCode: "de",
          role: "user" as any,
        },
        {
          id: "users_t2_member_delete",
          name: "Tenant Two Member Delete",
          email: "users_t2_member_delete@test.com",
          languageCode: "nl",
          role: "user" as any,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(userTenants)
      .values([
        { userId: "users_super", tenantId: tenantOneId },
        { userId: "users_t1_admin", tenantId: tenantOneId },
        { userId: "users_t1_member_a", tenantId: tenantOneId },
        { userId: "users_t1_member_b", tenantId: tenantOneId },
        { userId: "users_t2_admin", tenantId: tenantTwoId },
        { userId: "users_t2_member", tenantId: tenantTwoId },
        { userId: "users_t2_member_delete", tenantId: tenantTwoId },
      ])
      .onConflictDoNothing();

    // Seed both tenant-domain and auth-config data because these user/admin endpoints expose the
    // same tenant settings payload used by the admin UI.
    await db
      .insert(tenantDomains)
      .values([
        {
          domain: "tenant-one.example.com",
          tenantId: tenantOneId,
          providerType: "google",
        },
        {
          domain: "tenant-two.example.com",
          tenantId: tenantTwoId,
          providerType: "entra",
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(tenantAuthConfigs)
      .values([
        {
          tenantId: tenantOneId,
          providerType: "google",
          clientId: "google-client-1",
          clientSecretEncrypted: encrypt("secret-one"),
          tenantHint: null,
        },
        {
          tenantId: tenantTwoId,
          providerType: "entra",
          clientId: "entra-client-2",
          clientSecretEncrypted: encrypt("secret-two"),
          tenantHint: "common",
        },
      ])
      .onConflictDoNothing();

    tokens.super = await generateApiSessionToken("users_super", tenantOneId);
    tokens.t1admin = await generateApiSessionToken("users_t1_admin", tenantOneId);
    tokens.t2admin = await generateApiSessionToken("users_t2_admin", tenantTwoId);
    tokens.t1memberA = await generateApiSessionToken(
      "users_t1_member_a",
      tenantOneId,
    );
    tokens.t1memberB = await generateApiSessionToken(
      "users_t1_member_b",
      tenantOneId,
    );
    tokens.t2member = await generateApiSessionToken("users_t2_member", tenantTwoId);
    tokens.t2memberDelete = await generateApiSessionToken(
      "users_t2_member_delete",
      tenantTwoId,
    );
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("returns /user/me with role and tenant name", async () => {
    const response = await fetch(`${BASE_URL}/user/me`, {
      headers: { Cookie: `auth_session=${tokens.t1admin}` },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;

    expect(data.user.id).toBe("users_t1_admin");
    expect(data.user.role).toBe("tenant_admin");
    expect(data.tenant.id).toBe(tenantOneId);
    expect(data.tenant.name).toBe("Users Tenant One");
  });

  it("updates own account language with PATCH /user/me", async () => {
    const response = await fetch(`${BASE_URL}/user/me`, {
      method: "PATCH",
      headers: {
        Cookie: `auth_session=${tokens.t1memberA}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ languageCode: "ja" }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.user.languageCode).toBe("ja");

    const [updatedUser] = await db
      .select({ languageCode: users.languageCode })
      .from(users)
      .where(eq(users.id, "users_t1_member_a"));
    expect(updatedUser?.languageCode).toBe("ja");
  });

  it("allows tenant admin to list only users in their tenant", async () => {
    const response = await fetch(`${BASE_URL}/tenants/${tenantOneId}/users`, {
      headers: { Cookie: `auth_session=${tokens.t1admin}` },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;

    const listedIds = data.users.map((entry: any) => entry.id);
    expect(listedIds).toContain("users_t1_admin");
    expect(listedIds).toContain("users_t1_member_a");
    expect(listedIds).toContain("users_t1_member_b");
    expect(listedIds).not.toContain("users_t2_admin");
    expect(listedIds).not.toContain("users_t2_member");
  });

  it("returns tenant options for admin routes", async () => {
    const superRes = await fetch(`${BASE_URL}/tenants/`, {
      headers: { Cookie: `auth_session=${tokens.super}` },
    });

    expect(superRes.status).toBe(200);
    const superData = (await superRes.json()) as any;
    const superTenantIds = superData.tenants.map((tenant: any) => tenant.id);
    expect(superTenantIds).toContain(tenantOneId);
    expect(superTenantIds).toContain(tenantTwoId);

    const tenantAdminRes = await fetch(`${BASE_URL}/tenants/`, {
      headers: { Cookie: `auth_session=${tokens.t1admin}` },
    });
    expect(tenantAdminRes.status).toBe(200);
    const tenantAdminData = (await tenantAdminRes.json()) as any;
    // Tenant admins only get their own tenant as a valid scope selector.
    expect(tenantAdminData.tenants).toEqual([
      {
        id: tenantOneId,
        name: "Users Tenant One",
      },
    ]);
  });

  it("allows super admin to list users for any tenant", async () => {
    const response = await fetch(`${BASE_URL}/tenants/${tenantTwoId}/users`, {
      headers: { Cookie: `auth_session=${tokens.super}` },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    const listedIds = data.users.map((entry: any) => entry.id);
    expect(listedIds).toContain("users_t2_admin");
    expect(listedIds).toContain("users_t2_member");
    expect(listedIds).toContain("users_t2_member_delete");
    expect(listedIds).not.toContain("users_t1_member_a");
  });

  it("blocks tenant admins from cross-tenant list queries", async () => {
    const response = await fetch(`${BASE_URL}/tenants/${tenantTwoId}/users`, {
      headers: { Cookie: `auth_session=${tokens.t1admin}` },
    });

    expect(response.status).toBe(403);
  });

  it("supports tenant-scoped user search", async () => {
    const response = await fetch(
      `${BASE_URL}/tenants/${tenantOneId}/users?q=Member%20A`,
      {
        headers: { Cookie: `auth_session=${tokens.t1admin}` },
      },
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    const listedIds = data.users.map((entry: any) => entry.id);
    expect(listedIds).toContain("users_t1_member_a");
    expect(listedIds).not.toContain("users_t1_member_b");
    expect(data.pageInfo.hasMore).toBe(false);
  });

  it("blocks regular users from tenant user routes", async () => {
    const response = await fetch(`${BASE_URL}/tenants/${tenantOneId}/users`, {
      headers: { Cookie: `auth_session=${tokens.t1memberA}` },
    });

    expect(response.status).toBe(403);
  });

  it("returns tenant settings for a tenant admin without exposing secrets", async () => {
    const response = await fetch(`${BASE_URL}/tenants/${tenantOneId}/settings`, {
      headers: { Cookie: `auth_session=${tokens.t1admin}` },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.tenant.id).toBe(tenantOneId);
    expect(data.domains).toEqual([
      {
        domain: "tenant-one.example.com",
        providerType: "google",
      },
    ]);
    expect(data.authConfigs).toEqual([
      {
        providerType: "google",
        clientId: "google-client-1",
        tenantHint: null,
        hasSecret: true,
      },
    ]);
    expect(data.authConfigs[0].clientSecret).toBeUndefined();
  });

  it("allows tenant admin to update settings for their tenant", async () => {
    const response = await fetch(`${BASE_URL}/tenants/${tenantOneId}/settings`, {
      method: "PATCH",
      headers: {
        Cookie: `auth_session=${tokens.t1admin}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationName: "Tenant One Renamed",
        domains: [
          {
            domain: "tenant-one.example.com",
            providerType: "google",
          },
          {
            domain: "new.tenant-one.example.com",
            providerType: "google",
          },
        ],
        authConfigs: [
          {
            providerType: "google",
            clientId: "google-client-1-updated",
            tenantHint: null,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.tenant.name).toBe("Tenant One Renamed");
    expect(data.domains).toHaveLength(2);
    expect(data.authConfigs[0].clientId).toBe("google-client-1-updated");

    const [updatedConfig] = await db
      .select({
        clientId: tenantAuthConfigs.clientId,
        clientSecretEncrypted: tenantAuthConfigs.clientSecretEncrypted,
      })
      .from(tenantAuthConfigs)
      .where(
        and(
          eq(tenantAuthConfigs.tenantId, tenantOneId),
          eq(tenantAuthConfigs.providerType, "google"),
        ),
      );

    expect(updatedConfig?.clientId).toBe("google-client-1-updated");
    expect(decrypt(updatedConfig!.clientSecretEncrypted)).toBe("secret-one");
  });

  it("blocks cross-tenant settings updates for tenant admins", async () => {
    const response = await fetch(`${BASE_URL}/tenants/${tenantTwoId}/settings`, {
      method: "PATCH",
      headers: {
        Cookie: `auth_session=${tokens.t1admin}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationName: "Blocked",
        domains: [
          {
            domain: "tenant-two.example.com",
            providerType: "entra",
          },
        ],
        authConfigs: [
          {
            providerType: "entra",
            clientId: "blocked-client",
            tenantHint: "common",
          },
        ],
      }),
    });

    expect(response.status).toBe(403);
  });

  it("allows super admin to create an additional tenant", async () => {
    const response = await fetch(`${BASE_URL}/tenants/`, {
      method: "POST",
      headers: {
        Cookie: `auth_session=${tokens.super}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenantId: "users-tenant-3",
        organizationName: "Users Tenant Three",
        domains: [
          {
            domain: "tenant-three.example.com",
            providerType: "google",
          },
        ],
        authConfigs: [
          {
            providerType: "google",
            clientId: "google-client-3",
            clientSecret: "secret-three",
            tenantHint: null,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.tenant.id).toBe("users-tenant-3");
    expect(data.authConfigs[0].hasSecret).toBe(true);
    trackTestTenants("users-tenant-3");
  });

  it("allows tenant admin to update a user's role in their tenant", async () => {
    const response = await fetch(
      `${BASE_URL}/tenants/${tenantOneId}/users/users_t1_member_b`,
      {
        method: "PATCH",
        headers: {
          Cookie: `auth_session=${tokens.t1admin}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: "tenant_admin",
        }),
      },
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.user.role).toBe("tenant_admin");
    expect(data.user.name).toBe("Tenant One Member B");
    expect(data.user.email).toBe("users_t1_member_b@test.com");
    expect(data.user.languageCode).toBe("fr");
  });

  it("blocks cross-tenant user edits for tenant admins", async () => {
    const response = await fetch(
      `${BASE_URL}/tenants/${tenantTwoId}/users/users_t2_member`,
      {
        method: "PATCH",
        headers: {
          Cookie: `auth_session=${tokens.t1admin}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "tenant_admin" }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("rejects admin attempts to change a user's name", async () => {
    const response = await fetch(
      `${BASE_URL}/tenants/${tenantOneId}/users/users_t1_member_a`,
      {
        method: "PATCH",
        headers: {
          Cookie: `auth_session=${tokens.t1admin}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Renamed By Admin" }),
      },
    );

    expect(response.status).toBe(422);
  });

  it("rejects admin attempts to change a user's email", async () => {
    const response = await fetch(
      `${BASE_URL}/tenants/${tenantOneId}/users/users_t1_member_a`,
      {
        method: "PATCH",
        headers: {
          Cookie: `auth_session=${tokens.t1admin}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "renamed@test.com" }),
      },
    );

    expect(response.status).toBe(422);
  });

  it("rejects admin attempts to change a user's language", async () => {
    const response = await fetch(
      `${BASE_URL}/tenants/${tenantOneId}/users/users_t1_member_a`,
      {
        method: "PATCH",
        headers: {
          Cookie: `auth_session=${tokens.t1admin}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ languageCode: "en" }),
      },
    );

    expect(response.status).toBe(422);
  });

  it("allows super admin to edit users in another tenant", async () => {
    const response = await fetch(
      `${BASE_URL}/tenants/${tenantTwoId}/users/users_t2_member`,
      {
        method: "PATCH",
        headers: {
          Cookie: `auth_session=${tokens.super}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: "super_admin",
        }),
      },
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.user.role).toBe("super_admin");
  });

  it("prevents tenant admin from assigning super_admin role", async () => {
    const response = await fetch(
      `${BASE_URL}/tenants/${tenantOneId}/users/users_t1_member_a`,
      {
        method: "PATCH",
        headers: {
          Cookie: `auth_session=${tokens.t1admin}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "super_admin" }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("soft deletes user and blocks subsequent auth", async () => {
    const deleteResponse = await fetch(
      `${BASE_URL}/tenants/${tenantOneId}/users/users_t1_member_b`,
      {
      method: "DELETE",
      headers: { Cookie: `auth_session=${tokens.t1admin}` },
      },
    );
    expect(deleteResponse.status).toBe(200);

    const [deletedUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, "users_t1_member_b"), isNotNull(users.deletedAt)),
      );
    expect(deletedUser?.id).toBe("users_t1_member_b");

    const authResponse = await fetch(`${BASE_URL}/user/me`, {
      headers: { Cookie: `auth_session=${tokens.t1memberB}` },
    });
    expect(authResponse.status).toBe(401);
  });

  it("allows super admin to soft delete users in another tenant", async () => {
    const deleteResponse = await fetch(
      `${BASE_URL}/tenants/${tenantTwoId}/users/users_t2_member_delete`,
      {
        method: "DELETE",
        headers: { Cookie: `auth_session=${tokens.super}` },
      },
    );
    expect(deleteResponse.status).toBe(200);

    const [deletedUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, "users_t2_member_delete"), isNotNull(users.deletedAt)),
      );
    expect(deletedUser?.id).toBe("users_t2_member_delete");

    const authResponse = await fetch(`${BASE_URL}/user/me`, {
      headers: { Cookie: `auth_session=${tokens.t2memberDelete}` },
    });
    expect(authResponse.status).toBe(401);
  });
});
