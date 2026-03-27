import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { websocketController } from "../controllers/websocketController";
import {
  WS_URL,
  apiFetch,
  cleanupTestUsers,
  createMeeting,
  createTestUser,
  endMeeting,
  waitForEvent,
} from "./utils/testHelpers";

describe("Transcript language isolation integration", () => {
  let host: any;
  let attendeeEs: any;
  const activeSockets: WebSocket[] = [];
  const createdMeetings: { id: string; hostToken: string }[] = [];

  beforeAll(async () => {
    host = await createTestUser("host-language-isolation-int", "Host User", "en");
    attendeeEs = await createTestUser(
      "attendee-language-isolation-int-es",
      "Spanish Attendee",
      "es",
    );
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

  it("only sends english transcripts to a live english host websocket", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Language Isolation Host Integration Test",
      method: "one_way",
      languages: ["en", "es"],
    });
    createdMeetings.push({ id: meeting.meetingId, hostToken: host.token });

    const hostJoin = await apiFetch(`/meeting/join/${meeting.readableId}`, host.token);
    const hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoin.token}`);
    activeSockets.push(hostWs);

    const hostMessages: any[] = [];
    hostWs.onmessage = (event) => {
      hostMessages.push(JSON.parse(event.data.toString()));
    };

    await new Promise<void>((resolve) => {
      hostWs.onopen = () => {
        hostWs.send(
          JSON.stringify({ action: "subscribe_meeting", meetingId: meeting.meetingId }),
        );
        resolve();
      };
    });

    await waitForEvent(
      hostMessages,
      (message) => message.status === `Subscribed to ${meeting.meetingId}`,
      10000,
    );

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

    await (websocketController as any).handleTranscriptionEvent(meeting.meetingId, {
      text: "Hola a todos",
      targetLanguage: "es",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
      isFinal: true,
      startedAtMs: 1000,
      endedAtMs: 2000,
      speaker: null,
      sourceLanguage: "en",
    });

    await waitForEvent(
      hostMessages,
      (message) => message.type === "transcription" && message.language === "en",
      10000,
    );

    const hostTranscriptLanguages = hostMessages
      .filter((message) => message.type === "transcription")
      .map((message) => message.language);

    expect(hostTranscriptLanguages.length).toBeGreaterThan(0);
    expect(hostTranscriptLanguages.every((language) => language === "en")).toBe(true);
  }, 15000);

  it("only sends spanish transcripts to a live spanish attendee websocket", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Language Isolation Attendee Integration Test",
      method: "one_way",
      languages: ["en", "es"],
    });
    createdMeetings.push({ id: meeting.meetingId, hostToken: host.token });

    await apiFetch(`/meeting/join/${meeting.readableId}`, host.token);
    const attendeeJoin = await apiFetch(
      `/meeting/join/${meeting.readableId}`,
      attendeeEs.token,
    );

    const attendeeWs = new WebSocket(`${WS_URL}?ticket=${attendeeJoin.token}`);
    activeSockets.push(attendeeWs);

    const attendeeMessages: any[] = [];
    attendeeWs.onmessage = (event) => {
      attendeeMessages.push(JSON.parse(event.data.toString()));
    };

    await new Promise<void>((resolve) => {
      attendeeWs.onopen = () => {
        attendeeWs.send(
          JSON.stringify({ action: "subscribe_meeting", meetingId: meeting.meetingId }),
        );
        resolve();
      };
    });

    await waitForEvent(
      attendeeMessages,
      (message) => message.status === `Subscribed to ${meeting.meetingId}`,
      10000,
    );

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

    await (websocketController as any).handleTranscriptionEvent(meeting.meetingId, {
      text: "Hola a todos",
      targetLanguage: "es",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
      isFinal: true,
      startedAtMs: 1000,
      endedAtMs: 2000,
      speaker: null,
      sourceLanguage: "en",
    });

    await waitForEvent(
      attendeeMessages,
      (message) => message.type === "transcription" && message.language === "es",
      10000,
    );

    const attendeeTranscriptLanguages = attendeeMessages
      .filter((message) => message.type === "transcription")
      .map((message) => message.language);

    expect(attendeeTranscriptLanguages.length).toBeGreaterThan(0);
    expect(attendeeTranscriptLanguages.every((language) => language === "es")).toBe(true);
  }, 15000);
});
