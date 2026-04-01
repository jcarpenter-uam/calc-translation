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

        await websocketController.sendTranscriptHistoryToSocket(
          payload.meetingId,
          ws,
        );

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
