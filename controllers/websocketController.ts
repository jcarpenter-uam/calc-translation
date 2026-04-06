import type { ElysiaWS } from "elysia/ws";
import { basename, extname } from "node:path";
import { logger } from "../core/logger";
import type { CachedMeetingUtterance } from "../services/meetingTranscriptCacheService";
import {
  transcriptionService,
  type TranscriptionSession,
  type TranscriptionConfig,
  type TranscriptionEvent,
  type TranscriptionSessionLifecycleEvent,
  type TranscriptionSessionState,
} from "../services/transcriptionService";
import { ollamaBackfillService } from "../services/ollamaBackfillService";
import { ollamaSummaryService } from "../services/ollamaSummaryService";
import { meetingArtifactEmailService } from "../services/meetingArtifactEmailService";
import { meetingTranscriptCacheService } from "../services/meetingTranscriptCacheService";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import { eq } from "drizzle-orm";
import {
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
  requestedViewerLanguages: Set<string>;
  activatedViewerLanguages: Set<string>;
  audioCursorMs: number;
  audioClockStarted: boolean;
  lastChunkStartedAtMs: number | null;
  lastChunkEndedAtMs: number | null;
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
  transcriptState: "backfilling" | "backfill_failed" | "live";
  shouldResume: boolean;
  isReconnecting: boolean;
  currentUtteranceStartedAtMs: number | null;
  currentUtteranceLastSeenAtMs: number | null;
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
        requestedViewerLanguages: new Set(),
        activatedViewerLanguages: new Set(),
        audioCursorMs: 0,
        audioClockStarted: false,
        lastChunkStartedAtMs: null,
        lastChunkEndedAtMs: null,
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
        void this.handleTranscriptionEvent(meetingId, languageKey, event);
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
      transcriptState: "live",
      shouldResume: meeting.isHostSendingAudio,
      isReconnecting: false,
      currentUtteranceStartedAtMs: null,
      currentUtteranceLastSeenAtMs: null,
    };

    meeting.audioSessions.set(languageKey, entry);
    if (languageKey !== "two_way") {
      meeting.activatedViewerLanguages.add(languageKey);
    }
    return entry;
  }

  /**
   * Records a one-way viewer language request for this active meeting.
   */
  registerViewerLanguageRequest(meetingId: string, languageCode: string | null | undefined) {
    const meeting = this.meetings.get(meetingId);
    const normalizedLanguage = typeof languageCode === "string" ? languageCode.trim() : "";
    if (!meeting || !normalizedLanguage) {
      return false;
    }

    const initialSize = meeting.requestedViewerLanguages.size;
    meeting.requestedViewerLanguages.add(normalizedLanguage);
    return meeting.requestedViewerLanguages.size > initialSize;
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

    const addedLanguage = this.registerViewerLanguageRequest(meetingId, languageCode);

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
        : addedLanguage
          ? "Registered on-demand one-way language after transcript language switch."
          : "Transcript language switch reused existing one-way session.",
      {
        meetingId,
        languageCode,
        startedSession,
        addedLanguage,
      },
    );

    return {
      ok: true as const,
      addedLanguage,
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
          transcriptionText: utterance.transcriptionText,
          translationText: utterance.translationText,
          isFinal: true,
          isHistory: true,
          utteranceId: utterance.id,
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

    try {
      const sourceContext = await this.selectBackfillSourceLanguage(meetingId, targetLanguage);
      const targetHistory = await this.getSortedTranscriptHistory(meetingId, targetLanguage);
      const missingEntries = sourceContext
        ? this.getMissingTranscriptEntries(sourceContext.history, targetHistory)
        : [];

      if (!sourceContext || missingEntries.length === 0) {
        this.setTranscriptState(meetingId, targetLanguage, "live");
        await this.replayTranscriptHistoryToSocket(meetingId, ws, targetLanguage, false);
        return;
      }

      const result = await ollamaBackfillService.backfillMeetingLanguage(
        meetingId,
        targetLanguage,
        missingEntries,
      );
      logger.debug("Replaying backfilled transcript history to websocket subscriber.", {
        meetingId,
        socketId: ws.id,
        targetLanguage,
        sourceLanguage: sourceContext.language,
        missingEntryCount: missingEntries.length,
        backfilledEntryCount: result.entries.length,
      });

      this.setTranscriptState(meetingId, targetLanguage, "live");
      await this.replayTranscriptHistoryToSocket(meetingId, ws, targetLanguage, true);
    } catch (error) {
      this.setTranscriptState(meetingId, targetLanguage, "backfill_failed");
      throw error;
    }
  }

  setTranscriptState(
    meetingId: string,
    languageKey: string,
    transcriptState: MeetingAudioSession["transcriptState"],
  ) {
    const sessionEntry = this.meetings.get(meetingId)?.audioSessions.get(languageKey);
    if (!sessionEntry) {
      return false;
    }

    sessionEntry.transcriptState = transcriptState;
    return true;
  }

  getTranscriptState(meetingId: string, languageKey: string) {
    return this.meetings.get(meetingId)?.audioSessions.get(languageKey)?.transcriptState;
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
    const sourceContext = await this.selectBackfillSourceLanguage(meetingId, targetLanguage);
    if (!sourceContext) {
      logger.debug("Skipping subscribe-time backfill because no live source language exists.", {
        meetingId,
        targetLanguage,
      });
      return false;
    }

    const shouldBackfill =
      this.getMissingTranscriptEntries(sourceContext.history, this.sortTranscriptHistory(existingHistory))
        .length > 0;
    logger.debug("Subscribe-time backfill evaluation completed.", {
      meetingId,
      targetLanguage,
      cachedHistoryCount: existingHistory.length,
      sourceLanguage: sourceContext.language,
      sourceHistoryCount: sourceContext.history.length,
      shouldBackfill,
    });
    return shouldBackfill;
  }

  private sortTranscriptHistory(history: CachedMeetingUtterance[]) {
    return [...history].sort((left, right) => {
      const leftStart = left.startedAtMs ?? Number.MAX_SAFE_INTEGER;
      const rightStart = right.startedAtMs ?? Number.MAX_SAFE_INTEGER;
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      const leftEnd = left.endedAtMs ?? leftStart;
      const rightEnd = right.endedAtMs ?? rightStart;
      if (leftEnd !== rightEnd) {
        return leftEnd - rightEnd;
      }

      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  private async selectBackfillSourceLanguage(meetingId: string, targetLanguage: string) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      return null;
    }

    const isUuidMeetingId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      meetingId,
    );
    const [dbMeeting] = isUuidMeetingId
      ? await db.select().from(meetings).where(eq(meetings.id, meetingId))
      : [];
    const requestedViewerLanguages = Array.from(meeting.requestedViewerLanguages);
    const orderedLanguages = dbMeeting
      ? (dbMeeting.method || "one_way") === "two_way"
        ? getUniqueMeetingLanguages(dbMeeting.spoken_languages)
        : requestedViewerLanguages.length > 0
          ? requestedViewerLanguages
          : Array.from(meeting.audioSessions.keys())
      : Array.from(meeting.audioSessions.keys());

    for (const language of orderedLanguages) {
      if (language === targetLanguage) {
        continue;
      }

      const sessionEntry = meeting.audioSessions.get(language);
      if (!sessionEntry || sessionEntry.transcriptState !== "live") {
        continue;
      }

      const history = await this.getSortedTranscriptHistory(meetingId, language);
      if (history.length === 0) {
        continue;
      }

      return {
        language,
        history,
      };
    }

    return null;
  }

  private async getSortedTranscriptHistory(meetingId: string, language: string) {
    return this.sortTranscriptHistory(
      await meetingTranscriptCacheService.getLanguageHistory(meetingId, language),
    );
  }

  private async replayTranscriptHistoryToSocket(
    meetingId: string,
    ws: ElysiaWS,
    language: string,
    isBackfilled: boolean,
  ) {
    const history = await this.getSortedTranscriptHistory(meetingId, language);
    for (const entry of history) {
      ws.send(
        JSON.stringify({
          type: "transcription",
          meetingId,
          language,
          transcriptionText: entry.transcriptionText,
          translationText: entry.translationText,
          isFinal: true,
          isHistory: true,
          isBackfilled,
          utteranceId: entry.id,
          startedAtMs: entry.startedAtMs,
          endedAtMs: entry.endedAtMs,
          speaker: entry.speaker,
          sourceLanguage: entry.sourceLanguage,
        }),
      );
    }
  }

  private getMissingTranscriptEntries(
    sourceHistory: CachedMeetingUtterance[],
    targetHistory: CachedMeetingUtterance[],
  ) {
    const existingFingerprints = new Set(
      targetHistory.map((entry) => this.getTranscriptEntryFingerprint(entry)),
    );

    return sourceHistory.filter(
      (entry) => !existingFingerprints.has(this.getTranscriptEntryFingerprint(entry)),
    );
  }

  private getTranscriptEntryFingerprint(entry: CachedMeetingUtterance) {
    const normalizedText = entry.transcriptionText.trim().toLowerCase();
    return [
      entry.startedAtMs ?? "null",
      entry.endedAtMs ?? "null",
      normalizedText,
    ].join("|");
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

      const timingWindow = this.advanceMeetingAudioClock(meetingId, audioChunk);
      this.dispatchAudioChunkToMeeting(meetingId, audioChunk, timingWindow);
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

      const finalViewerLanguages = Array.from(meeting.activatedViewerLanguages)
        .sort((left, right) => left.localeCompare(right));

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

      const isUuidMeetingId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
      const [dbMeeting] = isUuidMeetingId
        ? await db
            .select({
              id: meetings.id,
              readable_id: meetings.readable_id,
              method: meetings.method,
              spoken_languages: meetings.spoken_languages,
              topic: meetings.topic,
              host_id: meetings.host_id,
              attendees: meetings.attendees,
              scheduled_time: meetings.scheduled_time,
              started_at: meetings.started_at,
              ended_at: meetings.ended_at,
            })
            .from(meetings)
            .where(eq(meetings.id, id))
        : [];

      let summaryOutputPaths: string[] = [];

      try {
        summaryOutputPaths = await this.generateMeetingSummaries(id, dbMeeting, finalViewerLanguages);
        if (summaryOutputPaths.length > 0) {
          logger.info("Meeting summaries flushed to disk.", {
            meetingId: id,
            outputPaths: summaryOutputPaths,
          });
        }
      } catch (err) {
        logger.error("Failed generating meeting summaries.", {
          meetingId: id,
          err,
        });
      }

      if (isUuidMeetingId && (dbMeeting?.method || "one_way") === "one_way") {
        await db
          .update(meetings)
          .set({ viewer_languages: finalViewerLanguages })
          .where(eq(meetings.id, id));
      }

      meeting.audioSessions.clear();
      meeting.requestedViewerLanguages.clear();
      meeting.activatedViewerLanguages.clear();
      meeting.pendingHostAudioChunks.length = 0;

      let outputPaths: string[] = [];

      try {
        outputPaths = await meetingTranscriptCacheService.flushMeetingToVtt(id);
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
        summaryLanguages: summaryOutputPaths
          .map((outputPath) => basename(outputPath, extname(outputPath)).replace(/^summary-/, ""))
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

      if (dbMeeting) {
        meetingArtifactEmailService.enqueueMeetingArtifactEmails({
          meetingId: id,
          readableId: dbMeeting.readable_id,
          topic: dbMeeting.topic,
          hostId: dbMeeting.host_id,
          attendeeIds: Array.isArray(dbMeeting.attendees) ? dbMeeting.attendees : [],
          method: (dbMeeting.method || "one_way") as "one_way" | "two_way",
          spokenLanguages: getUniqueMeetingLanguages(dbMeeting.spoken_languages),
          scheduledTime: dbMeeting.scheduled_time,
          startedAt: dbMeeting.started_at,
          endedAt: dbMeeting.ended_at,
          transcriptOutputPaths: outputPaths,
          summaryOutputPaths: summaryOutputPaths,
          liveParticipants: Array.from(meeting.participants.values()).map((participant) => ({
            id: participant.id,
            email: participant.email,
            languageCode: participant.languageCode,
          })),
        });
      }

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
   * Generates meeting summary markdown files for the finalized language set.
   */
  private async generateMeetingSummaries(
    meetingId: string,
    dbMeeting:
      | {
          method: string | null;
          spoken_languages: string[] | null;
          topic: string | null;
        }
      | undefined,
    finalViewerLanguages: string[],
  ) {
    const resolvedMethod = dbMeeting?.method || "one_way";
    if (resolvedMethod === "two_way") {
      const spokenLanguages = getUniqueMeetingLanguages(dbMeeting?.spoken_languages);
      if (spokenLanguages.length === 0) {
        return [] as string[];
      }

      const sharedHistory = await this.getSortedTranscriptHistory(meetingId, "two_way");
      if (sharedHistory.length === 0) {
        return [] as string[];
      }

      const results = await Promise.allSettled(
        spokenLanguages.map(async (language) => {
          const markdown = await ollamaSummaryService.summarizeMeeting({
            meetingId,
            targetLanguage: language,
            transcriptLanguage: "two_way",
            utterances: sharedHistory,
            meetingTopic: dbMeeting?.topic,
          });
          return await meetingTranscriptCacheService.writeMeetingSummary(meetingId, language, markdown);
        }),
      );

      return results.flatMap((result, index) => {
        if (result.status === "fulfilled") {
          return [result.value];
        }

        logger.error("Failed generating two-way meeting summary language.", {
          meetingId,
          language: spokenLanguages[index] || null,
          err: result.reason,
        });
        return [] as string[];
      });
    }

    const summaryLanguages = Array.from(
      new Set([
        ...getUniqueMeetingLanguages(dbMeeting?.spoken_languages),
        ...finalViewerLanguages,
      ]),
    ).sort((left, right) => left.localeCompare(right));

    const results = await Promise.allSettled(
        summaryLanguages.map(async (language) => {
          const history = await this.getSortedTranscriptHistory(meetingId, language);
          if (history.length === 0) {
            return null;
          }

          const markdown = await ollamaSummaryService.summarizeMeeting({
            meetingId,
            targetLanguage: language,
            transcriptLanguage: language,
            utterances: history,
            meetingTopic: dbMeeting?.topic,
          });
          return await meetingTranscriptCacheService.writeMeetingSummary(meetingId, language, markdown);
        }),
      );

    return results.flatMap((result, index) => {
      if (result.status === "fulfilled") {
        return result.value ? [result.value] : [];
      }

      logger.error("Failed generating one-way meeting summary language.", {
        meetingId,
        language: summaryLanguages[index] || null,
        err: result.reason,
      });
      return [] as string[];
    });
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
      const [dbMeeting] = await db
        .select({ method: meetings.method })
        .from(meetings)
        .where(eq(meetings.id, meetingId));
      const allowsIdleOneWayStart = (dbMeeting?.method || "one_way") === "one_way";

      if (!activeMeeting) {
        return;
      }

      if (!activeMeeting.audioSessions.size && !allowsIdleOneWayStart) {
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
      sessionEntry.currentUtteranceStartedAtMs = null;
      sessionEntry.currentUtteranceLastSeenAtMs = null;
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
    languageKeyOrEvent: string | TranscriptionEvent,
    maybeEvent?: TranscriptionEvent,
  ) {
    const languageKey =
      typeof languageKeyOrEvent === "string"
        ? languageKeyOrEvent
        : languageKeyOrEvent.targetLanguage;
    const event =
      typeof languageKeyOrEvent === "string" && maybeEvent
        ? maybeEvent
        : (languageKeyOrEvent as TranscriptionEvent);
    const normalizedEvent = this.applyMeetingRelativeTimestamps(meetingId, languageKey, event);

    logger.debug("Transcript utterance received.", {
      meetingId,
      language: normalizedEvent.targetLanguage,
      isFinal: normalizedEvent.isFinal,
      transcriptionText: normalizedEvent.transcriptionText,
      translationText: normalizedEvent.translationText,
      sourceLanguage: normalizedEvent.sourceLanguage,
      startedAtMs: normalizedEvent.startedAtMs,
      endedAtMs: normalizedEvent.endedAtMs,
      speaker: normalizedEvent.speaker,
    });

    if (normalizedEvent.isFinal && normalizedEvent.transcriptionText) {
      try {
        const cachedUtterance =
          await meetingTranscriptCacheService.appendFinalUtterance({
            meetingId,
            language: normalizedEvent.targetLanguage,
            transcriptionText: normalizedEvent.transcriptionText,
            translationText: normalizedEvent.translationText,
            sourceLanguage: normalizedEvent.sourceLanguage,
            startedAtMs: normalizedEvent.startedAtMs,
            endedAtMs: normalizedEvent.endedAtMs,
            speaker: normalizedEvent.speaker,
          });

        this.sendTranscriptToLanguageParticipants(
          meetingId,
          normalizedEvent.targetLanguage,
          JSON.stringify({
            type: "transcription",
            meetingId,
            language: normalizedEvent.targetLanguage,
            transcriptionText: normalizedEvent.transcriptionText,
            translationText: normalizedEvent.translationText,
            isFinal: true,
            utteranceId: cachedUtterance.id,
            startedAtMs: normalizedEvent.startedAtMs,
            endedAtMs: normalizedEvent.endedAtMs,
            speaker: normalizedEvent.speaker,
            sourceLanguage: normalizedEvent.sourceLanguage,
          }),
        );

        return;
      } catch (err) {
        logger.error("Failed caching finalized transcript utterance.", {
          meetingId,
          language: normalizedEvent.targetLanguage,
          err,
        });
      }
    }

    this.sendTranscriptToLanguageParticipants(
      meetingId,
      normalizedEvent.targetLanguage,
      JSON.stringify({
        type: "transcription",
        meetingId,
        language: normalizedEvent.targetLanguage,
        transcriptionText: normalizedEvent.transcriptionText,
        translationText: normalizedEvent.translationText,
        isFinal: normalizedEvent.isFinal,
        startedAtMs: normalizedEvent.startedAtMs,
        endedAtMs: normalizedEvent.endedAtMs,
        speaker: normalizedEvent.speaker,
        sourceLanguage: normalizedEvent.sourceLanguage,
      }),
    );
  }

  private applyMeetingRelativeTimestamps(
    meetingId: string,
    languageKey: string,
    event: TranscriptionEvent,
  ) {
    const meeting = this.meetings.get(meetingId);
    const sessionEntry = meeting?.audioSessions.get(languageKey);
    if (!meeting || !sessionEntry) {
      return event;
    }

    const currentChunkStart = meeting.lastChunkStartedAtMs ?? meeting.audioCursorMs;
    const currentChunkEnd = meeting.lastChunkEndedAtMs ?? currentChunkStart;

    if (!event.isFinal) {
      if (event.transcriptionText.trim() || (event.translationText || "").trim()) {
        if (sessionEntry.currentUtteranceStartedAtMs === null) {
          sessionEntry.currentUtteranceStartedAtMs = currentChunkStart;
        }
        sessionEntry.currentUtteranceLastSeenAtMs = currentChunkEnd;
      }

      return {
        ...event,
        startedAtMs: sessionEntry.currentUtteranceStartedAtMs,
        endedAtMs: sessionEntry.currentUtteranceLastSeenAtMs,
      } satisfies TranscriptionEvent;
    }

    const startedAtMs = sessionEntry.currentUtteranceStartedAtMs ?? currentChunkStart;
    const endedAtMs = Math.max(
      sessionEntry.currentUtteranceLastSeenAtMs ?? currentChunkEnd,
      startedAtMs,
    );

    sessionEntry.currentUtteranceStartedAtMs = null;
    sessionEntry.currentUtteranceLastSeenAtMs = null;

    return {
      ...event,
      startedAtMs,
      endedAtMs,
    } satisfies TranscriptionEvent;
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

    const sessionPlan = buildMeetingSessionPlan(
      dbMeeting.method,
      dbMeeting.spoken_languages,
      Array.from(meeting.requestedViewerLanguages),
    );
    if (sessionPlan.length === 0 && (dbMeeting.method || "one_way") === "two_way") {
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

    if (
      event.type === "disconnected" ||
      event.type === "error" ||
      event.type === "finished"
    ) {
      sessionEntry.currentUtteranceStartedAtMs = null;
      sessionEntry.currentUtteranceLastSeenAtMs = null;
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
          void this.handleTranscriptionEvent(event.meetingId, languageKey, transcriptionEvent);
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
      const timingWindow = this.advanceMeetingAudioClock(meetingId, chunk);
      this.dispatchAudioChunkToMeeting(meetingId, chunk, timingWindow);
    }
  }

  /**
   * Broadcasts raw audio chunks to every active Soniox session for the meeting.
   */
  private dispatchAudioChunkToMeeting(
    meetingId: string,
    audioChunk: Buffer,
    timingWindow?: { startedAtMs: number; endedAtMs: number },
  ) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      return;
    }

    meeting.audioSessions.forEach((sessionEntry) => {
      if (
        timingWindow &&
        sessionEntry.currentUtteranceStartedAtMs !== null &&
        sessionEntry.currentUtteranceLastSeenAtMs !== null
      ) {
        sessionEntry.currentUtteranceLastSeenAtMs = timingWindow.endedAtMs;
      }

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

  private advanceMeetingAudioClock(meetingId: string, audioChunk: Buffer) {
    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      return undefined;
    }

    const durationMs = this.getAudioChunkDurationMs(audioChunk);
    const startedAtMs = meeting.audioCursorMs;
    const endedAtMs = startedAtMs + durationMs;

    meeting.audioClockStarted = true;
    meeting.lastChunkStartedAtMs = startedAtMs;
    meeting.lastChunkEndedAtMs = endedAtMs;
    meeting.audioCursorMs = endedAtMs;

    return {
      startedAtMs,
      endedAtMs,
    };
  }

  private getAudioChunkDurationMs(audioChunk: Buffer) {
    const bytesPerMillisecond = 32;
    return audioChunk.length / bytesPerMillisecond;
  }
}

/**
 * Shared WebSocket controller instance.
 */
export const websocketController = new WebsocketController();
