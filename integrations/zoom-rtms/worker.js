import "dotenv/config";
import rtms from "@zoom/rtms";
import { WebSocket } from "ws";
import pino from "pino";
import jwt from "jsonwebtoken";
import pretty from "pino-pretty";

const BASE_SERVER_URL =
  process.env.BASE_SERVER_URL || "ws://localhost:8000/ws/transcribe";
const ZOOM_BASE_SERVER_URL = `${BASE_SERVER_URL}/zoom`;
const ZM_PRIVATE_KEY = process.env.ZM_PRIVATE_KEY;
const logDir = "logs";

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

  if (currentClientEntry?.meetingLogger) {
    try {
      currentClientEntry.meetingLogger.fatal(err, "WORKER UNCAUGHT EXCEPTION");
    } catch (e) {}
  }
  process.exit(1);
});

function getTimestamp() {
  const d = new Date();
  const YYYY = d.getFullYear();
  const MM = (d.getMonth() + 1).toString().padStart(2, "0");
  const DD = d.getDate().toString().padStart(2, "0");
  const HH = d.getHours().toString().padStart(2, "0");
  const MIN = d.getMinutes().toString().padStart(2, "0");
  const SS = d.getSeconds().toString().padStart(2, "0");
  return `${YYYY}-${MM}-${DD}_${HH}-${MIN}-${SS}`;
}

function createMeetingLogger(meeting_uuid) {
  const timestamp = getTimestamp();
  const safe_uuid = meeting_uuid.replace(/\//g, "_");
  const fileName = `${safe_uuid}_${timestamp}.log`;
  const logPath = `${logDir}/${fileName}`;

  const fileStream = pretty({
    destination: pino.destination({
      dest: logPath,
      sync: true,
      mkdir: true,
      append: true,
    }),
    colorize: false,
  });

  const consoleStream = pretty({
    destination: pino.destination({ fd: 1, sync: true }),
    colorize: true,
  });

  const fileLogger = pino(fileStream);
  const consoleLogger = pino(consoleStream);

  const dualLogger = {
    info: (msg) => {
      fileLogger.info(msg);
      consoleLogger.info(msg);
    },
    warn: (msg) => {
      fileLogger.warn(msg);
      consoleLogger.warn(msg);
    },
    error: (err, msg) => {
      fileLogger.error(err, msg);
      consoleLogger.error(err, msg);
    },
    fatal: (err, msg) => {
      fileLogger.fatal(err, msg);
      consoleLogger.fatal(err, msg);
    },
  };

  dualLogger.info(
    `--- Log for Meeting ${meeting_uuid} started at ${timestamp} ---`,
  );

  return { logger: dualLogger, transport: { end: (cb) => cb && cb() } };
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

function handleRtmsStarted(payload, streamId) {
  const meeting_uuid = payload?.meeting_uuid;
  const host_id = payload?.operator_id;
  const encoded_meeting_uuid = encodeURIComponent(meeting_uuid);

  const { logger: meetingLogger, transport: meetingTransport } =
    createMeetingLogger(meeting_uuid);

  const rtmsClient = new rtms.Client({
    log: { enable: false },
  });

  currentClientEntry = {
    rtmsClient,
    wsClient: null,
    meetingLogger,
    meetingTransport,
    hasLoggedWarning: false,
    streamId,
  };

  function connect(retries = 0) {
    if (isStopping) {
      meetingLogger.info("Stream stopping, aborting WebSocket connect.");
      return;
    }

    meetingLogger.info(
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
      meetingLogger.info(
        `WebSocket connection to ${BASE_SERVER_URL} established for stream ${streamId}`,
      );
      currentClientEntry.hasLoggedWarning = false;
      retries = 0;
    });

    wsClient.on("error", (error) => {
      meetingLogger.error(error, `WebSocket error for stream ${streamId}`);
    });

    wsClient.on("close", (code, reason) => {
      if (isStopping) {
        return;
      }

      meetingLogger.info(
        `WebSocket connection for stream ${streamId} closed. Code: ${code}, Reason: ${reason.toString()}`,
      );

      const nextRetries = retries + 1;
      const delay = Math.min(1000 * 2 ** retries, 30000);

      meetingLogger.info(
        `Will retry WebSocket connection in ${delay / 1000} seconds...`,
      );
      setTimeout(() => connect(nextRetries), delay);
    });
  }

  rtmsClient.onAudioData((data, size, timestamp, metadata) => {
    if (!currentClientEntry) return;

    const { wsClient, meetingLogger } = currentClientEntry;
    const speakerName = metadata.userName || "Zoom RTMS";

    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
      const payload = {
        userName: speakerName,
        audio: data.toString("base64"),
      };
      wsClient.send(JSON.stringify(payload));
    } else {
      if (!currentClientEntry.hasLoggedWarning) {
        meetingLogger.warn(
          `WebSocket not open for stream ${streamId}. Skipping audio packets until reconnected.`,
        );
        currentClientEntry.hasLoggedWarning = true;
      }
    }
  });

  meetingLogger.info(`Joining RTMS for meeting: ${meeting_uuid}`);
  rtmsClient.join(payload);

  connect();
}

function handleRtmsStopped(streamId) {
  isStopping = true;

  if (!currentClientEntry) {
    process.exit(0);
    return;
  }

  const { rtmsClient, wsClient, meetingLogger, meetingTransport } =
    currentClientEntry;

  meetingLogger.info(`Cleaning up clients for stream: ${streamId}`);

  try {
    rtmsClient.leave();
  } catch (err) {}

  try {
    if (wsClient) {
      wsClient.close();
    }
  } catch (err) {}

  meetingLogger.info(`--- Log for stream ${streamId} ended ---`);

  process.exit(0);
}
