import { afterEach, describe, expect, it } from "bun:test";
import { websocketController } from "../../controllers/websocketController";
import { meetingTranscriptCacheService } from "../../services/meetingTranscriptCacheService";

/**
 * Builds a lightweight websocket double that records outgoing messages by participant language.
 */
function createFakeSocket(id: string, languageCode: string | null) {
  const sentMessages: any[] = [];

  return {
    socket: {
      id,
      data: {
        wsUser: {
          id,
          email: `${id}@test.com`,
          name: id,
          role: "user",
          languageCode,
        },
      },
      send(payload: string) {
        sentMessages.push(JSON.parse(payload));
      },
    } as any,
    sentMessages,
  };
}

describe("Transcript language isolation", () => {
  afterEach(async () => {
    await meetingTranscriptCacheService.clearMeetingHistory("language-isolation-meeting");
    await meetingTranscriptCacheService.removeTranscriptArtifacts("language-isolation-meeting");
    await websocketController.deleteMeeting("language-isolation-meeting");
  });

  it("sends one-way transcripts only to matching-language participants", async () => {
    websocketController.initMeeting("language-isolation-meeting", "host-en");

    const host = createFakeSocket("host-en", "en");
    const attendeeZh = createFakeSocket("attendee-zh", "zh");
    const attendeeNoLanguage = createFakeSocket("attendee-none", null);

    websocketController.joinMeeting("language-isolation-meeting", "host-en", host.socket);
    websocketController.joinMeeting(
      "language-isolation-meeting",
      "attendee-zh",
      attendeeZh.socket,
    );
    websocketController.joinMeeting(
      "language-isolation-meeting",
      "attendee-none",
      attendeeNoLanguage.socket,
    );

    // Feed one finalized utterance per language so delivery can be asserted independently.
    await (websocketController as any).handleTranscriptionEvent(
      "language-isolation-meeting",
      {
        text: "Hello everyone",
        targetLanguage: "en",
        transcriptionText: "Hello everyone",
        translationText: null,
        isFinal: true,
        startedAtMs: 0,
        endedAtMs: 1000,
        speaker: null,
        sourceLanguage: "en",
      },
    );

    await (websocketController as any).handleTranscriptionEvent(
      "language-isolation-meeting",
      {
        text: "Ni hao",
        targetLanguage: "zh",
        transcriptionText: "Hello everyone",
        translationText: "Ni hao",
        isFinal: true,
        startedAtMs: 1000,
        endedAtMs: 2000,
        speaker: null,
        sourceLanguage: "en",
      },
    );

    const hostTranscriptLanguages = host.sentMessages
      .filter((message) => message.type === "transcription")
      .map((message) => message.language);
    const attendeeTranscriptLanguages = attendeeZh.sentMessages
      .filter((message) => message.type === "transcription")
      .map((message) => message.language);
    const noLanguageTranscriptCount = attendeeNoLanguage.sentMessages.filter(
      (message) => message.type === "transcription",
    ).length;

    expect(hostTranscriptLanguages).toEqual(["en"]);
    expect(attendeeTranscriptLanguages).toEqual(["zh"]);
    expect(noLanguageTranscriptCount).toBe(0);
    expect(host.sentMessages.find((message) => message.type === "transcription")).toMatchObject({
      transcriptionText: "Hello everyone",
      translationText: null,
      sourceLanguage: "en",
    });
    expect(
      attendeeZh.sentMessages.find((message) => message.type === "transcription"),
    ).toMatchObject({
      text: "Ni hao",
      transcriptionText: "Hello everyone",
      translationText: "Ni hao",
      sourceLanguage: "en",
    });
  });

  it("broadcasts two-way transcripts to all connected participants", async () => {
    websocketController.initMeeting("language-isolation-meeting", "host-en");

    const host = createFakeSocket("host-en", "en");
    const attendeeEs = createFakeSocket("attendee-es", "es");
    const attendeeNoLanguage = createFakeSocket("attendee-none", null);

    websocketController.joinMeeting("language-isolation-meeting", "host-en", host.socket);
    websocketController.joinMeeting(
      "language-isolation-meeting",
      "attendee-es",
      attendeeEs.socket,
    );
    websocketController.joinMeeting(
      "language-isolation-meeting",
      "attendee-none",
      attendeeNoLanguage.socket,
    );

    await (websocketController as any).handleTranscriptionEvent(
      "language-isolation-meeting",
      {
        text: "Hola a todos",
        targetLanguage: "two_way",
        transcriptionText: "Hello everyone",
        translationText: "Hola a todos",
        isFinal: true,
        startedAtMs: 0,
        endedAtMs: 1000,
        speaker: null,
        sourceLanguage: "en",
      },
    );

    expect(host.sentMessages.find((message) => message.type === "transcription")).toMatchObject({
      language: "two_way",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
    });
    expect(
      attendeeEs.sentMessages.find((message) => message.type === "transcription"),
    ).toMatchObject({
      language: "two_way",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
    });
    expect(
      attendeeNoLanguage.sentMessages.find((message) => message.type === "transcription"),
    ).toMatchObject({
      language: "two_way",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
    });
  });
});
