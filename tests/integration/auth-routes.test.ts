import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "../../core/database";
import { tenantAuthConfigs, tenantDomains, tenants } from "../../models/tenantModel";
import { userTenants } from "../../models/userTenantModel";
import { users } from "../../models/userModel";
import { encrypt } from "../../utils/fernet";
import { generateApiSessionToken } from "../../utils/security";
import {
  BASE_URL,
  cleanupTestData,
  trackTestTenants,
  trackTestUsers,
} from "../setup/utils/testHelpers";

describe("Auth routes", () => {
  const tenantIds = ["auth-routes-tenant-a", "auth-routes-tenant-b"];
  const userIds = ["auth-routes-user"];
  let userToken = "";

  beforeAll(async () => {
    trackTestTenants(...tenantIds);
    trackTestUsers(...userIds);

    await db
      .insert(tenants)
      .values([
        {
          tenantId: "auth-routes-tenant-a",
          organizationName: "Auth Routes Tenant A",
        },
        {
          tenantId: "auth-routes-tenant-b",
          organizationName: "Auth Routes Tenant B",
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(tenantDomains)
      .values([
        {
          tenantId: "auth-routes-tenant-a",
          domain: "auth-single.test",
          providerType: "google",
        },
        {
          tenantId: "auth-routes-tenant-a",
          domain: "auth-multi.test",
          providerType: "google",
        },
        {
          tenantId: "auth-routes-tenant-b",
          domain: "auth-multi.test",
          providerType: "entra",
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(tenantAuthConfigs)
      .values([
        {
          tenantId: "auth-routes-tenant-a",
          providerType: "google",
          clientId: "google-client-id",
          clientSecretEncrypted: encrypt("google-client-secret"),
          tenantHint: null,
        },
        {
          tenantId: "auth-routes-tenant-b",
          providerType: "entra",
          clientId: "entra-client-id",
          clientSecretEncrypted: encrypt("entra-client-secret"),
          tenantHint: "common",
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values({
        id: "auth-routes-user",
        name: "Auth Routes User",
        email: "auth-routes-user@test.com",
        languageCode: "en",
        role: "user",
      })
      .onConflictDoNothing();

    await db
      .insert(userTenants)
      .values({ userId: "auth-routes-user", tenantId: "auth-routes-tenant-a" })
      .onConflictDoNothing();

    userToken = await generateApiSessionToken("auth-routes-user", "auth-routes-tenant-a");
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("rejects login for unknown email domains", async () => {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@unknown-auth-domain.test" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "SSO is not configured for this domain.",
    });
  });

  it("returns provider choices when multiple tenant auth options match a domain", async () => {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@auth-multi.test" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      mode: string;
      email: string;
      options: Array<{ tenantId: string; tenantName: string | null; providerType: string }>;
    };

    expect(body.mode).toBe("select_provider");
    expect(body.email).toBe("person@auth-multi.test");
    expect(body.options).toEqual([
      {
        tenantId: "auth-routes-tenant-a",
        tenantName: "Auth Routes Tenant A",
        providerType: "google",
      },
      {
        tenantId: "auth-routes-tenant-b",
        tenantName: "Auth Routes Tenant B",
        providerType: "entra",
      },
    ]);
  });

  it("falls back to the default return target when an unsafe returnTo is supplied", async () => {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "person@auth-single.test",
        returnTo: "https://evil.example/steal-session",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode: string; url: string };
    expect(body.mode).toBe("redirect");
    expect(body.url).toContain("login_hint=person%40auth-single.test");

    const setCookie = response.headers.get("set-cookie") || "";
    expect(setCookie).toContain("oauth_return_to=http%3A%2F%2Flocalhost%3A5173%2F");
    expect(setCookie).not.toContain("evil.example");
  });

  it("rejects provider choices that are not configured for the domain", async () => {
    const response = await fetch(`${BASE_URL}/auth/login/choose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "person@auth-multi.test",
        tenantId: "auth-routes-tenant-a",
        providerType: "entra",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Selected provider is not configured for this domain",
    });
  });

  it("rejects callbacks with missing or invalid state", async () => {
    const response = await fetch(`${BASE_URL}/auth/callback/google?code=test-code&state=bad-state`, {
      headers: {
        Cookie: "oauth_state=expected-state; oauth_code_verifier=code-verifier; oauth_tenant_id=auth-routes-tenant-a",
      },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid state or missing code",
    });
  });

  it("rejects callbacks when tenant context cookies are missing", async () => {
    const response = await fetch(`${BASE_URL}/auth/callback/google?code=test-code&state=good-state`, {
      headers: {
        Cookie: "oauth_state=good-state; oauth_code_verifier=code-verifier",
      },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Session expired or missing tenant context. Please try logging in again.",
    });
  });

  it("clears the auth session cookie on logout", async () => {
    const response = await fetch(`${BASE_URL}/auth/logout`, {
      method: "POST",
      headers: { Cookie: `auth_session=${userToken}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Logged out successfully" });

    const setCookie = response.headers.get("set-cookie") || "";
    expect(setCookie).toContain("auth_session=");
    expect(setCookie).toContain("Max-Age=0");
  });
});
