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
 * An abstracted interface for a real-time transcription session.
 */
export interface TranscriptionSession {
  connect: () => Promise<void>;
  sendAudio: (chunk: Buffer) => void;
  finish: () => Promise<void>;
}

/**
 * Service responsible for managing connections and interactions with the Soniox API.
 */
class SonioxTranscriptionService {
  private client = new SonioxNodeClient({ apiKey: env.SONIOX_API_KEY });

  createSession(
    meetingId: string,
    config: TranscriptionConfig,
    onTranscriptionReady: (
      text: string,
      targetLanguage: string,
      isFinal: boolean,
    ) => void,
  ): TranscriptionSession {
    const targetLanguage =
      config.translation?.type === "one_way"
        ? config.translation.target_language
        : config.translation?.type === "two_way"
          ? "two_way"
          : "original";

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

    // Instantiate the official Soniox Utterance Buffer
    const utteranceBuffer = new RealtimeUtteranceBuffer();

    session.on("error", (error: any) => {
      logger.error(`Soniox session error [${meetingId}]:`, error);
    });

    session.on("close", () => {
      logger.warn(`Soniox session closed [${meetingId}]`);
    });

    let activeSentenceFinalTokens = "";

    session.on("result", (result: any) => {
      // Feed the SDK buffer so it can track the official state
      utteranceBuffer.addResult(result);

      if (!result || !result.tokens) return;

      // Track the live intermediate state for the UI's real-time typing effect
      const finalTokens = result.tokens
        .filter((t: any) => t.is_final)
        .map((t: any) => t.text)
        .join("");
      activeSentenceFinalTokens += finalTokens;

      const nonFinalTokens = result.tokens
        .filter((t: any) => !t.is_final)
        .map((t: any) => t.text)
        .join("");

      const currentText = activeSentenceFinalTokens + nonFinalTokens;
      if (currentText) {
        onTranscriptionReady(currentText, targetLanguage, false);
      }
    });

    // Use the SDK's built-in endpoint flusher for clean sentence boundaries
    session.on("endpoint", () => {
      const utterance = utteranceBuffer.markEndpoint();
      if (utterance) {
        onTranscriptionReady(utterance.text, targetLanguage, true);
        activeSentenceFinalTokens = ""; // Reset our live tracker for the next sentence
      }
    });

    // Flush any remaining tokens when the host ends the stream
    session.on("finished", () => {
      const utterance = utteranceBuffer.markEndpoint();
      if (utterance) {
        onTranscriptionReady(utterance.text, targetLanguage, true);
      }
    });

    return {
      connect: async () => await session.connect(),
      sendAudio: (chunk: Buffer) => session.sendAudio(chunk),
      finish: async () => await session.finish(),
    };
  }
}

export const transcriptionService = new SonioxTranscriptionService();
