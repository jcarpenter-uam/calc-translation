import { and, eq } from "drizzle-orm";
import { Google, MicrosoftEntraId, type OAuth2Tokens } from "arctic";
import { db } from "../core/database";
import { logger } from "../core/logger";
import { userOAuthGrants } from "../models/userOAuthGrantModel";
import {
  getProviderScopes,
  type SupportedAuthProvider,
} from "../utils/authProviders";
import { decrypt, encrypt } from "../utils/fernet";
import { getTenantAuthProvider } from "./tenantAuthService";

export interface ResolveOAuthAccessTokenInput {
  tenantId: string;
  userId: string;
  provider: SupportedAuthProvider;
}

export type ResolveOAuthAccessTokenResult =
  | { status: "ready"; accessToken: string }
  | { status: "reauth_required"; reason: string };

const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60 * 1000;

/**
 * Stores or updates one user's reusable OAuth grant.
 */
export async function persistUserOAuthGrant({
  tenantId,
  userId,
  provider,
  tokens,
}: {
  tenantId: string;
  userId: string;
  provider: SupportedAuthProvider;
  tokens: OAuth2Tokens;
}) {
  const now = new Date();
  const accessToken = tokens.accessToken();
  const refreshToken = tokens.hasRefreshToken() ? tokens.refreshToken() : null;
  const scopes = tokens.hasScopes() ? tokens.scopes().join(" ") : null;

  let accessTokenExpiresAt: Date | null = null;
  try {
    accessTokenExpiresAt = tokens.accessTokenExpiresAt();
  } catch {
    accessTokenExpiresAt = null;
  }

  await db
    .insert(userOAuthGrants)
    .values({
      tenantId,
      userId,
      provider,
      accessTokenEncrypted: encrypt(accessToken),
      refreshTokenEncrypted: refreshToken ? encrypt(refreshToken) : null,
      accessTokenExpiresAt,
      scopes,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        userOAuthGrants.userId,
        userOAuthGrants.tenantId,
        userOAuthGrants.provider,
      ],
      set: {
        accessTokenEncrypted: encrypt(accessToken),
        refreshTokenEncrypted: refreshToken ? encrypt(refreshToken) : null,
        accessTokenExpiresAt,
        scopes,
        updatedAt: now,
      },
    });
}

/**
 * Resolves a usable provider access token, refreshing when possible.
 */
export async function resolveUserOAuthAccessToken({
  tenantId,
  userId,
  provider,
}: ResolveOAuthAccessTokenInput): Promise<ResolveOAuthAccessTokenResult> {
  const [grant] = await db
    .select()
    .from(userOAuthGrants)
    .where(
      and(
        eq(userOAuthGrants.tenantId, tenantId),
        eq(userOAuthGrants.userId, userId),
        eq(userOAuthGrants.provider, provider),
      ),
    );

  if (!grant) {
    return { status: "reauth_required", reason: "grant_missing" };
  }

  const expiresAt = grant.accessTokenExpiresAt?.getTime() || null;
  const isStillValid =
    typeof expiresAt === "number" && expiresAt - Date.now() > ACCESS_TOKEN_EXPIRY_SKEW_MS;

  if (isStillValid) {
    return {
      status: "ready",
      accessToken: decrypt(grant.accessTokenEncrypted),
    };
  }

  if (!grant.refreshTokenEncrypted) {
    return { status: "reauth_required", reason: "refresh_token_missing" };
  }

  try {
    const authProvider = await getTenantAuthProvider(tenantId, provider);
    const refreshToken = decrypt(grant.refreshTokenEncrypted);
    const refreshedTokens =
      provider === "google"
        ? await (authProvider as Google).refreshAccessToken(refreshToken)
        : await (authProvider as MicrosoftEntraId).refreshAccessToken(
            refreshToken,
            getProviderScopes(provider),
          );

    await persistRefreshedGrant({
      grantId: grant.id,
      priorRefreshTokenEncrypted: grant.refreshTokenEncrypted,
      tokens: refreshedTokens,
    });

    return {
      status: "ready",
      accessToken: refreshedTokens.accessToken(),
    };
  } catch (err) {
    logger.warn("Stored OAuth grant refresh failed.", {
      tenantId,
      userId,
      provider,
      err,
    });
    return { status: "reauth_required", reason: "refresh_failed" };
  }
}

/**
 * Lists linked OAuth providers for one authenticated user/tenant pair.
 */
export async function listLinkedUserOAuthProviders(tenantId: string, userId: string) {
  const rows = await db
    .select({ provider: userOAuthGrants.provider })
    .from(userOAuthGrants)
    .where(
      and(
        eq(userOAuthGrants.tenantId, tenantId),
        eq(userOAuthGrants.userId, userId),
      ),
    );

  return rows
    .map((row) => row.provider)
    .filter(
      (provider): provider is SupportedAuthProvider =>
        provider === "google" || provider === "entra",
    );
}

async function persistRefreshedGrant({
  grantId,
  priorRefreshTokenEncrypted,
  tokens,
}: {
  grantId: string;
  priorRefreshTokenEncrypted: string | null;
  tokens: OAuth2Tokens;
}) {
  const updatedAt = new Date();

  let accessTokenExpiresAt: Date | null = null;
  try {
    accessTokenExpiresAt = tokens.accessTokenExpiresAt();
  } catch {
    accessTokenExpiresAt = null;
  }

  await db
    .update(userOAuthGrants)
    .set({
      accessTokenEncrypted: encrypt(tokens.accessToken()),
      refreshTokenEncrypted: tokens.hasRefreshToken()
        ? encrypt(tokens.refreshToken())
        : priorRefreshTokenEncrypted,
      accessTokenExpiresAt,
      scopes: tokens.hasScopes() ? tokens.scopes().join(" ") : null,
      updatedAt,
    })
    .where(eq(userOAuthGrants.id, grantId));
}
