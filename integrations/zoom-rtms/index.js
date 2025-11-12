// Load env variables
import "dotenv/config";
// For zoom URL verification
import crypto from "crypto";
// Import Express to create an HTTP server
import express from "express";
// Import the RTMS SDK
import rtms from "@zoom/rtms";
// Import Websockets to send zoom audio to our server
import { WebSocket } from "ws";
// Import Pino for logging
import pino from "pino";

const logDir = "logs";

// TODO: Save log file with {meeting_id}_{YYYY-MM-DD_HH-MM-SS}.log format
const transport = pino.transport({
  targets: [
    {
      level: "info",
      target: "pino-pretty",
      options: {
        destination: `${logDir}/app.log`,
        colorize: false,
        mkdir: true, // Create the log directory if it doesn't exist
        append: true, // Append to the log file
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

const logger = pino(transport);

// Log fatal errors and crashes to the file before exiting
process.on("uncaughtException", (err) => {
  logger.fatal(err, "UNCAUGHT EXCEPTION");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "UNHANDLED REJECTION");
  process.exit(1);
});

const BASE_SERVER_URL =
  process.env.BASE_SERVER_URL || "ws://localhost:8000/ws/transcribe";
const SECRET_TOKEN = process.env.SECRET_TOKEN;
const ZM_WEBHOOK_SECRET = process.env.ZM_WEBHOOK_SECRET;
const PORT = process.env.PORT || 8080;

const ZOOM_BASE_SERVER_URL = `${BASE_SERVER_URL}/zoom`;

if (!SECRET_TOKEN) {
  logger.fatal("FATAL: SECRET_TOKEN is not defined in .env file!");
  logger.fatal("Cannot connect to translation server without it.");
  process.exit(1); // The 'uncaughtException' handler won't catch this
}

// --- In-Memory Storage ---
// Store active clients, keyed by streamId
let clients = new Map();

// ============================
// --- Main Webhook Handler ---
// ============================
function rtmsWebhookHandler(req, res) {
  // --- Check if secret is loaded ---
  if (!ZM_WEBHOOK_SECRET) {
    logger.error("FATAL: ZM_WEBHOOK_SECRET is not defined in .env file!");
    logger.error(
      "Please get this from your Zoom App's 'Features' -> 'Event Subscriptions' page.",
    );
    return res.status(500).send("Server configuration error");
  }

  // Create the signature message from the raw Buffer to avoid string conversion.
  const timestamp = req.headers["x-zm-request-timestamp"];
  const msgPrefix = `v0:${timestamp}:`;

  // We update the HMAC with the prefix and the buffer *separately*.
  const hashForVerify = crypto
    .createHmac("sha256", ZM_WEBHOOK_SECRET)
    .update(msgPrefix) // First, update with the string prefix
    .update(req.body) // Next, update with the raw body Buffer
    .digest("hex");

  const signature = `v0=${hashForVerify}`;

  // Now that verification is done, manually parse the Buffer into JSON.
  let bodyPayload;
  let rawBodyString; // For logging
  try {
    rawBodyString = req.body.toString("utf8");
    bodyPayload = JSON.parse(rawBodyString);
  } catch (e) {
    logger.error(e, "Failed to parse request body JSON");
    return res.status(400).send("Bad Request: Invalid JSON");
  }

  // Get the event and payload from the *parsed* body.
  const { event, payload } = bodyPayload;
  const streamId = payload?.rtms_stream_id;

  // --- Verify Webhook Signature ---
  // The 'endpoint.url_validation' event is just a normal webhook
  // and its signature should also be checked.
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

  // If we get here, the signature was VALID.
  logger.info(`Received valid webhook for event: ${event}`);

  // --- Event Router ---
  switch (event) {
    case "endpoint.url_validation":
      logger.info("Handling endpoint.url_validation");
      // This function will send the response
      return handleUrlValidation(payload, res);

    case "meeting.rtms_started":
      logger.info(`Handling meeting.rtms_started for stream: ${streamId}`);
      // This function will start your clients
      handleRtmsStarted(payload, streamId);
      // Acknowledge the webhook
      return res.status(200).send("OK");

    case "meeting.rtms_stopped":
      logger.info(`Handling meeting.rtms_stopped for stream: ${streamId}`);
      // This function will stop your clients
      handleRtmsStopped(streamId);
      // Acknowledge the webhook
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
  if (!streamId) {
    logger.error("Cannot start RTMS: streamId is missing from payload.");
    return;
  }

  // Create a new RTMS client for the stream
  const rtmsClient = new rtms.Client();

  const authHeader = {
    Authorization: `Bearer ${SECRET_TOKEN}`,
  };

  // Create a new WebSocket client for the translation server with token
  // TODO: Get meeting id from zoom sdk
  const wsClient = new WebSocket(`${ZOOM_BASE_SERVER_URL}/${MEETING_ID}`, {
    headers: authHeader,
  });

  wsClient.on("open", () => {
    logger.info(
      `WebSocket connection to ${BASE_SERVER_URL} established for stream ${streamId}`,
    );
  });

  wsClient.on("error", (error) => {
    logger.error(error, `WebSocket error for stream ${streamId}`);
  });

  wsClient.on("close", (code, reason) => {
    logger.info(
      `WebSocket connection for stream ${streamId} closed. Code: ${code}, Reason: ${reason.toString()}`,
    );
  });

  // Store both clients in the map
  clients.set(streamId, { rtmsClient, wsClient });

  rtmsClient.onAudioData((data, size, timestamp, metadata) => {
    const speakerName = metadata.userName || "Zoom RTMS";

    if (wsClient.readyState === WebSocket.OPEN) {
      const payload = {
        userName: speakerName,
        audio: data.toString("base64"),
      };
      wsClient.send(JSON.stringify(payload));
    } else {
      logger.warn(
        `WebSocket not open for stream ${streamId}. Skipping audio packet.`,
      );
    }
  });

  // Join the meeting using the webhook payload directly
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

  // Clean up both the RTMS client and the WebSocket client
  logger.info(`Cleaning up clients for stream: ${streamId}`);
  clientEntry.rtmsClient.leave();
  if (clientEntry.wsClient) {
    clientEntry.wsClient.close();
  }
  clients.delete(streamId);
}

// ====================
// --- Server Setup ---
// ====================

const app = express();

//  Use `express.raw()` to read ALL bodies for the /zoom route as a Buffer.
//  This ensures req.body is *only* a Buffer inside our handler.
//  We set a limit just in case.
app.use(
  "/",
  express.raw({
    type: "application/json",
    limit: "2mb", // Set a reasonable limit
  }),
);

// Tell the server to use your main handler for this endpoint
app.post("/", rtmsWebhookHandler);

// Start the server
app.listen(PORT, () => {
  logger.info(`Zoom RTMS server listening on port ${PORT}`);
  logger.info(
    `Your Event Notification Endpoint URL should be https://<your_public_domain.com>`,
  );
});
