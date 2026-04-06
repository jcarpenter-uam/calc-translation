import { afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { websocketController } from "../../controllers/websocketController";
import { db } from "../../core/database";
import { meetings } from "../../models/meetingModel";
import { meetingTranscriptCacheService } from "../../services/meetingTranscriptCacheService";
import { meetingArtifactEmailService } from "../../services/meetingArtifactEmailService";
import { ollamaBackfillService } from "../../services/ollamaBackfillService";
import { ollamaSummaryService } from "../../services/ollamaSummaryService";
import { createTestUser } from "../setup/utils/testHelpers";

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

function createFakeAudioSession(languageKey: string, transcriptState: "backfilling" | "backfill_failed" | "live" = "live") {
  return {
    languageKey,
    config: {
      enableSpeakerDiarization: true,
      translation: { type: "one_way" as const, target_language: languageKey },
    },
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
    state: "connected" as const,
    transcriptState,
    shouldResume: true,
    isReconnecting: false,
    currentUtteranceStartedAtMs: null,
    currentUtteranceLastSeenAtMs: null,
  };
}

describe("Transcript language isolation", () => {
  afterEach(async () => {
    await meetingTranscriptCacheService.clearMeetingHistory("language-isolation-meeting");
    await meetingTranscriptCacheService.removeTranscriptArtifacts("language-isolation-meeting");
    await websocketController.deleteMeeting("language-isolation-meeting");
    await db.delete(meetings).where(eq(meetings.topic, "Language Isolation Meeting"));
    ollamaBackfillService.resetTranslatorForTests();
    ollamaSummaryService.resetSummarizerForTests();
    meetingArtifactEmailService.resetMailerForTests();
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

  it("stores finalized live variants per language in transcript cache", async () => {
    websocketController.initMeeting("language-isolation-meeting", "host-en");

    const host = createFakeSocket("host-en", "en");
    const attendeeEs = createFakeSocket("attendee-es", "es");

    websocketController.joinMeeting("language-isolation-meeting", "host-en", host.socket);
    websocketController.joinMeeting(
      "language-isolation-meeting",
      "attendee-es",
      attendeeEs.socket,
    );

    await (websocketController as any).handleTranscriptionEvent(
      "language-isolation-meeting",
      {
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
        targetLanguage: "es",
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
      utteranceId: expect.any(String),
      startedAtMs: 0,
      endedAtMs: 1000,
    });
    expect(
      attendeeEs.sentMessages.find((message) => message.type === "transcription"),
    ).toMatchObject({
      utteranceId: expect.any(String),
      startedAtMs: 0,
      endedAtMs: 1000,
    });

    const englishHistory = await meetingTranscriptCacheService.getLanguageHistory(
      "language-isolation-meeting",
      "en",
    );
    const spanishHistory = await meetingTranscriptCacheService.getLanguageHistory(
      "language-isolation-meeting",
      "es",
    );
    expect(englishHistory).toHaveLength(1);
    expect(spanishHistory).toHaveLength(1);
    expect(englishHistory[0]?.startedAtMs).toBe(0);
    expect(spanishHistory[0]?.startedAtMs).toBe(0);
  });

  it("detects when initial subscription should backfill missing language history", async () => {
    websocketController.initMeeting("language-isolation-meeting", "host-en");
    websocketController.getMeeting("language-isolation-meeting")?.audioSessions.set(
      "en",
      createFakeAudioSession("en"),
    );

    await (websocketController as any).handleTranscriptionEvent(
      "language-isolation-meeting",
      {
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

    expect(
      await websocketController.shouldBackfillTranscriptHistoryOnSubscribe(
        "language-isolation-meeting",
        "fr",
      ),
    ).toBe(true);

    expect(
      await websocketController.shouldBackfillTranscriptHistoryOnSubscribe(
        "language-isolation-meeting",
        "en",
      ),
    ).toBe(false);
  });

  it("marks transcript state live after backfill completes", async () => {
    websocketController.initMeeting("language-isolation-meeting", "host-en");

    const attendeeFr = createFakeSocket("attendee-fr", "fr");
    websocketController.joinMeeting(
      "language-isolation-meeting",
      "attendee-fr",
      attendeeFr.socket,
    );

    const meeting = websocketController.getMeeting("language-isolation-meeting");
    meeting?.audioSessions.set("en", createFakeAudioSession("en"));
    meeting?.audioSessions.set("fr", createFakeAudioSession("fr", "backfilling"));

    await (websocketController as any).handleTranscriptionEvent(
      "language-isolation-meeting",
      {
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

    ollamaBackfillService.setTranslatorForTests({
      async translateBatch(_meetingId, targetLanguage, utterances) {
        return utterances.map((utterance) => ({
          transcriptionText: utterance.sourceText,
          translationText: `${targetLanguage}:${utterance.sourceText}`,
          sourceLanguage: utterance.sourceLanguage,
        }));
      },
    });

    await websocketController.sendBackfilledTranscriptHistoryToSocket(
      "language-isolation-meeting",
      attendeeFr.socket,
      "fr",
    );

    expect(websocketController.getTranscriptState("language-isolation-meeting", "fr")).toBe("live");
    expect(
      attendeeFr.sentMessages.some(
        (message) =>
          message.type === "transcription" &&
          message.language === "fr" &&
          message.isBackfilled === true,
      ),
    ).toBe(true);
  });

  it("marks transcript state backfill_failed when backfill errors", async () => {
    websocketController.initMeeting("language-isolation-meeting", "host-en");

    const attendeeFr = createFakeSocket("attendee-fr", "fr");
    websocketController.joinMeeting(
      "language-isolation-meeting",
      "attendee-fr",
      attendeeFr.socket,
    );

    const meeting = websocketController.getMeeting("language-isolation-meeting");
    meeting?.audioSessions.set("en", createFakeAudioSession("en"));
    meeting?.audioSessions.set("fr", createFakeAudioSession("fr", "backfilling"));

    await (websocketController as any).handleTranscriptionEvent(
      "language-isolation-meeting",
      {
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

    ollamaBackfillService.setTranslatorForTests({
      async translateBatch() {
        throw new Error("backfill exploded");
      },
    });

    await expect(
      websocketController.sendBackfilledTranscriptHistoryToSocket(
        "language-isolation-meeting",
        attendeeFr.socket,
        "fr",
      ),
    ).rejects.toThrow("backfill exploded");

    expect(websocketController.getTranscriptState("language-isolation-meeting", "fr")).toBe(
      "backfill_failed",
    );
  });

  it("selects the lowest-index live source language for backfill", async () => {
    const meetingId = crypto.randomUUID();
    websocketController.initMeeting(meetingId, "host-en");
    await db.insert(meetings).values({
      id: meetingId,
      readable_id: `readable-${meetingId}`,
      topic: "Language Isolation Meeting",
      attendees: [],
      spoken_languages: ["en"],
      viewer_languages: ["es", "en", "fr"],
      method: "one_way",
    });

    const attendeeFr = createFakeSocket("attendee-fr", "fr");
    websocketController.joinMeeting(meetingId, "attendee-fr", attendeeFr.socket);

    const meeting = websocketController.getMeeting(meetingId);
    meeting?.audioSessions.set("es", createFakeAudioSession("es"));
    meeting?.audioSessions.set("en", createFakeAudioSession("en"));
    meeting?.audioSessions.set("fr", createFakeAudioSession("fr", "backfilling"));

    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId,
      language: "es",
      transcriptionText: "Hola a todos",
      translationText: null,
      sourceLanguage: "es",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });
    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId,
      language: "en",
      transcriptionText: "Hello everyone",
      translationText: null,
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });

    ollamaBackfillService.setTranslatorForTests({
      async translateBatch(_meetingId, targetLanguage, utterances) {
        return utterances.map((utterance) => ({
          transcriptionText: utterance.sourceText,
          translationText: `${targetLanguage}:${utterance.sourceText}`,
          sourceLanguage: utterance.sourceLanguage,
        }));
      },
    });

    await websocketController.sendBackfilledTranscriptHistoryToSocket(
      meetingId,
      attendeeFr.socket,
      "fr",
    );

    const frenchHistory = await meetingTranscriptCacheService.getLanguageHistory(meetingId, "fr");
    expect(frenchHistory).toHaveLength(1);
    expect(frenchHistory[0]?.translationText).toBe("fr:Hola a todos");

    await websocketController.deleteMeeting(meetingId);
    await meetingTranscriptCacheService.clearMeetingHistory(meetingId);
    await db.delete(meetings).where(eq(meetings.id, meetingId));
  });

  it("persists finalized viewer languages from in-memory session state at meeting end", async () => {
    const meetingId = crypto.randomUUID();

    await db.insert(meetings).values({
      id: meetingId,
      readable_id: `readable-${meetingId}`,
      topic: "Persist Viewer Languages Meeting",
      attendees: [],
      spoken_languages: ["en"],
      viewer_languages: [],
      method: "one_way",
    });

    websocketController.initMeeting(meetingId, "host-en");
    const meeting = websocketController.getMeeting(meetingId);
    expect(meeting).toBeTruthy();

    meeting?.audioSessions.set("en", createFakeAudioSession("en"));
    meeting?.audioSessions.set("fr", createFakeAudioSession("fr"));
    (meeting as any)?.activatedViewerLanguages.add("en");
    (meeting as any)?.activatedViewerLanguages.add("fr");

    await websocketController.deleteMeeting(meetingId);

    const [savedMeeting] = await db
      .select({ viewer_languages: meetings.viewer_languages })
      .from(meetings)
      .where(eq(meetings.id, meetingId));

    expect(savedMeeting?.viewer_languages).toEqual(["en", "fr"]);

    await db.delete(meetings).where(eq(meetings.id, meetingId));
  });

  it("writes one-way meeting summaries for each activated viewer language", async () => {
    const meetingId = crypto.randomUUID();

    await db.insert(meetings).values({
      id: meetingId,
      readable_id: `readable-${meetingId}`,
      topic: "Language Isolation Meeting",
      attendees: [],
      spoken_languages: ["en"],
      viewer_languages: [],
      method: "one_way",
    });

    websocketController.initMeeting(meetingId, "host-en");
    const meeting = websocketController.getMeeting(meetingId);
    meeting?.audioSessions.set("en", createFakeAudioSession("en"));
    meeting?.audioSessions.set("fr", createFakeAudioSession("fr"));
    (meeting as any)?.activatedViewerLanguages.add("en");
    (meeting as any)?.activatedViewerLanguages.add("fr");

    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId,
      language: "en",
      transcriptionText: "Ship the feature next week.",
      translationText: null,
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });
    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId,
      language: "fr",
      transcriptionText: "Ship the feature next week.",
      translationText: "Livrer la fonctionnalite la semaine prochaine.",
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });

    ollamaSummaryService.setSummarizerForTests({
      async summarizeMeeting(request) {
        return `# Meeting Summary\n\n## Overview\n${request.targetLanguage} summary\n\n## Key Points\n- ${request.transcriptLanguage}\n\n## Action Items\n- none\n`;
      },
    });

    await websocketController.deleteMeeting(meetingId);

    const summaryLanguages = await meetingTranscriptCacheService.listSummaryLanguages(meetingId);
    expect(summaryLanguages).toEqual(["en", "fr"]);

    const englishSummary = await Bun.file(
      meetingTranscriptCacheService.getMeetingSummaryOutputPath(meetingId, "en"),
    ).text();
    const frenchSummary = await Bun.file(
      meetingTranscriptCacheService.getMeetingSummaryOutputPath(meetingId, "fr"),
    ).text();

    expect(englishSummary).toContain("en summary");
    expect(frenchSummary).toContain("fr summary");

    await meetingTranscriptCacheService.removeTranscriptArtifacts(meetingId);
    await db.delete(meetings).where(eq(meetings.id, meetingId));
  });

  it("writes two-way meeting summaries for each spoken language", async () => {
    const meetingId = crypto.randomUUID();

    await db.insert(meetings).values({
      id: meetingId,
      readable_id: `readable-${meetingId}`,
      topic: "Language Isolation Meeting",
      attendees: [],
      spoken_languages: ["en", "es"],
      viewer_languages: [],
      method: "two_way",
    });

    websocketController.initMeeting(meetingId, "host-en");
    const meeting = websocketController.getMeeting(meetingId);
    meeting?.audioSessions.set("two_way", {
      ...createFakeAudioSession("two_way"),
      config: {
        enableSpeakerDiarization: true,
        translation: { type: "two_way", language_a: "en", language_b: "es" },
      },
    } as any);

    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId,
      language: "two_way",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });

    ollamaSummaryService.setSummarizerForTests({
      async summarizeMeeting(request) {
        return `# Meeting Summary\n\n## Overview\n${request.targetLanguage} summary from ${request.transcriptLanguage}\n\n## Key Points\n- mixed transcript\n\n## Action Items\n- none\n`;
      },
    });

    await websocketController.deleteMeeting(meetingId);

    const summaryLanguages = await meetingTranscriptCacheService.listSummaryLanguages(meetingId);
    expect(summaryLanguages).toEqual(["en", "es"]);

    const englishSummary = await Bun.file(
      meetingTranscriptCacheService.getMeetingSummaryOutputPath(meetingId, "en"),
    ).text();
    const spanishSummary = await Bun.file(
      meetingTranscriptCacheService.getMeetingSummaryOutputPath(meetingId, "es"),
    ).text();

    expect(englishSummary).toContain("en summary from two_way");
    expect(spanishSummary).toContain("es summary from two_way");

    await meetingTranscriptCacheService.removeTranscriptArtifacts(meetingId);
    await db.delete(meetings).where(eq(meetings.id, meetingId));
  });

  it("emails the host and attendees their preferred-language summary and transcript", async () => {
    const host = await createTestUser("artifact-host", "Artifact Host", "en");
    const attendee = await createTestUser("artifact-attendee", "Artifact Attendee", "fr");
    const meetingId = crypto.randomUUID();
    const delivered: Array<{ to: string; subject: string; html: string; attachments?: any[] }> = [];

    await db.insert(meetings).values({
      id: meetingId,
      readable_id: `readable-${meetingId}`,
      topic: "Language Isolation Meeting",
      host_id: host.id,
      attendees: [attendee.id],
      spoken_languages: ["en"],
      viewer_languages: [],
      method: "one_way",
    });

    websocketController.initMeeting(meetingId, host.id);
    const liveHost = createFakeSocket(host.id, "en");
    const liveAttendee = createFakeSocket(attendee.id, "fr");
    websocketController.joinMeeting(meetingId, host.id, liveHost.socket);
    websocketController.joinMeeting(meetingId, attendee.id, liveAttendee.socket);

    const meeting = websocketController.getMeeting(meetingId);
    meeting?.audioSessions.set("en", createFakeAudioSession("en"));
    meeting?.audioSessions.set("fr", createFakeAudioSession("fr"));
    (meeting as any)?.activatedViewerLanguages.add("en");
    (meeting as any)?.activatedViewerLanguages.add("fr");

    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId,
      language: "en",
      transcriptionText: "Ship next week.",
      translationText: null,
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });
    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId,
      language: "fr",
      transcriptionText: "Ship next week.",
      translationText: "Livrer la semaine prochaine.",
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });

    ollamaSummaryService.setSummarizerForTests({
      async summarizeMeeting(request) {
        return `# Summary\n\n${request.targetLanguage} summary`;
      },
    });
    meetingArtifactEmailService.setMailerForTests({
      async sendMail(request) {
        delivered.push(request);
      },
    });

    await websocketController.deleteMeeting(meetingId);
    await meetingArtifactEmailService.awaitIdleForTests();

    expect(delivered).toHaveLength(2);
    expect(delivered.map((entry) => entry.to).sort()).toEqual([
      `${attendee.id}@test.com`,
      `${host.id}@test.com`,
    ]);
    expect(delivered[0]?.attachments?.[0]?.contentType).toBe("text/vtt");
    expect(delivered.some((entry) => entry.html.includes("en summary"))).toBe(true);
    expect(delivered.some((entry) => entry.html.includes("fr summary"))).toBe(true);

    await meetingTranscriptCacheService.removeTranscriptArtifacts(meetingId);
    await db.delete(meetings).where(eq(meetings.id, meetingId));
  });

  it("goes live without backfill when no live source language exists", async () => {
    websocketController.initMeeting("language-isolation-meeting", "host-en");

    const attendeeFr = createFakeSocket("attendee-fr", "fr");
    websocketController.joinMeeting(
      "language-isolation-meeting",
      "attendee-fr",
      attendeeFr.socket,
    );

    const meeting = websocketController.getMeeting("language-isolation-meeting");
    meeting?.audioSessions.set("fr", createFakeAudioSession("fr", "backfilling"));

    await websocketController.sendBackfilledTranscriptHistoryToSocket(
      "language-isolation-meeting",
      attendeeFr.socket,
      "fr",
    );

    expect(websocketController.getTranscriptState("language-isolation-meeting", "fr")).toBe("live");
    expect(attendeeFr.sentMessages.filter((message) => message.type === "transcription")).toHaveLength(0);
  });

  it("skips duplicate backfill writes when live target history catches up first", async () => {
    websocketController.initMeeting("language-isolation-meeting", "host-en");

    const attendeeFr = createFakeSocket("attendee-fr", "fr");
    websocketController.joinMeeting(
      "language-isolation-meeting",
      "attendee-fr",
      attendeeFr.socket,
    );

    const meeting = websocketController.getMeeting("language-isolation-meeting");
    meeting?.audioSessions.set("en", createFakeAudioSession("en"));
    meeting?.audioSessions.set("fr", createFakeAudioSession("fr", "backfilling"));

    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId: "language-isolation-meeting",
      language: "en",
      transcriptionText: "Hello everyone",
      translationText: null,
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });

    ollamaBackfillService.setTranslatorForTests({
      async translateBatch() {
        await meetingTranscriptCacheService.appendFinalUtterance({
          meetingId: "language-isolation-meeting",
          language: "fr",
          transcriptionText: "Hello everyone",
          translationText: "fr:Hello everyone",
          sourceLanguage: "en",
          startedAtMs: 0,
          endedAtMs: 1000,
          speaker: null,
        });

        return [
          {
            transcriptionText: "Hello everyone",
            translationText: "fr:Hello everyone",
            sourceLanguage: "en",
          },
        ];
      },
    });

    await websocketController.sendBackfilledTranscriptHistoryToSocket(
      "language-isolation-meeting",
      attendeeFr.socket,
      "fr",
    );

    const frenchHistory = await meetingTranscriptCacheService.getLanguageHistory(
      "language-isolation-meeting",
      "fr",
    );
    expect(frenchHistory).toHaveLength(1);
    expect(frenchHistory[0]?.translationText).toBe("fr:Hello everyone");
  });

});
