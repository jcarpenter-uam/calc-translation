import { describe, it, expect, beforeAll } from "bun:test";
import {
  createTestUser,
  cleanupTestUsers,
  createMeeting,
  endMeeting,
  apiFetch,
  streamAudio,
  waitForEvent,
  WS_URL,
} from "./utils/testHelpers";

describe("Smoke Test - Single Stream", () => {
  let host: any;

  beforeAll(async () => {
    host = await createTestUser("smoke-host", "Smoke Test Host", "en");
  });

  it("should stream audio and receive transcription tokens", async () => {
    console.log(`\x1b[36mInitializing Single Stream Test...\x1b[0m`);

    // 1. Create and Join
    const meeting = await createMeeting(host.token, { topic: "Smoke Test" });
    const joinRes = await apiFetch(
      `/meeting/join/${meeting.readableId}`,
      host.token,
    );

    // 2. Connect WebSocket
    const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);
    const messages: any[] = [];

    ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data.toString());
      messages.push(parsed);
      if (parsed.type === "transcription") {
        process.stdout.write(
          `\r\x1b[K\x1b[32m${parsed.text}\x1b[0m${parsed.isFinal ? "\n" : ""}`,
        );
      }
    };

    await new Promise((resolve) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            action: "subscribe_meeting",
            meetingId: meeting.meetingId,
          }),
        );
        resolve(null);
      };
    });

    // 3. Stream and Assert
    console.log(`\x1b[35mStreaming audio chunks...\x1b[0m\n`);
    await streamAudio(ws, 3000);

    await expect(
      waitForEvent(messages, (m) => m.type === "transcription"),
    ).resolves.toBe(true);

    // 4. Cleanup
    ws.close();
    await endMeeting(meeting.meetingId, host.token);
    await cleanupTestUsers();
    console.log(`\n\x1b[33mMeeting ended gracefully.\x1b[0m`);
  }, 15000);
});
