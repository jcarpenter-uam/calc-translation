import { afterAll, describe, expect, it } from "bun:test";
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

const MEETING_STEP = 1;
const MAX_MEETING_COUNT = 20;
const VIEWERS_PER_MEETING = 200;
const VIEWERS_PER_LANGUAGE = 100;
const LATENCY_THRESHOLD_MS = 300;
const AVG_JOIN_THRESHOLD_MS = 175;
const MAX_SINGLE_JOIN_THRESHOLD_MS = 500;

const RESULTS_DIR = path.resolve(process.cwd(), "tests/stress/results");
const LATEST_RESULTS_PATH = path.join(
  RESULTS_DIR,
  "concurrent-meetings-two-language-capacity.latest.json",
);
const HISTORY_RESULTS_PATH = path.join(
  RESULTS_DIR,
  "concurrent-meetings-two-language-capacity.history.json",
);

type LanguageCode = "en" | "es";

interface MeetingViewer {
  userId: string;
  language: LanguageCode;
  ws: WebSocket;
  messages: any[];
}

interface ActiveMeeting {
  index: number;
  meetingId: string;
  readableId: string;
  hostToken: string;
  hostWs: WebSocket;
  stopAudio: () => void;
  viewers: MeetingViewer[];
}

describe("Concurrent meetings two-language capacity", () => {
  const activeSockets: WebSocket[] = [];
  const createdMeetings: { id: string; hostToken: string }[] = [];
  const activeMeetings: ActiveMeeting[] = [];

  afterAll(async () => {
    for (const meeting of activeMeetings) {
      meeting.stopAudio();
    }

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

  async function injectTranscript(meetingId: string, text: string, language: LanguageCode) {
    await (websocketController as any).handleTranscriptionEvent(meetingId, {
      targetLanguage: language,
      transcriptionText: text,
      translationText: null,
      isFinal: true,
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: null,
      sourceLanguage: language,
    });
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

    return () => {
      if (stopped) {
        return;
      }

      stopped = true;
      clearInterval(interval);

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ action: "audio_stopped" }));
      }
    };
  }

  async function connectViewer(
    meetingId: string,
    readableId: string,
    userToken: string,
    userId: string,
    language: LanguageCode,
  ) {
    const joinStartedAt = performance.now();
    const joinRes = await apiFetch(`/meeting/join/${readableId}`, userToken);
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
            meetingId,
          }),
        );
        resolve();
      };
    });

    await waitForEvent(
      messages,
      (message) =>
        message.status === `Subscribed to ${meetingId}` ||
        (message.type === "presence" && message.event === "snapshot"),
      10000,
    );

    return {
      viewer: {
        userId,
        language,
        ws,
        messages,
      } satisfies MeetingViewer,
      joinMs: performance.now() - joinStartedAt,
    };
  }

  async function createLoadedMeeting(meetingIndex: number) {
    const host = await createTestUser(
      `concurrent-meeting-host-${meetingIndex}`,
      `Concurrent Meeting Host ${meetingIndex}`,
      "en",
    );

    const created = await createMeeting(host.token, {
      topic: `Concurrent Two-Language Capacity ${meetingIndex}`,
      method: "one_way",
      languages: ["en", "es"],
    });
    createdMeetings.push({ id: created.meetingId, hostToken: host.token });

    const hostJoin = await apiFetch(`/meeting/join/${created.readableId}`, host.token);
    const hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoin.token}`);
    activeSockets.push(hostWs);

    await new Promise<void>((resolve) => {
      hostWs.onopen = () => {
        hostWs.send(
          JSON.stringify({
            action: "subscribe_meeting",
            meetingId: created.meetingId,
          }),
        );
        resolve();
      };
    });

    const stopAudio = startContinuousAudio(hostWs);
    const viewers: MeetingViewer[] = [];
    const joinTimes: number[] = [];

    for (const language of ["en", "es"] as const) {
      for (let viewerIndex = 0; viewerIndex < VIEWERS_PER_LANGUAGE; viewerIndex++) {
        const userId = `concurrent-meeting-${meetingIndex}-${language}-viewer-${viewerIndex}`;
        const user = await createTestUser(
          userId,
          `Concurrent Meeting ${meetingIndex} ${language.toUpperCase()} Viewer ${viewerIndex}`,
          language,
        );

        const { viewer, joinMs } = await connectViewer(
          created.meetingId,
          created.readableId,
          user.token,
          user.id,
          language,
        );
        viewers.push(viewer);
        joinTimes.push(joinMs);
      }
    }

    return {
      meeting: {
        index: meetingIndex,
        meetingId: created.meetingId,
        readableId: created.readableId,
        hostToken: host.token,
        hostWs,
        stopAudio,
        viewers,
      } satisfies ActiveMeeting,
      totalJoinMs: joinTimes.reduce((sum, value) => sum + value, 0),
      avgJoinMs: joinTimes.reduce((sum, value) => sum + value, 0) / joinTimes.length,
      maxSingleJoinMs: Math.max(...joinTimes),
    };
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

  it("finds the concurrent two-language meeting limit at 200 viewers per meeting", async () => {
    let breakReason: string | null = null;
    let breakingMeetingCount: number | null = null;
    const results: Array<{
      meetingCount: number;
      activeViewerCount: number;
      totalJoinMs: number;
      avgJoinMs: number;
      maxSingleJoinMs: number;
      minDeliveryMs: number;
      maxDeliveryMs: number;
      avgDeliveryMs: number;
    }> = [];

    try {
      for (
        let meetingCount = MEETING_STEP;
        meetingCount <= MAX_MEETING_COUNT;
        meetingCount += MEETING_STEP
      ) {
        const { meeting, totalJoinMs, avgJoinMs, maxSingleJoinMs } = await createLoadedMeeting(
          meetingCount,
        );
        activeMeetings.push(meeting);

        const deliveryTimes: number[] = [];

        for (const activeMeeting of activeMeetings) {
          for (const language of ["en", "es"] as const) {
            const transcriptText = `Concurrent meeting ${activeMeeting.index} marker ${language} at ${meetingCount}`;
            const deliveryStartedAt = performance.now();

            await injectTranscript(activeMeeting.meetingId, transcriptText, language);

            const matchingViewers = activeMeeting.viewers.filter(
              (viewer) => viewer.language === language,
            );

            const languageDeliveries = await Promise.all(
              matchingViewers.map(async (viewer) => {
                await waitForEvent(
                  viewer.messages,
                  (message) =>
                    message.type === "transcription" &&
                    message.language === language &&
                    message.transcriptionText === transcriptText,
                  10000,
                );

                return performance.now() - deliveryStartedAt;
              }),
            );

            deliveryTimes.push(...languageDeliveries);
          }
        }

        const minDeliveryMs = Math.min(...deliveryTimes);
        const maxDeliveryMs = Math.max(...deliveryTimes);
        const avgDeliveryMs =
          deliveryTimes.reduce((sum, value) => sum + value, 0) / deliveryTimes.length;
        const activeViewerCount = activeMeetings.length * VIEWERS_PER_MEETING;

        results.push({
          meetingCount,
          activeViewerCount,
          totalJoinMs,
          avgJoinMs,
          maxSingleJoinMs,
          minDeliveryMs,
          maxDeliveryMs,
          avgDeliveryMs,
        });

        console.log(`\n--- Concurrent Meeting Capacity (${meetingCount} meetings) ---`);
        console.log(`Active viewers: ${activeViewerCount}`);
        console.log(`Join phase total: ${totalJoinMs.toFixed(2)} ms`);
        console.log(`Join phase avg: ${avgJoinMs.toFixed(2)} ms/viewer`);
        console.log(`Join phase max single: ${maxSingleJoinMs.toFixed(2)} ms`);
        console.log(`Min delivery: ${minDeliveryMs.toFixed(2)} ms`);
        console.log(`Max delivery: ${maxDeliveryMs.toFixed(2)} ms`);
        console.log(`Avg delivery: ${avgDeliveryMs.toFixed(2)} ms`);

        if (avgJoinMs >= AVG_JOIN_THRESHOLD_MS) {
          breakReason = `average join time ${avgJoinMs.toFixed(2)}ms exceeded ${AVG_JOIN_THRESHOLD_MS}ms`;
          breakingMeetingCount = meetingCount;
          break;
        }

        if (maxSingleJoinMs >= MAX_SINGLE_JOIN_THRESHOLD_MS) {
          breakReason = `single join time ${maxSingleJoinMs.toFixed(2)}ms exceeded ${MAX_SINGLE_JOIN_THRESHOLD_MS}ms`;
          breakingMeetingCount = meetingCount;
          break;
        }

        if (maxDeliveryMs >= LATENCY_THRESHOLD_MS) {
          breakReason = `delivery latency ${maxDeliveryMs.toFixed(2)}ms exceeded ${LATENCY_THRESHOLD_MS}ms`;
          breakingMeetingCount = meetingCount;
          break;
        }
      }
    } finally {
      for (const meeting of activeMeetings) {
        meeting.stopAudio();
        meeting.hostWs.close();
        for (const viewer of meeting.viewers) {
          viewer.ws.close();
        }
      }

      while (activeMeetings.length > 0) {
        const meeting = activeMeetings.pop();
        if (!meeting) {
          continue;
        }

        await endMeeting(meeting.meetingId, meeting.hostToken);
        const trackedMeetingIndex = createdMeetings.findIndex((entry) => entry.id === meeting.meetingId);
        if (trackedMeetingIndex > -1) {
          createdMeetings.splice(trackedMeetingIndex, 1);
        }
      }
    }

    expect(results.length).toBeGreaterThan(0);

    await writeResultsFile({
      generatedAt: new Date().toISOString(),
      testName: "concurrent-meetings-two-language-capacity",
      thresholds: {
        meetingStep: MEETING_STEP,
        maxMeetingCount: MAX_MEETING_COUNT,
        viewersPerMeeting: VIEWERS_PER_MEETING,
        viewersPerLanguage: VIEWERS_PER_LANGUAGE,
        latencyThresholdMs: LATENCY_THRESHOLD_MS,
        avgJoinThresholdMs: AVG_JOIN_THRESHOLD_MS,
        maxSingleJoinThresholdMs: MAX_SINGLE_JOIN_THRESHOLD_MS,
      },
      highestCompletedMeetingCount: results[results.length - 1]?.meetingCount ?? 0,
      highestCompletedViewerCount: (results[results.length - 1]?.meetingCount ?? 0) * VIEWERS_PER_MEETING,
      breakReason,
      breakingMeetingCount,
      results,
    });

    if (breakReason && breakingMeetingCount !== null) {
      throw new Error(
        `Concurrent meetings two-language stress hit a limit at ${breakingMeetingCount} meetings: ${breakReason}`,
      );
    }

    const highestSuccessfulLevel = results[results.length - 1];
    console.log(
      `\nConcurrent meeting ramp completed through ${highestSuccessfulLevel?.meetingCount} meetings without breaching thresholds.`,
    );
  }, 900000);
});
