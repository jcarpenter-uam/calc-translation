// Load env variables
import "dotenv/config";
// Import the RTMS SDK
import rtms from "@zoom/rtms";
// Import FS for creating the logs dir
import fs from "fs";
// Import Websockets to send zoom audio to our server
import { WebSocket } from "ws";

const logDir = "logs";

// Create the 'logs' directory if it does not exist
// This removes the error for missing ./logs dir
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  console.log(`Created directory: ${logDir}`);
}

const ZOOM_TRANSLATION_SERVER_URL = process.env.ZOOM_TRANSLATION_SERVER_URL;

let clients = new Map();

// Set up webhook event handler to receive RTMS events from Zoom
rtms.onWebhookEvent(({ event, payload }) => {
  const streamId = payload?.rtms_stream_id;

  if (event == "meeting.rtms_stopped") {
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
    clientEntry.rtmsClient.leave();
    if (clientEntry.wsClient) {
      clientEntry.wsClient.close();
    }
    clients.delete(streamId);

    return;
  } else if (event !== "meeting.rtms_started") {
    console.log(`Ignoring unknown event`);
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

  // TODO: Auto reconnect logic
  wsClient.on("error", (error) => {
    console.error(`WebSocket error for stream ${streamId}:`, error.message);
    // We don't clean up the rtmsClient here, to handle them independently.
  });

  // TODO: Auto reconnect logic
  wsClient.on("close", (code, reason) => {
    console.log(
      `WebSocket connection for stream ${streamId} closed. Code: ${code}, Reason: ${reason.toString()}`,
    );
  });

  // Store both clients in the map
  clients.set(streamId, { rtmsClient, wsClient });

  rtmsClient.onAudioData((data, size, timestamp, metadata) => {
    const speakerName = metadata.userName || "Zoom RTMS";
    // userName stays empty until someone speaks. And sticks to that userName until someone else speaks
    console.log(
      `Received ${size} bytes of audio data at ${timestamp} from ${metadata.userName}`,
    );

    // Check if the WebSocket is ready to send data
    if (wsClient.readyState === WebSocket.OPEN) {
      const payload = {
        userName: speakerName,
        audio: data.toString("base64"), // Convert raw audio buffer to base64 string
      };
      wsClient.send(JSON.stringify(payload));
    } else {
      // Handle independently: Log a warning but don't stop the RTMS client.
      console.warn(
        `WebSocket not open for stream ${streamId}. Skipping audio packet.`,
      );
    }
  });

  // Join the meeting using the webhook payload directly
  rtmsClient.join(payload);
});
