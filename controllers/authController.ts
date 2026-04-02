import { generateState, generateCodeVerifier } from "arctic";
import {
  getProviderScopes,
  isSupportedAuthProvider,
  type SupportedAuthProvider,
} from "../utils/authProviders";
import { logger } from "../core/logger";
import { db } from "../core/database";
import { tenantDomains, tenants } from "../models/tenantModel";
import { users } from "../models/userModel";
import { userTenants } from "../models/userTenantModel";
import { and, asc, eq, sql } from "drizzle-orm";
import { env } from "../core/config";
import {
  generateApiSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "../utils/security";
import { getTenantAuthProvider } from "../services/tenantAuthService";
import { persistUserOAuthGrant } from "../services/userOAuthGrantService";
import { syncLinkedCalendarsForUser } from "../services/userCalendarSyncService";

interface OAuthUserProfile {
  id?: string;
  sub?: string;
  email?: string;
  mail?: string;
  userPrincipalName?: string;
  name?: string;
  displayName?: string;
  locale?: string;
  preferredLanguage?: string;
}

/**
 * A tenant/provider option presented when one email domain maps to multiple SSO setups.
 */
type LoginChoiceOption = {
  tenantId: string;
  tenantName: string | null;
  providerType: SupportedAuthProvider;
};

type LoginRedirectResult = {
  mode: "redirect";
  url: string;
};

type LoginSelectProviderResult = {
  mode: "select_provider";
  email: string;
  options: LoginChoiceOption[];
};

type ProviderRedirectCookieRefs = {
  oauth_state: { set: (value: Record<string, unknown>) => void };
  oauth_code_verifier: { set: (value: Record<string, unknown>) => void };
  oauth_tenant_id: { set: (value: Record<string, unknown>) => void };
  oauth_return_to: { set: (value: Record<string, unknown>) => void };
};

type BuildProviderRedirectInput = ProviderRedirectCookieRefs & {
  email: string;
  tenantId: string;
  providerType: SupportedAuthProvider;
  returnTo: unknown;
};

/**
 * Resolves a safe post-login redirect URL from a user-provided value.
 */
function resolveSafeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const allowedDevOrigins = new Set([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "http://localhost:5174",
  ]);

  if (env.NODE_ENV !== "production") {
    if (!allowedDevOrigins.has(parsed.origin)) {
      return null;
    }

    return parsed.toString();
  }

  const appOrigin = new URL(env.BASE_URL).origin;
  if (parsed.origin !== appOrigin) {
    return null;
  }

  return parsed.toString();
}

/**
 * Returns the default frontend URL for redirecting after auth.
 */
function getDefaultReturnTo() {
  return env.NODE_ENV === "production"
    ? new URL(env.BASE_URL).toString()
    : "http://localhost:5173/";
}

/**
 * Masks an email address for safe logging.
 */
function maskEmail(email: string) {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) {
    return "invalid_email";
  }

  if (localPart.length <= 2) {
    return `**@${domain}`;
  }

  return `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`;
}

async function buildProviderRedirect({
  email,
  tenantId,
  providerType,
  returnTo,
  oauth_state,
  oauth_code_verifier,
  oauth_tenant_id,
  oauth_return_to,
}: BuildProviderRedirectInput): Promise<LoginRedirectResult> {
  const safeReturnTo = resolveSafeReturnTo(returnTo) || getDefaultReturnTo();
  const authProvider = await getTenantAuthProvider(tenantId, providerType);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = authProvider.createAuthorizationURL(
    state,
    codeVerifier,
    getProviderScopes(providerType),
  );

  url.searchParams.set("login_hint", email);

  if (providerType === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }

  const cookieOpts = {
    path: "/",
    secure: env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
  };

  // These cookies bridge the browser round-trip to the identity provider so the callback can
  // validate state and restore the correct tenant/session context.
  oauth_state.set({ value: state, ...cookieOpts });
  oauth_code_verifier.set({ value: codeVerifier, ...cookieOpts });
  oauth_tenant_id.set({ value: tenantId, ...cookieOpts });
  oauth_return_to.set({ value: safeReturnTo, ...cookieOpts });

  return {
    mode: "redirect",
    url: url.href,
  };
}

/**
 * Resolves all tenant/provider combinations configured for an email domain.
 */
async function resolveLoginChoices(domain: string) {
  const rows = await db
    .select({
      tenantId: tenantDomains.tenantId,
      tenantName: tenants.organizationName,
      providerType: tenantDomains.providerType,
    })
    .from(tenantDomains)
    .leftJoin(tenants, eq(tenantDomains.tenantId, tenants.tenantId))
    .where(eq(tenantDomains.domain, domain))
    .orderBy(asc(tenants.organizationName), asc(tenantDomains.providerType));

  return rows.filter(
    (row): row is LoginChoiceOption =>
      Boolean(row.tenantId) &&
      typeof row.providerType === "string" && isSupportedAuthProvider(row.providerType),
  );
}

