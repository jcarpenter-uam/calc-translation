import type { ElysiaWS } from "elysia/ws";
import { logger } from "../core/logger";
import {
  transcriptionService,
  type TranscriptionSession,
  type TranscriptionConfig,
} from "../services/transcriptionService";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import { eq } from "drizzle-orm";

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
  hostId: string | null;
  participants: Map<string, Participant>;
  audioSessions: Map<string, TranscriptionSession>;
  hostTimeout?: ReturnType<typeof setTimeout>;
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
  initMeeting(meetingId: string, hostId?: string) {
    if (!this.meetings.has(meetingId)) {
      this.meetings.set(meetingId, {
        id: meetingId,
        hostId: hostId || null,
        participants: new Map(),
        audioSessions: new Map(),
      });
    } else if (hostId) {
      // Ensure hostId is attached if it was lazily created earlier
      const meeting = this.meetings.get(meetingId)!;
      if (!meeting.hostId) meeting.hostId = hostId;
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
      (text, language, isFinal) => {
        const payload = JSON.stringify({
          type: "transcription",
          meetingId,
          language, // Tag the payload so the frontend knows who to show this to
          text,
          isFinal,
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
    this.initMeeting(meetingId);

    const meeting = this.meetings.get(meetingId);
    if (meeting) {
      // Host reconnect logic
      if (meeting.hostId === participantId && meeting.hostTimeout) {
        clearTimeout(meeting.hostTimeout);
        meeting.hostTimeout = undefined;

        // Resume all active transcription streams
        meeting.audioSessions.forEach((session) => session.resume());

        logger.info(
          `Host reconnected to meeting ${meetingId}. Sessions resumed.`,
        );
        this.broadcastToMeeting(
          meetingId,
          JSON.stringify({
            type: "status",
            event: "host_reconnected",
            message: "Host reconnected. Resuming audio...",
          }),
        );
      }

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
    const meetingId = this.socketToMeeting.get(ws.id);
    this.socketToMeeting.delete(ws.id);

    if (meetingId) {
      const meeting = this.meetings.get(meetingId);
      if (meeting) {
        let disconnectedParticipantId: string | null = null;

        meeting.participants.forEach((p, id) => {
          if (p.socket.id === ws.id) {
            disconnectedParticipantId = id;
            meeting.participants.delete(id);
          }
        });

        // Host reconnection logic
        if (
          disconnectedParticipantId &&
          disconnectedParticipantId === meeting.hostId
        ) {
          logger.warn(
            `Host ${meeting.hostId} disconnected from meeting ${meetingId}. Pausing sessions...`,
          );

          // Pause all active Soniox sessions
          meeting.audioSessions.forEach((session) => session.pause());

          // Notify other participants
          this.broadcastToMeeting(
            meetingId,
            JSON.stringify({
              type: "status",
              event: "host_disconnected",
              message:
                "Host disconnected. Meeting will end in 60 seconds if they do not return.",
            }),
          );

          // Set the timeout to forcefully end the meeting
          meeting.hostTimeout = setTimeout(async () => {
            logger.info(
              `Host timeout reached for meeting ${meetingId}. Ending meeting.`,
            );

            try {
              // Mark the meeting as ended in the DB
              await db
                .update(meetings)
                .set({ ended_at: new Date() })
                .where(eq(meetings.id, meetingId));
            } catch (err) {
              logger.error(
                `Error updating meeting status in DB for ${meetingId}`,
                err,
              );
            }

            // Cleanup memory and kick everyone out
            this.deleteMeeting(meetingId);
          }, 60000); // 60 seconds
        }
      }
    }
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
  public broadcastToMeeting(meetingId: string, data: any) {
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
