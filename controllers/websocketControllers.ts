import { SonioxNodeClient } from "@soniox/node";
import type { ElysiaWS } from "elysia/ws";
import { env } from "../core/config";
import { logger } from "../core/logger";

interface Participant {
  id: string;
  socket: ElysiaWS<any, any, any>;
}

interface Meeting {
  id: string;
  participants: Map<string, Participant>;
  sonioxSession: any;
}

export class WebsocketController {
  private meetings = new Map<string, Meeting>();

  // Track by string IDs instead of ElysiaWS Proxy objects!
  private globalSubscribers = new Map<string, ElysiaWS<any, any, any>>();
  private socketToMeeting = new Map<string, string>();

  private sonioxClient = new SonioxNodeClient({ apiKey: env.SONIOX_API_KEY });

  // --- State Management ---
  createMeeting(meetingId: string) {
    const session = this.sonioxClient.realtime.stt({
      model: "stt-rt-v4",
      audio_format: "pcm_s16le",
      sample_rate: 16000,
      num_channels: 1,
      enable_endpoint_detection: true,
    });

    session.on("result", (result: any) => {
      const text = result.tokens.map((t: any) => t.text).join("");
      if (!text) return;

      const payload = JSON.stringify({
        type: "transcription",
        meetingId,
        text,
      });
      this.broadcastToMeeting(meetingId, payload);
    });

    this.meetings.set(meetingId, {
      id: meetingId,
      participants: new Map(),
      sonioxSession: session,
    });

    return session;
  }

  // --- Subscription & Audio Logic ---
  addGlobalSubscriber(ws: ElysiaWS<any, any, any>) {
    this.globalSubscribers.set(ws.id, ws);
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
      // Map the stable string ID to the meeting
      this.socketToMeeting.set(ws.id, meetingId);
    }
  }

  handleAudio(wsId: string, audioChunk: Buffer) {
    const meetingId = this.socketToMeeting.get(wsId);

    if (!meetingId) {
      logger.error(
        `Audio dropped: Socket ${wsId} is not mapped to an active meeting.`,
      );
      return;
    }

    const meeting = this.meetings.get(meetingId);
    if (meeting && meeting.sonioxSession) {
      try {
        meeting.sonioxSession.sendAudio(audioChunk);
      } catch (err) {
        logger.error("Error sending audio to Soniox:", err);
      }
    }
  }

  removeSubscriber(ws: ElysiaWS<any, any, any>) {
    this.globalSubscribers.delete(ws.id);
    this.socketToMeeting.delete(ws.id);

    this.meetings.forEach((m) => {
      m.participants.forEach((p, id) => {
        if (p.socket.id === ws.id) m.participants.delete(id);
      });
    });
  }

  deleteMeeting(id: string) {
    const meeting = this.meetings.get(id);

    if (meeting) {
      const disconnectMsg = JSON.stringify({
        type: "status",
        message: `Meeting ${id} has been ended by the host.`,
      });

      meeting.participants.forEach((p) => {
        try {
          p.socket.send(disconnectMsg);
        } catch (e) {}
      });

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
