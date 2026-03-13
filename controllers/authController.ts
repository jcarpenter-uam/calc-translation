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
  // Normalize the provider name to lowercase.
  const normalizedProvider = providerType.toLowerCase();

  // Fetch the authentication configuration from the database.
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
    throw new Error(
      `Auth config not found for tenant ${tenantId} and provider ${providerType}`,
    );
  }

  // Decrypt the client secret.
  const decryptedSecret = decrypt(config.clientSecretEncrypted);

  // Return the requested provider instance.
  if (normalizedProvider === "google") {
    return createGoogleProvider(config.clientId, decryptedSecret);
  } else if (normalizedProvider === "entra") {
    // Fallback to "common" if the tenant hint is missing.
    const entraTenantId = config.tenantHint || "common";
    return createEntraProvider(entraTenantId, config.clientId, decryptedSecret);
  }

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
    // Extract the domain from the provided email address.
    const domain = email.split("@")[1].toLowerCase();

    // Look up the tenant domain record.
    const [domainRecord] = await db
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.domain, domain));

    if (!domainRecord) {
      set.status = 400;
      return { error: "SSO is not configured for this domain." };
    }

    logger.debug(`Found domain record for ${domain}:`, domainRecord);

    const { tenantId, providerType: provider } = domainRecord;
    const normalizedProvider = provider.toLowerCase();

    // Retrieve the matching authentication provider.
    const authProvider = await getTenantAuthProvider(tenantId, provider);

    // Generate OAuth state and PKCE code verifier.
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    let url: URL;

    // Build the authorization URL with required scopes.
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
      logger.debug(
        `Failed matching provider. normalizedProvider was: "${normalizedProvider}"`,
      );
      set.status = 400;
      return { error: "Unsupported provider configured for this domain" };
    }

    // Pre-populate the email address for the user.
    url.searchParams.set("login_hint", email);

    // Configure secure cookie options.
    const cookieOpts = {
      path: "/",
      secure: env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 60 * 10,
    };

    // Set the OAuth flow cookies.
    oauth_state.set({ value: state, ...cookieOpts });
    oauth_code_verifier.set({ value: codeVerifier, ...cookieOpts });
    oauth_tenant_id.set({ value: tenantId, ...cookieOpts });

    // Redirect the user to the identity provider.
    return Response.redirect(url.href, 302);
  } catch (err) {
    logger.error(`Unified login failed for email ${email}:`, err);
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
  const code = query.code;
  const state = query.state;
  const storedState = oauth_state.value;
  const storedCodeVerifier = oauth_code_verifier.value;
  const tenantId = oauth_tenant_id.value;

  // Validate that the state matches the stored cookie.
  if (!code || !state || !storedState || state !== storedState) {
    set.status = 400;
    return { error: "Invalid state or missing code" };
  }

  // Ensure the tenant ID exists in the cookie context.
  if (!tenantId) {
    set.status = 400;
    return {
      error:
        "Session expired or missing tenant context. Please try logging in again.",
    };
  }

  try {
    const normalizedProvider = provider.toLowerCase();

    // Retrieve the matching authentication provider.
    const authProvider = await getTenantAuthProvider(
      tenantId,
      normalizedProvider,
    );

    let tokens;
    let userProfile;

    // Exchange the authorization code for tokens and fetch the user profile.
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

    // Normalize the email field across different providers.
    const userEmail =
      userProfile.email || userProfile.mail || userProfile.userPrincipalName;

    logger.debug(`Successful ${normalizedProvider} login for: ${userEmail}`);

    // Normalize remaining user fields across providers.
    // Google uses 'sub' for ID and 'locale' for language.
    // Entra uses 'id' for ID, 'displayName' for name, and 'preferredLanguage' for language.
    const userId = userProfile.id || userProfile.sub;
    const userName =
      userProfile.name || userProfile.displayName || userEmail.split("@")[0];
    const userLanguage = userProfile.locale || userProfile.preferredLanguage;

    // Upsert the user into the database.
    const [user] = await db
      .insert(users)
      .values({
        id: userId,
        name: userName,
        email: userEmail,
        languageCode: userLanguage,
      })
      .onConflictDoUpdate({
        target: users.id, // If the ID already exists...
        set: {
          // ...update these fields to keep them fresh.
          name: userName,
          email: userEmail,
          languageCode: userLanguage,
        },
      })
      .returning();

    logger.debug(`User upserted successfully: ${user.email}`);

    // Generate and set the final application session token.
    const sessionToken = await generateApiSessionToken(user.id, tenantId);
    setSessionCookie(auth_session, sessionToken);

    // Clean up temporary OAuth cookies.
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
      `OAuth callback failed for ${provider} (Tenant: ${tenantId}):`,
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
 * @param {Object} context.set - The Elysia response state object.
 * @param {Object} context.cookie - The Elysia cookie jar containing the session cookie.
 * @returns {Promise<{ message: string }>} A success message.
 */
export const logout = async ({ set, cookie: { auth_session } }: any) => {
  clearSessionCookie(auth_session);

  logger.debug("User logged out, session cookie cleared.");

  return { message: "Logged out successfully" };
};
