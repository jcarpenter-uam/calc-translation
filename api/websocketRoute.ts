import { Elysia, t } from "elysia";
import { websocketController } from "../controllers/websocketController";
import { logger } from "../core/logger";
import { db } from "../core/database";
import { meetings } from "../models/meetingModel";
import { eq } from "drizzle-orm";
import { canAccessMeetingRecord } from "../utils/accessPolicy";

async function canSubscribeToMeeting(meetingId: string, wsUser: any, wsTenantId: string | null) {
  const [meeting] = await db
    .select({
      host_id: meetings.host_id,
      attendees: meetings.attendees,
      tenant_id: meetings.tenant_id,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId));

  if (!meeting || !wsUser) {
    return false;
  }

  return canAccessMeetingRecord(meeting, wsUser, wsTenantId);
}

/**
 * WebSocket route for authenticated meeting subscriptions and audio streaming.
 */
export const websocketRoute = new Elysia().ws("/ws", {
  // Audio frames arrive as raw binary, so schema validation needs to stay permissive here.
  body: t.Any(),

  open(ws) {
    const user = (ws.data as any).wsUser;

    logger.debug("WebSocket connected.", {
      userId: user?.id,
      socketId: ws.id,
    });

    websocketController.addGlobalSubscriber(ws);
    ws.send(JSON.stringify({ status: "Connected and authenticated" }));
  },

  async message(ws, message) {
    const user = (ws.data as any).wsUser;
    const wsTenantId = (ws.data as any).wsTenantId ?? null;

    // Host microphone chunks are forwarded without JSON parsing to keep the audio path minimal.
    if (
      Buffer.isBuffer(message) ||
      message instanceof Uint8Array ||
      message instanceof ArrayBuffer
    ) {
      const bufferChunk = Buffer.isBuffer(message)
        ? message
        : message instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(message))
          : Buffer.from(message);

      websocketController.handleAudio(ws.id, bufferChunk);
      return;
    }

    // Some runtimes surface binary payloads as plain objects instead of Buffers.
    if (
      typeof message === "object" &&
      message !== null &&
      !("action" in (message as any))
    ) {
      websocketController.handleAudio(ws.id, Buffer.from(message as any));
      return;
    }

    let parsed = message;

    if (typeof message === "string") {
      try {
        parsed = JSON.parse(message);
      } catch (e) {
        logger.debug("Ignoring invalid WebSocket JSON payload.", {
          socketId: ws.id,
        });
        return;
      }
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "action" in (parsed as any)
    ) {
      const payload = parsed as any;

      if (payload.action === "subscribe_meeting" && payload.meetingId) {
        const secureParticipantId = user?.id || "unknown_user";
        logger.debug("Processing meeting subscription request.", {
          userId: secureParticipantId,
          meetingId: payload.meetingId,
          socketId: ws.id,
          viewerLanguage: user?.languageCode || null,
          tenantId: wsTenantId,
        });

        const isAuthorized = await canSubscribeToMeeting(
          payload.meetingId,
          user,
          wsTenantId,
        );

        if (!isAuthorized) {
          logger.warn("WebSocket meeting subscription denied.", {
            userId: secureParticipantId,
            meetingId: payload.meetingId,
            tenantId: wsTenantId,
            socketId: ws.id,
          });
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Not authorized to subscribe to this meeting",
              meetingId: payload.meetingId,
            }),
          );
          return;
        }

        websocketController.joinMeeting(
          payload.meetingId,
          secureParticipantId,
          ws,
        );

        if (typeof user?.languageCode === "string" && user.languageCode.trim()) {
          const sessionResult = await websocketController.ensureParticipantLanguageSession(
            payload.meetingId,
            user.languageCode,
          );
          if (!sessionResult.ok) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: sessionResult.error,
                meetingId: payload.meetingId,
              }),
            );
            return;
          }
        }

        const shouldBackfill = await websocketController.shouldBackfillTranscriptHistoryOnSubscribe(
          payload.meetingId,
          user?.languageCode,
        );
        logger.debug("Evaluated subscribe-time transcript backfill.", {
          userId: secureParticipantId,
          meetingId: payload.meetingId,
          socketId: ws.id,
          viewerLanguage: user?.languageCode || null,
          shouldBackfill,
        });

        if (shouldBackfill) {
          websocketController.setTranscriptState(
            payload.meetingId,
            user?.languageCode || "",
            "backfilling",
          );

          logger.debug("Starting subscribe-time transcript backfill.", {
            userId: secureParticipantId,
            meetingId: payload.meetingId,
            socketId: ws.id,
            viewerLanguage: user?.languageCode || null,
          });

          try {
            await websocketController.sendBackfilledTranscriptHistoryToSocket(
              payload.meetingId,
              ws,
              user?.languageCode,
            );
          } catch (error) {
            logger.error("Subscribe-time transcript backfill failed.", {
              userId: secureParticipantId,
              meetingId: payload.meetingId,
              socketId: ws.id,
              viewerLanguage: user?.languageCode || null,
              errorMessage: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : undefined,
            });
            ws.send(
              JSON.stringify({
                type: "status",
                event: "backfill_failed",
                meetingId: payload.meetingId,
                languageCode: user?.languageCode || null,
                message: "Transcript history backfill failed.",
              }),
            );
          }
        }
        else {
          await websocketController.sendTranscriptHistoryToSocket(
            payload.meetingId,
            ws,
          );
        }

        await websocketController.prepareHostAudio(
          payload.meetingId,
          secureParticipantId,
        );

        logger.debug(
          "WebSocket user subscribed to meeting.",
          {
            userId: secureParticipantId,
            meetingId: payload.meetingId,
            socketId: ws.id,
          },
        );

        ws.send(
          JSON.stringify({ status: `Subscribed to ${payload.meetingId}` }),
        );

        const snapshot = websocketController.getMeetingPresenceSnapshot(
          payload.meetingId,
        );
        ws.send(
          JSON.stringify({
            type: "presence",
            event: "snapshot",
            meetingId: payload.meetingId,
            participants: snapshot.participants,
            connectedCount: snapshot.connectedCount,
          }),
        );
        return;
      }

      if (payload.action === "audio_started") {
        websocketController.setHostAudioState(ws.id, true);
        return;
      }

      if (payload.action === "audio_stopped") {
        websocketController.setHostAudioState(ws.id, false);
        return;
      }

      if (
        payload.action === "switch_language" &&
        payload.meetingId &&
        typeof payload.languageCode === "string"
      ) {
        const secureParticipantId = user?.id || "unknown_user";
        const subscribedMeetingId = websocketController.getMeetingBySocket(ws.id);
        if (subscribedMeetingId !== payload.meetingId) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Socket is not subscribed to the requested meeting",
              meetingId: payload.meetingId,
            }),
          );
          return;
        }

        try {
          logger.debug("Processing transcript language switch request.", {
            userId: secureParticipantId,
            meetingId: payload.meetingId,
            socketId: ws.id,
            requestedLanguage: payload.languageCode,
            currentLanguage: user?.languageCode || (ws.data as any)?.wsUser?.languageCode || null,
          });
          const sessionResult = await websocketController.ensureParticipantLanguageSession(
            payload.meetingId,
            payload.languageCode,
          );
          if (!sessionResult.ok) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: sessionResult.error,
                meetingId: payload.meetingId,
              }),
            );
            return;
          }

          const updated = websocketController.updateParticipantLanguage(
            payload.meetingId,
            secureParticipantId,
            payload.languageCode,
          );
          if (!updated) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Unable to switch transcript language",
                meetingId: payload.meetingId,
              }),
            );
            return;
          }

          websocketController.setTranscriptState(
            payload.meetingId,
            payload.languageCode,
            "backfilling",
          );

          await websocketController.sendBackfilledTranscriptHistoryToSocket(
            payload.meetingId,
            ws,
            payload.languageCode,
          );
        } catch (error) {
          logger.error("Failed sending backfilled transcript history after language switch.", {
            userId: secureParticipantId,
            meetingId: payload.meetingId,
            languageCode: payload.languageCode,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
          });
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Failed to backfill transcript history for the selected language",
              meetingId: payload.meetingId,
            }),
          );
        }
        return;
      }
    }
  },

  close(ws) {
    const user = (ws.data as any).wsUser;
    logger.debug("WebSocket disconnected.", {
      userId: user?.id,
      socketId: ws.id,
    });

    websocketController.removeSubscriber(ws);
  },
});
