import { SonioxNodeClient } from "@soniox/node";
import type { ElysiaWS } from "elysia/ws";
import { env } from "../core/config";
import { logger } from "../core/logger";

interface Participant {
  id: string;
  socket: ElysiaWS<any, any, any>;
}

interface Meeting {
  id: string;
  participants: Map<string, Participant>;
  sonioxSession: any;
}

export class WebsocketController {
  // Master record of all active meetings and their Soniox sessions
  private meetings = new Map<string, Meeting>();

  // Track global connections by their stable string ID (`ws.id`).
  // We use the string ID instead of the `ws` object directly because Elysia
  // wraps WebSockets in a Proxy, and the object reference can sometimes change
  // between the `open`, `message`, and `close` events, causing memory leaks or missed lookups.
  private globalSubscribers = new Map<string, ElysiaWS<any, any, any>>();

  // A lookup table to quickly find which meeting a specific socket ID belongs to.
  // This is critical for routing incoming raw audio bytes to the correct Soniox session.
  private socketToMeeting = new Map<string, string>();

  private sonioxClient = new SonioxNodeClient({ apiKey: env.SONIOX_API_KEY });

  // --- State Management ---
  createMeeting(meetingId: string) {
    if (this.meetings.size >= 100) {
      throw new Error("Maximum concurrent Soniox connections reached.");
    }

    // Initialize a new real-time connection to Soniox.
    // We explicitly define the PCM audio formats here so Soniox knows
    // exactly how to decode the raw bytes we send it later.
    const session = this.sonioxClient.realtime.stt({
      model: "stt-rt-v4",
      audio_format: "pcm_s16le", // 16-bit little-endian PCM
      sample_rate: 16000, // 16kHz
      num_channels: 1, // Mono audio
      enable_endpoint_detection: true, // Let Soniox tell us when a sentence ends
    });

    // Catch asynchronous API/Connection errors from Soniox
    session.on("error", (error: any) => {
      logger.error(`Soniox session error [${meetingId}]:`, error);
    });

    // Log when the session closes so you know exactly when a stream dies
    session.on("close", () => {
      logger.warn(`Soniox session closed [${meetingId}]`);
    });

    // Listen for transcription tokens streaming back from Soniox
    session.on("result", (result: any) => {
      // Combine the individual word tokens into a single string
      const text = result.tokens.map((t: any) => t.text).join("");
      if (!text) return;

      // Package it into a JSON string and broadcast it to everyone in this meeting
      const payload = JSON.stringify({
        type: "transcription",
        meetingId,
        text,
      });
      this.broadcastToMeeting(meetingId, payload);
    });

    // Store the meeting in memory so participants can join it
    this.meetings.set(meetingId, {
      id: meetingId,
      participants: new Map(),
      sonioxSession: session,
    });

    return session;
  }

  // --- Subscription & Audio Logic ---

  addGlobalSubscriber(ws: ElysiaWS<any, any, any>) {
    this.globalSubscribers.set(ws.id, ws);
  }

  getMeeting(id: string) {
    return this.meetings.get(id);
  }

  joinMeeting(
    meetingId: string,
    participantId: string,
    ws: ElysiaWS<any, any, any>,
  ) {
    const meeting = this.meetings.get(meetingId);
    if (meeting) {
      // Add the user to the meeting's participant list
      meeting.participants.set(participantId, {
        id: participantId,
        socket: ws,
      });
      // Map their specific WebSocket ID to this meeting so we know where to route their audio
      this.socketToMeeting.set(ws.id, meetingId);
    }
  }

  handleAudio(wsId: string, audioChunk: Buffer) {
    // Look up which meeting this socket belongs to
    const meetingId = this.socketToMeeting.get(wsId);

    if (!meetingId) {
      logger.error(
        `Audio dropped: Socket ${wsId} is not mapped to an active meeting.`,
      );
      return;
    }

    const meeting = this.meetings.get(meetingId);
    if (meeting && meeting.sonioxSession) {
      try {
        // Relay the raw audio bytes directly to this meeting's active Soniox session
        meeting.sonioxSession.sendAudio(audioChunk);
      } catch (err) {
        logger.error("Error sending audio to Soniox:", err);
      }
    }
  }

  removeSubscriber(ws: ElysiaWS<any, any, any>) {
    // Clean up memory when a user disconnects or closes their browser
    this.globalSubscribers.delete(ws.id);
    this.socketToMeeting.delete(ws.id);

    // Remove them from any meetings they were a part of
    this.meetings.forEach((m) => {
      m.participants.forEach((p, id) => {
        if (p.socket.id === ws.id) m.participants.delete(id);
      });
    });
  }

  deleteMeeting(id: string) {
    const meeting = this.meetings.get(id);

    if (meeting) {
      const disconnectMsg = JSON.stringify({
        type: "status",
        message: `Meeting ${id} has been ended by the host.`,
      });

      // Notify all participants that the meeting is over
      meeting.participants.forEach((p) => {
        try {
          p.socket.send(disconnectMsg);
        } catch (e) {} // Ignore errors if the socket is already dead
      });

      // Completely remove the meeting from memory
      this.meetings.delete(id);
    }
  }

  private broadcastToMeeting(meetingId: string, data: any) {
    // Send data (like transcriptions) only to users in a specific meeting
    this.meetings
      .get(meetingId)
      ?.participants.forEach((p) => p.socket.send(data));
  }

  private broadcastGlobal(data: any) {
    this.globalSubscribers.forEach((ws) => ws.send(data));
  }
}

export const websocketController = new WebsocketController();
