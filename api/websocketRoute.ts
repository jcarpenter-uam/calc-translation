import { Elysia, t } from "elysia";
import { websocketController } from "../controllers/websocketControllers";

export const websocketRoute = new Elysia().ws("/ws", {
  body: t.Any(),
  open(ws) {
    websocketController.addGlobalSubscriber(ws);
    ws.send(
      JSON.stringify({ status: "Connected and subscribed to global events" }),
    );
  },
  message(ws, message) {
    // Handle incoming raw audio data (Binary Frames)
    if (
      Buffer.isBuffer(message) ||
      message instanceof Uint8Array ||
      message instanceof ArrayBuffer
    ) {
      const bufferChunk = Buffer.isBuffer(message)
        ? message
        : Buffer.from(message as ArrayBuffer | Uint8Array);

      // Note: Passing ws.id instead of ws
      websocketController.handleAudio(ws.id, bufferChunk);
      return;
    }

    // Fallback: If Elysia parses the binary frame into an empty object, force it to Buffer
    if (
      typeof message === "object" &&
      message !== null &&
      !("action" in (message as any))
    ) {
      websocketController.handleAudio(ws.id, Buffer.from(message as any));
      return;
    }

    // Handle incoming JSON commands
    let parsed = message;
    if (typeof message === "string") {
      try {
        parsed = JSON.parse(message);
      } catch (e) {
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
    websocketController.removeSubscriber(ws);
  },
});
