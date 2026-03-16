import { Elysia, t } from "elysia";
import { websocketController } from "../controllers/websocketController";
import { logger } from "../core/logger";

/**
 * WebSocket route for authenticated meeting subscriptions and audio streaming.
 */
export const websocketRoute = new Elysia().ws("/ws", {
  // Accept binary audio frames without schema coercion.
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

  message(ws, message) {
    const user = (ws.data as any).wsUser;

    // Route raw bytes directly as microphone audio.
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

    // Handle edge-case binary frames parsed as plain objects.
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

        websocketController.joinMeeting(
          payload.meetingId,
          secureParticipantId,
          ws,
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
