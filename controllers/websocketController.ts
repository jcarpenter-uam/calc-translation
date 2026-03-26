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
  name: string | null;
  email: string;
  role: string | null;
  languageCode: string | null;
  socket: ElysiaWS;
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
  hostAudioIdleTimeout?: ReturnType<typeof setTimeout>;
  isHostSendingAudio: boolean;
}

function getUniqueMeetingLanguages(languages: unknown): string[] {
  if (!Array.isArray(languages)) {
    return [];
  }

  return Array.from(
    new Set(
      languages
        .filter((language): language is string => typeof language === "string")
        .map((language) => language.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * Manages WebSocket connections, routes raw audio to transcription services,
 * and broadcasts text results back to connected clients.
 */
export class WebsocketController {
  private meetings = new Map<string, Meeting>();

  private globalSubscribers = new Map<string, ElysiaWS>();

  private socketToMeeting = new Map<string, string>();

  /**
   * Sets up the meeting container in memory without starting any audio sessions.
   */
  initMeeting(meetingId: string, hostId?: string) {
    if (!this.meetings.has(meetingId)) {
      logger.debug("Initializing meeting container in memory.", { meetingId });
      this.meetings.set(meetingId, {
        id: meetingId,
        hostId: hostId || null,
        participants: new Map(),
        audioSessions: new Map(),
        isHostSendingAudio: false,
      });
    } else if (hostId) {
      const meeting = this.meetings.get(meetingId)!;
      if (!meeting.hostId) {
        logger.debug("Attaching host to existing meeting container.", {
          hostId,
          meetingId,
        });
        meeting.hostId = hostId;
      }
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
    if (!meeting) {
      logger.warn("Attempted to add session to missing meeting.", { meetingId });
      return null;
    }

    if (meeting.audioSessions.has(languageKey)) {
      logger.debug("Transcription session already exists.", {
        meetingId,
        languageKey,
      });
      return meeting.audioSessions.get(languageKey);
    }

    logger.debug("Creating transcription session.", {
      meetingId,
      languageKey,
    });

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
  addGlobalSubscriber(ws: ElysiaWS) {
    this.globalSubscribers.set(ws.id, ws);
    logger.debug("Global WebSocket subscriber added.", { socketId: ws.id });
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
    ws: ElysiaWS,
  ) {
    this.initMeeting(meetingId);

    const meeting = this.meetings.get(meetingId);
    const wsUser = (ws.data as any)?.wsUser;
    const userEmail = wsUser?.email || participantId;
    const userName = wsUser?.name || null;
    const userRole = wsUser?.role || null;
    const userLanguageCode = wsUser?.languageCode || null;

    if (meeting) {
      if (meeting.hostId === participantId && meeting.hostTimeout) {
        clearTimeout(meeting.hostTimeout);
        meeting.hostTimeout = undefined;

        logger.info("Host reconnected to meeting websocket.", {
          userId: participantId,
          userEmail,
          meetingId,
        });

        this.broadcastToMeeting(
          meetingId,
          JSON.stringify({
            type: "status",
            event: "host_reconnected",
            message: "Host reconnected. Audio will resume when microphone streaming starts.",
          }),
        );
      }

      meeting.participants.set(participantId, {
        id: participantId,
        name: userName,
        email: userEmail,
        role: userRole,
        languageCode: userLanguageCode,
        socket: ws,
      });

      this.socketToMeeting.set(ws.id, meetingId);
      logger.info("User subscribed to meeting websocket stream.", {
        userId: participantId,
        userEmail,
        meetingId,
      });

      this.broadcastToMeeting(
        meetingId,
        JSON.stringify({
          type: "presence",
          event: "participant_joined",
          meetingId,
          participant: {
            id: participantId,
            name: userName,
            email: userEmail,
            role: userRole,
            languageCode: userLanguageCode,
            isConnected: true,
          },
          connectedCount: meeting.participants.size,
        }),
      );
    }
  }

  /**
   * Returns a presence snapshot for a meeting's active websocket connections.
   */
  getMeetingPresenceSnapshot(meetingId: string) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      return {
        participants: [],
        connectedCount: 0,
      };
    }

    const participants = Array.from(meeting.participants.values()).map(
      (participant) => ({
        id: participant.id,
        name: participant.name,
        email: participant.email,
        role: participant.role,
        languageCode: participant.languageCode,
        isConnected: true,
      }),
    );

    return {
      participants,
      connectedCount: meeting.participants.size,
    };
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
      logger.debug(
        `Audio dropped: Socket ${wsId} is not mapped to an active meeting.`,
      );
      return;
    }

    const meeting = this.meetings.get(meetingId);
    if (meeting) {
      const sender = Array.from(meeting.participants.values()).find(
        (participant) => participant.socket.id === wsId,
      );

      if (sender?.id === meeting.hostId && !meeting.isHostSendingAudio) {
        this.resumeHostAudio(meetingId, false);
      } else if (sender?.id === meeting.hostId) {
        this.refreshHostAudioIdleTimeout(meetingId);
      }

      meeting.audioSessions.forEach((session) => {
        try {
          session.sendAudio(audioChunk);
        } catch (err) {
          logger.error("Error sending audio to transcription service.", {
            meetingId,
            err,
          });
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
  removeSubscriber(ws: ElysiaWS) {
    this.globalSubscribers.delete(ws.id);
    const meetingId = this.socketToMeeting.get(ws.id);
    this.socketToMeeting.delete(ws.id);

    if (meetingId) {
      const meeting = this.meetings.get(meetingId);
      if (meeting) {
        let disconnectedParticipantId: string | null = null;
        let disconnectedParticipantEmail = "unknown_user";

        meeting.participants.forEach((p, id) => {
          if (p.socket.id === ws.id) {
            disconnectedParticipantId = id;
            disconnectedParticipantEmail = p.email;
            meeting.participants.delete(id);
          }
        });

        if (disconnectedParticipantId) {
          logger.debug(
            "Disconnected user removed from meeting memory.",
            {
              userId: disconnectedParticipantId,
              userEmail: disconnectedParticipantEmail,
              meetingId,
            },
          );

          this.broadcastToMeeting(
            meetingId,
            JSON.stringify({
              type: "presence",
              event: "participant_left",
              meetingId,
              participant: {
                id: disconnectedParticipantId,
                email: disconnectedParticipantEmail,
                isConnected: false,
              },
              connectedCount: meeting.participants.size,
            }),
          );
        }

        // Host reconnection logic
        if (
          disconnectedParticipantId &&
          disconnectedParticipantId === meeting.hostId
        ) {
          logger.warn("Host disconnected; pausing sessions.", {
            hostId: disconnectedParticipantId,
            hostEmail: disconnectedParticipantEmail,
            meetingId,
          });

          this.pauseHostAudio(meetingId, false);

          this.broadcastToMeeting(
            meetingId,
            JSON.stringify({
              type: "status",
              event: "host_disconnected",
              message:
                "Host disconnected. Meeting will end in 60 seconds if they do not return.",
            }),
          );

          meeting.hostTimeout = setTimeout(async () => {
            logger.info("Host reconnect timeout reached; ending meeting.", {
              meetingId,
              hostEmail: disconnectedParticipantEmail,
            });

            try {
              await db
                .update(meetings)
                .set({ ended_at: new Date() })
                .where(eq(meetings.id, meetingId));
            } catch (err) {
              logger.error("Failed updating meeting status after host timeout.", {
                meetingId,
                err,
              });
            }

            this.deleteMeeting(meetingId);
          }, 60000);
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
      logger.info(
        "Tearing down meeting and finishing audio sessions.",
        {
          meetingId: id,
        },
      );

      if (meeting.hostTimeout) {
        clearTimeout(meeting.hostTimeout);
        logger.debug(
          "Canceling host reconnect timeout timer.",
          {
            meetingId: id,
          },
        );
      }

      if (meeting.hostAudioIdleTimeout) {
        clearTimeout(meeting.hostAudioIdleTimeout);
      }

      const disconnectMsg = JSON.stringify({
        type: "status",
        message: `Meeting ${id} ended.`,
      });

      meeting.participants.forEach((p) => {
        try {
          p.socket.send(disconnectMsg);
        } catch (err) {
          logger.debug(`Failed to send disconnect message for meeting ${id}.`, {
            err,
          });
        }
      });

      meeting.audioSessions.forEach((session, languageKey) => {
        session
          .finish()
          .catch((err) =>
            logger.error("Failed finishing audio session.", {
              err,
              meetingId: id,
              languageKey,
            }),
          );
      });

      this.meetings.delete(id);
      logger.debug("Meeting removed from memory.", { meetingId: id });
    } else {
      logger.warn("Attempted to delete meeting not found in memory.", {
        meetingId: id,
      });
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

  isHostSendingAudio(meetingId: string) {
    return this.meetings.get(meetingId)?.isHostSendingAudio ?? false;
  }

  async prepareHostAudio(meetingId: string, participantId: string) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting || meeting.hostId !== participantId) {
      return;
    }

    if (meeting.audioSessions.size > 0) {
      this.pauseHostAudio(meetingId, false);
      return;
    }

    const [dbMeeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId));

    if (!dbMeeting) {
      logger.warn("Unable to prepare host audio for missing meeting record.", {
        meetingId,
        participantId,
      });
      return;
    }

    const method = dbMeeting.method || "one_way";
    const languages = getUniqueMeetingLanguages(dbMeeting.languages);

    if (method === "two_way") {
      const [languageA, languageB] = languages;
      if (!languageA || !languageB) {
        logger.warn("Skipping paused two-way session startup due to missing languages.", {
          meetingId,
          participantId,
        });
        return;
      }

      const session = this.addTranscriptionSession(meetingId, "two_way", {
        enableSpeakerDiarization: true,
        translation: {
          type: "two_way",
          language_a: languageA,
          language_b: languageB,
        },
      });

      await session?.connect();
      session?.pause();
    } else {
      for (const language of languages) {
        const session = this.addTranscriptionSession(meetingId, language, {
          enableSpeakerDiarization: true,
          translation: {
            type: "one_way",
            target_language: language,
          },
        });

        await session?.connect();
        session?.pause();
      }
    }

    if (meeting.audioSessions.size === 0) {
      logger.warn("Prepared host audio request found no languages to activate.", {
        meetingId,
        participantId,
        method,
      });
      return;
    }

    meeting.isHostSendingAudio = false;

    await db
      .update(meetings)
      .set({ started_at: dbMeeting.started_at || new Date() })
      .where(eq(meetings.id, meetingId));

    logger.info("Prepared paused transcription sessions for host.", {
      meetingId,
      participantId,
      method,
      languageCount: languages.length,
    });

    this.broadcastToMeeting(
      meetingId,
      JSON.stringify({
        type: "status",
        event: "meeting_started",
        message: "Meeting started. Transcription sessions are standing by.",
      }),
    );
  }

  setHostAudioState(wsId: string, isSendingAudio: boolean) {
    const meetingId = this.socketToMeeting.get(wsId);
    if (!meetingId) {
      logger.debug("Ignoring host audio state update for unmapped socket.", {
        socketId: wsId,
      });
      return;
    }

    const meeting = this.meetings.get(meetingId);
    const sender = meeting
      ? Array.from(meeting.participants.values()).find(
          (participant) => participant.socket.id === wsId,
        )
      : null;

    if (!meeting || sender?.id !== meeting.hostId) {
      logger.debug("Ignoring non-host audio state update.", {
        meetingId,
        socketId: wsId,
      });
      return;
    }

    if (isSendingAudio) {
      this.resumeHostAudio(meetingId, true);
      return;
    }

    this.pauseHostAudio(meetingId, true);
  }

  private refreshHostAudioIdleTimeout(meetingId: string) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      return;
    }

    if (meeting.hostAudioIdleTimeout) {
      clearTimeout(meeting.hostAudioIdleTimeout);
    }

    meeting.hostAudioIdleTimeout = setTimeout(() => {
      this.pauseHostAudio(meetingId, true);
    }, 5000);
  }

  private resumeHostAudio(meetingId: string, announce: boolean) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting || meeting.isHostSendingAudio) {
      if (meeting?.isHostSendingAudio) {
        this.refreshHostAudioIdleTimeout(meetingId);
      }
      return;
    }

    meeting.audioSessions.forEach((session) => session.resume());
    meeting.isHostSendingAudio = true;
    this.refreshHostAudioIdleTimeout(meetingId);

    logger.info("Host audio resumed for meeting.", { meetingId });

    if (announce) {
      this.broadcastToMeeting(
        meetingId,
        JSON.stringify({
          type: "status",
          event: "host_audio_started",
          message: "Host microphone is live.",
        }),
      );
    }
  }

  private pauseHostAudio(meetingId: string, announce: boolean) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      return;
    }

    if (meeting.hostAudioIdleTimeout) {
      clearTimeout(meeting.hostAudioIdleTimeout);
      meeting.hostAudioIdleTimeout = undefined;
    }

    meeting.audioSessions.forEach((session) => session.pause());
    const wasSendingAudio = meeting.isHostSendingAudio;
    meeting.isHostSendingAudio = false;

    if (!wasSendingAudio) {
      return;
    }

    logger.info("Host audio paused for meeting.", { meetingId });

    if (announce) {
      this.broadcastToMeeting(
        meetingId,
        JSON.stringify({
          type: "status",
          event: "host_audio_stopped",
          message: "Host microphone is idle.",
        }),
      );
    }
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

/**
 * Shared WebSocket controller instance.
 */
export const websocketController = new WebsocketController();
