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
let metricsInterval = null;
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();

process.on("message", (msg) => {
  if (msg.type === "START") {
    handleRtmsStarted(msg.payload, msg.streamId, msg.isPrimary);
  } else if (msg.type === "STOP") {
    handleRtmsStopped(msg.streamId);
  }
});

process.on("uncaughtException", (err) => {
  console.error(`[Worker ${process.pid}] CRITICAL CRASH:`, err);
  process.exit(1);
});

function startMetricsReporting() {
  if (metricsInterval) clearInterval(metricsInterval);

  metricsInterval = setInterval(() => {
    const memory = process.memoryUsage();
    const now = Date.now();
    const currentCpu = process.cpuUsage();
    const userDiff = currentCpu.user - lastCpuUsage.user;
    const sysDiff = currentCpu.system - lastCpuUsage.system;
    const timeDiff = (now - lastCpuTime) * 1000;
    const cpuPercent =
      timeDiff > 0 ? ((userDiff + sysDiff) / timeDiff) * 100 : 0;

    lastCpuUsage = currentCpu;
    lastCpuTime = now;

    if (process.connected) {
      process.send({
        type: "METRICS",
        payload: {
          rss: Math.round(memory.rss / 1024 / 1024),
          heap: Math.round(memory.heapUsed / 1024 / 1024),
          ext: Math.round(memory.external / 1024 / 1024),
          cpu: cpuPercent.toFixed(1),
        },
      });
    }
  }, 2000);
}

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

function handleRtmsStarted(payload, streamId, isPrimary) {
  const meeting_uuid = payload?.meeting_uuid;
  const host_id = payload?.operator_id;
  const encoded_meeting_uuid = encodeURIComponent(meeting_uuid);

  console.log(
    `[Worker ${process.pid}] Starting Meeting ${meeting_uuid} (Role: ${isPrimary ? "PRIMARY" : "STANDBY"})`,
  );

  startMetricsReporting();

  const rtmsClient = new rtms.Client({
    log: { enable: false },
  });

  currentClientEntry = {
    rtmsClient,
    wsClient: null,
    hasLoggedWarning: false,
    streamId,
    isPrimary,
  };

  if (!isPrimary) {
    console.log(
      `[Worker ${process.pid}] Standby mode active. Joining RTMS, but suppressing backend connection.`,
    );
    rtmsClient.join(payload);
    return;
  }

  let hasConnectedOnce = false;

  function connect(retries = 0) {
    if (isStopping) return;

    console.log(
      `[Worker ${process.pid}] Connecting WS to ${BASE_SERVER_URL} (Attempt ${
        retries + 1
      })...`,
    );

    const token = generateAuthToken(host_id);
    const authHeader = { Authorization: `Bearer ${token}` };

    const wsClient = new WebSocket(
      `${ZOOM_BASE_SERVER_URL}/${encoded_meeting_uuid}`,
      { headers: authHeader, handshakeTimeout: 10000 },
    );

    currentClientEntry.wsClient = wsClient;

    wsClient.on("open", () => {
      console.log(`[Worker ${process.pid}] WS Connected`);
      currentClientEntry.hasLoggedWarning = false;

      const meta = {
        meeting_uuid,
        streamId,
        workerPid: process.pid,
      };

      if (!hasConnectedOnce) {
        wsClient.send(
          JSON.stringify({
            type: "session_start",
            payload: meta,
          }),
        );
        hasConnectedOnce = true;
      } else {
        console.log(`[Worker ${process.pid}] Sending session_reconnected...`);
        wsClient.send(
          JSON.stringify({
            type: "session_reconnected",
            payload: meta,
          }),
        );
      }
    });

    wsClient.on("error", (error) => {
      console.error(`[Worker ${process.pid}] WS Error:`, error.message);
    });

    wsClient.on("close", (code, reason) => {
      if (isStopping) return;
      console.log(`[Worker ${process.pid}] WS Closed. Retrying...`);
      const delay = Math.min(1000 * 2 ** retries, 30000);
      setTimeout(() => connect(retries + 1), delay);
    });
  }

  rtmsClient.onAudioData((data, size, timestamp, metadata) => {
    if (!currentClientEntry) return;

    if (!currentClientEntry.isPrimary) return;

    const { wsClient } = currentClientEntry;
    const speakerName = metadata.userName || "Zoom RTMS";

    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      const payload = {
        userName: speakerName,
        audio: data.toString("base64"),
      };
      wsClient.send(JSON.stringify(payload));
    }
  });

  rtmsClient.join(payload);
  connect();
}

function handleRtmsStopped(streamId) {
  isStopping = true;
  if (metricsInterval) clearInterval(metricsInterval);

  if (!currentClientEntry) {
    process.exit(0);
    return;
  }

  const { rtmsClient, wsClient, isPrimary } = currentClientEntry;

  try {
    rtmsClient.leave();
  } catch (err) {}

  if (isPrimary) {
    try {
      if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        console.log(`[Worker ${process.pid}] Sending session_end...`);
        wsClient.send(JSON.stringify({ type: "session_end" }));
      }
    } catch (err) {}

    try {
      if (wsClient) wsClient.close();
    } catch (err) {}
  }

  console.log(`[Worker ${process.pid}] Stopping...`);
  process.exit(0);
}
