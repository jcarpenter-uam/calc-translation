import rtms from "@zoom/rtms";
import { WebSocket } from "ws";

const TRANSCRIPTION_SERVER_URL = "ws://localhost:8000/ws/transcribe";

let clients = new Map();

rtms.onWebhookEvent(({ event, payload }) => {
  const streamId = payload?.rtms_stream_id;

  if (event == "meeting.rtms_stopped") {
    if (!streamId) {
      console.log(`Received meeting.rtms_stopped event without stream ID`);
      return;
    }

    const session = clients.get(streamId);
    if (!session) {
      console.log(
        `Received meeting.rtms_stopped event for unknown stream ID: ${streamId}`,
      );
      return;
    }

    session.zoomClient.leave();
    if (session.wsClient) {
      session.wsClient.close();
      console.log(`Closed WebSocket connection for stream: ${streamId}`);
    }
    clients.delete(streamId);

    return;
  } else if (event !== "meeting.rtms_started") {
    console.log(`Ignoring unknown event: ${event}`);
    return;
  }

  console.log(`RTMS stream started for stream ID: ${streamId}`);

  const wsClient = new WebSocket(TRANSCRIPTION_SERVER_URL);

  wsClient.on("open", () => {
    console.log(`WebSocket connection opened for stream: ${streamId}`);
  });

  wsClient.on("error", (error) => {
    console.error(`WebSocket error for stream ${streamId}:`, error);
  });

  wsClient.on("close", () => {
    console.log(`WebSocket connection closed for stream: ${streamId}`);
  });

  const zoomClient = new rtms.Client();

  clients.set(streamId, { zoomClient, wsClient });

  zoomClient.onTranscriptData((data, size, timestamp, metadata) => {
    console.log(`[${timestamp}] -- ${metadata.userName}: ${data}`);
  });

  zoomClient.onAudioData((data, size, timestamp, metadata) => {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(data);
    }
  });

  const video_params = {
    contentType: rtms.VideoContentType.RAW_VIDEO,
    codec: rtms.VideoCodec.H264,
    resolution: rtms.VideoResolution.SD,
    dataOpt: rtms.VideoDataOption.VIDEO_SINGLE_ACTIVE_STREAM,
    fps: 30,
  };

  zoomClient.setVideoParams(video_params);
  zoomClient.onVideoData((data, size, timestamp, metadata) => {
    console.log(
      `Received ${size} bytes of video data at ${timestamp} from ${metadata.userName}`,
    );
  });

  zoomClient.setDeskshareParams(video_params);
  zoomClient.onDeskshareData((data, size, timestamp, metadata) => {
    console.log(
      `Received ${size} bytes of deskshare data at ${timestamp} from ${metadata.userName}`,
    );
  });

  zoomClient.join(payload);
});
