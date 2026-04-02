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

export type CalendarSyncStatus =
  | "idle"
  | "syncing"
  | "success"
  | "error"
  | "reauth_required";

export interface DueCalendarSyncGrant {
  id: string;
  tenantId: string;
  userId: string;
  provider: SupportedAuthProvider;
  nextCalendarSyncAt: Date | null;
}

const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60 * 1000;
const DAILY_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAILY_SYNC_JITTER_MS = 60 * 60 * 1000;

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
      calendarSyncStatus: "idle",
      nextCalendarSyncAt: now,
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
        calendarSyncStatus: "idle",
        nextCalendarSyncAt: now,
        lastCalendarSyncError: null,
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

/**
 * Returns one stored OAuth grant for a user/provider pair.
 */
export async function getUserOAuthGrantByProvider(
  tenantId: string,
  userId: string,
  provider: SupportedAuthProvider,
) {
  const [grant] = await db
    .select({ id: userOAuthGrants.id })
    .from(userOAuthGrants)
    .where(
      and(
        eq(userOAuthGrants.tenantId, tenantId),
        eq(userOAuthGrants.userId, userId),
        eq(userOAuthGrants.provider, provider),
      ),
    );

  return grant || null;
}

/**
 * Lists provider grants that are due for a background calendar sync.
 */
export async function listDueCalendarSyncGrants(limit = 25): Promise<DueCalendarSyncGrant[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: userOAuthGrants.id,
      tenantId: userOAuthGrants.tenantId,
      userId: userOAuthGrants.userId,
      provider: userOAuthGrants.provider,
      nextCalendarSyncAt: userOAuthGrants.nextCalendarSyncAt,
    })
    .from(userOAuthGrants)
    .where(eq(userOAuthGrants.calendarSyncStatus, "idle"));

  return rows
    .filter(
      (row): row is DueCalendarSyncGrant =>
        (row.provider === "google" || row.provider === "entra") &&
        (!row.nextCalendarSyncAt || row.nextCalendarSyncAt.getTime() <= now.getTime()),
    )
    .sort((left, right) => {
      const leftTime = left.nextCalendarSyncAt?.getTime() || 0;
      const rightTime = right.nextCalendarSyncAt?.getTime() || 0;
      return leftTime - rightTime;
    })
    .slice(0, limit);
}

/**
 * Marks a provider grant as actively syncing so the scheduler does not duplicate work.
 */
export async function markCalendarSyncRunning(grantId: string) {
  await updateCalendarSyncState(grantId, {
    calendarSyncStatus: "syncing",
    lastCalendarSyncError: null,
  });
}

/**
 * Marks a provider grant as successfully synced and schedules the next daily run.
 */
export async function markCalendarSyncSuccess(grantId: string, now = new Date()) {
  await updateCalendarSyncState(grantId, {
    calendarSyncStatus: "idle",
    lastCalendarSyncAt: now,
    nextCalendarSyncAt: buildNextDailyCalendarSyncAt(now),
    lastCalendarSyncError: null,
  });
}

/**
 * Marks a provider grant as temporarily failed and schedules a retry.
 */
export async function markCalendarSyncError(
  grantId: string,
  error: string,
  retryAt: Date,
) {
  await updateCalendarSyncState(grantId, {
    calendarSyncStatus: "idle",
    nextCalendarSyncAt: retryAt,
    lastCalendarSyncError: error,
  });
}

/**
 * Marks a provider grant as requiring reauthentication before future background syncs.
 */
export async function markCalendarSyncReauthRequired(grantId: string, reason: string) {
  await updateCalendarSyncState(grantId, {
    calendarSyncStatus: "reauth_required",
    nextCalendarSyncAt: null,
    lastCalendarSyncError: reason,
  });
}

/**
 * Reschedules a provider grant for an immediate retry, typically after reconnecting OAuth.
 */
export async function queueImmediateCalendarSync(grantId: string) {
  await updateCalendarSyncState(grantId, {
    calendarSyncStatus: "idle",
    nextCalendarSyncAt: new Date(),
    lastCalendarSyncError: null,
  });
}

/**
 * Schedules a provider grant for the next daily background sync.
 */
export function buildNextDailyCalendarSyncAt(now = new Date()) {
  return new Date(now.getTime() + DAILY_SYNC_INTERVAL_MS + randomDailyJitterMs());
}

/**
 * Builds a bounded retry time for transient provider failures.
 */
export function buildCalendarSyncRetryAt(now = new Date(), retryAfterSeconds?: number | null) {
  const boundedRetryMs = retryAfterSeconds
    ? Math.min(Math.max(retryAfterSeconds * 1000, 5 * 60 * 1000), 6 * 60 * 60 * 1000)
    : 60 * 60 * 1000;
  return new Date(now.getTime() + boundedRetryMs);
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

async function updateCalendarSyncState(
  grantId: string,
  values: Partial<{
    calendarSyncStatus: CalendarSyncStatus;
    lastCalendarSyncAt: Date | null;
    nextCalendarSyncAt: Date | null;
    lastCalendarSyncError: string | null;
  }>,
) {
  await db
    .update(userOAuthGrants)
    .set({
      ...values,
      updatedAt: new Date(),
    })
    .where(eq(userOAuthGrants.id, grantId));
}

function randomDailyJitterMs() {
  return Math.floor(Math.random() * DAILY_SYNC_JITTER_MS);
}
