import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "../core/database";
import { logger } from "../core/logger";
import { calendarEvents } from "../models/calendarEventModel";
import { tenants } from "../models/tenantModel";
import { users } from "../models/userModel";
import { parseBoundedInteger } from "../utils/pagination";
import { requireTenantContext } from "../utils/sessionPolicy";
import { syncLinkedCalendarsForUser } from "../services/userCalendarSyncService";

/**
 * Returns the authenticated user profile with tenant details.
 */
export const getMe = async ({ user, tenantId, set }: any) => {
  const userId = user?.id || "unknown_user";

  try {
    const [tenant] = tenantId
      ? await db
          .select({
            id: tenants.tenantId,
            name: tenants.organizationName,
          })
          .from(tenants)
          .where(eq(tenants.tenantId, tenantId))
      : [];

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        languageCode: user.languageCode,
      },
      tenant: tenant || null,
    };
  } catch (err) {
    logger.error("Failed to load current user profile.", {
      userId,
      tenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to fetch current user profile" };
  }
};

/**
 * Updates the authenticated user's language preference.
 */
export const updateMe = async ({ user, body, set }: any) => {
  const userId = user?.id || "unknown_user";

  try {
    const [updatedUser] = await db
      .update(users)
      .set({ languageCode: body.languageCode })
      .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        languageCode: users.languageCode,
      });

    if (!updatedUser) {
      set.status = 404;
      return { error: "User not found" };
    }

    logger.info("User language preference updated.", {
      userId,
      languageCode: body.languageCode,
    });

    return {
      message: "Language updated successfully",
      user: updatedUser,
    };
  } catch (err) {
    logger.error("Failed to update current user profile.", {
      userId,
      err,
    });
    set.status = 500;
    return { error: "Failed to update profile" };
  }
};

/**
 * Returns cached upcoming calendar events for the authenticated user.
 */
export const getCalendarEvents = async ({ user, tenantId, query, set }: any) => {
  const userId = user?.id || "unknown_user";
  const scopedTenantId = requireTenantContext(tenantId, set);
  if (!scopedTenantId) {
    return { error: "Missing tenant context" };
  }

  const limit = parseBoundedInteger(query?.limit, {
    defaultValue: 8,
    min: 1,
    max: 100,
  });

  const range = parseCalendarRange({ from: query?.from, to: query?.to });
  if (!range) {
    set.status = 400;
    return { error: "Invalid calendar date range" };
  }

  try {
    const conditions = [
      eq(calendarEvents.userId, user.id),
      eq(calendarEvents.tenantId, scopedTenantId),
      gte(calendarEvents.startsAt, range.from),
    ];

    if (range.to) {
      conditions.push(lte(calendarEvents.startsAt, range.to));
    }

    const events = await db
      .select({
        id: calendarEvents.id,
        provider: calendarEvents.provider,
        providerEventId: calendarEvents.providerEventId,
        title: calendarEvents.title,
        startsAt: calendarEvents.startsAt,
        endsAt: calendarEvents.endsAt,
        status: calendarEvents.status,
        platform: calendarEvents.platform,
        joinUrl: calendarEvents.joinUrl,
        lastSyncedAt: calendarEvents.lastSyncedAt,
      })
      .from(calendarEvents)
      .where(and(...conditions))
      .orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.createdAt))
      .limit(limit);

    logger.debug("Calendar events retrieved.", {
      userId,
      tenantId: scopedTenantId,
      limit,
      from: range.from,
      to: range.to,
      count: events.length,
    });

    return {
      events: events.map((event) => ({
        ...event,
        startsAt: event.startsAt ? event.startsAt.toISOString() : null,
        endsAt: event.endsAt ? event.endsAt.toISOString() : null,
        lastSyncedAt: event.lastSyncedAt.toISOString(),
      })),
    };
  } catch (err) {
    logger.error("Failed to load calendar events.", {
      userId,
      tenantId: scopedTenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to fetch calendar events" };
  }
};

/**
 * Syncs the authenticated user's linked calendar providers into the local cache.
 */
export const syncMyCalendar = async ({ user, tenantId, body, set }: any) => {
  const userId = user?.id || "unknown_user";
  const scopedTenantId = requireTenantContext(tenantId, set);
  if (!scopedTenantId) {
    return { error: "Missing tenant context" };
  }

  const requestedRange = parseCalendarRange(body || {});
  if (!requestedRange) {
    set.status = 400;
    return { error: "Invalid calendar date range" };
  }

  try {
    const {
      providers,
      reauthProviders,
      fetchedCount,
      savedCount,
      prunedCount,
    } = await syncLinkedCalendarsForUser({
      tenantId: scopedTenantId,
      userId: user.id,
      timeMin: requestedRange.from,
      timeMax: requestedRange.to || undefined,
      pruneMode: "none",
    });

    logger.info("Manual calendar sync completed.", {
      userId,
      tenantId: scopedTenantId,
      providers,
      reauthProviders,
      fetchedCount,
      savedCount,
      prunedCount,
      from: requestedRange.from,
      to: requestedRange.to,
    });

    return {
      message:
        providers.length > 0
          ? "Calendar sync completed"
          : "No linked calendar providers available to sync",
      providers,
      reauthProviders,
      fetchedCount,
      savedCount,
      prunedCount,
    };
  } catch (err) {
    logger.error("Manual calendar sync failed.", {
      userId,
      tenantId: scopedTenantId,
      err,
    });
    set.status = 500;
    return { error: "Failed to sync calendar" };
  }
};

function parseCalendarFromQuery(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function parseCalendarRange(input: { from?: unknown; to?: unknown }) {
  const from = parseCalendarBoundary(input.from, "start") || new Date();
  const to = parseCalendarBoundary(input.to, "end");

  if (!from) {
    return null;
  }

  if (to && from.getTime() > to.getTime()) {
    return null;
  }

  if (to && to.getTime() - from.getTime() > 90 * 24 * 60 * 60 * 1000) {
    return null;
  }

  return { from, to };
}

function parseCalendarBoundary(value: unknown, boundary: "start" | "end") {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const suffix = boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
    return parseCalendarFromQuery(`${value}${suffix}`);
  }

  return parseCalendarFromQuery(value);
}
