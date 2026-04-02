import type { ElysiaWS } from "elysia/ws";
import { basename, extname } from "node:path";
import { logger } from "../core/logger";
import {
  transcriptionService,
  type TranscriptionSession,
  type TranscriptionConfig,
  type TranscriptionEvent,
  type TranscriptionSessionLifecycleEvent,
  type TranscriptionSessionState,
} from "../services/transcriptionService";
import { meetingCanonicalTranscriptService } from "../services/meetingCanonicalTranscriptService";
import { meetingDerivedTranslationStore } from "../services/meetingDerivedTranslationStore";
import { ollamaBackfillService } from "../services/ollamaBackfillService";
import { meetingTranscriptCacheService } from "../services/meetingTranscriptCacheService";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import { eq } from "drizzle-orm";
import {
  addOneWayMeetingLanguage,
  buildOneWayTranscriptionConfig,
  buildMeetingSessionPlan,
  getUniqueMeetingLanguages,
  type MeetingSessionPlan,
} from "../utils/meetingPolicy";

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
  audioSessions: Map<string, MeetingAudioSession>;
  pendingHostAudioChunks: Buffer[];
  hostTimeout?: ReturnType<typeof setTimeout>;
  hostAudioIdleTimeout?: ReturnType<typeof setTimeout>;
  isHostSendingAudio: boolean;
  isStartingAudio?: boolean;
  isEnding?: boolean;
}

