import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { websocketController } from "../../controllers/websocketController";
import {
  apiFetch,
  audioData,
  cleanupTestUsers,
  createMeeting,
  createTestUser,
  endMeeting,
  waitForEvent,
  WS_URL,
} from "../setup/utils/testHelpers";

const START_VIEWERS = 25;
const VIEWER_STEP = 25;
const MAX_VIEWERS = 2000;
const LATENCY_THRESHOLD_MS = 250;
const AVG_JOIN_THRESHOLD_MS = 175;
const MAX_SINGLE_JOIN_THRESHOLD_MS = 500;

const RESULTS_DIR = path.resolve(process.cwd(), "tests/stress/results");
const LATEST_RESULTS_PATH = path.join(RESULTS_DIR, "single-meeting-same-language-viewers.latest.json");
const HISTORY_RESULTS_PATH = path.join(RESULTS_DIR, "single-meeting-same-language-viewers.history.json");

describe("Single meeting same-language fanout stress", () => {
  let host: any;
  let attendees: any[] = [];

  const activeSockets: WebSocket[] = [];
  const createdMeetings: { id: string; hostToken: string }[] = [];

  beforeAll(async () => {
    host = await createTestUser(
      "single-meeting-stress-host",
      "Single Meeting Stress Host",
      "en",
    );
  });

  afterAll(async () => {
    for (const ws of activeSockets) {
      if (ws.readyState === 0 || ws.readyState === 1) {
        ws.close();
      }
    }

    for (const meeting of createdMeetings) {
      try {
        await endMeeting(meeting.id, meeting.hostToken);
      } catch {}
    }

    await cleanupTestUsers();
  });

  async function injectTranscript(meetingId: string, text: string) {
    await (websocketController as any).handleTranscriptionEvent(meetingId, {
      targetLanguage: "en",
      transcriptionText: text,
      translationText: null,
      isFinal: true,
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
      sourceLanguage: "en",
    });
  }

  async function getOrCreateAttendee(index: number) {
    if (!attendees[index]) {
      attendees[index] = await createTestUser(
        `single-meeting-stress-viewer-${index}`,
        `Single Meeting Stress Viewer ${index}`,
        "en",
      );
    }

    return attendees[index];
  }

  async function writeResultsFile(payload: unknown) {
    await mkdir(RESULTS_DIR, { recursive: true });
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    await writeFile(LATEST_RESULTS_PATH, serialized);

    let history: unknown[] = [];

    try {
      history = JSON.parse(await readFile(HISTORY_RESULTS_PATH, "utf8"));
      if (!Array.isArray(history)) {
        history = [];
      }
    } catch {
      history = [];
    }

    history.push(payload);
    await writeFile(HISTORY_RESULTS_PATH, `${JSON.stringify(history, null, 2)}\n`);
  }

  function startContinuousAudio(ws: WebSocket) {
    const fallbackChunk = Buffer.alloc(3200);
    const sourceAudio = audioData.length > 0 ? audioData : fallbackChunk;
    let offset = 0;
    let stopped = false;

    ws.send(JSON.stringify({ action: "audio_started" }));

    const interval = setInterval(() => {
      if (stopped || ws.readyState !== 1) {
        return;
      }

      if (offset >= sourceAudio.length) {
        offset = 0;
      }

      const end = Math.min(offset + 3200, sourceAudio.length);
      const chunk = sourceAudio.subarray(offset, end);
      ws.send(chunk.length > 0 ? chunk : fallbackChunk);
      offset += 3200;
    }, 100);

    return {
      stop() {
        if (stopped) {
          return;
        }

        stopped = true;
        clearInterval(interval);

        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ action: "audio_stopped" }));
        }
      },
    };
  }

  it("keeps streaming while same-language viewers join until latency or breakage becomes unacceptable", async () => {
    const meeting = await createMeeting(host.token, {
      topic: "Single Meeting Same-Language Stress Ramp",
      method: "one_way",
      spoken_languages: ["en"],
    });
    createdMeetings.push({ id: meeting.meetingId, hostToken: host.token });

    const hostJoin = await apiFetch(`/meeting/join/${meeting.readableId}`, host.token);
    const hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoin.token}`);
    activeSockets.push(hostWs);

    await new Promise<void>((resolve) => {
      hostWs.onopen = () => {
        hostWs.send(
          JSON.stringify({
            action: "subscribe_meeting",
            meetingId: meeting.meetingId,
          }),
        );
        resolve();
      };
    });

    const audioStream = startContinuousAudio(hostWs);
    const viewers: Array<{ ws: WebSocket; messages: any[]; attendeeId: string }> = [];

    let breakReason: string | null = null;
    let breakingViewerCount: number | null = null;
    const results: Array<{
      viewerCount: number;
      totalJoinMs: number;
      avgJoinMs: number;
      maxSingleJoinMs: number;
      minMs: number;
      maxMs: number;
      avgMs: number;
    }> = [];

    try {
      for (let viewerCount = START_VIEWERS; viewerCount <= MAX_VIEWERS; viewerCount += VIEWER_STEP) {
        const nextIndices = Array.from(
          { length: viewerCount - viewers.length },
          (_, offset) => viewers.length + offset,
        );

        const joinStartedAt = performance.now();
        const singleJoinTimes: number[] = [];

        for (const attendeeIndex of nextIndices) {
          const attendee = await getOrCreateAttendee(attendeeIndex);
          const singleJoinStartedAt = performance.now();
          const joinRes = await apiFetch(`/meeting/join/${meeting.readableId}`, attendee.token);
          const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);
          activeSockets.push(ws);

          const messages: any[] = [];
          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data.toString()));
          };

          await new Promise<void>((resolve) => {
            ws.onopen = () => {
              ws.send(
                JSON.stringify({
                  action: "subscribe_meeting",
                  meetingId: meeting.meetingId,
                }),
              );
              resolve();
            };
          });

          await waitForEvent(
            messages,
            (message) =>
              message.status === `Subscribed to ${meeting.meetingId}` ||
              (message.type === "presence" && message.event === "snapshot"),
            10000,
          );

          singleJoinTimes.push(performance.now() - singleJoinStartedAt);
          viewers.push({ ws, messages, attendeeId: attendee.id });
        }

        const totalJoinMs = performance.now() - joinStartedAt;
        const avgJoinMs =
          singleJoinTimes.reduce((sum, value) => sum + value, 0) / singleJoinTimes.length;
        const maxSingleJoinMs = Math.max(...singleJoinTimes);
        const transcriptText = `Same language ramp marker ${viewerCount}`;
        const deliveryStartedAt = performance.now();

        await injectTranscript(meeting.meetingId, transcriptText);

        const deliveryResults = await Promise.all(
          viewers.map(async ({ messages, attendeeId }) => {
            await waitForEvent(
              messages,
              (message) =>
                message.type === "transcription" &&
                message.language === "en" &&
                message.transcriptionText === transcriptText,
              10000,
            );

            return {
              attendeeId,
              deliveryMs: performance.now() - deliveryStartedAt,
            };
          }),
        );

        const deliveryTimes = deliveryResults.map((result) => result.deliveryMs);
        const minMs = Math.min(...deliveryTimes);
        const maxMs = Math.max(...deliveryTimes);
        const avgMs = deliveryTimes.reduce((sum, value) => sum + value, 0) / deliveryTimes.length;

        results.push({
          viewerCount,
          totalJoinMs,
          avgJoinMs,
          maxSingleJoinMs,
          minMs,
          maxMs,
          avgMs,
        });

        console.log(`\n--- Same-Language Fanout Ramp (${viewerCount} viewers) ---`);
        console.log(`Join phase total: ${totalJoinMs.toFixed(2)} ms`);
        console.log(`Join phase avg: ${avgJoinMs.toFixed(2)} ms/viewer`);
        console.log(`Join phase max single: ${maxSingleJoinMs.toFixed(2)} ms`);
        console.log(`Min delivery: ${minMs.toFixed(2)} ms`);
        console.log(`Max delivery: ${maxMs.toFixed(2)} ms`);
        console.log(`Avg delivery: ${avgMs.toFixed(2)} ms`);

        if (avgJoinMs >= AVG_JOIN_THRESHOLD_MS) {
          breakReason = `average join time ${avgJoinMs.toFixed(2)}ms exceeded ${AVG_JOIN_THRESHOLD_MS}ms`;
          breakingViewerCount = viewerCount;
          break;
        }

        if (maxSingleJoinMs >= MAX_SINGLE_JOIN_THRESHOLD_MS) {
          breakReason = `single join time ${maxSingleJoinMs.toFixed(2)}ms exceeded ${MAX_SINGLE_JOIN_THRESHOLD_MS}ms`;
          breakingViewerCount = viewerCount;
          break;
        }

        if (maxMs >= LATENCY_THRESHOLD_MS) {
          breakReason = `delivery latency ${maxMs.toFixed(2)}ms exceeded ${LATENCY_THRESHOLD_MS}ms`;
          breakingViewerCount = viewerCount;
          break;
        }
      }
    } finally {
      audioStream.stop();
      hostWs.close();
      for (const viewer of viewers) {
        viewer.ws.close();
      }
      await endMeeting(meeting.meetingId, host.token);

      const meetingIndex = createdMeetings.findIndex((entry) => entry.id === meeting.meetingId);
      if (meetingIndex > -1) {
        createdMeetings.splice(meetingIndex, 1);
      }
    }

    expect(results.length).toBeGreaterThan(0);

    await writeResultsFile({
      generatedAt: new Date().toISOString(),
      testName: "single-meeting-same-language-viewers",
      thresholds: {
        startViewers: START_VIEWERS,
        viewerStep: VIEWER_STEP,
        maxViewers: MAX_VIEWERS,
        latencyThresholdMs: LATENCY_THRESHOLD_MS,
        avgJoinThresholdMs: AVG_JOIN_THRESHOLD_MS,
        maxSingleJoinThresholdMs: MAX_SINGLE_JOIN_THRESHOLD_MS,
      },
      highestCompletedViewerCount: results[results.length - 1]?.viewerCount ?? 0,
      breakReason,
      breakingViewerCount,
      results,
    });

    if (breakReason && breakingViewerCount !== null) {
      throw new Error(
        `Same-language single-meeting stress hit a limit at ${breakingViewerCount} viewers: ${breakReason}`,
      );
    }

    const highestSuccessfulLevel = results[results.length - 1];
    console.log(
      `\nSame-language ramp completed through ${highestSuccessfulLevel?.viewerCount} viewers without breaching thresholds.`,
    );
  }, 600000);
});
