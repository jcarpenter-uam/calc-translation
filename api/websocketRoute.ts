import { Elysia, t } from "elysia";
import { websocketController } from "../controllers/websocketController";
import { logger } from "../core/logger";

export const websocketRoute = new Elysia().ws("/ws", {
  // We use t.Any() instead of a strict schema so Elysia's validator doesn't
  // intercept and silently drop raw binary audio frames from the client.
  body: t.Any(),

  open(ws) {
    // Extract the securely validated user from the middleware context
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

    // Raw Audio
    // If the incoming message is raw bytes, we assume it's microphone audio.
    if (
      Buffer.isBuffer(message) ||
      message instanceof Uint8Array ||
      message instanceof ArrayBuffer
    ) {
      // The Soniox SDK specifically requires a standard Node.js Buffer.
      // We convert ArrayBuffers/Uint8Arrays if necessary.
      const bufferChunk = Buffer.isBuffer(message)
        ? message
        : message instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(message))
          : Buffer.from(message);

      // Pass the stable ws.id and the audio buffer to the controller for routing
      websocketController.handleAudio(ws.id, bufferChunk);
      return; // Exit early so we don't try to parse audio as JSON
    }

    // Fallback binary check
    // Sometimes (especially from non-browser clients), Elysia misparses binary
    // frames as an empty object `{}`. This fallback catches that edge case
    // and forces it into a Buffer so the audio isn't lost.
    if (
      typeof message === "object" &&
      message !== null &&
      !("action" in (message as any))
    ) {
      websocketController.handleAudio(ws.id, Buffer.from(message as any));
      return;
    }

    // JSON commands
    let parsed = message;

    // If the client sent a stringified JSON payload, parse it first
    if (typeof message === "string") {
      try {
        parsed = JSON.parse(message);
      } catch (e) {
        logger.debug("Ignoring invalid WebSocket JSON payload.", {
          socketId: ws.id,
        });
        return; // Silently ignore invalid JSON strings
      }
    }

    // Check if the payload is a valid command object containing an "action"
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "action" in (parsed as any)
    ) {
      const payload = parsed as any;

      // Route the specific actions to the controller
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

    // Trigger cleanup in the controller when a client drops the connection
    websocketController.removeSubscriber(ws);
  },
});
