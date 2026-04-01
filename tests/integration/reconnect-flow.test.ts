import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../core/database";
import { meetings } from "../../models/meetingModel";
import {
  createTestUser,
  cleanupTestUsers,
  apiFetch,
  createMeeting,
  endMeeting,
  streamAudio,
  waitForEvent,
  WS_URL,
} from "../setup/utils/testHelpers";

describe("Host Reconnection and Timeout Logic", () => {
  let host: any;
  let attendee: any;

  // These long-running websocket tests need explicit cleanup to avoid cross-test interference.
  const activeSockets: WebSocket[] = [];
  const createdMeetings: { id: string; hostToken: string }[] = [];

  beforeAll(async () => {
    host = await createTestUser("host-reconnect", "Host User", "en");
    attendee = await createTestUser("attendee-reconnect", "Attendee", "en");
  });

  afterAll(async () => {
    for (const ws of activeSockets) {
      if (ws.readyState === 1 || ws.readyState === 0) ws.close();
    }

    for (const meeting of createdMeetings) {
      try {
        await endMeeting(meeting.id, meeting.hostToken);
      } catch (err) {
        console.error(`Cleanup failed for meeting ${meeting.id}:`, err);
        }
      }

    await cleanupTestUsers();
  });

  it("should allow host to disconnect and reconnect without ending the session", async () => {
    /* Host creates and joins meeting */
    const createRes = await createMeeting(host.token, {
      topic: "Reconnection Test",
      languages: ["en"],
    });

    const meetingId = createRes.meetingId;
    const readableId = createRes.readableId;
    createdMeetings.push({ id: meetingId, hostToken: host.token });

    const hostJoin = await apiFetch(`/meeting/join/${readableId}`, host.token);

    /* Attendee joins and collects incoming WebSocket messages */
    const attendeeJoin = await apiFetch(
      `/meeting/join/${readableId}`,
      attendee.token,
    );
    const attendeeWs = new WebSocket(`${WS_URL}?ticket=${attendeeJoin.token}`);
    activeSockets.push(attendeeWs);

    const attendeeMessages: any[] = [];
    attendeeWs.onmessage = (event) => {
      const data = JSON.parse(event.data.toString());
      attendeeMessages.push(data);
    };

    await new Promise((resolve) => {
      attendeeWs.onopen = () => {
        attendeeWs.send(
          JSON.stringify({ action: "subscribe_meeting", meetingId }),
        );
        resolve(null);
      };
    });

    /* Host subscribes and streams audio */
    let hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoin.token}`);
    activeSockets.push(hostWs);

    await new Promise((r) => {
      hostWs.onopen = () => {
        hostWs.send(JSON.stringify({ action: "subscribe_meeting", meetingId }));
        setTimeout(r, 500);
      };
    });

    console.log("Streaming initial audio...");
    await streamAudio(hostWs, 3000); // Send 3 seconds of audio

    // Prove the session is active before simulating a disconnect.
    await waitForEvent(attendeeMessages, (m) => m.type === "transcription");

    /* Simulate a Host Network Crash */
    attendeeMessages.length = 0; // Clear the log
    hostWs.close();

    // The attendee should see the temporary disconnect instead of an ended meeting.
    await waitForEvent(
      attendeeMessages,
      (m) => m.type === "status" && m.event === "host_disconnected",
    );

    /* Host Reconnects */
    attendeeMessages.length = 0; // Clear the log
    await new Promise((r) => setTimeout(r, 1000));

    const hostReconnectJoin = await apiFetch(
      `/meeting/join/${readableId}`,
      host.token,
    );
    hostWs = new WebSocket(`${WS_URL}?ticket=${hostReconnectJoin.token}`);
    activeSockets.push(hostWs);

    await new Promise((r) => {
      hostWs.onopen = () => {
        hostWs.send(JSON.stringify({ action: "subscribe_meeting", meetingId }));
        r(null);
      };
    });

    // Rejoining as the same host should resume the room rather than rebuilding it from scratch.
    await waitForEvent(
      attendeeMessages,
      (m) => m.type === "status" && m.event === "host_reconnected",
    );

    /* Host sends new audio to prove stream is un-paused */
    await streamAudio(hostWs, 3000);

    // Fresh transcript events confirm the audio pipeline resumed after reconnect.
    await waitForEvent(attendeeMessages, (m) => m.type === "transcription");

    /* Proactively clean up to prevent bleeding into the next test */
    hostWs.close();
    attendeeWs.close();
    await endMeeting(meetingId, host.token);

    const cleanupIdx = createdMeetings.findIndex((m) => m.id === meetingId);
    if (cleanupIdx > -1) createdMeetings.splice(cleanupIdx, 1);
  }, 30000);

  it("should automatically end the meeting if the host is gone for more than 60 seconds", async () => {
    /* Host starts meeting */
    const createRes = await createMeeting(host.token, {
      topic: "Timeout Test",
      languages: ["en"],
    });

    const meetingId = createRes.meetingId;
    const readableId = createRes.readableId;

    const hostJoin = await apiFetch(`/meeting/join/${readableId}`, host.token);
    const hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoin.token}`);
    activeSockets.push(hostWs);

    await new Promise((r) => {
      hostWs.onopen = () => {
        hostWs.send(JSON.stringify({ action: "subscribe_meeting", meetingId }));
        setTimeout(r, 500);
      };
    });

    // Start a real upstream session before disconnecting so the timeout path exercises live state.
    await streamAudio(hostWs, 2000);

    /* Host disconnects */
    hostWs.close();

    // Wait slightly past the host grace period so the server marks the meeting ended.
    await new Promise((r) => setTimeout(r, 65000));

    /* Check Database to ensure ended_at is set */
    const [dbMeeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId));

    if (!dbMeeting) {
      throw new Error("Expected meeting record to exist after reconnect timeout.");
    }

    expect(dbMeeting.ended_at).not.toBeNull();
  }, 85000);
});
