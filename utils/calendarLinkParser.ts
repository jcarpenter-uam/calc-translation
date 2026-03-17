export type SupportedCalendarPlatform =
  | "teams"
  | "google_meet"
  | "zoom"
  | "app";

export interface ParsedMeetingLink {
  platform: SupportedCalendarPlatform;
  joinUrl: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"]+/gi;

/**
 * Extracts HTTP(S) URLs from free-form text.
 */
export function extractUrlsFromText(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }

  const matches = text.match(URL_REGEX) || [];
  const cleaned = matches
    .map((value) => value.replace(/[),.;!?]+$/g, ""))
    .filter((value) => value.length > 0);

  return Array.from(new Set(cleaned));
}

/**
 * Resolves the first supported meeting link from a list of URLs.
 */
export function findSupportedMeetingLink(
  urls: string[],
  appBaseUrl: string,
): ParsedMeetingLink | null {
  let appHost: string | null = null;
  try {
    appHost = new URL(appBaseUrl).host.toLowerCase();
  } catch {
    appHost = null;
  }

  for (const candidate of urls) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }

    const host = parsed.host.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (host === "meet.google.com") {
      return { platform: "google_meet", joinUrl: parsed.toString() };
    }

    if (host === "zoom.us" || host.endsWith(".zoom.us")) {
      return { platform: "zoom", joinUrl: parsed.toString() };
    }

    if (host === "teams.microsoft.com" || host.endsWith(".teams.microsoft.com")) {
      return { platform: "teams", joinUrl: parsed.toString() };
    }

    if (
      appHost &&
      host === appHost &&
      /(\/meeting\b|\/meetings\b|\/join\b|\/m\/)/.test(pathname)
    ) {
      return { platform: "app", joinUrl: parsed.toString() };
    }
  }

  return null;
}
