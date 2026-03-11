import { Elysia, t } from "elysia";
import { websocketController } from "../controllers/websocketControllers";

export const websocketRoute = new Elysia()
  // WebSocket Endpoint for Subscriptions
  .ws("/ws", {
    body: t.Object({
      action: t.String(), // "subscribe_global" or "subscribe_meeting"
      meetingId: t.Optional(t.String()),
      participantId: t.Optional(t.String()),
    }),
    message(ws, message) {
      if (message.action === "subscribe_global") {
        websocketController.addGlobalSubscriber(ws);
        ws.send({ status: "Subscribed to all meetings" });
      }

      if (message.action === "subscribe_meeting" && message.meetingId) {
        websocketController.joinMeeting(
          message.meetingId,
          message.participantId || "anon",
          ws,
        );
        ws.send({ status: `Subscribed to ${message.meetingId}` });
      }
    },
    close(ws) {
      websocketController.removeSubscriber(ws);
    },
  });
