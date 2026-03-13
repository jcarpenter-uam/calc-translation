import type { ElysiaWS } from "elysia/ws";
import { logger } from "../core/logger";
import {
  transcriptionService,
  type TranscriptionSession,
  type TranscriptionConfig,
} from "../services/transcriptionService";

/**
 * Represents a single user connected via WebSocket.
 */
interface Participant {
  id: string;
  socket: ElysiaWS<any, any, any>;
}

/**
 * Represents an active meeting, including its participants and the active audio session.
 */
interface Meeting {
  id: string;
  participants: Map<string, Participant>;
  audioSessions: Map<string, TranscriptionSession>;
}

/**
 * Manages WebSocket connections, routes raw audio to transcription services,
 * and broadcasts text results back to connected clients.
 */
export class WebsocketController {
  // Master record of all active meetings and their audio sessions.
  private meetings = new Map<string, Meeting>();

  // Tracks global connections by their stable string ID (`ws.id`).
  private globalSubscribers = new Map<string, ElysiaWS<any, any, any>>();

  // Maps a specific socket ID to a meeting ID for O(1) audio routing lookups.
  private socketToMeeting = new Map<string, string>();

  /**
   * Sets up the meeting container in memory without starting any audio sessions.
   */
  initMeeting(meetingId: string) {
    if (!this.meetings.has(meetingId)) {
      this.meetings.set(meetingId, {
        id: meetingId,
        participants: new Map(),
        audioSessions: new Map(),
      });
    }
  }

  /**
   * Adds a new dedicated Soniox session to an active meeting.
   */
  addTranscriptionSession(
    meetingId: string,
    languageKey: string,
    config: TranscriptionConfig,
  ) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) return null;

    // Prevent duplicate sessions for the same language
    if (meeting.audioSessions.has(languageKey)) {
      return meeting.audioSessions.get(languageKey);
    }

    const session = transcriptionService.createSession(
      meetingId,
      config,
      (text, language) => {
        const payload = JSON.stringify({
          type: "transcription",
          meetingId,
          language, // Tag the payload so the frontend knows who to show this to
          text,
        });
        this.broadcastToMeeting(meetingId, payload);
      },
    );

    meeting.audioSessions.set(languageKey, session);
    return session;
  }

  /**
   * Registers a WebSocket connection globally.
   *
   * @param ws - The active Elysia WebSocket instance.
   */
  addGlobalSubscriber(ws: ElysiaWS<any, any, any>) {
    this.globalSubscribers.set(ws.id, ws);
  }

  /**
   * Retrieves an active meeting by its ID.
   *
   * @param id - The internal database ID of the meeting.
   * @returns The meeting object, or undefined if not found.
   */
  getMeeting(id: string) {
    return this.meetings.get(id);
  }

  /**
   * Subscribes a user's WebSocket connection to a specific meeting.
   *
   * @param meetingId - The internal database ID of the meeting to join.
   * @param participantId - The unique ID of the joining user.
   * @param ws - The active Elysia WebSocket instance.
   */
  joinMeeting(
    meetingId: string,
    participantId: string,
    ws: ElysiaWS<any, any, any>,
  ) {
    const meeting = this.meetings.get(meetingId);
    if (meeting) {
      meeting.participants.set(participantId, {
        id: participantId,
        socket: ws,
      });
      this.socketToMeeting.set(ws.id, meetingId);
    }
  }

  /**
   * Routes a chunk of raw audio from a WebSocket client to the correct transcription session.
   *
   * @param wsId - The stable string ID of the originating WebSocket.
   * @param audioChunk - The raw PCM audio bytes.
   */
  handleAudio(wsId: string, audioChunk: Buffer) {
    const meetingId = this.socketToMeeting.get(wsId);

    if (!meetingId) {
      logger.error(
        `Audio dropped: Socket ${wsId} is not mapped to an active meeting.`,
      );
      return;
    }

    const meeting = this.meetings.get(meetingId);
    if (meeting) {
      // Fan-out the raw microphone audio to ALL active language sessions
      meeting.audioSessions.forEach((session) => {
        try {
          session.sendAudio(audioChunk);
        } catch (err) {
          logger.error("Error sending audio to transcription service:", err);
        }
      });
    }
  }

  /**
   * Cleans up memory when a user disconnects, removing them from global tracking
   * and any active meetings.
   *
   * @param ws - The disconnecting Elysia WebSocket instance.
   */
  removeSubscriber(ws: ElysiaWS<any, any, any>) {
    this.globalSubscribers.delete(ws.id);
    this.socketToMeeting.delete(ws.id);

    this.meetings.forEach((m) => {
      m.participants.forEach((p, id) => {
        if (p.socket.id === ws.id) m.participants.delete(id);
      });
    });
  }

  /**
   * Ends a meeting, notifies all participants, closes the audio session,
   * and completely removes the meeting from memory.
   *
   * @param id - The internal database ID of the meeting to end.
   */
  deleteMeeting(id: string) {
    const meeting = this.meetings.get(id);

    if (meeting) {
      const disconnectMsg = JSON.stringify({
        type: "status",
        message: `Meeting ${id} ended.`,
      });

      meeting.participants.forEach((p) => {
        try {
          p.socket.send(disconnectMsg);
        } catch (e) {}
      });

      // Finish ALL active audio sessions
      meeting.audioSessions.forEach((session) => {
        session
          .finish()
          .catch((err) =>
            logger.error(`Error finishing audio session for ${id}:`, err),
          );
      });

      this.meetings.delete(id);
    }
  }

  /**
   * Broadcasts a JSON string payload to all participants within a specific meeting.
   *
   * @param meetingId - The internal database ID of the target meeting.
   * @param data - The JSON string payload to send.
   */
  private broadcastToMeeting(meetingId: string, data: any) {
    this.meetings
      .get(meetingId)
      ?.participants.forEach((p) => p.socket.send(data));
  }

  /**
   * Broadcasts a JSON string payload to all connected WebSockets globally.
   *
   * @param data - The JSON string payload to send.
   */
  private broadcastGlobal(data: any) {
    this.globalSubscribers.forEach((ws) => ws.send(data));
  }
}

export const websocketController = new WebsocketController();
