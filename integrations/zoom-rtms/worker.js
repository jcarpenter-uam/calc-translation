import "dotenv/config";
import rtms from "@zoom/rtms";
import { WebSocket } from "ws";
import jwt from "jsonwebtoken";

const BASE_SERVER_URL =
  process.env.BASE_SERVER_URL || "ws://localhost:8000/ws/transcribe";
const ZOOM_BASE_SERVER_URL = `${BASE_SERVER_URL}/zoom`;
const ZM_PRIVATE_KEY = process.env.ZM_PRIVATE_KEY;

let currentClientEntry = null;
let isStopping = false;

process.on("message", (msg) => {
  if (msg.type === "START") {
    handleRtmsStarted(msg.payload, msg.streamId);
  } else if (msg.type === "STOP") {
    handleRtmsStopped(msg.streamId);
  }
});

process.on("uncaughtException", (err) => {
  console.error("CRITICAL WORKER CRASH:", err);
  process.exit(1);
});

function generateAuthToken(host_id) {
  const payload = {
    iss: "zoom-rtms-service",
    iat: Math.floor(Date.now() / 1000),
    aud: "python-backend",
    zoom_host_id: host_id,
  };
  return jwt.sign(payload, ZM_PRIVATE_KEY, {
    expiresIn: "5m",
    algorithm: "RS256",
  });
}

function handleRtmsStarted(payload, streamId) {
  const meeting_uuid = payload?.meeting_uuid;
  const host_id = payload?.operator_id;
  const encoded_meeting_uuid = encodeURIComponent(meeting_uuid);

  console.log(
    `Starting worker for Meeting ${meeting_uuid} (Stream: ${streamId})`,
  );

  const rtmsClient = new rtms.Client({
    log: { enable: false },
  });

  currentClientEntry = {
    rtmsClient,
    wsClient: null,
    hasLoggedWarning: false,
    streamId,
  };

  function connect(retries = 0) {
    if (isStopping) {
      console.log("Stream stopping, aborting WebSocket connect.");
      return;
    }

    console.log(
      `Attempting WebSocket connection to ${BASE_SERVER_URL} (attempt ${retries + 1})...`,
    );

    const token = generateAuthToken(host_id);
    const authHeader = { Authorization: `Bearer ${token}` };

    const wsClient = new WebSocket(
      `${ZOOM_BASE_SERVER_URL}/${encoded_meeting_uuid}`,
      {
        headers: authHeader,
        handshakeTimeout: 10000,
      },
    );

    currentClientEntry.wsClient = wsClient;

    wsClient.on("open", () => {
      console.log(`WebSocket connection established for stream ${streamId}`);
      currentClientEntry.hasLoggedWarning = false;
      retries = 0;
    });

    wsClient.on("error", (error) => {
      console.error(`WebSocket error for stream ${streamId}:`, error);
    });

    wsClient.on("close", (code, reason) => {
      if (isStopping) return;

      console.log(
        `WebSocket closed for stream ${streamId}. Code: ${code}, Reason: ${reason}`,
      );

      const nextRetries = retries + 1;
      const delay = Math.min(1000 * 2 ** retries, 30000);

      console.log(
        `Will retry WebSocket connection in ${delay / 1000} seconds...`,
      );
      setTimeout(() => connect(nextRetries), delay);
    });
  }

  rtmsClient.onAudioData((data, size, timestamp, metadata) => {
    if (!currentClientEntry) return;

    const { wsClient } = currentClientEntry;
    const speakerName = metadata.userName || "Zoom RTMS";

    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      const payload = {
        userName: speakerName,
        audio: data.toString("base64"),
      };
      wsClient.send(JSON.stringify(payload));
    } else {
      if (!currentClientEntry.hasLoggedWarning) {
        console.warn(
          `WebSocket not open for stream ${streamId}. Skipping audio packets.`,
        );
        currentClientEntry.hasLoggedWarning = true;
      }
    }
  });

  console.log(`Joining RTMS for meeting: ${meeting_uuid}`);
  rtmsClient.join(payload);

  connect();
}

function handleRtmsStopped(streamId) {
  isStopping = true;

  if (!currentClientEntry) {
    process.exit(0);
    return;
  }

  const { rtmsClient, wsClient } = currentClientEntry;
  console.log(`Cleaning up clients for stream: ${streamId}`);

  try {
    rtmsClient.leave();
  } catch (err) {
    console.error("Error leaving RTMS:", err);
  }

  try {
    if (wsClient) wsClient.close();
  } catch (err) {
    console.error("Error closing WebSocket:", err);
  }

  console.log(`Worker stopping for stream ${streamId}`);
  process.exit(0);
}
