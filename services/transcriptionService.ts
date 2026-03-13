import { SonioxNodeClient } from "@soniox/node";
import { env } from "../core/config";
import { logger } from "../core/logger";

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
   * @param onTranscriptionReady - Callback triggered when transcribed text is received.
   * @returns An abstracted TranscriptionSession object to control the stream.
   */
  createSession(
    meetingId: string,
    onTranscriptionReady: (text: string) => void,
  ): TranscriptionSession {
    const session = this.client.realtime.stt({
      model: "stt-rt-v4",
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      num_channels: 1,
      enable_endpoint_detection: true,
    });

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
        onTranscriptionReady(text);
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
