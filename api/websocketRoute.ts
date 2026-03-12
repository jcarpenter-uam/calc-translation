import { Elysia, t } from "elysia";
import { websocketController } from "../controllers/websocketController";

export const websocketRoute = new Elysia().ws("/ws", {
  // We use t.Any() instead of a strict schema so Elysia's validator doesn't
  // intercept and silently drop raw binary audio frames from the client.
  body: t.Any(),

  open(ws) {
    websocketController.addGlobalSubscriber(ws);
    ws.send(
      JSON.stringify({ status: "Connected and subscribed to global events" }),
    );
  },

  message(ws, message) {
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
        : Buffer.from(message as ArrayBuffer | Uint8Array);

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
        // TODO: Replace this with real JWT/session validation later
        if (
          !payload.token ||
          typeof payload.token !== "string" ||
          !payload.token.startsWith("token_")
        ) {
          // Send an error message back to the client
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Unauthorized: Missing or invalid token",
            }),
          );
          // Close the WebSocket connection with a policy violation code (1008)
          ws.close(1008, "Unauthorized");
          return; // Exit early so they don't join the meeting
        }

        websocketController.joinMeeting(
          payload.meetingId,
          payload.participantId || "anon",
          ws,
        );
        ws.send(
          JSON.stringify({ status: `Subscribed to ${payload.meetingId}` }),
        );
      }
    }
  },

  close(ws) {
    // Trigger cleanup in the controller when a client drops the connection
    websocketController.removeSubscriber(ws);
  },
});
