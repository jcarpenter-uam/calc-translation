import { afterEach, describe, expect, it } from "bun:test";
import { meetingCanonicalTranscriptService } from "../../services/meetingCanonicalTranscriptService";

describe("Canonical meeting transcript history", () => {
  afterEach(async () => {
    await meetingCanonicalTranscriptService.clearMeetingHistory("canonical-history-test");
  });

  it("reuses the same utterance order for translated variants of one spoken utterance", async () => {
    const english = await meetingCanonicalTranscriptService.registerUtterance({
      meetingId: "canonical-history-test",
      text: "Hello everyone",
      language: "en",
      transcriptionText: "Hello everyone",
      translationText: null,
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });

    const spanish = await meetingCanonicalTranscriptService.registerUtterance({
      meetingId: "canonical-history-test",
      text: "Hola a todos",
      language: "es",
      transcriptionText: "Hello everyone",
      translationText: "Hola a todos",
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });

    expect(english.utteranceOrder).toBe(1);
    expect(spanish.utteranceOrder).toBe(1);

    const history = await meetingCanonicalTranscriptService.getMeetingHistory(
      "canonical-history-test",
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      utteranceOrder: 1,
      sourceText: "Hello everyone",
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
    });
  });

  it("allocates a new order for a distinct spoken utterance", async () => {
    await meetingCanonicalTranscriptService.registerUtterance({
      meetingId: "canonical-history-test",
      text: "Hello everyone",
      language: "en",
      transcriptionText: "Hello everyone",
      translationText: null,
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
    });

    const second = await meetingCanonicalTranscriptService.registerUtterance({
      meetingId: "canonical-history-test",
      text: "How are you?",
      language: "en",
      transcriptionText: "How are you?",
      translationText: null,
      sourceLanguage: "en",
      startedAtMs: 1200,
      endedAtMs: 2200,
      speaker: null,
    });

    expect(second.utteranceOrder).toBe(2);
  });
});
