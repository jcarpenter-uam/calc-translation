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
  targetLanguage: string;
  transcriptionText: string;
  translationText: string | null;
  isFinal: boolean;
  startedAtMs: number | null;
  endedAtMs: number | null;
  speaker: string | null;
  sourceLanguage: string | null;
}

export type TranscriptionSessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "paused"
  | "finishing"
  | "finished"
  | "disconnected"
  | "error";

/**
 * Lifecycle signal emitted when the underlying Soniox transport changes state.
 */
export interface TranscriptionSessionLifecycleEvent {
  type: "connected" | "disconnected" | "finished" | "error";
  meetingId: string;
  targetLanguage: string;
  state: TranscriptionSessionState;
  error?: unknown;
  reason?: string;
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

/**
 * Reassembles the text returned by Soniox token streams.
 */
function joinTokenText(tokens: SonioxToken[]) {
  return tokens.map((token) => token.text || "").join("").trim();
}

/**
 * Splits mixed Soniox token streams into transcription and translation text.
 */
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
    transcriptionText: transcriptionText || translationText || "",
    sourceLanguage:
      translationTokens.find((token) => token.source_language)?.source_language ||
      transcriptionTokens.find((token) => token.source_language)?.source_language ||
      null,
  };
}

/**
 * Normalizes Soniox speaker labels into stable client-facing strings.
 */
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
  getState: () => TranscriptionSessionState;
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
    onLifecycleEvent?: (event: TranscriptionSessionLifecycleEvent) => void,
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
    let state: TranscriptionSessionState = "idle";

    const emitLifecycleEvent = (
      event: Omit<TranscriptionSessionLifecycleEvent, "meetingId" | "targetLanguage" | "state">,
    ) => {
      onLifecycleEvent?.({
        ...event,
        meetingId,
        targetLanguage,
        state,
      });
    };

    const utteranceBuffer = new RealtimeUtteranceBuffer();

    session.on("error", (error: any) => {
      state = "error";
      logger.error("Soniox session error.", { meetingId, targetLanguage, error });
      emitLifecycleEvent({ type: "error", error });
    });

    session.on("connected", () => {
      state = "connected";
      emitLifecycleEvent({ type: "connected" });
    });

    session.on("disconnected", (reason?: string) => {
      state = "disconnected";
      logger.warn("Soniox session disconnected.", {
        meetingId,
        targetLanguage,
        reason,
      });
      emitLifecycleEvent({ type: "disconnected", reason });
    });

    session.on("result", (result: any) => {
      utteranceBuffer.addResult(result);

      if (!result || !result.tokens) return;

      const { transcriptionText, translationText, sourceLanguage } =
        splitTranscriptTexts(result.tokens as SonioxToken[]);

      if (transcriptionText || translationText) {
        onTranscriptionReady({
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
      state = "finished";
      logger.debug(
        `Soniox session stream finished flushing for meeting ${meetingId} (${targetLanguage})`,
      );
      const utterance = utteranceBuffer.markEndpoint();
      if (utterance) {
        onTranscriptionReady(this.buildFinalEvent(utterance, targetLanguage));
      }

      emitLifecycleEvent({ type: "finished" });
    });

    return {
      connect: async () => {
        state = "connecting";
        logger.info("Connecting Soniox session.", { meetingId, targetLanguage });
        await session.connect();
      },
      sendAudio: (chunk: Buffer) => session.sendAudio(chunk),
      pause: () => {
        state = "paused";
        logger.debug("Pausing Soniox session.", { meetingId, targetLanguage });
        session.pause();
      },
      resume: () => {
        state = "connected";
        logger.debug("Resuming Soniox session.", { meetingId, targetLanguage });
        session.resume();
      },
      finish: async () => {
        state = "finishing";
        logger.info("Finishing Soniox session.", { meetingId, targetLanguage });
        await session.finish();
      },
      getState: () => state,
    };
  }

  private buildFinalEvent(utterance: any, targetLanguage: string): TranscriptionEvent {
    const tokens = Array.isArray(utterance?.tokens) ? utterance.tokens : [];
    const { transcriptionText, translationText, sourceLanguage } =
      splitTranscriptTexts(tokens as SonioxToken[]);

    return {
      targetLanguage,
      transcriptionText,
      translationText,
      isFinal: true,
      startedAtMs: null,
      endedAtMs: null,
      speaker: this.normalizeSpeaker(
        utterance?.speaker ?? utterance?.speaker_label,
      ),
      sourceLanguage,
    };
  }

  /**
   * Normalizes speaker labels emitted by Soniox and fallback token metadata.
   */
  private normalizeSpeaker(value: unknown) {
    return normalizeSpeakerLabel(value);
  }
}

/**
 * Shared transcription service instance.
 */
export const transcriptionService = new SonioxTranscriptionService();
export { normalizeSpeakerLabel, splitTranscriptTexts };
