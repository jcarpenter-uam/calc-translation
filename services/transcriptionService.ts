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

    let activeSentenceFinalTokens = "";

    session.on("result", (result: any) => {
      utteranceBuffer.addResult(result);

      if (!result || !result.tokens) return;

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

    session.on("endpoint", () => {
      const utterance = utteranceBuffer.markEndpoint();
      if (utterance) {
        onTranscriptionReady(utterance.text, targetLanguage, true);
        activeSentenceFinalTokens = "";
      }
    });

    session.on("finished", () => {
      logger.debug(
        `Soniox session stream finished flushing for meeting ${meetingId} (${targetLanguage})`,
      );
      const utterance = utteranceBuffer.markEndpoint();
      if (utterance) {
        onTranscriptionReady(utterance.text, targetLanguage, true);
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
}

/**
 * Shared transcription service instance.
 */
export const transcriptionService = new SonioxTranscriptionService();