/**
 * Starts SSO login by resolving tenant domain routing and redirecting to OAuth.
 */
export const unifiedLogin = async ({
  body,
  query,
  cookie: {
    oauth_state,
    oauth_code_verifier,
    oauth_tenant_id,
    oauth_return_to,
  },
  set,
}: any) => {
  const rawEmail = String(body?.email ?? query?.email ?? "");
  const returnTo = body?.returnTo ?? query?.returnTo;

  try {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    const domain = normalizedEmail.split("@")[1];

    if (!domain) {
      logger.warn("Login rejected due to malformed email.", {
        email: maskEmail(normalizedEmail),
      });
      set.status = 400;
      return { error: "A valid email is required" };
    }

    logger.info("Initiating SSO login flow.", {
      email: maskEmail(normalizedEmail),
      domain,
    });

    const domainRecords = await resolveLoginChoices(domain);

    if (domainRecords.length === 0) {
      logger.warn("SSO login attempted for unconfigured domain.", {
        domain,
        email: maskEmail(normalizedEmail),
      });
      set.status = 400;
      return { error: "SSO is not configured for this domain." };
    }

    if (domainRecords.length > 1) {
      logger.info("Multiple auth providers matched login domain.", {
        domain,
        email: maskEmail(normalizedEmail),
        options: domainRecords.map((record) => ({
          tenantId: record.tenantId,
          provider: record.providerType,
        })),
      });
      return {
        mode: "select_provider",
        email: normalizedEmail,
        options: domainRecords,
      } as LoginSelectProviderResult;
    }

    const domainRecord = domainRecords[0];
    if (!domainRecord) {
      set.status = 400;
      return { error: "SSO tenant mapping is incomplete for this domain" };
    }
    logger.debug("Resolved domain auth routing.", {
      domain,
      tenantId: domainRecord.tenantId,
      provider: domainRecord.providerType,
    });

    return await buildProviderRedirect({
      email: normalizedEmail,
      tenantId: domainRecord.tenantId,
      providerType: domainRecord.providerType,
      returnTo,
      oauth_state,
      oauth_code_verifier,
      oauth_tenant_id,
      oauth_return_to,
    });
  } catch (err) {
    logger.error("Unified login flow failed.", {
      email: maskEmail(rawEmail),
      err,
    });
    set.status = 500;
    return { error: "Internal Server Error" };
  }
};

/**
 * Starts SSO login after the user chooses a provider.
 */
export const chooseLoginProvider = async ({
  body,
  cookie: {
    oauth_state,
    oauth_code_verifier,
    oauth_tenant_id,
    oauth_return_to,
  },
  set,
}: any) => {
  const rawEmail = String(body?.email ?? "");
  const tenantId = String(body?.tenantId ?? "").trim();
  const providerType = String(body?.providerType ?? "").trim().toLowerCase();
  const returnTo = body?.returnTo;

  try {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    const domain = normalizedEmail.split("@")[1];

    if (!domain || !tenantId || !isSupportedAuthProvider(providerType)) {
      set.status = 400;
      return { error: "Valid email, tenant, and provider are required" };
    }

    const domainRecords = await resolveLoginChoices(domain);
    const match = domainRecords.find(
      (record) =>
        record.tenantId === tenantId && record.providerType === providerType,
    );

    if (!match) {
      set.status = 400;
      return { error: "Selected provider is not configured for this domain" };
    }

    return await buildProviderRedirect({
      email: normalizedEmail,
      tenantId,
      providerType,
      returnTo,
      oauth_state,
      oauth_code_verifier,
      oauth_tenant_id,
      oauth_return_to,
    });
  } catch (err) {
    logger.error("Provider choice login flow failed.", {
      email: maskEmail(rawEmail),
      tenantId,
      providerType,
      err,
    });
    set.status = 500;
    return { error: "Internal Server Error" };
  }
};

/**
 * Completes OAuth callback validation and creates an API session.
 */
