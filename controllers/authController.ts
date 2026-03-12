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

async function getTenantAuthProvider(tenantId: string, providerType: string) {
  // normalize provider name
  const normalizedProvider = providerType.toLowerCase();

  // fetch auth config from db
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

  // decrypt secret
  const decryptedSecret = decrypt(config.clientSecretEncrypted);

  // return requested provider instance
  if (normalizedProvider === "google") {
    return createGoogleProvider(config.clientId, decryptedSecret);
  } else if (normalizedProvider === "entra") {
    // fallback to common if tenant hint is missing
    const entraTenantId = config.tenantHint || "common";
    return createEntraProvider(entraTenantId, config.clientId, decryptedSecret);
  }

  throw new Error(`Unsupported provider: "${providerType}"`);
}

export const unifiedLogin = async ({
  body: { email },
  cookie: { oauth_state, oauth_code_verifier, oauth_tenant_id },
  set,
}: any) => {
  try {
    // extract domain from email
    const domain = email.split("@")[1].toLowerCase();

    // lookup tenant domain
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

    // retrieve matching auth provider
    const authProvider = await getTenantAuthProvider(tenantId, provider);

    // generate oauth values
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    let url: URL;

    // build auth url with required scopes
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

    // prepopulate email for user
    url.searchParams.set("login_hint", email);

    // configure cookies
    const cookieOpts = {
      path: "/",
      secure: Bun.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 60 * 10,
    };

    // set auth cookies
    oauth_state.set({ value: state, ...cookieOpts });
    oauth_code_verifier.set({ value: codeVerifier, ...cookieOpts });
    oauth_tenant_id.set({ value: tenantId, ...cookieOpts });

    // redirect to identity provider
    return Response.redirect(url.href, 302);
  } catch (err) {
    logger.error(`Unified login failed for email ${email}:`, err);
    set.status = 500;
    return { error: "Internal Server Error" };
  }
};

export const providerCallback = async ({
  params: { provider },
  query,
  cookie: { oauth_state, oauth_code_verifier, oauth_tenant_id },
  set,
}: any) => {
  const code = query.code;
  const state = query.state;
  const storedState = oauth_state.value;
  const storedCodeVerifier = oauth_code_verifier.value;
  const tenantId = oauth_tenant_id.value;

  // validate state match
  if (!code || !state || !storedState || state !== storedState) {
    set.status = 400;
    return { error: "Invalid state or missing code" };
  }

  // ensure tenant id exists
  if (!tenantId) {
    set.status = 400;
    return {
      error:
        "Session expired or missing tenant context. Please try logging in again.",
    };
  }

  try {
    const normalizedProvider = provider.toLowerCase();

    // retrieve matching auth provider
    const authProvider = await getTenantAuthProvider(
      tenantId,
      normalizedProvider,
    );

    let tokens;
    let userProfile;

    // exchange code for tokens and fetch profile
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

    // normalize email field
    const userEmail =
      userProfile.email || userProfile.mail || userProfile.userPrincipalName;

    logger.debug(`Successful ${normalizedProvider} login for: ${userEmail}`);

    // Normalize remaining user fields across providers
    // Google uses 'sub' for ID and 'locale' for language.
    // Entra uses 'id' for ID, 'displayName' for name, and 'preferredLanguage' for language.
    const userId = userProfile.id || userProfile.sub;
    const userName =
      userProfile.name || userProfile.displayName || userEmail.split("@")[0];
    const userLanguage = userProfile.locale || userProfile.preferredLanguage;

    // Upsert user into the database
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
          // ...update these fields to keep them fresh
          name: userName,
          email: userEmail,
          languageCode: userLanguage,
        },
      })
      .returning();

    logger.debug(`User upserted successfully: ${user.email}`);

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

export const logout = async ({ set, cookie }: any) => {
  // TODO: implement session clearing logic
  return { message: "Logged out successfully" };
};
