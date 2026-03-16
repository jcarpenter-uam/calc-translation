import { generateState, generateCodeVerifier } from "arctic";
import {
  createGoogleProvider,
  createEntraProvider,
} from "../utils/authProviders";
import { logger } from "../core/logger";
import { db } from "../core/database";
import { tenantAuthConfigs, tenantDomains } from "../models/tenantModel";
import { users } from "../models/userModel";
import { userTenants } from "../models/userTenantModel";
import { and, eq } from "drizzle-orm";
import { decrypt } from "../utils/fernet";
import { env } from "../core/config";
import {
  generateApiSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "../utils/security";

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

/**
 * Resolves and initializes an OAuth provider for a tenant.
 */
async function getTenantAuthProvider(
  tenantId: string,
  providerType: string,
  callbackBaseUrl?: string,
) {
  const normalizedProvider = providerType.toLowerCase();

  logger.debug("Looking up auth config.", {
    tenantId,
    provider: normalizedProvider,
  });

  const [config] = await db
    .select()
    .from(tenantAuthConfigs)
    .where(
      and(
        eq(tenantAuthConfigs.tenantId, tenantId),
        eq(tenantAuthConfigs.providerType, providerType),
      ),
    );

  if (!config) {
    logger.warn("Auth config not found.", {
      tenantId,
      provider: providerType,
    });
    throw new Error(
      `Auth config not found for tenant ${tenantId} and provider ${providerType}`,
    );
  }

  const decryptedSecret = decrypt(config.clientSecretEncrypted);

  if (normalizedProvider === "google") {
    return createGoogleProvider(config.clientId, decryptedSecret, callbackBaseUrl);
  } else if (normalizedProvider === "entra") {
    const entraTenantId = config.tenantHint || "common";
    return createEntraProvider(
      entraTenantId,
      config.clientId,
      decryptedSecret,
      callbackBaseUrl,
    );
  }

  logger.warn("Unsupported provider requested.", { providerType });
  throw new Error(`Unsupported provider: "${providerType}"`);
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

    const [domainRecord] = await db
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.domain, domain));

    if (!domainRecord) {
      logger.warn("SSO login attempted for unconfigured domain.", {
        domain,
        email: maskEmail(normalizedEmail),
      });
      set.status = 400;
      return { error: "SSO is not configured for this domain." };
    }

    logger.debug("Resolved domain auth routing.", {
      domain,
      tenantId: domainRecord.tenantId,
      provider: domainRecord.providerType,
    });

    const { tenantId, providerType } = domainRecord;
    if (!tenantId) {
      logger.warn("Domain record has no tenant id.", { domain });
      set.status = 400;
      return { error: "SSO tenant mapping is incomplete for this domain" };
    }

    if (!providerType) {
      logger.warn("Domain record has no provider type.", {
        domain,
        tenantId,
      });
      set.status = 400;
      return { error: "Unsupported provider configured for this domain" };
    }

    const safeReturnTo = resolveSafeReturnTo(returnTo) || getDefaultReturnTo();
    const normalizedProvider = providerType.toLowerCase();

    const authProvider = await getTenantAuthProvider(tenantId, providerType);

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    let url: URL;

    if (normalizedProvider === "google") {
      url = authProvider.createAuthorizationURL(state, codeVerifier, [
        "openid",
        "profile",
        "email",
        "https://www.googleapis.com/auth/calendar.readonly",
      ]);
    } else if (normalizedProvider === "entra") {
      url = authProvider.createAuthorizationURL(state, codeVerifier, [
        "openid",
        "profile",
        "email",
        "Calendars.Read",
        "User.Read",
      ]);
    } else {
      logger.warn("Unsupported provider configured for domain.", {
        domain,
        provider: normalizedProvider,
      });
      set.status = 400;
      return { error: "Unsupported provider configured for this domain" };
    }

    url.searchParams.set("login_hint", rawEmail);

    const cookieOpts = {
      path: "/",
      secure: env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 60 * 10,
    };

    oauth_state.set({ value: state, ...cookieOpts });
    oauth_code_verifier.set({ value: codeVerifier, ...cookieOpts });
    oauth_tenant_id.set({ value: tenantId, ...cookieOpts });
    oauth_return_to.set({ value: safeReturnTo, ...cookieOpts });

    logger.debug("Redirecting user to identity provider.", {
      provider: normalizedProvider,
      tenantId,
      email: maskEmail(normalizedEmail),
    });
    return Response.redirect(url.href, 302);
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
    const authProvider = await getTenantAuthProvider(
      tenantId,
      normalizedProvider,
    );

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
    const userLanguage = userProfile.locale || userProfile.preferredLanguage;

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
          languageCode: userLanguage,
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