interface MeetingAudioSession {
  languageKey: string;
  config: TranscriptionConfig;
  session: TranscriptionSession;
  state: TranscriptionSessionState;
  shouldResume: boolean;
  isReconnecting: boolean;
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
        pendingHostAudioChunks: [],
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
      logger.warn("Attempted to add session to missing meeting.", {
        meetingId,
      });
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
      (event) => {
        void this.handleTranscriptionEvent(meetingId, event);
      },
      (event) => {
        void this.handleSessionLifecycleEvent(languageKey, event);
      },
    );

    const entry: MeetingAudioSession = {
      languageKey,
      config,
      session,
      state: session.getState(),
      shouldResume: meeting.isHostSendingAudio,
      isReconnecting: false,
    };

    meeting.audioSessions.set(languageKey, entry);
    return entry;
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
   * Returns the subscribed meeting id for a websocket connection.
   */
  getMeetingBySocket(wsId: string) {
    return this.socketToMeeting.get(wsId);
  }

  /**
   * Subscribes a user's WebSocket connection to a specific meeting.
   *
   * @param meetingId - The internal database ID of the meeting to join.
   * @param participantId - The unique ID of the joining user.
   * @param ws - The active Elysia WebSocket instance.
   */
  joinMeeting(meetingId: string, participantId: string, ws: ElysiaWS) {
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
            message:
              "Host reconnected. Audio will resume when microphone streaming starts.",
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
   * Updates the in-memory language preference for a connected meeting participant.
   */
  updateParticipantLanguage(meetingId: string, participantId: string, languageCode: string) {
    const meeting = this.meetings.get(meetingId);
    const participant = meeting?.participants.get(participantId);
    if (!meeting || !participant) {
      return false;
    }

    participant.languageCode = languageCode;

    const wsUser = (participant.socket.data as any)?.wsUser;
    if (wsUser) {
      wsUser.languageCode = languageCode;
    }

    participant.socket.send(
      JSON.stringify({
        type: "status",
        event: "language_switched",
        meetingId,
        languageCode,
        message: `Transcript language switched to ${languageCode}.`,
      }),
    );

    this.broadcastToMeeting(
      meetingId,
      JSON.stringify({
        type: "presence",
        event: "participant_updated",
        meetingId,
        participant: {
          id: participant.id,
          name: participant.name,
          email: participant.email,
          role: participant.role,
          languageCode,
          isConnected: true,
        },
        connectedCount: meeting.participants.size,
      }),
    );

    return true;
  }

  /**
   * Ensures a one-way meeting can produce live transcript output for a switched language.
   */
  async ensureParticipantLanguageSession(meetingId: string, languageCode: string) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting || !languageCode) {
      return { ok: false as const, error: "Meeting not found" };
    }

    const [dbMeeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    if (!dbMeeting) {
      return { ok: false as const, error: "Meeting not found" };
    }

    if ((dbMeeting.method || "one_way") !== "one_way") {
      return { ok: true as const, addedLanguage: false, startedSession: false };
    }

    const currentLanguages = getUniqueMeetingLanguages(dbMeeting.languages);
    const nextLanguages = addOneWayMeetingLanguage(currentLanguages, languageCode);
    if (nextLanguages.limitExceeded) {
      return {
        ok: false as const,
        error: "One-way meeting language limit reached",
      };
    }

    if (nextLanguages.added) {
      await db
        .update(meetings)
        .set({ languages: nextLanguages.languages })
        .where(eq(meetings.id, meetingId));
    }

    let startedSession = false;
    if (meeting.isHostSendingAudio && !meeting.audioSessions.has(languageCode)) {
      const newSession = this.addTranscriptionSession(
        meetingId,
        languageCode,
        buildOneWayTranscriptionConfig(languageCode),
      );

      if (newSession) {
        await newSession.session.connect();
        newSession.state = newSession.session.getState();
        startedSession = true;
      }
    }

    logger.info(
      startedSession
        ? "Started on-demand one-way session after transcript language switch."
        : nextLanguages.added
          ? "Registered on-demand one-way language after transcript language switch."
          : "Transcript language switch reused existing one-way session.",
      {
        meetingId,
        languageCode,
        startedSession,
        addedLanguage: nextLanguages.added,
      },
    );

    return {
      ok: true as const,
      addedLanguage: nextLanguages.added,
      startedSession,
    };
  }

  /**
   * Replays cached finalized transcript history to a newly subscribed socket.
   */
  async sendTranscriptHistoryToSocket(meetingId: string, ws: ElysiaWS) {
    const languageCode = (ws.data as any)?.wsUser?.languageCode;
    if (!languageCode) {
      return;
    }

    const history = await meetingTranscriptCacheService.getLanguageHistory(
      meetingId,
      languageCode,
    );

    const twoWayHistory = languageCode === "two_way"
      ? []
      : await meetingTranscriptCacheService.getLanguageHistory(meetingId, "two_way");

    const combinedHistory = [...history, ...twoWayHistory].sort((left, right) => {
      const leftOrder = left.utteranceOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.utteranceOrder ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      const leftTime = left.startedAtMs ?? Number.MAX_SAFE_INTEGER;
      const rightTime = right.startedAtMs ?? Number.MAX_SAFE_INTEGER;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return left.createdAt.localeCompare(right.createdAt);
    });

    logger.debug("Replaying cached transcript history to websocket subscriber.", {
      meetingId,
      socketId: ws.id,
      viewerLanguage: languageCode,
      cachedLanguageHistoryCount: history.length,
      cachedTwoWayHistoryCount: twoWayHistory.length,
      combinedHistoryCount: combinedHistory.length,
    });

    for (const utterance of combinedHistory) {
      ws.send(
        JSON.stringify({
          type: "transcription",
          meetingId,
          language: utterance.language,
          text: utterance.text,
          transcriptionText:
            utterance.transcriptionText ??
            (utterance.language === "two_way" ? utterance.text : null),
          translationText: utterance.translationText ?? utterance.text,
          isFinal: true,
          isHistory: true,
          utteranceId: utterance.id,
          utteranceOrder: utterance.utteranceOrder,
          startedAtMs: utterance.startedAtMs,
          endedAtMs: utterance.endedAtMs,
          speaker: utterance.speaker,
          sourceLanguage: utterance.sourceLanguage ?? null,
        }),
      );
    }
  }

  /**
   * Materializes and replays target-language history for one connected socket.
   */
  async sendBackfilledTranscriptHistoryToSocket(
    meetingId: string,
    ws: ElysiaWS,
    languageCode?: string | null,
  ) {
    const targetLanguage = languageCode || (ws.data as any)?.wsUser?.languageCode;
    if (!targetLanguage || targetLanguage === "two_way") {
      logger.debug("Skipping transcript backfill replay for websocket subscriber.", {
        meetingId,
        socketId: ws.id,
        requestedLanguage: languageCode || null,
        resolvedLanguage: targetLanguage || null,
      });
      return;
    }

    const result = await ollamaBackfillService.backfillMeetingLanguage(meetingId, targetLanguage);
    logger.debug("Replaying backfilled transcript history to websocket subscriber.", {
      meetingId,
      socketId: ws.id,
      targetLanguage,
      backfilledEntryCount: result.entries.length,
    });
    for (const entry of result.entries) {
      ws.send(
        JSON.stringify({
          type: "transcription",
          meetingId,
          language: targetLanguage,
          text: entry.text,
          transcriptionText: entry.transcriptionText,
          translationText: entry.translationText,
          isFinal: true,
          isHistory: true,
          isBackfilled: true,
          utteranceId: `${meetingId}:${targetLanguage}:${entry.utteranceOrder}`,
          utteranceOrder: entry.utteranceOrder,
          startedAtMs: entry.startedAtMs,
          endedAtMs: entry.endedAtMs,
          speaker: entry.speaker,
          sourceLanguage: entry.sourceLanguage,
          provider: entry.provider,
        }),
      );
    }
  }

  /**
   * Returns whether initial subscription should trigger backfill for the viewer language.
   */
  async shouldBackfillTranscriptHistoryOnSubscribe(
    meetingId: string,
    languageCode?: string | null,
  ) {
    const targetLanguage = languageCode?.trim();
    if (!targetLanguage || targetLanguage === "two_way") {
      logger.debug("Skipping subscribe-time backfill evaluation.", {
        meetingId,
        requestedLanguage: languageCode || null,
        resolvedLanguage: targetLanguage || null,
      });
      return false;
    }

    const existingHistory = await meetingTranscriptCacheService.getLanguageHistory(
      meetingId,
      targetLanguage,
    );
    if (existingHistory.length > 0) {
      logger.debug("Subscribe-time backfill not needed because cached history exists.", {
        meetingId,
        targetLanguage,
        cachedHistoryCount: existingHistory.length,
      });
      return false;
    }

    const canonicalHistory = await meetingCanonicalTranscriptService.getMeetingHistory(meetingId);
    const shouldBackfill = canonicalHistory.length > 0;
    logger.debug("Subscribe-time backfill evaluation completed.", {
      meetingId,
      targetLanguage,
      cachedHistoryCount: existingHistory.length,
      canonicalHistoryCount: canonicalHistory.length,
      shouldBackfill,
    });
    return shouldBackfill;
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
        if (meeting.isStartingAudio) {
          this.queuePendingHostAudio(meeting, audioChunk);
          return;
        }

        this.queuePendingHostAudio(meeting, audioChunk);

        void this.resumeHostAudio(meetingId, false, true)
          .catch((err) => {
            logger.error("Failed starting host audio from incoming chunk.", {
              meetingId,
              err,
            });
          });
        return;
      } else if (sender?.id === meeting.hostId) {
        this.refreshHostAudioIdleTimeout(meetingId);
      }

      this.dispatchAudioChunkToMeeting(meetingId, audioChunk);
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
          logger.debug("Disconnected user removed from meeting memory.", {
            userId: disconnectedParticipantId,
            userEmail: disconnectedParticipantEmail,
            meetingId,
          });

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

        // A brief grace period lets the host refresh or reconnect without dropping live sessions
        // immediately for every participant.
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
              logger.error(
                "Failed updating meeting status after host timeout.",
                {
                  meetingId,
                  err,
                },
              );
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
  async deleteMeeting(id: string) {
    const meeting = this.meetings.get(id);

    if (meeting) {
      if (meeting.isEnding) {
        logger.debug("Meeting teardown already in progress.", {
          meetingId: id,
        });
        return;
      }

      meeting.isEnding = true;

      logger.info("Tearing down meeting and finishing audio sessions.", {
        meetingId: id,
      });

      if (meeting.hostTimeout) {
        clearTimeout(meeting.hostTimeout);
        logger.debug("Canceling host reconnect timeout timer.", {
          meetingId: id,
        });
      }

      if (meeting.hostAudioIdleTimeout) {
        clearTimeout(meeting.hostAudioIdleTimeout);
      }

      await Promise.all(
        Array.from(meeting.audioSessions.entries()).map(
          async ([languageKey, sessionEntry]) => {
            try {
              await sessionEntry.session.finish();
            } catch (err) {
              logger.error("Failed finishing audio session.", {
                err,
                meetingId: id,
                languageKey,
              });
            }
          },
        ),
      );

      meeting.audioSessions.clear();
      meeting.pendingHostAudioChunks.length = 0;

      let outputPaths: string[] = [];

      try {
        outputPaths = await meetingTranscriptCacheService.flushMeetingToVtt(id);
        await meetingCanonicalTranscriptService.clearMeetingHistory(id);
        await meetingDerivedTranslationStore.clearMeetingHistory(id);
        if (outputPaths.length > 0) {
          logger.info("Meeting transcript history flushed to disk.", {
            meetingId: id,
            outputPaths,
          });
        }
      } catch (err) {
        logger.error("Failed flushing meeting transcript history.", {
          meetingId: id,
          err,
        });
      }

      const disconnectMsg = JSON.stringify({
        type: "status",
        event: "meeting_ended",
        message: `Meeting ${id} ended.`,
        transcriptLanguages: outputPaths
          .map((outputPath) => basename(outputPath, extname(outputPath)))
          .filter(Boolean),
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

  /**
   * Sends transcript events only to participants who subscribed in the target language.
   */
  private sendTranscriptToLanguageParticipants(
    meetingId: string,
    language: string,
    data: string,
  ) {
    this.meetings.get(meetingId)?.participants.forEach((participant) => {
      if (language === "two_way" || participant.languageCode === language) {
        participant.socket.send(data);
      }
    });
  }

  /**
   * Reports whether the host microphone is currently feeding audio into the meeting.
   */
  isHostSendingAudio(meetingId: string) {
    return this.meetings.get(meetingId)?.isHostSendingAudio ?? false;
  }

  /**
   * Marks the host as present in the room before live audio begins.
   */
  async prepareHostAudio(meetingId: string, participantId: string) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting || meeting.hostId !== participantId) {
      return;
    }

    meeting.isHostSendingAudio = false;

    logger.info("Host prepared live room without starting transcription yet.", {
      meetingId,
      participantId,
    });
  }

  /**
   * Handles explicit host microphone start/stop signals from the WebSocket client.
   */
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
      void this.resumeHostAudio(meetingId, true, true);
      return;
    }

    this.pauseHostAudio(meetingId, true);
  }

  /**
   * Pauses host audio automatically after a short period without new microphone chunks.
   */
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

  /**
   * Starts or resumes all meeting audio sessions when the host microphone becomes active.
   */
  private async resumeHostAudio(
    meetingId: string,
    announce: boolean,
    ensureSessions: boolean,
  ) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting || meeting.isHostSendingAudio || meeting.isStartingAudio) {
      if (meeting?.isHostSendingAudio) {
        this.refreshHostAudioIdleTimeout(meetingId);
      }
      return;
    }

    meeting.isStartingAudio = true;

    try {
      const didStartSessions = ensureSessions
        ? await this.ensureMeetingAudioSessionsStarted(meetingId)
        : false;
      const activeMeeting = this.meetings.get(meetingId);

      if (!activeMeeting?.audioSessions.size) {
        return;
      }

      // Sessions may connect before the host actually starts talking, so keep the desired audio
      // state separate from the current transport state and reapply it after reconnects.
      activeMeeting.audioSessions.forEach((sessionEntry) => {
        sessionEntry.shouldResume = true;
        sessionEntry.session.resume();
        sessionEntry.state = sessionEntry.session.getState();
      });
      activeMeeting.isHostSendingAudio = true;
      this.refreshHostAudioIdleTimeout(meetingId);
      this.flushPendingHostAudio(meetingId);

      logger.info("Host audio resumed for meeting.", { meetingId });

      if (didStartSessions) {
        this.broadcastToMeeting(
          meetingId,
          JSON.stringify({
            type: "status",
            event: "meeting_started",
            message: "Meeting started. Host microphone is live.",
          }),
        );
      }

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
    } finally {
      const activeMeeting = this.meetings.get(meetingId);
      if (activeMeeting) {
        activeMeeting.isStartingAudio = false;
      }
    }
  }

  /**
   * Pauses all active audio sessions without tearing them down.
   */
  private pauseHostAudio(meetingId: string, announce: boolean) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      return;
    }

    if (meeting.hostAudioIdleTimeout) {
      clearTimeout(meeting.hostAudioIdleTimeout);
      meeting.hostAudioIdleTimeout = undefined;
    }

    meeting.audioSessions.forEach((sessionEntry) => {
      sessionEntry.shouldResume = false;
      sessionEntry.session.pause();
      sessionEntry.state = sessionEntry.session.getState();
    });
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

  /**
   * Normalizes Soniox events, caches finalized utterances, and fans them out to listeners.
   */
  private async handleTranscriptionEvent(
    meetingId: string,
    event: TranscriptionEvent,
  ) {
    logger.debug("Transcript utterance received.", {
      meetingId,
      language: event.targetLanguage,
      isFinal: event.isFinal,
      text: event.text,
      transcriptionText: event.transcriptionText,
      translationText: event.translationText,
      sourceLanguage: event.sourceLanguage,
      startedAtMs: event.startedAtMs,
      endedAtMs: event.endedAtMs,
      speaker: event.speaker,
    });

    if (event.isFinal && event.text) {
      try {
        const canonicalUtterance = await meetingCanonicalTranscriptService.registerUtterance({
          meetingId,
          text: event.text,
          language: event.targetLanguage,
          transcriptionText: event.transcriptionText,
          translationText: event.translationText,
          sourceLanguage: event.sourceLanguage,
          startedAtMs: event.startedAtMs,
          endedAtMs: event.endedAtMs,
          speaker: event.speaker,
        });
        const cachedUtterance =
          await meetingTranscriptCacheService.appendFinalUtterance({
            meetingId,
            language: event.targetLanguage,
            text: event.text,
            utteranceOrder: canonicalUtterance.utteranceOrder,
            transcriptionText: event.transcriptionText,
            translationText: event.translationText,
            sourceLanguage: event.sourceLanguage,
            startedAtMs: event.startedAtMs,
            endedAtMs: event.endedAtMs,
            speaker: event.speaker,
          });

        this.sendTranscriptToLanguageParticipants(
          meetingId,
          event.targetLanguage,
          JSON.stringify({
            type: "transcription",
            meetingId,
            language: event.targetLanguage,
            text: event.text,
            transcriptionText: event.transcriptionText,
            translationText: event.translationText,
            isFinal: true,
            utteranceId: cachedUtterance.id,
            utteranceOrder: cachedUtterance.utteranceOrder,
            startedAtMs: event.startedAtMs,
            endedAtMs: event.endedAtMs,
            speaker: event.speaker,
            sourceLanguage: event.sourceLanguage,
          }),
        );

        return;
      } catch (err) {
        logger.error("Failed caching finalized transcript utterance.", {
          meetingId,
          language: event.targetLanguage,
          err,
        });
      }
    }

    this.sendTranscriptToLanguageParticipants(
      meetingId,
      event.targetLanguage,
      JSON.stringify({
        type: "transcription",
        meetingId,
        language: event.targetLanguage,
        text: event.text,
        transcriptionText: event.transcriptionText,
        translationText: event.translationText,
        isFinal: event.isFinal,
        startedAtMs: event.startedAtMs,
        endedAtMs: event.endedAtMs,
        speaker: event.speaker,
        sourceLanguage: event.sourceLanguage,
      }),
    );
  }

  /**
   * Ensures every language/session required by the persisted meeting record is connected.
   */
  private async ensureMeetingAudioSessionsStarted(meetingId: string) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      return false;
    }

    const [dbMeeting] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingId));

    if (!dbMeeting) {
      logger.warn("Unable to start host audio for missing meeting record.", {
        meetingId,
      });
      return false;
    }

    const sessionPlan = buildMeetingSessionPlan(dbMeeting.method, dbMeeting.languages);
    if (sessionPlan.length === 0) {
      logger.warn("No Soniox session plan available for meeting.", {
        meetingId,
        method: dbMeeting.method,
      });
      return false;
    }

    const missingSessions = sessionPlan.filter(({ languageKey }) => {
      const existing = meeting.audioSessions.get(languageKey);
      return !existing || this.shouldReplaceSession(existing.state);
    });

    await Promise.all(
      missingSessions.map(async ({ languageKey, config }) => {
        const existing = meeting.audioSessions.get(languageKey);
        if (existing) {
          meeting.audioSessions.delete(languageKey);
        }

        const sessionEntry = this.addTranscriptionSession(
          meetingId,
          languageKey,
          config,
        );
        await sessionEntry?.session.connect();
        if (sessionEntry) {
          sessionEntry.state = sessionEntry.session.getState();
        }
      }),
    );

    if (meeting.audioSessions.size === 0) {
      return false;
    }

    if (!dbMeeting.started_at) {
      await db
        .update(meetings)
        .set({ started_at: new Date() })
        .where(eq(meetings.id, meetingId));

      logger.info("Started transcription sessions for meeting.", {
        meetingId,
        method: dbMeeting.method,
        languageCount: sessionPlan.length,
      });

      return true;
    }

    return false;
  }

  /**
   * Flags lifecycle states that require a fresh Soniox session before audio can continue.
   */
  private shouldReplaceSession(state: TranscriptionSessionState) {
    return state === "disconnected" || state === "error" || state === "finished";
  }

  /**
   * Reconnects Soniox sessions that fail while the meeting still expects live audio.
   */
  private async handleSessionLifecycleEvent(
    languageKey: string,
    event: TranscriptionSessionLifecycleEvent,
  ) {
    const meeting = this.meetings.get(event.meetingId);
    const sessionEntry = meeting?.audioSessions.get(languageKey);
    if (!meeting || !sessionEntry) {
      return;
    }

    sessionEntry.state = event.state;

    if (meeting.isEnding) {
      return;
    }

    if (event.type === "connected") {
      sessionEntry.isReconnecting = false;
      if (sessionEntry.shouldResume) {
        sessionEntry.session.resume();
        sessionEntry.state = sessionEntry.session.getState();
      }
      return;
    }

    if (
      event.type !== "disconnected" &&
      event.type !== "error" &&
      event.type !== "finished"
    ) {
      return;
    }

    if (!sessionEntry.shouldResume || sessionEntry.isReconnecting) {
      return;
    }

    sessionEntry.isReconnecting = true;
    logger.warn("Recreating Soniox session after lifecycle failure.", {
      meetingId: event.meetingId,
      languageKey,
      lifecycleEvent: event.type,
    });

    try {
      const replacement = transcriptionService.createSession(
        event.meetingId,
        sessionEntry.config,
        (transcriptionEvent) => {
          void this.handleTranscriptionEvent(event.meetingId, transcriptionEvent);
        },
        (lifecycleEvent) => {
          void this.handleSessionLifecycleEvent(languageKey, lifecycleEvent);
        },
      );

      sessionEntry.session = replacement;
      sessionEntry.state = replacement.getState();
      await replacement.connect();

      if (sessionEntry.shouldResume) {
        replacement.resume();
        sessionEntry.state = replacement.getState();
      }

      logger.info("Recreated Soniox session successfully.", {
        meetingId: event.meetingId,
        languageKey,
      });
    } catch (err) {
      sessionEntry.state = sessionEntry.session.getState();
      logger.error("Failed recreating Soniox session.", {
        meetingId: event.meetingId,
        languageKey,
        err,
      });
    } finally {
      sessionEntry.isReconnecting = false;
    }
  }

  /**
   * Buffers a small amount of host audio while sessions are still connecting.
   */
  private queuePendingHostAudio(meeting: Meeting, audioChunk: Buffer) {
    if (meeting.pendingHostAudioChunks.length >= 20) {
      meeting.pendingHostAudioChunks.shift();
    }

    meeting.pendingHostAudioChunks.push(Buffer.from(audioChunk));
  }

  /**
   * Replays buffered host audio once the meeting sessions are ready.
   */
  private flushPendingHostAudio(meetingId: string) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting || meeting.pendingHostAudioChunks.length === 0) {
      return;
    }

    const pendingChunks = meeting.pendingHostAudioChunks.splice(0);
    for (const chunk of pendingChunks) {
      this.dispatchAudioChunkToMeeting(meetingId, chunk);
    }
  }

  /**
   * Broadcasts raw audio chunks to every active Soniox session for the meeting.
   */
  private dispatchAudioChunkToMeeting(meetingId: string, audioChunk: Buffer) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      return;
    }

    meeting.audioSessions.forEach((sessionEntry) => {
      try {
        sessionEntry.session.sendAudio(audioChunk);
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
 * Shared WebSocket controller instance.
 */
export const websocketController = new WebsocketController();
