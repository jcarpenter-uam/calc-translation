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

function log(msg) {
  console.log(`[${new Date().toISOString()}][Worker ${process.pid}] ${msg}`);
}

process.on("message", (msg) => {
  if (msg.type === "START") {
    handleRtmsStarted(msg.payload, msg.streamId, msg.isPrimary);
  } else if (msg.type === "STOP") {
    handleRtmsStopped(msg.streamId);
  } else if (msg.type === "PROMOTE") {
    handlePromotion();
  }
});

process.on("uncaughtException", (err) => {
  console.error(
    `[${new Date().toISOString()}][Worker ${process.pid}] CRITICAL CRASH:`,
    err,
  );
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

function handlePromotion() {
  if (!currentClientEntry || isStopping) {
    log(
      "Received PROMOTE command but worker is stopping or invalid. Ignoring.",
    );
    return;
  }

  log("Received PROMOTE command. Promoting STANDBY -> PRIMARY.");
  currentClientEntry.isPrimary = true;

  if (currentClientEntry.connect) {
    log("Initiating backend connection for promoted session...");
    currentClientEntry.connect(0, true);
  } else {
    log("Error: No connect function available during promotion.");
  }
}

function handleRtmsStarted(payload, streamId, isPrimary) {
  const meeting_uuid = payload?.meeting_uuid;
  const host_id = payload?.operator_id;
  const encoded_meeting_uuid = encodeURIComponent(meeting_uuid);

  log(
    `Starting. Stream: ${streamId}, Role: ${isPrimary ? "PRIMARY" : "STANDBY"}`,
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
    connect: null,
  };

  let hasConnectedOnce = false;

  function connect(retries = 0, isPromoted = false) {
    if (isStopping) return;

    if (retries === 0) {
      log(
        `Connecting to backend: ${ZOOM_BASE_SERVER_URL}/${encoded_meeting_uuid}`,
      );
    }

    const token = generateAuthToken(host_id);
    const authHeader = { Authorization: `Bearer ${token}` };

    const wsClient = new WebSocket(
      `${ZOOM_BASE_SERVER_URL}/${encoded_meeting_uuid}`,
      { headers: authHeader, handshakeTimeout: 10000 },
    );

    currentClientEntry.wsClient = wsClient;

    wsClient.on("open", () => {
      log("Backend WebSocket Connected (OPEN).");
      currentClientEntry.hasLoggedWarning = false;

      const meta = {
        meeting_uuid,
        streamId,
        workerPid: process.pid,
      };

      if (!hasConnectedOnce && !isPromoted) {
        log("Sending 'session_start'...");
        wsClient.send(
          JSON.stringify({
            type: "session_start",
            payload: meta,
          }),
        );
        hasConnectedOnce = true;
      } else {
        log("Sending 'session_reconnected' (Resume/Failover)...");
        wsClient.send(
          JSON.stringify({
            type: "session_reconnected",
            payload: meta,
          }),
        );
        hasConnectedOnce = true;
      }
    });

    wsClient.on("error", (error) => {
      if (!isStopping) log(`Backend WebSocket Error: ${error.message}`);
    });

    wsClient.on("close", (code, reason) => {
      if (isStopping) {
        log("Backend WebSocket Closed (Clean Shutdown).");
        return;
      }

      const delay = Math.min(1000 * 2 ** retries, 30000);
      log(
        `Backend WebSocket Closed unexpectedly. Reconnecting in ${delay}ms... (Attempt ${retries + 1})`,
      );
      setTimeout(() => connect(retries + 1, isPromoted), delay);
    });
  }

  currentClientEntry.connect = connect;

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

  log("Joining Zoom RTMS channel...");
  rtmsClient.join(payload);

  if (isPrimary) {
    connect();
  } else {
    log(
      "Standby Mode: Joined Zoom RTMS, but waiting for PROMOTE signal to connect backend.",
    );
  }
}

function handleRtmsStopped(streamId) {
  log("Received STOP command.");
  isStopping = true;
  if (metricsInterval) clearInterval(metricsInterval);

  if (!currentClientEntry) {
    log("No active client entry found. Exiting immediately.");
    process.exit(0);
    return;
  }

  const { rtmsClient, wsClient, isPrimary } = currentClientEntry;

  try {
    log("Leaving RTMS channel...");
    rtmsClient.leave();
  } catch (err) {
    log(`Error leaving RTMS: ${err.message}`);
  }

  if (isPrimary && wsClient && wsClient.readyState === WebSocket.OPEN) {
    log("Sending 'session_end' to backend...");
    wsClient.send(JSON.stringify({ type: "session_end" }), (err) => {
      if (err) log(`Error sending session_end: ${err.message}`);
      else log("session_end sent successfully.");

      try {
        wsClient.close();
      } catch (e) {}

      log("Exiting process (Primary).");
      setTimeout(() => process.exit(0), 100);
    });
  } else {
    if (wsClient) {
      try {
        wsClient.close();
      } catch (e) {}
    }
    log("Exiting process (Standby or Disconnected).");
    process.exit(0);
  }
}
