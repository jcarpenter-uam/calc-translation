import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { websocketController } from "../../controllers/websocketController";
import {
  WS_URL,
  apiFetch,
  cleanupTestUsers,
  createMeeting,
  createTestUser,
  endMeeting,
  waitForEvent,
} from "../setup/utils/testHelpers";

describe("Transcript language isolation integration", () => {
  let host: any;
  let attendeeEn: any;
  let attendeeEs: any;
  const activeSockets: WebSocket[] = [];
  const createdMeetings: { id: string; hostToken: string }[] = [];

  beforeAll(async () => {
    host = await createTestUser("host-language-isolation-int", "Host User", "en");
    attendeeEn = await createTestUser(
      "attendee-language-isolation-int-en",
      "English Attendee",
      "en",
    );
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
    await new Promise((resolve) => setTimeout(resolve, 250));

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

  it("only sends english transcripts to a live english attendee websocket", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Language Isolation Host Integration Test",
      method: "one_way",
      languages: ["en", "es"],
    });
    createdMeetings.push({ id: meeting.meetingId, hostToken: host.token });

    const attendeeJoin = await apiFetch(
      `/meeting/join/${meeting.readableId}`,
      attendeeEn.token,
    );
    const { messages: attendeeMessages } = await connectMeetingSocket(
      attendeeJoin.token,
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
      attendeeMessages,
      (message) => message.type === "transcription" && message.language === "en",
      10000,
    );

    const attendeeTranscriptLanguages = attendeeMessages
      .filter((message: any) => message.type === "transcription")
      .map((message: any) => message.language);

    expect(attendeeTranscriptLanguages.length).toBeGreaterThan(0);
    expect(attendeeTranscriptLanguages.every((language: any) => language === "en")).toBe(true);
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

  it("broadcasts two-way transcripts to all live viewers", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Language Isolation Two-Way Integration Test",
      method: "two_way",
      languages: ["en", "es"],
    });
    createdMeetings.push({ id: meeting.meetingId, hostToken: host.token });

    const attendeeEnJoin = await apiFetch(
      `/meeting/join/${meeting.readableId}`,
      attendeeEn.token,
    );
    const { messages: attendeeEnMessages } = await connectMeetingSocket(
      attendeeEnJoin.token,
      meeting.meetingId,
    );

    const attendeeJoin = await apiFetch(
      `/meeting/join/${meeting.readableId}`,
      attendeeEs.token,
    );
    const { messages: attendeeMessages } = await connectMeetingSocket(
      attendeeJoin.token,
      meeting.meetingId,
    );

    await (websocketController as any).handleTranscriptionEvent(meeting.meetingId, {
      text: "Hola a todos",
      targetLanguage: "two_way",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
      isFinal: true,
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
      sourceLanguage: "en",
    });

    await waitForEvent(
      attendeeEnMessages,
      (message) => message.type === "transcription" && message.language === "two_way",
      10000,
    );
    await waitForEvent(
      attendeeMessages,
      (message) => message.type === "transcription" && message.language === "two_way",
      10000,
    );

    expect(
      attendeeEnMessages.find((message: any) => message.type === "transcription"),
    ).toMatchObject({
      language: "two_way",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
      sourceLanguage: "en",
    });
    expect(
      attendeeMessages.find((message: any) => message.type === "transcription"),
    ).toMatchObject({
      language: "two_way",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
      sourceLanguage: "en",
    });
  }, 15000);

  it("replays two-way transcript history with both languages to late joiners", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Language Isolation Two-Way History Integration Test",
      method: "two_way",
      languages: ["en", "es"],
    });
    createdMeetings.push({ id: meeting.meetingId, hostToken: host.token });

    await (websocketController as any).handleTranscriptionEvent(meeting.meetingId, {
      text: "Hola a todos",
      targetLanguage: "two_way",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
      isFinal: true,
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
      sourceLanguage: "en",
    });

    const attendeeJoin = await apiFetch(
      `/meeting/join/${meeting.readableId}`,
      attendeeEs.token,
    );
    const { messages: attendeeMessages } = await connectMeetingSocket(
      attendeeJoin.token,
      meeting.meetingId,
    );

    await waitForEvent(
      attendeeMessages,
      (message) =>
        message.type === "transcription" &&
        message.language === "two_way" &&
        message.isHistory === true,
      10000,
    );

    expect(
      attendeeMessages.find(
        (message: any) =>
          message.type === "transcription" &&
          message.language === "two_way" &&
          message.isHistory === true,
      ),
    ).toMatchObject({
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
      sourceLanguage: "en",
    });
  }, 15000);
});
