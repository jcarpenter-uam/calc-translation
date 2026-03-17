import { describe, expect, it } from "bun:test";
import {
  extractUrlsFromText,
  findSupportedMeetingLink,
} from "../utils/calendarLinkParser";

describe("calendarLinkParser", () => {
  it("extracts urls and trims trailing punctuation", () => {
    const text =
      "Join here: https://meet.google.com/abc-defg-hij, backup https://foo.bar/path).";

    const urls = extractUrlsFromText(text);

    expect(urls).toEqual([
      "https://meet.google.com/abc-defg-hij",
      "https://foo.bar/path",
    ]);
  });

  it("resolves Google Meet links", () => {
    const parsed = findSupportedMeetingLink(
      ["https://meet.google.com/abc-defg-hij"],
      "http://localhost:8000",
    );

    expect(parsed).toEqual({
      platform: "google_meet",
      joinUrl: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("resolves Zoom and Teams links", () => {
    const zoom = findSupportedMeetingLink(
      ["https://acme.zoom.us/j/123456789"],
      "http://localhost:8000",
    );
    const teams = findSupportedMeetingLink(
      ["https://teams.microsoft.com/l/meetup-join/abc"],
      "http://localhost:8000",
    );

    expect(zoom?.platform).toBe("zoom");
    expect(teams?.platform).toBe("teams");
  });

  it("resolves app links only for matching host and meeting paths", () => {
    const matched = findSupportedMeetingLink(
      ["https://app.example.com/meeting/12345"],
      "https://app.example.com",
    );
    const ignored = findSupportedMeetingLink(
      ["https://app.example.com/docs"],
      "https://app.example.com",
    );

    expect(matched?.platform).toBe("app");
    expect(ignored).toBeNull();
  });
});
