// Load env variables
import "dotenv/config";
// Import FS for creating the logs dir
import fs from "fs";
// For zoom URL verification
import crypto from "crypto";
// Import Express to create an HTTP server
import express from "express";
// Import the RTMS SDK
import rtms from "@zoom/rtms";
// Import Websockets to send zoom audio to our server
import { WebSocket } from "ws";

const logDir = "logs";

// Create the 'logs' directory if it does not exist
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  console.log(`Created directory: ${logDir}`);
}

const ZOOM_TRANSLATION_SERVER_URL = process.env.ZOOM_TRANSLATION_SERVER_URL;
const ZOOM_WEBHOOK_SECRET_TOKEN = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;

const PORT = process.env.PORT || 8080;

// --- In-Memory Storage ---
// Store active clients, keyed by streamId
let clients = new Map();

// ============================
// --- Main Webhook Handler ---
// ============================
function rtmsWebhookHandler(req, res) {
  // --- Check if secret is loaded ---
  if (!ZOOM_WEBHOOK_SECRET_TOKEN) {
    console.error(
      "FATAL: ZOOM_WEBHOOK_SECRET_TOKEN is not defined in .env file!",
    );
    console.error(
      "Please get this from your Zoom App's 'Features' -> 'Event Subscriptions' page.",
    );
    return res.status(500).send("Server configuration error");
  }

  // Create the signature message from the raw Buffer to avoid string conversion.
  const timestamp = req.headers["x-zm-request-timestamp"];
  const msgPrefix = `v0:${timestamp}:`;

  // We update the HMAC with the prefix and the buffer *separately*.
  const hashForVerify = crypto
    .createHmac("sha256", ZOOM_WEBHOOK_SECRET_TOKEN)
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
    console.error("Failed to parse request body JSON:", e);
    return res.status(400).send("Bad Request: Invalid JSON");
  }

  // Get the event and payload from the *parsed* body.
  const { event, payload } = bodyPayload;
  const streamId = payload?.rtms_stream_id;

  // --- Verify Webhook Signature ---
  // The 'endpoint.url_validation' event is just a normal webhook
  // and its signature should also be checked.
  if (req.headers["x-zm-signature"] !== signature) {
    console.warn("--- SIGNATURE VALIDATION FAILED ---");
    console.log("EVENT:", event);
    // Log the two parts we hashed
    console.log("MESSAGE PREFIX HASHED:", msgPrefix);
    console.log("MESSAGE BODY HASHED (as string):", rawBodyString);
    console.log("OUR SIGNATURE:", signature);
    console.log("ZOOM'S SIGNATURE:", req.headers["x-zm-signature"]);
    console.warn("-------------------------------------");

    console.warn("Received webhook with invalid signature.");
    return res.status(401).send("Invalid signature");
  }

  // If we get here, the signature was VALID.
  console.log(`Received valid webhook for event: ${event}`);

  // --- Event Router ---
  switch (event) {
    case "endpoint.url_validation":
      console.log("Handling endpoint.url_validation");
      // This function will send the response
      return handleUrlValidation(payload, res);

    case "meeting.rtms_started":
      console.log(`Handling meeting.rtms_started for stream: ${streamId}`);
      // This function will start your clients
      handleRtmsStarted(payload, streamId);
      // Acknowledge the webhook
      return res.status(200).send("OK");

    case "meeting.rtms_stopped":
      console.log(`Handling meeting.rtms_stopped for stream: ${streamId}`);
      // This function will stop your clients
      handleRtmsStopped(streamId);
      // Acknowledge the webhook
      return res.status(200).send("OK");

    default:
      console.log(`Ignoring unknown event: ${event}`);
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
    console.warn("Validation failed: no plainToken received.");
    return res.status(400).send("Bad Request: Missing plainToken");
  }

  const hashForValidate = crypto
    .createHmac("sha256", ZOOM_WEBHOOK_SECRET_TOKEN)
    .update(payload.plainToken)
    .digest("hex");

  const responsePayload = {
    plainToken: payload.plainToken,
    encryptedToken: hashForValidate,
  };

  console.log("Sending validation response:", responsePayload);
  return res.status(200).json(responsePayload);
}

/**
 * Handles RTMS start event by creating SDK and WebSocket clients
 */
function handleRtmsStarted(payload, streamId) {
  if (!streamId) {
    console.error("Cannot start RTMS: streamId is missing from payload.");
    return;
  }

  // Create a new RTMS client for the stream
  const rtmsClient = new rtms.Client();

  // Create a new WebSocket client for the translation server
  const wsClient = new WebSocket(ZOOM_TRANSLATION_SERVER_URL);

  wsClient.on("open", () => {
    console.log(
      `WebSocket connection to ${ZOOM_TRANSLATION_SERVER_URL} established for stream ${streamId}`,
    );
  });

  wsClient.on("error", (error) => {
    console.error(`WebSocket error for stream ${streamId}:`, error.message);
  });

  wsClient.on("close", (code, reason) => {
    console.log(
      `WebSocket connection for stream ${streamId} closed. Code: ${code}, Reason: ${reason.toString()}`,
    );
  });

  // Store both clients in the map
  clients.set(streamId, { rtmsClient, wsClient });

  rtmsClient.onAudioData((data, size, timestamp, metadata) => {
    const speakerName = metadata.userName || "Zoom RTMS";
    // console.log( // This is very noisy
    //   `Received ${size} bytes of audio data at ${timestamp} from ${metadata.userName}`,
    // );

    if (wsClient.readyState === WebSocket.OPEN) {
      const payload = {
        userName: speakerName,
        audio: data.toString("base64"),
      };
      wsClient.send(JSON.stringify(payload));
    } else {
      console.warn(
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
    console.log(`Received meeting.rtms_stopped event without stream ID`);
    return;
  }

  const clientEntry = clients.get(streamId);
  if (!clientEntry) {
    console.log(
      `Received meeting.rtms_stopped event for unknown stream ID: ${streamId}`,
    );
    return;
  }

  // Clean up both the RTMS client and the WebSocket client
  console.log(`Cleaning up clients for stream: ${streamId}`);
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
  console.log(`Zoom RTMS server listening on port ${PORT}`);
  console.log(
    `Your Event Notification Endpoint URL should be https://<your_public_domain.com>`,
  );
});
