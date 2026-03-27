import { SonioxNodeClient, RealtimeUtteranceBuffer } from "@soniox/node";
import { env } from "../core/config";
import { logger } from "../core/logger";

/**
 * Configuration options for a transcription session.
 */
export interface TranscriptionConfig {
  enableSpeakerDiarization?: boolean;
  languageHints?: string[];
  translation?:
    | { type: "one_way"; target_language: string }
    | { type: "two_way"; language_a: string; language_b: string };
}

/**
 * Normalized transcription event passed from Soniox to the websocket layer.
 */
export interface TranscriptionEvent {
  text: string;
  targetLanguage: string;
  transcriptionText: string | null;
  translationText: string | null;
  isFinal: boolean;
  startedAtMs: number | null;
  endedAtMs: number | null;
  speaker: string | null;
  sourceLanguage: string | null;
}

type SonioxToken = {
  text?: string;
  is_final?: boolean;
  start_ms?: number;
  end_ms?: number;
  speaker?: string;
  translation_status?: "none" | "original" | "translation";
  source_language?: string;
};

function joinTokenText(tokens: SonioxToken[]) {
  return tokens.map((token) => token.text || "").join("").trim();
}

function splitTranscriptTexts(tokens: SonioxToken[]) {
  const translationTokens = tokens.filter(
    (token) => token.translation_status === "translation",
  );
  const transcriptionTokens = tokens.filter(
    (token) => token.translation_status !== "translation",
  );

  const translationText = joinTokenText(translationTokens);
  const transcriptionText = joinTokenText(transcriptionTokens);

  return {
    translationText: translationText || null,
    transcriptionText: transcriptionText || null,
    displayText: translationText || transcriptionText,
    sourceLanguage:
      translationTokens.find((token) => token.source_language)?.source_language ||
      transcriptionTokens.find((token) => token.source_language)?.source_language ||
      null,
  };
}

function normalizeSpeakerLabel(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return /^\d+$/.test(trimmed) ? `Speaker: ${trimmed}` : trimmed;
}

/**
 * An abstracted interface for a real-time transcription session.
 */
export interface TranscriptionSession {
  connect: () => Promise<void>;
  sendAudio: (chunk: Buffer) => void;
  pause: () => void;
  resume: () => void;
  finish: () => Promise<void>;
}

/**
 * Service responsible for managing connections and interactions with the Soniox API.
 */
class SonioxTranscriptionService {
  private client = new SonioxNodeClient({ api_key: env.SONIOX_API_KEY });

  /**
   * Creates a realtime Soniox session bound to a meeting.
   */
  createSession(
    meetingId: string,
    config: TranscriptionConfig,
    onTranscriptionReady: (event: TranscriptionEvent) => void,
  ): TranscriptionSession {
    const targetLanguage =
      config.translation?.type === "one_way"
        ? config.translation.target_language
        : config.translation?.type === "two_way"
          ? "two_way"
          : "original";

    logger.debug("Configuring Soniox session.", {
      meetingId,
      targetLanguage,
    });

    const sttConfig: any = {
      model: "stt-rt-v4",
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      num_channels: 1,
      enable_endpoint_detection: true,
    };

    if (config.enableSpeakerDiarization !== undefined) {
      sttConfig.enable_speaker_diarization = config.enableSpeakerDiarization;
    }

    if (config.languageHints && config.languageHints.length > 0) {
      sttConfig.language_hints = config.languageHints;
    }

    if (config.translation) {
      sttConfig.translation = config.translation;
    }

    const session = this.client.realtime.stt(sttConfig);

    const utteranceBuffer = new RealtimeUtteranceBuffer();

    session.on("error", (error: any) => {
      logger.error("Soniox session error.", { meetingId, targetLanguage, error });
    });

    session.on("disconnected", (reason?: string) => {
      logger.warn("Soniox session disconnected.", {
        meetingId,
        targetLanguage,
        reason,
      });
    });

    session.on("result", (result: any) => {
      utteranceBuffer.addResult(result);

      if (!result || !result.tokens) return;

      const { displayText, transcriptionText, translationText, sourceLanguage } =
        splitTranscriptTexts(result.tokens as SonioxToken[]);

      if (displayText) {
        onTranscriptionReady({
          text: displayText,
          targetLanguage,
          transcriptionText,
          translationText,
          isFinal: false,
          startedAtMs: null,
          endedAtMs: null,
          speaker: null,
          sourceLanguage,
        });
      }
    });

    session.on("endpoint", () => {
      const utterance = utteranceBuffer.markEndpoint();
      if (utterance) {
        onTranscriptionReady(this.buildFinalEvent(utterance, targetLanguage));
      }
    });

    session.on("finished", () => {
      logger.debug(
        `Soniox session stream finished flushing for meeting ${meetingId} (${targetLanguage})`,
      );
      const utterance = utteranceBuffer.markEndpoint();
      if (utterance) {
        onTranscriptionReady(this.buildFinalEvent(utterance, targetLanguage));
      }
    });

    return {
      connect: async () => {
        logger.info("Connecting Soniox session.", { meetingId, targetLanguage });
        await session.connect();
      },
      sendAudio: (chunk: Buffer) => session.sendAudio(chunk),
      pause: () => {
        logger.debug("Pausing Soniox session.", { meetingId, targetLanguage });
        session.pause();
      },
      resume: () => {
        logger.debug("Resuming Soniox session.", { meetingId, targetLanguage });
        session.resume();
      },
      finish: async () => {
        logger.info("Finishing Soniox session.", { meetingId, targetLanguage });
        await session.finish();
      },
    };
  }

  private buildFinalEvent(utterance: any, targetLanguage: string): TranscriptionEvent {
    const tokens = Array.isArray(utterance?.tokens) ? utterance.tokens : [];
    const { displayText, transcriptionText, translationText, sourceLanguage } =
      splitTranscriptTexts(tokens as SonioxToken[]);
    const firstTokenWithStart = tokens.find((token: any) => token?.start_ms != null);
    const lastTokenWithEnd = [...tokens]
      .reverse()
      .find((token: any) => token?.end_ms != null);

    return {
      text: displayText,
      targetLanguage,
      transcriptionText,
      translationText,
      isFinal: true,
      startedAtMs: this.normalizeMs(
        utterance?.start_ms ?? utterance?.startMs ?? firstTokenWithStart?.start_ms,
      ),
      endedAtMs: this.normalizeMs(
        utterance?.end_ms ?? utterance?.endMs ?? lastTokenWithEnd?.end_ms,
      ),
      speaker: this.normalizeSpeaker(
        utterance?.speaker ?? utterance?.speaker_label ?? firstTokenWithStart?.speaker,
      ),
      sourceLanguage,
    };
  }

  private normalizeMs(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private normalizeSpeaker(value: unknown) {
    return normalizeSpeakerLabel(value);
  }
}

/**
 * Shared transcription service instance.
 */
export const transcriptionService = new SonioxTranscriptionService();
export { normalizeSpeakerLabel, splitTranscriptTexts };
