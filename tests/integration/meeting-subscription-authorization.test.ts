import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "../../core/database";
import { tenants } from "../../models/tenantModel";
import { users } from "../../models/userModel";
import { userTenants } from "../../models/userTenantModel";
import { generateApiSessionToken, generateWsTicket } from "../../utils/security";
import {
  BASE_URL,
  WS_URL,
  cleanupTestData,
  createMeeting,
  trackTestTenants,
  trackTestUsers,
  waitForEvent,
} from "../setup/utils/testHelpers";

describe("Meeting subscription authorization", () => {
  const tenantIds = ["meeting-sub-tenant-a", "meeting-sub-tenant-b"];
  const userIds = [
    "meeting-sub-host",
    "meeting-sub-same-tenant-outsider",
    "meeting-sub-cross-tenant-outsider",
  ];

  const activeSockets: WebSocket[] = [];
  let hostToken = "";
  let sameTenantOutsiderToken = "";
  let crossTenantOutsiderToken = "";

  beforeAll(async () => {
    trackTestTenants(...tenantIds);
    trackTestUsers(...userIds);

    await db
      .insert(tenants)
      .values([
        {
          tenantId: "meeting-sub-tenant-a",
          organizationName: "Meeting Subscription Tenant A",
        },
        {
          tenantId: "meeting-sub-tenant-b",
          organizationName: "Meeting Subscription Tenant B",
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values([
        {
          id: "meeting-sub-host",
          name: "Meeting Subscription Host",
          email: "meeting-sub-host@test.com",
          languageCode: "en",
          role: "user",
        },
        {
          id: "meeting-sub-same-tenant-outsider",
          name: "Same Tenant Outsider",
          email: "meeting-sub-same-tenant-outsider@test.com",
          languageCode: "es",
          role: "user",
        },
        {
          id: "meeting-sub-cross-tenant-outsider",
          name: "Cross Tenant Outsider",
          email: "meeting-sub-cross-tenant-outsider@test.com",
          languageCode: "fr",
          role: "user",
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(userTenants)
      .values([
        { userId: "meeting-sub-host", tenantId: "meeting-sub-tenant-a" },
        {
          userId: "meeting-sub-same-tenant-outsider",
          tenantId: "meeting-sub-tenant-a",
        },
        {
          userId: "meeting-sub-cross-tenant-outsider",
          tenantId: "meeting-sub-tenant-b",
        },
      ])
      .onConflictDoNothing();

    hostToken = await generateApiSessionToken("meeting-sub-host", "meeting-sub-tenant-a");
    sameTenantOutsiderToken = await generateApiSessionToken(
      "meeting-sub-same-tenant-outsider",
      "meeting-sub-tenant-a",
    );
    crossTenantOutsiderToken = await generateApiSessionToken(
      "meeting-sub-cross-tenant-outsider",
      "meeting-sub-tenant-b",
    );
  });

  afterAll(async () => {
    for (const ws of activeSockets) {
      if (ws.readyState === 0 || ws.readyState === 1) {
        ws.close();
      }
    }

    await cleanupTestData();
  });

  async function subscribeWithTicket(ticket: string, meetingId: string) {
    const ws = new WebSocket(`${WS_URL}?ticket=${ticket}`);
    activeSockets.push(ws);

    const messages: any[] = [];
    ws.onmessage = (event) => {
      messages.push(JSON.parse(event.data.toString()));
    };

    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ action: "subscribe_meeting", meetingId }));
        resolve();
      };
    });

    return { ws, messages };
  }

  it("rejects joining a meeting from another tenant", async () => {
    const meeting = await createMeeting(hostToken, {
      topic: "Cross Tenant Join Denial",
      languages: ["en"],
    });

    const response = await fetch(`${BASE_URL}/meeting/join/${meeting.readableId}`, {
      method: "POST",
      headers: { Cookie: `auth_session=${crossTenantOutsiderToken}` },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Not authorized to join this meeting",
    });
  });

  it("rejects websocket subscription for a same-tenant user who never joined the meeting", async () => {
    const meeting = await createMeeting(hostToken, {
      topic: "Same Tenant WebSocket Denial",
      languages: ["en"],
    });
    const outsiderTicket = await generateWsTicket(
      "meeting-sub-same-tenant-outsider",
      "meeting-sub-tenant-a",
    );

    const { messages } = await subscribeWithTicket(outsiderTicket, meeting.meetingId);

    await waitForEvent(
      messages,
      (message) =>
        message.type === "error" &&
        message.error === "Not authorized to subscribe to this meeting",
    );

    expect(messages.some((message) => message.status === `Subscribed to ${meeting.meetingId}`)).toBe(
      false,
    );
  });

  it("rejects websocket subscription for a user from another tenant", async () => {
    const meeting = await createMeeting(hostToken, {
      topic: "Cross Tenant WebSocket Denial",
      languages: ["en"],
    });
    const outsiderTicket = await generateWsTicket(
      "meeting-sub-cross-tenant-outsider",
      "meeting-sub-tenant-b",
    );

    const { messages } = await subscribeWithTicket(outsiderTicket, meeting.meetingId);

    await waitForEvent(
      messages,
      (message) =>
        message.type === "error" &&
        message.error === "Not authorized to subscribe to this meeting",
    );

    expect(messages.some((message) => message.status === `Subscribed to ${meeting.meetingId}`)).toBe(
      false,
    );
  });
});
