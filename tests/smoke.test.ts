import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { websocketController } from "../controllers/websocketController";
import { meetingTranscriptCacheService } from "../services/meetingTranscriptCacheService";
import {
  audioData,
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
  let activeMeetingId: string | null = null;
  let activeSocket: WebSocket | null = null;

  beforeAll(async () => {
    host = await createTestUser("smoke-host", "Smoke Test Host", "en");
  });

  afterAll(async () => {
    if (activeSocket && (activeSocket.readyState === 0 || activeSocket.readyState === 1)) {
      activeSocket.close();
    }

    if (activeMeetingId) {
      try {
        await endMeeting(activeMeetingId, host.token);
      } catch {
        // No-op; meeting may already be closed.
      }
    }

    await cleanupTestUsers();
  });

  it("should stream audio and receive transcription tokens", async () => {
    console.log(`\x1b[36mInitializing Single Stream Test...\x1b[0m`);

    // Keep this flow minimal so it acts as a fast signal that the end-to-end stack is alive.
    const meeting = await createMeeting(host.token, { topic: "Smoke Test" });
    activeMeetingId = meeting.meetingId;

    const joinRes = await apiFetch(
      `/meeting/join/${meeting.readableId}`,
      host.token,
    );

    // Subscribe over WebSocket before sending audio so early transcript events are not missed.
    const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);
    activeSocket = ws;
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

    await waitForEvent(
      messages,
      (message) =>
        message.status === `Subscribed to ${meeting.meetingId}` ||
        (message.type === "presence" && message.event === "snapshot"),
    );

    console.log(`\x1b[35mStreaming audio chunks...\x1b[0m\n`);

    if (audioData.length > 0) {
      await streamAudio(ws, 3000);
      await expect(
        waitForEvent(messages, (m) => m.type === "transcription"),
      ).resolves.toBe(true);
    } else {
      // CI/local environments may not have the optional raw audio fixture, so inject a finalized
      // transcript event directly and assert it is accepted by the live meeting pipeline.
      await (websocketController as any).handleTranscriptionEvent(meeting.meetingId, {
        text: "Smoke test transcript",
        targetLanguage: "en",
        transcriptionText: "Smoke test transcript",
        translationText: null,
        isFinal: true,
        startedAtMs: 0,
        endedAtMs: 1000,
        speaker: null,
        sourceLanguage: "en",
      });

      const history = await meetingTranscriptCacheService.getLanguageHistory(
        meeting.meetingId,
        "en",
      );
      expect(history.some((entry) => entry.text === "Smoke test transcript")).toBe(true);
    }

    ws.close();
    await endMeeting(meeting.meetingId, host.token);
    activeSocket = null;
    activeMeetingId = null;
    console.log(`\n\x1b[33mMeeting ended gracefully.\x1b[0m`);
  }, 15000);
});
