import { describe, expect, it } from "bun:test";
import {
  hasTranslatedTranscriptContent,
  renderTranscriptItem,
  type TranscriptItem,
} from "../../clients/packages/app/src/meetings/transcriptDisplay";

function buildTranscriptItem(overrides: Partial<TranscriptItem> = {}): TranscriptItem {
  return {
    id: "item-1",
    language: "es",
    speaker: null,
    isFinal: true,
    transcriptionText: "Hello everyone",
    translationText: "Hola a todos",
    sourceLanguage: "en",
    ...overrides,
  };
}

describe("transcript display helpers", () => {
  it("detects when an utterance includes translated content", () => {
    expect(hasTranslatedTranscriptContent(buildTranscriptItem())).toBe(true);
    expect(
      hasTranslatedTranscriptContent(
        buildTranscriptItem({ translationText: "Hello everyone" }),
      ),
    ).toBe(false);
    expect(
      hasTranslatedTranscriptContent(buildTranscriptItem({ translationText: null })),
    ).toBe(false);
  });

  it("renders translated-only mode by default", () => {
    expect(renderTranscriptItem(buildTranscriptItem(), "translated_only")).toEqual({
      id: "item-1",
      language: "es",
      speaker: null,
      isFinal: true,
      primaryText: "Hola a todos",
      secondaryText: null,
    });
  });

  it("renders transcribed-only mode with fallback to translation", () => {
    expect(renderTranscriptItem(buildTranscriptItem(), "transcribed_only")).toMatchObject({
      primaryText: "Hello everyone",
      secondaryText: null,
    });

    expect(
      renderTranscriptItem(
        buildTranscriptItem({ transcriptionText: null, translationText: "Hola a todos" }),
        "transcribed_only",
      ),
    ).toMatchObject({
      primaryText: "Hola a todos",
      secondaryText: null,
    });
  });

  it("renders both mode with the transcription as a secondary line", () => {
    expect(renderTranscriptItem(buildTranscriptItem(), "both")).toMatchObject({
      primaryText: "Hola a todos",
      secondaryText: "Hello everyone",
    });

    expect(
      renderTranscriptItem(
        buildTranscriptItem({ translationText: "Hello everyone" }),
        "both",
      ),
    ).toMatchObject({
      primaryText: "Hello everyone",
      secondaryText: null,
    });
  });

  it("renders two-way transcripts for source-language viewers with transcription first", () => {
    expect(
      renderTranscriptItem(
        buildTranscriptItem({ language: "two_way" }),
        "translated_only",
        "en",
      ),
    ).toMatchObject({
      primaryText: "Hello everyone",
      secondaryText: "Hola a todos",
    });
  });

  it("renders two-way transcripts for other viewers with translation first", () => {
    expect(
      renderTranscriptItem(
        buildTranscriptItem({ language: "two_way" }),
        "transcribed_only",
        "es",
      ),
    ).toMatchObject({
      primaryText: "Hola a todos",
      secondaryText: "Hello everyone",
    });

    expect(
      renderTranscriptItem(
        buildTranscriptItem({ language: "two_way", sourceLanguage: null }),
        "both",
        null,
      ),
    ).toMatchObject({
      primaryText: "Hola a todos",
      secondaryText: "Hello everyone",
    });
  });
});
