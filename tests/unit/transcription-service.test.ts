import { describe, expect, it } from "bun:test";
import {
  normalizeSpeakerLabel,
  splitTranscriptTexts,
} from "../../services/transcriptionService";

describe("Soniox transcript splitting", () => {
  it("separates original transcription from translated text", () => {
    const result = splitTranscriptTexts([
      {
        text: "Extra text.",
        translation_status: "original",
        source_language: "en",
      },
      {
        text: " 追加のテキストです。",
        translation_status: "translation",
        source_language: "en",
      },
    ]);

    expect(result.transcriptionText).toBe("Extra text.");
    expect(result.translationText).toBe("追加のテキストです。");
    expect(result.displayText).toBe("追加のテキストです。");
    expect(result.sourceLanguage).toBe("en");
  });

  it("falls back to transcription text when no translated tokens exist", () => {
    const result = splitTranscriptTexts([
      {
        text: "Only transcription",
        translation_status: "original",
        source_language: "en",
      },
    ]);

    expect(result.transcriptionText).toBe("Only transcription");
    expect(result.translationText).toBeNull();
    expect(result.displayText).toBe("Only transcription");
    expect(result.sourceLanguage).toBe("en");
  });
});

describe("speaker normalization", () => {
  it("formats Soniox diarization labels for display", () => {
    expect(normalizeSpeakerLabel("1")).toBe("Speaker: 1");
    expect(normalizeSpeakerLabel(" 42 ")).toBe("Speaker: 42");
  });

  it("preserves non-diarization speaker labels", () => {
    expect(normalizeSpeakerLabel("Jane Doe")).toBe("Jane Doe");
    expect(normalizeSpeakerLabel("Speaker 1")).toBe("Speaker 1");
  });

  it("returns null for empty or invalid values", () => {
    expect(normalizeSpeakerLabel("   ")).toBeNull();
    expect(normalizeSpeakerLabel(null)).toBeNull();
  });
});
