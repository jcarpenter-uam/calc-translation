import { performance } from "node:perf_hooks";
import {
  WS_URL,
  apiFetch,
  audioData,
  cleanupTestUsers,
  createMeeting,
  createTestUser,
  endMeeting,
} from "../tests/setup/utils/testHelpers";

type ChunkBenchmarkResult = {
  samplesPerChunk: number;
  bytesPerChunk: number;
  intervalMs: number;
  trials: number[];
};

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const TRIAL_COUNT = 3;

async function main() {
  const host = await createTestUser("chunk-bench-host", "Chunk Bench Host", "en");
  const results: ChunkBenchmarkResult[] = [];

  try {
    for (const samplesPerChunk of [2048, 1024]) {
      const bytesPerChunk = samplesPerChunk * BYTES_PER_SAMPLE;
      const intervalMs = (samplesPerChunk / SAMPLE_RATE) * 1000;
      const trials: number[] = [];

      for (let trial = 0; trial < TRIAL_COUNT; trial += 1) {
        trials.push(await runTrial(host.token, bytesPerChunk, intervalMs, trial));
      }

      results.push({
        samplesPerChunk,
        bytesPerChunk,
        intervalMs,
        trials,
      });
    }
  } finally {
    await cleanupTestUsers();
  }

  for (const result of results) {
    const average = result.trials.reduce((sum, value) => sum + value, 0) / result.trials.length;
    const min = Math.min(...result.trials);
    const max = Math.max(...result.trials);
    console.log(
      JSON.stringify(
        {
          samplesPerChunk: result.samplesPerChunk,
          bytesPerChunk: result.bytesPerChunk,
          intervalMs: result.intervalMs,
          averageTtftMs: Number(average.toFixed(2)),
          minTtftMs: Number(min.toFixed(2)),
          maxTtftMs: Number(max.toFixed(2)),
          trialsMs: result.trials.map((value) => Number(value.toFixed(2))),
          chunksPerSecond: Number((1000 / result.intervalMs).toFixed(2)),
        },
        null,
        2,
      ),
    );
  }
}

async function runTrial(
  hostToken: string,
  bytesPerChunk: number,
  intervalMs: number,
  trialIndex: number,
) {
  const meeting = await createMeeting(hostToken, {
    topic: `Chunk benchmark ${bytesPerChunk}-${trialIndex}`,
    method: "one_way",
    languages: ["en"],
  });

  const joinResponse = await apiFetch<{ token: string }>(`/meeting/join/${meeting.readableId}`, hostToken);
  const ws = new WebSocket(`${WS_URL}?ticket=${joinResponse.token}`);

  try {
    return await new Promise<number>((resolve, reject) => {
      let firstChunkStartedAt: number | null = null;
      let offset = 0;
      let streamInterval: ReturnType<typeof setInterval> | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (streamInterval) {
          clearInterval(streamInterval);
          streamInterval = null;
        }
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      ws.onopen = () => {
        ws.send(JSON.stringify({ action: "subscribe_meeting", meetingId: meeting.meetingId }));
        ws.send(JSON.stringify({ action: "audio_started" }));

        streamInterval = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            return;
          }

          if (audioData.length === 0) {
            reject(new Error("Sample audio file is empty."));
            cleanup();
            return;
          }

          if (offset >= audioData.length) {
            offset = 0;
          }

          if (firstChunkStartedAt === null) {
            firstChunkStartedAt = performance.now();
          }

          const end = Math.min(offset + bytesPerChunk, audioData.length);
          ws.send(audioData.subarray(offset, end));
          offset += bytesPerChunk;
        }, intervalMs);

        timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for first token at chunk size ${bytesPerChunk}.`));
        }, 20000);
      };

      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data.toString());
        if (payload.type !== "transcription" || firstChunkStartedAt === null) {
          return;
        }

        const ttftMs = performance.now() - firstChunkStartedAt;
        cleanup();
        resolve(ttftMs);
      };

      ws.onerror = () => {
        cleanup();
        reject(new Error(`WebSocket error during chunk benchmark for ${bytesPerChunk} bytes.`));
      };
    });
  } finally {
    try {
      await endMeeting(meeting.meetingId, hostToken);
    } catch {
      // Ignore cleanup failures from partially initialized trials.
    }
  }
}

await main();
