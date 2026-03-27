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

    // Give the websocket route one extra tick to finish subscription side effects before the test
    // injects transcript events.
    await new Promise((resolve) => setTimeout(resolve, 50));

    return { ws, messages };
  }

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
    const { messages: hostMessages } = await connectMeetingSocket(
      hostJoin.token,
      meeting.meetingId,
    );

    // Inject finalized transcript events directly so the test focuses on websocket fan-out rules.
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
      .filter((message: any) => message.type === "transcription")
      .map((message: any) => message.language);

    expect(hostTranscriptLanguages.length).toBeGreaterThan(0);
    expect(hostTranscriptLanguages.every((language: any) => language === "en")).toBe(true);
  }, 15000);

  it("only sends spanish transcripts to a live spanish attendee websocket", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Language Isolation Attendee Integration Test",
      method: "one_way",
      languages: ["en", "es"],
    });
    createdMeetings.push({ id: meeting.meetingId, hostToken: host.token });

    const hostJoin = await apiFetch(`/meeting/join/${meeting.readableId}`, host.token);
    await connectMeetingSocket(hostJoin.token, meeting.meetingId);

    const attendeeJoin = await apiFetch(
      `/meeting/join/${meeting.readableId}`,
      attendeeEs.token,
    );

    const { messages: attendeeMessages } = await connectMeetingSocket(
      attendeeJoin.token,
      meeting.meetingId,
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
      .filter((message: any) => message.type === "transcription")
      .map((message: any) => message.language);

    expect(attendeeTranscriptLanguages.length).toBeGreaterThan(0);
    expect(attendeeTranscriptLanguages.every((language: any) => language === "es")).toBe(true);
  }, 15000);
});
