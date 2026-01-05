import "dotenv/config";
import crypto from "crypto";
import express from "express";
import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
  process.exit(1);
});

const ZM_WEBHOOK_SECRET = process.env.ZM_WEBHOOK_SECRET;
const PORT = process.env.PORT || 8080;

if (!process.env.ZM_PRIVATE_KEY) {
  console.error("FATAL: ZM_PRIVATE_KEY is not defined in .env file!");
  process.exit(1);
}

const activeWorkers = new Map();
const app = express();

app.use(
  "/",
  express.raw({
    type: "application/json",
    limit: "2mb",
  }),
);

app.post("/zoom", (req, res) => {
  if (!ZM_WEBHOOK_SECRET) {
    console.error("FATAL: ZM_WEBHOOK_SECRET is not defined in .env file!");
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
  try {
    const rawBodyString = req.body.toString("utf8");
    bodyPayload = JSON.parse(rawBodyString);
  } catch (e) {
    console.error("Failed to parse request body JSON:", e);
    return res.status(400).send("Bad Request: Invalid JSON");
  }

  const { event, payload } = bodyPayload;
  const streamId = payload?.rtms_stream_id;

  if (req.headers["x-zm-signature"] !== signature) {
    console.warn("Received webhook with invalid signature.");
    return res.status(401).send("Invalid signature");
  }

  console.log(`Received valid webhook for event: ${event}`);

  switch (event) {
    case "endpoint.url_validation":
      console.log("Handling endpoint.url_validation");
      if (!payload?.plainToken) {
        return res.status(400).send("Bad Request: Missing plainToken");
      }
      const hashForValidate = crypto
        .createHmac("sha256", ZM_WEBHOOK_SECRET)
        .update(payload.plainToken)
        .digest("hex");
      return res.status(200).json({
        plainToken: payload.plainToken,
        encryptedToken: hashForValidate,
      });

    case "meeting.rtms_started":
      console.log(`Handling meeting.rtms_started for stream: ${streamId}`);

      if (activeWorkers.has(streamId)) {
        console.warn(`Worker already exists for stream ${streamId}`);
        return res.status(200).send("OK");
      }

      const worker = new Worker(path.resolve(__dirname, "./worker.js"));

      worker.on("exit", (code) => {
        console.log(
          `Worker thread for stream ${streamId} exited with code ${code}`,
        );
        activeWorkers.delete(streamId);
      });

      worker.on("error", (err) => {
        console.error(`Worker thread error for stream ${streamId}:`, err);
      });

      worker.postMessage({
        type: "START",
        payload: payload,
        streamId: streamId,
      });

      activeWorkers.set(streamId, worker);
      return res.status(200).send("OK");

    case "meeting.rtms_stopped":
      console.log(`Handling meeting.rtms_stopped for stream: ${streamId}`);
      if (streamId && activeWorkers.has(streamId)) {
        const targetWorker = activeWorkers.get(streamId);

        targetWorker.postMessage({ type: "STOP", streamId: streamId });

        setTimeout(() => {
          if (activeWorkers.has(streamId)) {
            console.log(
              `Force terminating worker thread for stream ${streamId}`,
            );
            targetWorker.terminate();
            activeWorkers.delete(streamId);
          }
        }, 10000);
      }
      return res.status(200).send("OK");

    default:
      return res.status(200).send("OK");
  }
});

app.listen(PORT, () => {
  console.log(`Zoom RTMS Manager (Threaded) listening on port ${PORT}`);
});
