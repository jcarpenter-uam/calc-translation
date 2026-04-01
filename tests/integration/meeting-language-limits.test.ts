import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../core/database";
import { meetings } from "../../models/meetingModel";
import {
  BASE_URL,
  cleanupTestUsers,
  createMeeting,
  createTestUser,
  endMeeting,
} from "../setup/utils/testHelpers";

describe("Meeting language limits", () => {
  let host: any;
  let attendees: any[] = [];
  const createdMeetings: { id: string; hostToken: string }[] = [];

  beforeAll(async () => {
    host = await createTestUser("host-language-limit", "Host User", "en");

    // Use five distinct attendee languages so the last join exercises the policy cap exactly.
    const languages = ["es", "fr", "de", "it", "pt"];
    attendees = await Promise.all(
      languages.map((language, index) =>
        createTestUser(
          `attendee-language-limit-${index}`,
          `Attendee ${index}`,
          language,
        ),
      ),
    );
  });

  afterAll(async () => {
    for (const meeting of createdMeetings) {
      try {
        await endMeeting(meeting.id, meeting.hostToken);
      } catch {}
    }

    await cleanupTestUsers();
  });

  it("rejects creating a one-way meeting with more than five languages", async () => {
    const response = await fetch(`${BASE_URL}/meeting/create`, {
      method: "POST",
      headers: {
        Cookie: `auth_session=${host.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: "Too many languages",
        method: "one_way",
        languages: ["en", "es", "fr", "de", "it", "pt"],
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "One-way meetings can include at most 5 spoken languages",
    });
  });

  it("rejects a sixth unique language when joining a one-way meeting", async () => {
    const createRes = await createMeeting(host.token, {
      topic: "Join limit test",
      method: "one_way",
      languages: ["en"],
    });

    createdMeetings.push({ id: createRes.meetingId, hostToken: host.token });

    // Fill the meeting to the allowed maximum before attempting the final rejected join.
    for (const attendee of attendees.slice(0, 4)) {
      const response = await fetch(
        `${BASE_URL}/meeting/join/${createRes.readableId}`,
        {
          method: "POST",
          headers: {
            Cookie: `auth_session=${attendee.token}`,
            "Content-Type": "application/json",
          },
        },
      );

      expect(response.status).toBe(200);
    }

    const rejectedJoin = await fetch(
      `${BASE_URL}/meeting/join/${createRes.readableId}`,
      {
        method: "POST",
        headers: {
          Cookie: `auth_session=${attendees[4].token}`,
          "Content-Type": "application/json",
        },
      },
    );

    expect(rejectedJoin.status).toBe(400);
    await expect(rejectedJoin.json()).resolves.toMatchObject({
      error: "One-way meetings can include at most 5 spoken languages",
    });

    const [meeting] = await db
      .select({ languages: meetings.languages })
      .from(meetings)
      .where(eq(meetings.id, createRes.meetingId));

    expect(meeting?.languages).toEqual(["en", "es", "fr", "de", "it"]);
  });
});
