import "dotenv/config";
import crypto from "crypto";
import express from "express";
import { fork } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on("uncaughtException", (err) => {
  console.error(`[${new Date().toISOString()}] UNCAUGHT EXCEPTION:`, err);
  process.exit(1);
});

const ZM_WEBHOOK_SECRET = process.env.ZM_WEBHOOK_SECRET;
const PORT = process.env.PORT || 8080;

if (!process.env.ZM_PRIVATE_KEY) {
  console.error("FATAL: ZM_PRIVATE_KEY is not defined in .env file!");
  process.exit(1);
}

const activeWorkers = new Map();
const activeMeetings = new Map();

const app = express();

app.use("/", express.raw({ type: "application/json", limit: "2mb" }));

function log(msg) {
  console.log(`[${new Date().toISOString()}][SERVER] ${msg}`);
}

function attemptPromotion(meetingUuid, oldStreamId) {
  log(
    `[Failover] Checking promotion candidates for meeting ${meetingUuid} (Old Primary: ${oldStreamId})`,
  );

  let candidateStreamId = null;
  for (const [sId, entry] of activeWorkers.entries()) {
    if (entry.metadata?.meeting_uuid === meetingUuid && sId !== oldStreamId) {
      candidateStreamId = sId;
      break;
    }
  }

  if (candidateStreamId) {
    const candidate = activeWorkers.get(candidateStreamId);
    log(
      `[Failover] Candidate found: ${candidateStreamId}. Promoting to PRIMARY.`,
    );

    activeMeetings.set(meetingUuid, candidateStreamId);
    candidate.isPrimary = true;

    candidate.worker.send({ type: "PROMOTE" });
    return true;
  } else {
    log(
      `[Failover] No standby candidates found for meeting ${meetingUuid}. Closing meeting.`,
    );
    activeMeetings.delete(meetingUuid);
    return false;
  }
}

app.get("/metrics", (req, res) => {
  const uptime = process.uptime();
  const memory = process.memoryUsage();

  const streams = Array.from(activeWorkers.values()).map((entry) => {
    return {
      streamId: entry.streamId,
      meetingUuid: entry.metadata?.meeting_uuid || "unknown",
      role: entry.isPrimary ? "PRIMARY" : "STANDBY",
      pid: entry.worker.pid,
      startTime: new Date(entry.startTime).toISOString(),
      durationSeconds: Math.floor((Date.now() - entry.startTime) / 1000),
      usage: entry.metrics || { status: "waiting_for_report" },
    };
  });

  res.json({
    status: "ok",
    system: {
      uptimeSeconds: Math.floor(uptime),
      managerMemoryMB: {
        rss: Math.round(memory.rss / 1024 / 1024),
      },
      loadAverage: os.loadavg(),
    },
    activeStreamsCount: activeWorkers.size,
    activeMeetingsCount: activeMeetings.size,
    streams: streams,
  });
});

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
    bodyPayload = JSON.parse(req.body.toString("utf8"));
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

  switch (event) {
    case "endpoint.url_validation":
      log("Handling endpoint.url_validation");
      const hashForValidate = crypto
        .createHmac("sha256", ZM_WEBHOOK_SECRET)
        .update(payload.plainToken)
        .digest("hex");
      return res.status(200).json({
        plainToken: payload.plainToken,
        encryptedToken: hashForValidate,
      });

    case "meeting.rtms_started":
      log(`Received meeting.rtms_started for stream: ${streamId}`);

      if (activeWorkers.has(streamId)) {
        log(
          `Stream ${streamId} already active. Ignoring duplicate start request.`,
        );
        return res.status(200).send("OK");
      }

      const meetingUuid = payload?.meeting_uuid;
      let isPrimary = false;

      if (meetingUuid && !activeMeetings.has(meetingUuid)) {
        log(`New meeting detected (${meetingUuid}). Assigning PRIMARY role.`);
        activeMeetings.set(meetingUuid, streamId);
        isPrimary = true;
      } else {
        log(
          `Existing meeting detected (${meetingUuid}). Assigning STANDBY role.`,
        );
        isPrimary = false;
      }

      const worker = fork(path.resolve(__dirname, "./worker.js"), [], {
        execArgv: [
          "--optimize_for_size",
          "--max-old-space-size=512",
          "--gc_interval=100",
        ],
      });

      log(`Spawned worker process (PID ${worker.pid}) for stream ${streamId}`);

      worker.on("message", (msg) => {
        if (msg.type === "METRICS") {
          const entry = activeWorkers.get(streamId);
          if (entry) {
            entry.metrics = msg.payload;
          }
        }
      });

      worker.on("exit", (code) => {
        log(
          `Worker process (PID ${worker.pid}) for stream ${streamId} exited with code ${code}`,
        );
        activeWorkers.delete(streamId);

        if (meetingUuid && activeMeetings.get(meetingUuid) === streamId) {
          log(
            `Primary worker exited unexpectedly. Attempting promotion for ${meetingUuid}.`,
          );
          attemptPromotion(meetingUuid, streamId);
        }
      });

      worker.send({
        type: "START",
        payload: payload,
        streamId: streamId,
        isPrimary: isPrimary,
      });

      activeWorkers.set(streamId, {
        worker,
        streamId,
        startTime: Date.now(),
        metadata: payload,
        metrics: null,
        isPrimary,
      });

      return res.status(200).send("OK");

    case "meeting.rtms_stopped":
      log(`Received meeting.rtms_stopped for stream: ${streamId}`);

      if (streamId && activeWorkers.has(streamId)) {
        const entry = activeWorkers.get(streamId);
        const mUuid = entry.metadata?.meeting_uuid;
        const wasPrimary = entry.isPrimary;

        log(
          `Stopping worker (PID ${entry.worker.pid}). Was Primary? ${wasPrimary}`,
        );

        entry.worker.send({ type: "STOP", streamId: streamId });

        activeWorkers.delete(streamId);

        if (wasPrimary && mUuid) {
          log(
            `Primary stream stopped explicitly. Checking for failover candidates.`,
          );
          attemptPromotion(mUuid, streamId);
        }

        setTimeout(() => {
          if (!entry.worker.killed) {
            log(
              `Force killing worker (PID ${entry.worker.pid}) after timeout.`,
            );
            entry.worker.kill();
          }
        }, 10000);
      } else {
        log(`Received stop for unknown or already removed stream: ${streamId}`);
      }
      return res.status(200).send("OK");

    default:
      return res.status(200).send("OK");
  }
});

app.listen(PORT, () => {
  log(`Zoom RTMS Manager listening on port ${PORT}`);
});
