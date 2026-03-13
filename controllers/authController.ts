import { generateState, generateCodeVerifier } from "arctic";
import {
  createGoogleProvider,
  createEntraProvider,
} from "../utils/authProviders";
import { logger } from "../core/logger";
import { db } from "../core/database";
import { tenantAuthConfigs, tenantDomains } from "../models/tenantModel";
import { users } from "../models/userModel";
import { and, eq } from "drizzle-orm";
import { decrypt } from "../utils/fernet";
import { env } from "../core/config";
import {
  generateApiSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "../utils/security";

/**
 * Retrieves and initializes the OAuth provider configuration for a specific tenant.
 *
 * @param {string} tenantId - The unique identifier for the tenant.
 * @param {string} providerType - The type of provider (e.g., 'google' or 'entra').
 * @returns {Promise<any>} The initialized Arctic authentication provider instance.
 * @throws {Error} If the configuration is missing or the provider is unsupported.
 */
async function getTenantAuthProvider(tenantId: string, providerType: string) {
  const normalizedProvider = providerType.toLowerCase();

  logger.debug(
    `Looking up auth config for tenant: ${tenantId}, provider: ${normalizedProvider}`,
  );

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
    logger.warn(
      `Auth config not found for tenant: ${tenantId}, provider: ${providerType}`,
    );
    throw new Error(
      `Auth config not found for tenant ${tenantId} and provider ${providerType}`,
    );
  }

  const decryptedSecret = decrypt(config.clientSecretEncrypted);

  if (normalizedProvider === "google") {
    return createGoogleProvider(config.clientId, decryptedSecret);
  } else if (normalizedProvider === "entra") {
    const entraTenantId = config.tenantHint || "common";
    return createEntraProvider(entraTenantId, config.clientId, decryptedSecret);
  }

  logger.warn(`Unsupported provider requested: "${providerType}"`);
  throw new Error(`Unsupported provider: "${providerType}"`);
}

/**
 * Initiates the unified SSO login flow.
 * Looks up the user's email domain to find their tenant, initializes the correct OAuth
 * provider, sets secure temporary cookies, and redirects the user to the provider's login page.
 *
 * @param {Object} context - The Elysia request context.
 * @param {Object} context.body - The request body.
 * @param {string} context.body.email - The email address the user is attempting to log in with.
 * @param {Object} context.cookie - The Elysia cookie jar for managing temporary OAuth state.
 * @param {Object} context.set - The Elysia response state object.
 * @returns {Promise<Response | { error: string }>} An HTTP redirect to the identity provider, or an error payload.
 */
export const unifiedLogin = async ({
  body: { email },
  cookie: { oauth_state, oauth_code_verifier, oauth_tenant_id },
  set,
}: any) => {
  try {
    logger.info(`Initiating SSO login flow for: ${email}`);
    const domain = email.split("@")[1].toLowerCase();

    const [domainRecord] = await db
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.domain, domain));

    if (!domainRecord) {
      logger.warn(
        `SSO login attempted for unconfigured domain: ${domain} (Email: ${email})`,
      );
      set.status = 400;
      return { error: "SSO is not configured for this domain." };
    }

    logger.debug(`Found domain record for ${domain}:`, domainRecord);

    const { tenantId, providerType: provider } = domainRecord;
    const normalizedProvider = provider.toLowerCase();

    const authProvider = await getTenantAuthProvider(tenantId, provider);

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
      logger.warn(
        `Unsupported provider configured for domain ${domain}: "${normalizedProvider}"`,
      );
      set.status = 400;
      return { error: "Unsupported provider configured for this domain" };
    }

    url.searchParams.set("login_hint", email);

    const cookieOpts = {
      path: "/",
      secure: env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 60 * 10,
    };

    oauth_state.set({ value: state, ...cookieOpts });
    oauth_code_verifier.set({ value: codeVerifier, ...cookieOpts });
    oauth_tenant_id.set({ value: tenantId, ...cookieOpts });

    logger.debug(
      `Redirecting ${email} to ${normalizedProvider} for authentication`,
    );
    return Response.redirect(url.href, 302);
  } catch (err) {
    logger.error(`Unified login flow failed for email ${email}:`, err);
    set.status = 500;
    return { error: "Internal Server Error" };
  }
};

