import "dotenv/config";
import crypto from "crypto";
import express from "express";
import rtms from "@zoom/rtms";
import { WebSocket } from "ws";
import pino from "pino";
import jwt from "jsonwebtoken";

const logDir = "logs";

const transport = pino.transport({
  targets: [
    {
      level: "info",
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    },
  ],
});

const logger = pino(transport);

process.on("uncaughtException", (err) => {
  logger.fatal(err, "UNCAUGHT EXCEPTION");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "UNHANDLED REJECTION");
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

/**
 * Creates a new pino logger instance for a specific meeting.
 * This logger writes to both the console and a unique file.
 * @param {string} meeting_uuid - The UUID of the meeting
 * @returns {{logger: pino.Logger, transport: object}}
 */
function createMeetingLogger(meeting_uuid) {
  const timestamp = getTimestamp();
  const safe_uuid = meeting_uuid.replace(/\//g, "_"); // Replaces all '/' with '_'
  const fileName = `${safe_uuid}_${timestamp}.log`;
  const logPath = `${logDir}/${fileName}`;

  logger.info(`Creating new log file for meeting: ${logPath}`);

  const meetingTransport = pino.transport({
    targets: [
      {
        level: "info",
        target: "pino-pretty",
        options: {
          destination: logPath,
          colorize: false,
          mkdir: true, // Create the log directory if it doesn't exist
          append: true,
        },
      },
      {
        level: "info",
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    ],
  });

  const meetingLogger = pino(meetingTransport);
  meetingLogger.info(
    `--- Log for Meeting ${meeting_uuid} started at ${timestamp} ---`,
  );

  return { logger: meetingLogger, transport: meetingTransport };
}

const BASE_SERVER_URL =
  process.env.BASE_SERVER_URL || "ws://localhost:8000/ws/transcribe";
const ZM_PRIVATE_KEY = process.env.ZM_PRIVATE_KEY;
const ZM_WEBHOOK_SECRET = process.env.ZM_WEBHOOK_SECRET;
const PORT = process.env.PORT || 8080;

const ZOOM_BASE_SERVER_URL = `${BASE_SERVER_URL}/zoom`;

if (!ZM_PRIVATE_KEY) {
  logger.fatal("FATAL: ZM_PRIVATE_KEY is not defined in .env file!");
  process.exit(1);
}

let clients = new Map();

// ============================
// --- Main Webhook Handler ---
// ============================
function rtmsWebhookHandler(req, res) {
  if (!ZM_WEBHOOK_SECRET) {
    logger.error("FATAL: ZM_WEBHOOK_SECRET is not defined in .env file!");
    logger.error(
      "Please get this from your Zoom App's 'Features' -> 'Event Subscriptions' page.",
    );
    return res.status(500).send("Server configuration error");
  }

  const timestamp = req.headers["x-zm-request-timestamp"];
  const msgPrefix = `v0:${timestamp}:`;

  const hashForVerify = crypto
    .createHmac("sha256", ZM_WEBHOOK_SECRET)
    .update(msgPrefix)
    .update(req.body)
    .digest("hex");

  const signature = `v0=${hashForVerify}`;

  let bodyPayload;
  let rawBodyString;
  try {
    rawBodyString = req.body.toString("utf8");
    bodyPayload = JSON.parse(rawBodyString);
  } catch (e) {
    logger.error(e, "Failed to parse request body JSON");
    return res.status(400).send("Bad Request: Invalid JSON");
  }

  const { event, payload } = bodyPayload;
  const streamId = payload?.rtms_stream_id;

  if (req.headers["x-zm-signature"] !== signature) {
    logger.warn("--- SIGNATURE VALIDATION FAILED ---");
    logger.info(
      {
        event: event,
        msgPrefix: msgPrefix,
        bodyString: rawBodyString,
        ourSignature: signature,
        zoomSignature: req.headers["x-zm-signature"],
      },
      "Signature validation details",
    );
    logger.warn("-------------------------------------");

    logger.warn("Received webhook with invalid signature.");
    return res.status(401).send("Invalid signature");
  }

  logger.info(`Received valid webhook for event: ${event}`);

  switch (event) {
    case "endpoint.url_validation":
      logger.info("Handling endpoint.url_validation");
      return handleUrlValidation(payload, res);

    case "meeting.rtms_started":
      logger.info(`Handling meeting.rtms_started for stream: ${streamId}`);
      handleRtmsStarted(payload, streamId);
      return res.status(200).send("OK");

    case "meeting.rtms_stopped":
      logger.info(`Handling meeting.rtms_stopped for stream: ${streamId}`);
      handleRtmsStopped(streamId);
      return res.status(200).send("OK");

    default:
      logger.info(`Ignoring unknown event: ${event}`);
      return res.status(200).send("OK");
  }
}

// ================================
// --- Event-Specific Functions ---
// ================================

/**
 * Handles Zoom's URL validation challenge
 */
function handleUrlValidation(payload, res) {
  if (!payload?.plainToken) {
    logger.warn("Validation failed: no plainToken received.");
    return res.status(400).send("Bad Request: Missing plainToken");
  }

  const hashForValidate = crypto
    .createHmac("sha256", ZM_WEBHOOK_SECRET)
    .update(payload.plainToken)
    .digest("hex");

  const responsePayload = {
    plainToken: payload.plainToken,
    encryptedToken: hashForValidate,
  };

  logger.info("Sending validation response:", responsePayload);
  return res.status(200).json(responsePayload);
}

/**
 * Generates a short-lived JWT
 * @returns {string} - A signed JWT valid for 5 minutes
 */
function generateAuthToken() {
  const payload = {
    iss: "zoom-rtms-service",
    iat: Math.floor(Date.now() / 1000),
    aud: "python-backend",
  };

  return jwt.sign(payload, ZM_PRIVATE_KEY, {
    expiresIn: "5m", // 5 minutes
    algorithm: "RS256",
  });
}

/**
 * Handles RTMS start event by creating SDK and WebSocket clients
 */
function handleRtmsStarted(payload, streamId) {
  const meeting_uuid = payload?.meeting_uuid;

  if (!streamId) {
    logger.error("Cannot start RTMS: streamId is missing from payload.");
    return;
  }
  if (!meeting_uuid) {
    logger.error("Cannot start RTMS: meeting_uuid is missing from payload.");
    return;
  }

  const encoded_meeting_uuid = encodeURIComponent(meeting_uuid);

  const { logger: meetingLogger, transport: meetingTransport } =
    createMeetingLogger(meeting_uuid);

  // BUG: Find a way to remove Zoom_RTMS log files
  const rtmsClient = new rtms.Client({
    log: { enable: false },
  });

  const clientEntry = {
    rtmsClient,
    wsClient: null,
    meetingLogger,
    meetingTransport,
    hasLoggedWarning: false,
  };
  clients.set(streamId, clientEntry);

  /**
   * Defines a recursive connect function with exponential backoff
   */
  function connect(retries = 0) {
    if (!clients.has(streamId)) {
      meetingLogger.info(
        "Client entry removed, stopping WebSocket reconnect attempts.",
      );
      return;
    }

    meetingLogger.info(
      `Attempting WebSocket connection to ${BASE_SERVER_URL} (attempt ${
        retries + 1
      })...`,
    );

    const token = generateAuthToken();
    const authHeader = {
      Authorization: `Bearer ${token}`,
    };

    const wsClient = new WebSocket(
      `${ZOOM_BASE_SERVER_URL}/${encoded_meeting_uuid}`,
      {
        headers: authHeader,
      },
    );

    clientEntry.wsClient = wsClient;

    wsClient.on("open", () => {
      meetingLogger.info(
        `WebSocket connection to ${BASE_SERVER_URL} established for stream ${streamId}`,
      );
      clientEntry.hasLoggedWarning = false;
      retries = 0;
    });

    wsClient.on("error", (error) => {
      meetingLogger.error(error, `WebSocket error for stream ${streamId}`);
    });

    wsClient.on("close", (code, reason) => {
      meetingLogger.info(
        `WebSocket connection for stream ${streamId} closed. Code: ${code}, Reason: ${reason.toString()}`,
      );

      if (!clients.has(streamId)) {
        meetingLogger.info(
          `Stream ${streamId} was intentionally stopped, not reconnecting.`,
        );

        meetingLogger.info(`--- Log for stream ${streamId} ended ---`);
        meetingTransport.end(() => {
          logger.info(`Log file for stream ${streamId} closed.`);
        });
        return;
      }

      // It was an unexpected close, so let's retry.
      const nextRetries = retries + 1;
      const delay = Math.min(1000 * 2 ** retries, 30000);

      meetingLogger.info(
        `Will retry WebSocket connection in ${delay / 1000} seconds...`,
      );
      setTimeout(() => connect(nextRetries), delay);
    });
  }

  rtmsClient.onAudioData((data, size, timestamp, metadata) => {
    const currentClientEntry = clients.get(streamId);
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

/**
 * Handles RTMS stop event
 */
function handleRtmsStopped(streamId) {
  if (!streamId) {
    logger.info(`Received meeting.rtms_stopped event without stream ID`);
    return;
  }

  const clientEntry = clients.get(streamId);
  if (!clientEntry) {
    logger.info(
      `Received meeting.rtms_stopped event for unknown stream ID: ${streamId}`,
    );
    return;
  }

  const { rtmsClient, wsClient, meetingLogger, meetingTransport } = clientEntry;

  meetingLogger.info(`Cleaning up clients for stream: ${streamId}`);

  rtmsClient.leave();

  clients.delete(streamId);

  if (wsClient) {
    wsClient.close();
  } else {
    meetingLogger.warn(
      `Stream ${streamId} stopped, but WebSocket was never established. Cleaning up logger.`,
    );
    meetingLogger.info(`--- Log for stream ${streamId} ended ---`);
    meetingTransport.end(() => {
      logger.info(`Log file for stream ${streamId} closed.`);
    });
  }
}

// ====================
// --- Server Setup ---
// ====================

const app = express();

app.use((req, res, next) => {
  logger.info({ method: req.method, path: req.path }, "Incoming request");
  next();
});

app.use(
  "/",
  express.raw({
    type: "application/json",
    limit: "2mb",
  }),
);

app.post("/", rtmsWebhookHandler);

// Start the server
app.listen(PORT, () => {
  logger.info(`Zoom RTMS server listening on port ${PORT}`);
  logger.info(
    `Your Event Notification Endpoint URL should be https://<your_public_domain.com>`,
  );
});
