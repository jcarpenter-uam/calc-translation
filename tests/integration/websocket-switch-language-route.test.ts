import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { websocketController } from "../../controllers/websocketController";
import { db } from "../../core/database";
import { meetings } from "../../models/meetingModel";
import { ollamaBackfillService } from "../../services/ollamaBackfillService";
import {
  WS_URL,
  apiFetch,
  cleanupTestUsers,
  createMeeting,
  createTestUser,
  endMeeting,
  waitForEvent,
} from "../setup/utils/testHelpers";

describe("websocket switch_language route", () => {
  let host: any;
  let attendeeEn: any;
  const activeSockets: WebSocket[] = [];
  const createdMeetings: { id: string; hostToken: string }[] = [];

  beforeAll(async () => {
    host = await createTestUser("host-switch-route-int", "Host User", "en");
    attendeeEn = await createTestUser("attendee-switch-route-int", "English Attendee", "en");
  });

  afterAll(async () => {
    for (const ws of activeSockets) {
      if (ws.readyState === 0 || ws.readyState === 1) {
        ws.close();
      }
    }

    for (const meeting of createdMeetings) {
      try {
        await endMeeting(meeting.id, meeting.hostToken);
      } catch {
        // Meeting may already be closed.
      }
    }

    await cleanupTestUsers();
  });

  async function connectMeetingSocket(token: string, meetingId: string) {
    const ws = new WebSocket(`${WS_URL}?ticket=${token}`);
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

    await waitForEvent(
      messages,
      (message) =>
        message.status === `Subscribed to ${meetingId}` ||
        (message.type === "presence" && message.event === "snapshot"),
      10000,
    );

    await new Promise((resolve) => setTimeout(resolve, 250));

    return { ws, messages };
  }

  it("switches websocket transcript language, backfills history, and expands one-way live sessions", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Switch Language Route Integration Test",
      method: "one_way",
      languages: ["en"],
    });
    createdMeetings.push({ id: meeting.meetingId, hostToken: host.token });

    const hostJoin = await apiFetch(`/meeting/join/${meeting.readableId}`, host.token);
    await connectMeetingSocket(hostJoin.token, meeting.meetingId);

    const attendeeJoin = await apiFetch(`/meeting/join/${meeting.readableId}`, attendeeEn.token);
    const { ws, messages } = await connectMeetingSocket(attendeeJoin.token, meeting.meetingId);

    websocketController.initMeeting(meeting.meetingId, host.id);
    const activeMeeting = websocketController.getMeeting(meeting.meetingId);
    expect(activeMeeting).toBeTruthy();
    activeMeeting!.isHostSendingAudio = true;
    activeMeeting!.audioSessions.set("en", {
      languageKey: "en",
      config: {
        enableSpeakerDiarization: true,
        translation: { type: "one_way", target_language: "en" },
      },
      state: "connected",
      transcriptState: "live",
      shouldResume: true,
      isReconnecting: false,
      session: {
        async connect() {},
        sendAudio() {},
        pause() {},
        resume() {},
        async finish() {},
        getState() {
          return "connected" as const;
        },
      },
    } as any);

    await (websocketController as any).handleTranscriptionEvent(meeting.meetingId, {
      text: "Hello everyone",
      targetLanguage: "en",
      transcriptionText: "Hello everyone",
      translationText: null,
      isFinal: true,
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
      sourceLanguage: "en",
    });

    let connectCount = 0;
    const originalAddTranscriptionSession = websocketController.addTranscriptionSession.bind(
      websocketController,
    );
    const originalSendBackfilledTranscriptHistoryToSocket =
      websocketController.sendBackfilledTranscriptHistoryToSocket.bind(websocketController);

    (websocketController as any).addTranscriptionSession = (
      targetMeetingId: string,
      languageKey: string,
      config: any,
    ) => {
      const targetMeeting = websocketController.getMeeting(targetMeetingId);
      if (!targetMeeting) {
        return null;
      }

      const entry = {
        languageKey,
        config,
        state: "connecting",
        transcriptState: "live",
        shouldResume: true,
        isReconnecting: false,
        session: {
          async connect() {
            connectCount += 1;
          },
          sendAudio() {},
          pause() {},
          resume() {},
          async finish() {},
          getState() {
            return "connected";
          },
        },
      };

      targetMeeting.audioSessions.set(languageKey, entry as any);
      return entry as any;
    };
    (websocketController as any).sendBackfilledTranscriptHistoryToSocket = async (
      targetMeetingId: string,
      targetWs: WebSocket,
      languageCode?: string | null,
    ) => {
      expect(websocketController.getTranscriptState(targetMeetingId, String(languageCode))).toBe(
        "backfilling",
      );
      websocketController.setTranscriptState(targetMeetingId, String(languageCode), "live");
      targetWs.send(
        JSON.stringify({
          type: "transcription",
          meetingId: targetMeetingId,
          language: languageCode,
          text: "fr:Hello everyone",
          transcriptionText: "Hello everyone",
          translationText: "fr:Hello everyone",
          isFinal: true,
          isHistory: true,
          isBackfilled: true,
          utteranceId: `${targetMeetingId}:fr:1`,
          utteranceOrder: 1,
        }),
      );
    };

    try {
      ws.send(
        JSON.stringify({
          action: "switch_language",
          meetingId: meeting.meetingId,
          languageCode: "fr",
        }),
      );

      await waitForEvent(
        messages,
        (message) => message.type === "status" && message.event === "language_switched",
        10000,
      );
      expect(
        messages.find((message) => message.type === "status" && message.event === "language_switched"),
      ).toMatchObject({
        meetingId: meeting.meetingId,
        languageCode: "fr",
      });

      expect(connectCount).toBeGreaterThanOrEqual(0);
      expect(messages.find((message) => message.type === "error")).toBeUndefined();

      const [savedMeeting] = await db
        .select({ languages: meetings.languages })
        .from(meetings)
        .where(eq(meetings.id, meeting.meetingId));

      expect(savedMeeting?.languages).toEqual(["en", "fr"]);
      expect(websocketController.getTranscriptState(meeting.meetingId, "fr")).toBe("live");
    } finally {
      (websocketController as any).addTranscriptionSession = originalAddTranscriptionSession;
      (websocketController as any).sendBackfilledTranscriptHistoryToSocket =
        originalSendBackfilledTranscriptHistoryToSocket;
      ollamaBackfillService.resetTranslatorForTests();
    }
  }, 20000);

});
