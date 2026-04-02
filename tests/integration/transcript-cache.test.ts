import { afterEach, describe, expect, it } from "bun:test";
import { meetingTranscriptCacheService } from "../../services/meetingTranscriptCacheService";
import { websocketController } from "../../controllers/websocketController";

describe("Meeting transcript cache", () => {
  afterEach(async () => {
    await meetingTranscriptCacheService.clearMeetingHistory("history-test-meeting");
    await meetingTranscriptCacheService.removeTranscriptArtifacts("history-test-meeting");
  });

  it("replays cached utterances for the subscriber language", async () => {
    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId: "history-test-meeting",
      language: "en",
      transcriptionText: "Hello there",
      startedAtMs: 120,
      endedAtMs: 980,
      speaker: null,
    });

    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId: "history-test-meeting",
      language: "es",
      transcriptionText: "Hola",
      startedAtMs: 1000,
      endedAtMs: 1600,
      speaker: null,
    });

    const sentPayloads: any[] = [];
    const fakeSocket = {
      id: "history-socket",
      data: {
        wsUser: {
          languageCode: "en",
        },
      },
      send(payload: string) {
        sentPayloads.push(JSON.parse(payload));
      },
    } as any;

    await websocketController.sendTranscriptHistoryToSocket(
      "history-test-meeting",
      fakeSocket,
    );

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({
      type: "transcription",
      language: "en",
      transcriptionText: "Hello there",
      translationText: null,
      isFinal: true,
      isHistory: true,
      startedAtMs: 120,
      endedAtMs: 980,
    });
  });

  it("preserves meeting-relative timestamps across meeting languages", async () => {
    const first = await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId: "history-test-meeting",
      language: "en",
      transcriptionText: "First line",
      startedAtMs: 0,
      endedAtMs: 1200,
      speaker: null,
    });

    const second = await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId: "history-test-meeting",
      language: "es",
      transcriptionText: "Segunda linea",
      startedAtMs: 100,
      endedAtMs: 1300,
      speaker: null,
    });

    expect(first.startedAtMs).toBe(0);
    expect(second.startedAtMs).toBe(100);

    const englishHistory = await meetingTranscriptCacheService.getLanguageHistory(
      "history-test-meeting",
      "en",
    );
    const spanishHistory = await meetingTranscriptCacheService.getLanguageHistory(
      "history-test-meeting",
      "es",
    );

    expect(englishHistory[0]?.startedAtMs).toBe(0);
    expect(spanishHistory[0]?.startedAtMs).toBe(100);
  });

  it("writes per-language VTT files and clears cached history", async () => {
    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId: "history-test-meeting",
      language: "en",
      transcriptionText: "First line",
      startedAtMs: 0,
      endedAtMs: 1200,
      speaker: "Speaker 1",
    });

    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId: "history-test-meeting",
      language: "en",
      transcriptionText: "Second line",
      startedAtMs: 1400,
      endedAtMs: 2400,
      speaker: null,
    });

    const outputPaths = await meetingTranscriptCacheService.flushMeetingToVtt(
      "history-test-meeting",
    );

    expect(outputPaths).toHaveLength(1);

    const outputPath = meetingTranscriptCacheService.getTranscriptOutputPath(
      "history-test-meeting",
      "en",
    );
    const vttContent = await Bun.file(outputPath).text();

    expect(vttContent).toContain("WEBVTT");
    expect(vttContent).toContain("1\n00:00:00.000 --> 00:00:01.200");
    expect(vttContent).toContain("00:00:00.000 --> 00:00:01.200");
    expect(vttContent).toContain("Speaker 1: First line");
    expect(vttContent).toContain("2\n00:00:01.400 --> 00:00:02.400");
    expect(vttContent).toContain("Second line");
    expect(vttContent).not.toContain("Translated:");
  
    const history = await meetingTranscriptCacheService.getLanguageHistory(
      "history-test-meeting",
      "en",
    );
    expect(history).toHaveLength(0);
  });
});
