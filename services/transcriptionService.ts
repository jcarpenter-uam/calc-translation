import { SonioxNodeClient } from "@soniox/node";
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
 * This ensures consuming controllers do not depend on provider-specific types.
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

  /**
   * Starts a new STT (Speech-to-Text) session, configures audio parameters,
   * and sets up event listeners for incoming transcriptions.
   *
   * @param meetingId - The internal database ID of the associated meeting.
   * @param config - Options for translation, diarization, and language hints.
   * @param onTranscriptionReady - Callback triggered when transcribed text is received.
   * @returns An abstracted TranscriptionSession object to control the stream.
   */
  createSession(
    meetingId: string,
    config: TranscriptionConfig,
    onTranscriptionReady: (text: string, targetLanguage: string) => void,
  ): TranscriptionSession {
    // Determine what language this specific session is outputting
    const targetLanguage =
      config.translation?.type === "one_way"
        ? config.translation.target_language
        : config.translation?.type === "two_way"
          ? "two_way"
          : "original";

    // Construct the base configuration with required PCM audio settings
    const sttConfig: any = {
      model: "stt-rt-v4",
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      num_channels: 1,
      enable_endpoint_detection: true,
    };

    // Dynamically apply optional client configuration parameters
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

    session.on("error", (error: any) => {
      logger.error(`Soniox session error [${meetingId}]:`, error);
    });

    session.on("close", () => {
      logger.warn(`Soniox session closed [${meetingId}]`);
    });

    // Parse the Soniox-specific token structure and pass pure text to the callback
    session.on("result", (result: any) => {
      const text = result.tokens.map((t: any) => t.text).join("");
      if (text) {
        onTranscriptionReady(text, targetLanguage);
      }
    });

    // Return generic methods that the controller can safely use
    return {
      connect: async () => await session.connect(),
      sendAudio: (chunk: Buffer) => session.sendAudio(chunk),
      finish: async () => await session.finish(),
    };
  }
}

// Export a singleton instance
export const transcriptionService = new SonioxTranscriptionService();
