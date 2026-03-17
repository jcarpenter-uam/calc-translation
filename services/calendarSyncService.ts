import { and, eq, inArray } from "drizzle-orm";
import { db } from "../core/database";
import { env } from "../core/config";
import { logger } from "../core/logger";
import { calendarEvents } from "../models/calendarEventModel";
import {
  extractUrlsFromText,
  findSupportedMeetingLink,
} from "../utils/calendarLinkParser";

type CalendarProvider = "google" | "entra";

interface SyncCalendarEventsInput {
  provider: CalendarProvider;
  accessToken: string;
  userId: string;
  tenantId: string;
}

interface NormalizedCalendarEvent {
  providerEventId: string;
  icalUid: string | null;
  title: string | null;
  status: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  urlCandidates: string[];
}

/**
 * Pulls calendar events from a provider and stores only supported meeting links.
 */
export async function syncCalendarEventsForUser({
  provider,
  accessToken,
  userId,
  tenantId,
}: SyncCalendarEventsInput) {
  const now = new Date();
  const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const sourceEvents =
    provider === "google"
      ? await fetchGoogleCalendarEvents(accessToken, timeMin, timeMax)
      : await fetchEntraCalendarEvents(accessToken, timeMin, timeMax);

  const records: Array<{
    tenantId: string;
    userId: string;
    provider: CalendarProvider;
    providerEventId: string;
    icalUid: string | null;
    title: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    status: string | null;
    platform: "teams" | "google_meet" | "zoom" | "app";
    joinUrl: string;
    lastSyncedAt: Date;
    updatedAt: Date;
  }> = [];

  for (const event of sourceEvents) {
    logger.debug("Calendar event fetched for parsing.", {
      userId,
      tenantId,
      provider,
      providerEventId: event.providerEventId,
      title: event.title,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      urlCandidates: event.urlCandidates,
      urlCandidateCount: event.urlCandidates.length,
    });

    const parsed = findSupportedMeetingLink(event.urlCandidates, env.BASE_URL);
    if (!parsed) {
      logger.debug("Calendar event skipped during parsing.", {
        userId,
        tenantId,
        provider,
        providerEventId: event.providerEventId,
        title: event.title,
        skipReason: resolveCalendarSkipReason(event.urlCandidates, env.BASE_URL),
        urlCandidates: event.urlCandidates,
      });
      continue;
    }

    logger.debug("Calendar event matched supported meeting link.", {
      userId,
      tenantId,
      provider,
      providerEventId: event.providerEventId,
      title: event.title,
      platform: parsed.platform,
      joinUrl: parsed.joinUrl,
    });

    records.push({
      tenantId,
      userId,
      provider,
      providerEventId: event.providerEventId,
      icalUid: event.icalUid,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
      platform: parsed.platform,
      joinUrl: parsed.joinUrl,
      lastSyncedAt: now,
      updatedAt: now,
    });
  }

  for (const record of records) {
    await db
      .insert(calendarEvents)
      .values(record)
      .onConflictDoUpdate({
        target: [
          calendarEvents.userId,
          calendarEvents.provider,
          calendarEvents.providerEventId,
        ],
        set: {
          tenantId: record.tenantId,
          icalUid: record.icalUid,
          title: record.title,
          startsAt: record.startsAt,
          endsAt: record.endsAt,
          status: record.status,
          platform: record.platform,
          joinUrl: record.joinUrl,
          lastSyncedAt: now,
          updatedAt: now,
        },
      });
  }

  const retainedProviderEventIds = new Set(records.map((record) => record.providerEventId));
  const existing = await db
    .select({ providerEventId: calendarEvents.providerEventId })
    .from(calendarEvents)
    .where(
      and(eq(calendarEvents.userId, userId), eq(calendarEvents.provider, provider)),
    );

  const staleProviderEventIds = existing
    .map((entry) => entry.providerEventId)
    .filter((providerEventId) => !retainedProviderEventIds.has(providerEventId));

  if (staleProviderEventIds.length > 0) {
    await db
      .delete(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, userId),
          eq(calendarEvents.provider, provider),
          inArray(calendarEvents.providerEventId, staleProviderEventIds),
        ),
      );
  }

  logger.info("Calendar sync completed.", {
    userId,
    tenantId,
    provider,
    fetchedCount: sourceEvents.length,
    savedCount: records.length,
    prunedCount: staleProviderEventIds.length,
  });

  return {
    fetchedCount: sourceEvents.length,
    savedCount: records.length,
    prunedCount: staleProviderEventIds.length,
  };
}

interface GoogleCalendarApiEvent {
  id?: string;
  iCalUID?: string;
  summary?: string;
  status?: string;
  hangoutLink?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: {
    entryPoints?: Array<{ uri?: string }>;
  };
}

/**
 * Fetches Google Calendar events from the primary calendar.
 */
