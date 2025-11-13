import "dotenv/config";
import crypto from "crypto";
import express from "express";
import rtms from "@zoom/rtms";
import ReconnectingWebSocket from "reconnecting-websocket";
import { WebSocket } from "ws";
import pino from "pino";

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
  const fileName = `${meeting_uuid}_${timestamp}.log`;
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
const SECRET_TOKEN = process.env.SECRET_TOKEN;
const ZM_WEBHOOK_SECRET = process.env.ZM_WEBHOOK_SECRET;
const PORT = process.env.PORT || 8080;

const ZOOM_BASE_SERVER_URL = `${BASE_SERVER_URL}/zoom`;

if (!SECRET_TOKEN) {
  logger.fatal("FATAL: SECRET_TOKEN is not defined in .env file!");
  logger.fatal("Cannot connect to translation server without it.");
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

  const { logger: meetingLogger, transport: meetingTransport } =
    createMeetingLogger(meeting_uuid);

  // BUG: Find a way to remove Zoom_RTMS log files
  const rtmsClient = new rtms.Client({
    log: { enable: false },
  });

  const authHeader = {
    Authorization: `Bearer ${SECRET_TOKEN}`,
  };

  const wsClient = new ReconnectingWebSocket(
    `${ZOOM_BASE_SERVER_URL}/${meeting_uuid}`,
    [],
    {
      headers: authHeader,
      WebSocket: WebSocket,
      maxRetries: 10, // Try to reconnect 10 times
      minReconnectionDelay: 1000, // Start with a 1-second delay
      maxReconnectionDelay: 10000, // Max delay of 10 seconds
    },
  );

  wsClient.onopen = () => {
    meetingLogger.info(
      `WebSocket connection to ${BASE_SERVER_URL} established for stream ${streamId}`,
    );
  };

  wsClient.onerror = (event) => {
    meetingLogger.error(event.error, `WebSocket error for stream ${streamId}`);
  };

  wsClient.onclose = (event) => {
    meetingLogger.info(
      `WebSocket connection for stream ${streamId} closed. Code: ${event.code}, Reason: ${event.reason.toString()}`,
    );
  };

  // Store all clients in the map
  clients.set(streamId, {
    rtmsClient,
    wsClient,
    meetingLogger,
    meetingTransport,
  });

  rtmsClient.onAudioData((data, size, timestamp, metadata) => {
    const speakerName = metadata.userName || "Zoom RTMS";

    if (wsClient.readyState === WebSocket.OPEN) {
      const payload = {
        userName: speakerName,
        audio: data.toString("base64"),
      };
      wsClient.send(JSON.stringify(payload));
    } else {
      meetingLogger.warn(
        `WebSocket not open for stream ${streamId}. Skipping audio packet.`,
      );
    }
  });

  meetingLogger.info(`Joining RTMS for meeting: ${meeting_uuid}`);
  rtmsClient.join(payload);
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

  clients.delete(streamId);

  meetingLogger.info(`Cleaning up clients for stream: ${streamId}`);
  rtmsClient.leave();

  if (wsClient) {
    wsClient.close(1000, "Meeting ended by webhook");
  }

  meetingLogger.info(`--- Log for stream ${streamId} ended ---`);
  meetingTransport.end(() => {
    logger.info(`Log file for stream ${streamId} closed.`);
  });
}

// ====================
// --- Server Setup ---
// ====================

const app = express();

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
