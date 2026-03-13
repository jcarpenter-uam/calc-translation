import { SonioxNodeClient } from "@soniox/node";
import { env } from "../core/config";
import { logger } from "../core/logger";

// Define an interface so the controller doesn't depend on Soniox types
export interface TranscriptionSession {
  connect: () => Promise<void>;
  sendAudio: (chunk: Buffer) => void;
  finish: () => Promise<void>;
}

class SonioxTranscriptionService {
  private client = new SonioxNodeClient({ apiKey: env.SONIOX_API_KEY });

  /**
   * Starts a new STT session and accepts a callback for when text is ready.
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