export const providerCallback = async ({
  params: { provider },
  query,
  cookie: {
    oauth_state,
    oauth_code_verifier,
    oauth_tenant_id,
    oauth_return_to,
    auth_session,
  },
  set,
}: any) => {
  logger.debug("Received OAuth callback.", { provider });

  const code = query.code;
  const state = query.state;
  const storedState = oauth_state.value;
  const storedCodeVerifier = oauth_code_verifier.value;
  const tenantId = oauth_tenant_id.value;
  const returnTo = resolveSafeReturnTo(oauth_return_to.value);

  if (!code || !state || !storedState || state !== storedState) {
    logger.warn("OAuth callback failed state validation.", { provider });
    set.status = 400;
    return { error: "Invalid state or missing code" };
  }

  if (!tenantId) {
    logger.warn("OAuth callback failed due to missing tenant context.", {
      provider,
    });
    set.status = 400;
    return {
      error:
        "Session expired or missing tenant context. Please try logging in again.",
    };
  }

  try {
    const normalizedProvider = provider.toLowerCase();
      const authProvider = await getTenantAuthProvider(tenantId, normalizedProvider);

    let tokens;
    let userProfile: OAuthUserProfile | null = null;

    if (normalizedProvider === "google") {
      tokens = await authProvider.validateAuthorizationCode(
        code,
        storedCodeVerifier as string,
      );

      const response = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: `Bearer ${tokens.accessToken()}` } },
      );
      userProfile = (await response.json()) as OAuthUserProfile;
    } else if (normalizedProvider === "entra") {
      tokens = await authProvider.validateAuthorizationCode(
        code,
        storedCodeVerifier as string,
      );

      const response = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${tokens.accessToken()}` },
      });
      userProfile = (await response.json()) as OAuthUserProfile;
    }

    if (!userProfile) {
      logger.warn("OAuth callback returned no user profile.", {
        provider: normalizedProvider,
        tenantId,
      });
      set.status = 400;
      return { error: "Failed to fetch user profile" };
    }

    const userEmail =
      userProfile.email || userProfile.mail || userProfile.userPrincipalName;

    if (!userEmail) {
      logger.warn("OAuth callback profile missing email.", {
        provider: normalizedProvider,
        tenantId,
      });
      set.status = 400;
      return { error: "Identity provider did not return an email" };
    }

    logger.info("OAuth authentication succeeded.", {
      provider: normalizedProvider,
      tenantId,
      email: maskEmail(userEmail),
    });

    const userId = userProfile.id || userProfile.sub;
    if (!userId) {
      logger.warn("OAuth callback profile missing user id.", {
        provider: normalizedProvider,
        tenantId,
        email: maskEmail(userEmail),
      });
      set.status = 400;
      return { error: "Identity provider did not return a user id" };
    }

    const userName =
      userProfile.name || userProfile.displayName || userEmail.split("@")[0];
    const rawLanguage = userProfile.locale || userProfile.preferredLanguage;
    const userLanguage = rawLanguage?.trim() || null;

    const [user] = await db
      .insert(users)
      .values({
        id: userId,
        name: userName,
        email: userEmail,
        languageCode: userLanguage,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          name: userName,
          email: userEmail,
          languageCode: sql`COALESCE(${users.languageCode}, ${userLanguage})`,
        },
      })
      .returning();

    if (!user) {
      logger.error("User upsert returned no record.", {
        provider: normalizedProvider,
        tenantId,
        userId,
      });
      set.status = 500;
      return { error: "Failed to persist user profile" };
    }

    logger.debug("User record upserted.", { userId: user.id, tenantId });

    if (tokens) {
      await persistUserOAuthGrant({
        tenantId,
        userId: user.id,
        provider: normalizedProvider,
        tokens,
      });
    }

    if (user.deletedAt) {
      logger.warn("Deleted user attempted to authenticate.", {
        userId: user.id,
        tenantId,
      });
      set.status = 403;
      return { error: "User account is deactivated" };
    }

    await db
      .insert(userTenants)
      .values({
        userId: user.id,
        tenantId,
      })
      .onConflictDoNothing();

    // Login succeeds even if background calendar import fails; the sync is a convenience step,
    // not part of authentication correctness.
    if (tokens?.accessToken) {
      try {
        const calendarSyncNow = new Date();
        await syncLinkedCalendarsForUser({
          userId: user.id,
          tenantId,
          timeMin: new Date(calendarSyncNow.getTime() - 24 * 60 * 60 * 1000),
          timeMax: new Date(calendarSyncNow.getTime() + 30 * 24 * 60 * 60 * 1000),
          pruneMode: "window",
        });
      } catch (syncErr) {
        logger.warn("Calendar sync failed after successful OAuth login.", {
          provider: normalizedProvider,
          tenantId,
          userId: user.id,
          err: syncErr,
        });
      }
    }

    const sessionToken = await generateApiSessionToken(user.id, tenantId);
    setSessionCookie(auth_session, sessionToken);

    logger.debug("Session token generated and cookie set.", {
      userId: user.id,
      tenantId,
    });

    oauth_state.remove();
    oauth_code_verifier.remove();
    oauth_tenant_id.remove();
    oauth_return_to.remove();

    return Response.redirect(returnTo || getDefaultReturnTo(), 302);
  } catch (err) {
    logger.error("OAuth callback flow failed.", {
      provider,
      tenantId,
      err,
    });
    set.status = 400;
    return { error: "Failed to validate authorization code" };
  }
};

/**
 * Logs out the authenticated user by clearing the API session cookie.
 */
export const logout = async ({ user, set, cookie: { auth_session } }: any) => {
  clearSessionCookie(auth_session);

  logger.info("User logged out successfully.", {
    userId: user?.id || "unknown_user",
  });

  return { message: "Logged out successfully" };
};
