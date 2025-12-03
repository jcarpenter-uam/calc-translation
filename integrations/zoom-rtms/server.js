import "dotenv/config";
import crypto from "crypto";
import express from "express";
import pino from "pino";
import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// Setup directory resolution for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Logging Setup (Global Server) ---
const transport = pino.transport({
  targets: [
    {
      level: "info",
      target: "pino-pretty",
      options: { colorize: true },
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

// --- Configuration ---
const ZM_WEBHOOK_SECRET = process.env.ZM_WEBHOOK_SECRET;
const PORT = process.env.PORT || 8080;

if (!process.env.ZM_PRIVATE_KEY) {
  logger.fatal("FATAL: ZM_PRIVATE_KEY is not defined in .env file!");
  process.exit(1);
}

// Track active workers: Map<streamId, ChildProcess>
const activeWorkers = new Map();

// --- Webhook Handler ---
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
    logger.error("FATAL: ZM_WEBHOOK_SECRET is not defined in .env file!");
    return res.status(500).send("Server configuration error");
  }

  // 1. Signature Validation
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
    logger.warn("Received webhook with invalid signature.");
    return res.status(401).send("Invalid signature");
  }

  logger.info(`Received valid webhook for event: ${event}`);

  // 2. Event Routing
  switch (event) {
    case "endpoint.url_validation":
      logger.info("Handling endpoint.url_validation");
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
      logger.info(`Handling meeting.rtms_started for stream: ${streamId}`);

      // Prevent duplicate starts
      if (activeWorkers.has(streamId)) {
        logger.warn(`Worker already exists for stream ${streamId}`);
        return res.status(200).send("OK");
      }

      // SPAWN WORKER
      const worker = fork(path.resolve(__dirname, "./worker.js"));

      worker.on("exit", (code) => {
        logger.info(`Worker for stream ${streamId} exited with code ${code}`);
        activeWorkers.delete(streamId);
      });

      // Pass payload to worker
      worker.send({
        type: "START",
        payload: payload,
        streamId: streamId,
      });

      activeWorkers.set(streamId, worker);
      return res.status(200).send("OK");

    case "meeting.rtms_stopped":
      logger.info(`Handling meeting.rtms_stopped for stream: ${streamId}`);
      if (streamId && activeWorkers.has(streamId)) {
        const targetWorker = activeWorkers.get(streamId);
        targetWorker.send({ type: "STOP" });

        // Safety cleanup from map (worker exit handler will confirm)
        setTimeout(() => {
          if (activeWorkers.has(streamId)) {
            targetWorker.kill(); // Force kill if it hangs
            activeWorkers.delete(streamId);
          }
        }, 5000);
      }
      return res.status(200).send("OK");

    default:
      return res.status(200).send("OK");
  }
});

app.listen(PORT, () => {
  logger.info(`Zoom RTMS Manager listening on port ${PORT}`);
});
