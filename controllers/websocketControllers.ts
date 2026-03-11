import { SonioxNodeClient } from "@soniox/node";
import type { ElysiaWS } from "elysia/ws";
import { env } from "../core/config";

interface Participant {
  id: string;
  socket: ElysiaWS<any, any, any>;
}

interface Meeting {
  id: string;
  participants: Map<string, Participant>;
  sonioxSession: any; // Type from @soniox/node
}

export class WebsocketController {
  private meetings = new Map<string, Meeting>();
  private globalSubscribers = new Set<ElysiaWS<any, any, any>>();
  private sonioxClient = new SonioxNodeClient({ apiKey: env.SONIOX_API_KEY });

  // --- State Management ---
  createMeeting(meetingId: string) {
    const session = this.sonioxClient.realtime.stt({ model: "stt-rt-v4" });

    // Broadcast transcription to global and meeting-scoped listeners
    session.on("result", (result: any) => {
      const text = result.tokens.map((t: any) => t.text).join("");
      if (!text) return;

      const payload = { type: "transcription", meetingId, text };
      this.broadcastToMeeting(meetingId, payload);
    });

    this.meetings.set(meetingId, {
      id: meetingId,
      participants: new Map(),
      sonioxSession: session,
    });

    return session;
  }

  // --- Subscription Logic ---
  addGlobalSubscriber(ws: ElysiaWS<any, any, any>) {
    this.globalSubscribers.add(ws);
  }

  getMeeting(id: string) {
    return this.meetings.get(id);
  }

  joinMeeting(
    meetingId: string,
    participantId: string,
    ws: ElysiaWS<any, any, any>,
  ) {
    const meeting = this.meetings.get(meetingId);
    if (meeting) {
      meeting.participants.set(participantId, {
        id: participantId,
        socket: ws,
      });
    }
  }

  removeSubscriber(ws: ElysiaWS<any, any, any>) {
    this.globalSubscribers.delete(ws);
    this.meetings.forEach((m) => {
      m.participants.forEach((p, id) => {
        if (p.socket === ws) m.participants.delete(id);
      });
    });
  }

  deleteMeeting(id: string) {
    const meeting = this.meetings.get(id);

    if (meeting) {
      // Notify all participants before removing the meeting from memory
      const disconnectMsg = JSON.stringify({
        type: "status",
        message: `Meeting ${id} has been ended by the host.`,
      });

      meeting.participants.forEach((p) => {
        try {
          p.socket.send(disconnectMsg);
        } catch (e) {
          // Socket may already be closed
        }
      });

      // Remove the meeting object entirely from the in-memory Map
      this.meetings.delete(id);
    }
  }

  private broadcastToMeeting(meetingId: string, data: any) {
    this.meetings
      .get(meetingId)
      ?.participants.forEach((p) => p.socket.send(data));
  }

  private broadcastGlobal(data: any) {
    this.globalSubscribers.forEach((ws) => ws.send(data));
  }
}

export const websocketController = new WebsocketController();