/**
 * Handles the callback from the OAuth identity provider.
 * Validates the authorization code against the PKCE verifier, fetches the user's profile,
 * upserts their data into the local database, and issues an internal session JWT.
 *
 * @param {Object} context - The Elysia request context.
 * @param {Object} context.params - The URL parameters.
 * @param {string} context.params.provider - The provider handling the callback (e.g., 'google').
 * @param {Object} context.query - The URL query parameters returned by the provider.
 * @param {string} context.query.code - The authorization code.
 * @param {string} context.query.state - The state string to prevent CSRF.
 * @param {Object} context.cookie - The Elysia cookie jar holding temporary OAuth state and the final session.
 * @param {Object} context.set - The Elysia response state object.
 * @returns {Promise<{ message: string, tenantId: string, provider: string, user: Object } | { error: string }>}
 * A JSON payload containing the authenticated user's details and tenant context.
 */
export const providerCallback = async ({
  params: { provider },
  query,
  cookie: { oauth_state, oauth_code_verifier, oauth_tenant_id, auth_session },
  set,
}: any) => {
  logger.debug(`Received OAuth callback for provider: ${provider}`);

  const code = query.code;
  const state = query.state;
  const storedState = oauth_state.value;
  const storedCodeVerifier = oauth_code_verifier.value;
  const tenantId = oauth_tenant_id.value;

  if (!code || !state || !storedState || state !== storedState) {
    logger.warn(
      `OAuth callback failed: Invalid state or missing code for provider ${provider}`,
    );
    set.status = 400;
    return { error: "Invalid state or missing code" };
  }

  if (!tenantId) {
    logger.warn(
      `OAuth callback failed: Missing tenant context in cookies for provider ${provider}`,
    );
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
    let userProfile;

    if (normalizedProvider === "google") {
      tokens = await authProvider.validateAuthorizationCode(
        code,
        storedCodeVerifier as string,
      );

      const response = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: `Bearer ${tokens.accessToken()}` } },
      );
      userProfile = await response.json();
    } else if (normalizedProvider === "entra") {
      tokens = await authProvider.validateAuthorizationCode(
        code,
        storedCodeVerifier as string,
      );

      const response = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${tokens.accessToken()}` },
      });
      userProfile = await response.json();
    }

    const userEmail =
      userProfile.email || userProfile.mail || userProfile.userPrincipalName;

    logger.info(
      `Successful ${normalizedProvider} authentication for: ${userEmail}`,
    );

    const userId = userProfile.id || userProfile.sub;
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

    logger.debug(`User record created/updated successfully for: ${userEmail}`);

    const sessionToken = await generateApiSessionToken(user.id, tenantId);
    setSessionCookie(auth_session, sessionToken);

    logger.debug(`Session token generated and cookie set for: ${userEmail}`);

    oauth_state.remove();
    oauth_code_verifier.remove();
    oauth_tenant_id.remove();

    return {
      message: "Authentication successful",
      tenantId,
      provider: normalizedProvider,
      user,
    };
  } catch (err) {
    logger.error(
      `OAuth callback flow failed for ${provider} (Tenant: ${tenantId}):`,
      err,
    );
    set.status = 400;
    return { error: "Failed to validate authorization code" };
  }
};

/**
 * Logs out the currently authenticated user by invalidating their session cookie.
 *
 * @param {Object} context - The Elysia request context.
 * @param {Object} context.user - The user object extracted by the requireAuth middleware.
 * @param {Object} context.set - The Elysia response state object.
 * @param {Object} context.cookie - The Elysia cookie jar containing the session cookie.
 * @returns {Promise<{ message: string }>} A success message.
 */
export const logout = async ({ user, set, cookie: { auth_session } }: any) => {
  clearSessionCookie(auth_session);

  const userEmail = user?.email || "unknown_user";
  logger.info(`User logged out successfully: ${userEmail}`);

  return { message: "Logged out successfully" };
};
