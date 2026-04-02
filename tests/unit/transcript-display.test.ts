import { describe, expect, it } from "bun:test";
import {
  hasTranslatedTranscriptContent,
  renderTranscriptItem,
  type TranscriptItem,
  upsertTranscriptItem,
} from "../../clients/packages/app/src/meetings/transcriptDisplay";

function buildTranscriptItem(overrides: Partial<TranscriptItem> = {}): TranscriptItem {
  return {
    id: "item-1",
    startedAtMs: 0,
    endedAtMs: 1000,
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
      startedAtMs: 0,
      endedAtMs: 1000,
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

  it("upserts finalized transcript items by meeting timestamps", () => {
    const current = [
      buildTranscriptItem({
        id: "draft-1",
        startedAtMs: null,
        endedAtMs: null,
        isFinal: false,
        transcriptionText: "Hello every",
        translationText: "Hola a to",
      }),
      buildTranscriptItem({
        id: "item-3",
        startedAtMs: 3000,
        endedAtMs: 4000,
        translationText: "Tercera linea",
      }),
    ];

    const next = upsertTranscriptItem(
      current,
      buildTranscriptItem({
        id: "item-2",
        startedAtMs: 2000,
        endedAtMs: 3000,
        isFinal: true,
      }),
    );

    expect(next.map((item) => item.startedAtMs)).toEqual([2000, 3000]);
    expect(next[0]).toMatchObject({
      id: "item-2",
      startedAtMs: 2000,
      isFinal: true,
    });
  });

  it("replaces an existing utterance when the same timestamps are replayed", () => {
    const current = [
      buildTranscriptItem({
        id: "item-8",
        startedAtMs: 8000,
        endedAtMs: 9000,
        translationText: "Hola inicial",
      }),
    ];

    const next = upsertTranscriptItem(
      current,
      buildTranscriptItem({
        id: "item-8-replayed",
        startedAtMs: 8000,
        endedAtMs: 9000,
        translationText: "Hola final",
      }),
    );

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "item-8-replayed",
      startedAtMs: 8000,
      translationText: "Hola final",
    });
  });

  it("keeps partial transcript updates on a single line", () => {
    const current = [
      buildTranscriptItem({
        id: "partial-1",
        startedAtMs: 4000,
        endedAtMs: 4200,
        isFinal: false,
        transcriptionText: "Hello ev",
        translationText: "Hola a",
      }),
    ];

    const next = upsertTranscriptItem(
      current,
      buildTranscriptItem({
        id: "partial-2",
        startedAtMs: 4000,
        endedAtMs: 4400,
        isFinal: false,
        transcriptionText: "Hello everyone",
        translationText: "Hola a todos",
      }),
    );

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "partial-2",
      isFinal: false,
      transcriptionText: "Hello everyone",
    });
  });
});
