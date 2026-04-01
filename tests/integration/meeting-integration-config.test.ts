import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { env } from "../../core/config";
import { db } from "../../core/database";
import { meetings } from "../../models/meetingModel";
import { BASE_URL, cleanupTestUsers, createTestUser } from "../setup/utils/testHelpers";

describe("Meeting integration configuration", () => {
  let host: any;
  const createdMeetingIds: string[] = [];

  beforeAll(async () => {
    host = await createTestUser("host-integration-config", "Host User", "en");
  });

  afterAll(async () => {
    if (createdMeetingIds.length > 0) {
      await db.delete(meetings).where(inArray(meetings.id, createdMeetingIds));
    }

    await cleanupTestUsers();
  });

  it("generates a native viewer join URL on create", async () => {
    const response = await fetch(`${BASE_URL}/meeting/create`, {
      method: "POST",
      headers: {
        Cookie: `auth_session=${host.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: "Native URL test",
        integration: "native",
        method: "one_way",
        languages: ["en"],
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json() as {
      meetingId: string;
      readableId: string;
      joinUrl: string;
    };
    createdMeetingIds.push(data.meetingId);

    const expectedOrigin = new URL(env.BASE_URL).origin;
    expect(data.joinUrl).toBe(`${expectedOrigin}/?join=${data.readableId}`);

    const [meeting] = await db
      .select({ joinUrl: meetings.join_url })
      .from(meetings)
      .where(eq(meetings.id, data.meetingId));

    expect(meeting?.joinUrl).toBe(data.joinUrl);
  });

  it("rejects zoom meetings without a valid zoom URL", async () => {
    const response = await fetch(`${BASE_URL}/meeting/create`, {
      method: "POST",
      headers: {
        Cookie: `auth_session=${host.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: "Zoom URL required",
        integration: "zoom",
        method: "one_way",
        languages: ["en"],
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Zoom meetings require a valid meeting URL",
    });
  });
});
