import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../core/database";
import { users } from "../models/userModel";
import { meetings } from "../models/meetingModel";
import { generateApiSessionToken } from "../utils/security";
import { eq } from "drizzle-orm";
import * as fs from "fs";

const PORT = process.env.PORT || 8000;
const BASE_URL = `http://localhost:${PORT}/api`;
const WS_URL = `ws://localhost:${PORT}/ws`;
const AUDIO_FILE = "./tests/samples/sample.raw";

// Load audio file into memory once
const audioData = fs.readFileSync(AUDIO_FILE);

/**
 * Helper to seed a test user into the database and generate a session token.
 */
async function createTestUser(id: string, name: string, languageCode: string) {
  await db
    .insert(users)
    .values({ id, name, email: `${id}@test.com`, languageCode })
    .onConflictDoUpdate({
      target: users.id,
      set: { languageCode },
    });

  const token = await generateApiSessionToken(id, "test-tenant");
  return { id, token, languageCode };
}

/**
 * Helper to make authenticated POST requests to the API.
 */
async function apiFetch(path: string, token: string, body?: any) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Cookie: `auth_session=${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

/**
 * Helper to continuously stream PCM audio chunks to a WebSocket for a set duration.
 * Loops the audio buffer if the duration exceeds the file length.
 */
function streamAudio(ws: WebSocket, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    let offset = 0;
    const chunkSize = 3200; // ~100ms of 16kHz PCM audio

    const interval = setInterval(() => {
      if (ws.readyState === 1) {
        // 1 = OPEN
        // Loop the audio file if we hit the end
        if (offset >= audioData.length) offset = 0;
        const end = Math.min(offset + chunkSize, audioData.length);
        ws.send(audioData.subarray(offset, end));
        offset += chunkSize;
      }
    }, 100);

    setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, durationMs);
  });
}

/**
 * Helper to block execution until a specific condition is met in an event array.
 */
async function waitForEvent(
  messages: any[],
  predicate: (msg: any) => boolean,
  timeout = 10000,
) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (messages.find(predicate)) return true;
    await new Promise((r) => setTimeout(r, 100)); // Poll every 100ms
  }
  throw new Error("Timeout waiting for specific WebSocket event.");
}

describe("Host Reconnection and Timeout Logic", () => {
  let host: any;
  let attendee: any;

  /* Resource trackers for guaranteed cleanup */
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
        await apiFetch(`/meeting/end/${meeting.id}`, meeting.hostToken);
      } catch (err) {
        console.error(`Cleanup failed for meeting ${meeting.id}:`, err);
      }
    }
  });

  it("should allow host to disconnect and reconnect without ending the session", async () => {
    /* Host creates and joins meeting */
    const createRes = await apiFetch("/meeting/create", host.token, {
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

    // Verify attendee received live transcription tokens
    await waitForEvent(attendeeMessages, (m) => m.type === "transcription");

    /* Simulate a Host Network Crash */
    attendeeMessages.length = 0; // Clear the log
    hostWs.close();

    // Verify attendee got the disconnect warning
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

    // Verify attendee got the reconnect notification
    await waitForEvent(
      attendeeMessages,
      (m) => m.type === "status" && m.event === "host_reconnected",
    );

    /* Host sends new audio to prove stream is un-paused */
    await streamAudio(hostWs, 3000);

    // Verify attendee gets fresh transcription tokens
    await waitForEvent(attendeeMessages, (m) => m.type === "transcription");

    /* Proactively clean up to prevent bleeding into the next test */
    hostWs.close();
    attendeeWs.close();
    await apiFetch(`/meeting/end/${meetingId}`, host.token);
    const cleanupIdx = createdMeetings.findIndex((m) => m.id === meetingId);
    if (cleanupIdx > -1) createdMeetings.splice(cleanupIdx, 1);
  }, 30000); // 30 second timeout to accommodate audio streaming delays

  it("should automatically end the meeting if the host is gone for more than 60 seconds", async () => {
    /* Host starts meeting */
    const createRes = await apiFetch("/meeting/create", host.token, {
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

    // Feed it a little audio so Soniox registers a real session before we crash it
    await streamAudio(hostWs, 2000);

    /* Host disconnects */
    hostWs.close();

    /* Wait for timeout (Using 65 seconds to be safely past the 60s limit) */
    await new Promise((r) => setTimeout(r, 65000));

    /* Check Database to ensure ended_at is set */
    const [dbMeeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId));

    expect(dbMeeting.ended_at).not.toBeNull();
  }, 85000); // Extended timeout to accommodate the initial audio streaming
});
