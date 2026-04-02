import { logger } from "../core/logger";
import {
  CalendarProviderSyncError,
  syncCalendarEventsForUser,
  type CalendarProvider,
  type CalendarSyncPruneMode,
} from "./calendarSyncService";
import {
  buildCalendarSyncRetryAt,
  getUserOAuthGrantByProvider,
  listLinkedUserOAuthProviders,
  markCalendarSyncError,
  markCalendarSyncReauthRequired,
  markCalendarSyncRunning,
  markCalendarSyncSuccess,
  resolveUserOAuthAccessToken,
} from "./userOAuthGrantService";

interface SyncCalendarProviderGrantInput {
  grantId: string;
  tenantId: string;
  userId: string;
  provider: CalendarProvider;
  timeMin?: Date;
  timeMax?: Date;
  pruneMode?: CalendarSyncPruneMode;
}

interface SyncLinkedCalendarsForUserInput {
  tenantId: string;
  userId: string;
  timeMin?: Date;
  timeMax?: Date;
  pruneMode?: CalendarSyncPruneMode;
}

/**
 * Syncs one stored provider grant and updates its background scheduling metadata.
 */
export async function syncCalendarProviderGrant({
  grantId,
  tenantId,
  userId,
  provider,
  timeMin,
  timeMax,
  pruneMode,
}: SyncCalendarProviderGrantInput) {
  await markCalendarSyncRunning(grantId);

  const tokenResult = await resolveUserOAuthAccessToken({
    tenantId,
    userId,
    provider,
  });

  if (tokenResult.status !== "ready") {
    await markCalendarSyncReauthRequired(grantId, tokenResult.reason);
    return {
      status: "reauth_required" as const,
      provider,
      reason: tokenResult.reason,
    };
  }

  try {
    const syncResult = await syncCalendarEventsForUser({
      provider,
      accessToken: tokenResult.accessToken,
      userId,
      tenantId,
      timeMin,
      timeMax,
      pruneMode,
    });

    await markCalendarSyncSuccess(grantId);

    return {
      status: "synced" as const,
      provider,
      ...syncResult,
    };
  } catch (err) {
    const retryAt = buildCalendarSyncRetryAt(
      new Date(),
      err instanceof CalendarProviderSyncError ? err.retryAfterSeconds : null,
    );
    const errorMessage = err instanceof Error ? err.message : "calendar_sync_failed";

    await markCalendarSyncError(grantId, errorMessage, retryAt);

    throw err;
  }
}

/**
 * Syncs all linked calendar providers for a user and returns aggregate counts.
 */
export async function syncLinkedCalendarsForUser({
  tenantId,
  userId,
  timeMin,
  timeMax,
  pruneMode,
}: SyncLinkedCalendarsForUserInput) {
  const linkedProviders = await listLinkedUserOAuthProviders(tenantId, userId);
  const providers: CalendarProvider[] = [];
  const reauthProviders: CalendarProvider[] = [];
  let fetchedCount = 0;
  let savedCount = 0;
  let prunedCount = 0;

  for (const provider of linkedProviders) {
    try {
      const syncResult = await syncCalendarProviderGrant({
        grantId: await lookupGrantId(tenantId, userId, provider),
        tenantId,
        userId,
        provider,
        timeMin,
        timeMax,
        pruneMode,
      });

      if (syncResult.status === "reauth_required") {
        reauthProviders.push(provider);
        continue;
      }

      providers.push(provider);
      fetchedCount += syncResult.fetchedCount;
      savedCount += syncResult.savedCount;
      prunedCount += syncResult.prunedCount;
    } catch (err) {
      logger.warn("Linked calendar provider sync failed.", {
        tenantId,
        userId,
        provider,
        err,
      });
      throw err;
    }
  }

  return {
    providers,
    reauthProviders,
    fetchedCount,
    savedCount,
    prunedCount,
  };
}

async function lookupGrantId(
  tenantId: string,
  userId: string,
  provider: CalendarProvider,
) {
  const grant = await getUserOAuthGrantByProvider(tenantId, userId, provider);
  if (!grant) {
    throw new Error(`OAuth grant missing for ${provider}`);
  }

  return grant.id;
}