async function fetchGoogleCalendarEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
): Promise<NormalizedCalendarEvent[]> {
  const endpoint = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  endpoint.searchParams.set("singleEvents", "true");
  endpoint.searchParams.set("orderBy", "startTime");
  endpoint.searchParams.set("timeMin", timeMin.toISOString());
  endpoint.searchParams.set("timeMax", timeMax.toISOString());
  endpoint.searchParams.set("maxResults", "250");
  endpoint.searchParams.set(
    "fields",
    "items(id,iCalUID,summary,status,hangoutLink,location,description,htmlLink,start,end,conferenceData(entryPoints(uri)))",
  );

  const response = await fetch(endpoint.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Google calendar fetch failed (${response.status}): ${responseBody}`);
  }

  const payload = (await response.json()) as { items?: GoogleCalendarApiEvent[] };
  const items = payload.items || [];

  return items
    .filter((item): item is GoogleCalendarApiEvent & { id: string } => !!item.id)
    .map((item) => {
      const urlCandidates = [
        item.hangoutLink,
        item.htmlLink,
        ...extractUrlsFromText(item.location),
        ...extractUrlsFromText(item.description),
        ...(item.conferenceData?.entryPoints || []).map((entryPoint) => entryPoint.uri),
      ].filter((url): url is string => typeof url === "string" && url.length > 0);

      return {
        providerEventId: item.id,
        icalUid: item.iCalUID || null,
        title: item.summary || null,
        status: item.status || null,
        startsAt: parseCalendarDate(item.start?.dateTime || item.start?.date),
        endsAt: parseCalendarDate(item.end?.dateTime || item.end?.date),
        urlCandidates,
      };
    });
}

interface EntraCalendarApiEvent {
  id?: string;
  iCalUId?: string;
  subject?: string;
  bodyPreview?: string;
  isCancelled?: boolean;
  webLink?: string;
  onlineMeeting?: { joinUrl?: string };
  location?: { displayName?: string };
  locations?: Array<{ displayName?: string }>;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
}

/**
 * Fetches Microsoft Graph calendar events from the user's default calendar.
 */
async function fetchEntraCalendarEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
): Promise<NormalizedCalendarEvent[]> {
  const endpoint = new URL("https://graph.microsoft.com/v1.0/me/calendar/events");
  endpoint.searchParams.set(
    "$select",
    "id,iCalUId,subject,bodyPreview,isCancelled,webLink,onlineMeeting,location,locations,start,end",
  );
  endpoint.searchParams.set("$top", "250");
  endpoint.searchParams.set("$orderby", "start/dateTime");
  endpoint.searchParams.set(
    "$filter",
    `start/dateTime ge '${timeMin.toISOString()}' and end/dateTime le '${timeMax.toISOString()}'`,
  );

  const allEvents: EntraCalendarApiEvent[] = [];
  let nextUrl: string | null = endpoint.toString();

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Entra calendar fetch failed (${response.status}): ${responseBody}`);
    }

    const payload = (await response.json()) as {
      value?: EntraCalendarApiEvent[];
      "@odata.nextLink"?: string;
    };

    allEvents.push(...(payload.value || []));
    nextUrl = payload["@odata.nextLink"] || null;
  }

  return allEvents
    .filter((item): item is EntraCalendarApiEvent & { id: string } => !!item.id)
    .map((item) => {
      const locationText = [
        item.location?.displayName,
        ...(item.locations || []).map((location) => location.displayName),
      ]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(" ");

      const urlCandidates = [
        item.onlineMeeting?.joinUrl,
        item.webLink,
        ...extractUrlsFromText(item.bodyPreview),
        ...extractUrlsFromText(locationText),
      ].filter((url): url is string => typeof url === "string" && url.length > 0);

      return {
        providerEventId: item.id,
        icalUid: item.iCalUId || null,
        title: item.subject || null,
        status: item.isCancelled ? "cancelled" : "confirmed",
        startsAt: parseCalendarDate(item.start?.dateTime),
        endsAt: parseCalendarDate(item.end?.dateTime),
        urlCandidates,
      };
    });
}

/**
 * Parses provider date strings into Date objects when valid.
 */
function parseCalendarDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

/**
 * Explains why event URLs do not match supported meeting-link rules.
 */
function resolveCalendarSkipReason(urlCandidates: string[], appBaseUrl: string) {
  if (urlCandidates.length === 0) {
    return "no_url_candidates";
  }

  const parsedUrls = urlCandidates
    .map((candidate) => {
      try {
        return new URL(candidate);
      } catch {
        return null;
      }
    })
    .filter((value): value is URL => value !== null);

  if (parsedUrls.length === 0) {
    return "invalid_url_candidates";
  }

  let appHost = "";
  try {
    appHost = new URL(appBaseUrl).host.toLowerCase();
  } catch {
    appHost = "";
  }

  const uniqueHosts = Array.from(
    new Set(parsedUrls.map((value) => value.host.toLowerCase())),
  );

  if (appHost && uniqueHosts.includes(appHost)) {
    return "app_host_url_without_supported_meeting_path";
  }

  return `unsupported_meeting_hosts:${uniqueHosts.join(",") || "unknown"}`;
}
