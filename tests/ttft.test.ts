import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { performance } from "perf_hooks";
import {
  createTestUser,
  cleanupTestUsers,
  createMeeting,
  endMeeting,
  apiFetch,
  WS_URL,
  audioData,
} from "./utils/testHelpers";

const CONCURRENCY_LEVELS = [1, 5, 10, 25, 50, 100];

describe("Stress Test & TTFT Measurement", () => {
  let host: any;

  /* Resource trackers for guaranteed cleanup */
  const activeSockets: WebSocket[] = [];
  const createdMeetings: { id: string; hostToken: string }[] = [];

  beforeAll(async () => {
    host = await createTestUser("stress-host", "Stress Test Host", "en");
  });

  afterAll(async () => {
    // 1. Force close any lingering WebSockets
    for (const ws of activeSockets) {
      if (ws.readyState === 1 || ws.readyState === 0) ws.close();
    }

    // 2. End all remaining meetings via the API
    for (const meeting of createdMeetings) {
      try {
        await endMeeting(meeting.id, meeting.hostToken);
      } catch (err) {}
    }

    // 3. Destroy all test users and their database records
    await cleanupTestUsers();
  });

  // Dynamically generate a test block for each concurrency tier
  for (const level of CONCURRENCY_LEVELS) {
    // Increased timeout heavily (120 seconds) for the higher concurrency levels
    it(`should start ${level} concurrent streams and measure TTFT`, async () => {
      console.log(`\n=================================================`);
      console.log(
        `\x1b[36mRunning Stress Test: ${level} Concurrent Stream(s)\x1b[0m`,
      );
      console.log(`=================================================`);

      // --- PHASE 1: BULK CREATE & JOIN MEETINGS ---
      const meetings: { id: string; token: string }[] = [];

      for (let i = 0; i < level; i++) {
        const createRes = await createMeeting(host.token, {
          topic: `Stress Test Meeting ${i + 1}`,
          method: "one_way",
          languages: ["en"],
        });

        const joinRes = await apiFetch(
          `/meeting/join/${createRes.readableId}`,
          host.token,
        );

        meetings.push({ id: createRes.meetingId, token: joinRes.token });
        createdMeetings.push({
          id: createRes.meetingId,
          hostToken: host.token,
        });
      }

      // Ensure we successfully created the required number of meetings
      expect(meetings.length).toBe(level);

      // --- PHASE 2: CONNECT WS & MEASURE TTFT ---
      await new Promise<void>((resolve) => {
        let completed = 0;
        const ttfts: number[] = [];
        const sockets: WebSocket[] = [];
        const intervals: Timer[] = [];
        let isFinished = false;

        const finish = async () => {
          if (isFinished) return;
          isFinished = true;

          intervals.forEach(clearInterval);

          if (ttfts.length > 0) {
            const avg = (
              ttfts.reduce((a, b) => a + b, 0) / ttfts.length
            ).toFixed(2);
            const min = Math.min(...ttfts).toFixed(2);
            const max = Math.max(...ttfts).toFixed(2);

            console.log(`\n\x1b[35m[Results for ${level} stream(s)]\x1b[0m`);
            console.log(`  Min TTFT: \x1b[33m${min} ms\x1b[0m`);
            console.log(`  Max TTFT: \x1b[33m${max} ms\x1b[0m`);
            console.log(`  Avg TTFT: \x1b[32m${avg} ms\x1b[0m\n`);
          } else {
            console.log(
              `\n\x1b[31m[Results for ${level} stream(s)] No tokens received.\x1b[0m\n`,
            );
          }

          // Test strictly expects all streams to successfully return a token
          expect(ttfts.length).toBe(level);
          setTimeout(resolve, 1500);
        };

        meetings.forEach((meeting, index) => {
          const ws = new WebSocket(`${WS_URL}?ticket=${meeting.token}`);
          sockets.push(ws);
          activeSockets.push(ws);

          let firstChunkTime: number | null = null;
          let firstTokenTime: number | null = null;

          ws.onopen = () => {
            ws.send(
              JSON.stringify({
                action: "subscribe_meeting",
                meetingId: meeting.id,
              }),
            );

            // Wait slightly for the Soniox worker to spin up before hammering it with audio
            setTimeout(() => {
              let offset = 0;
              const chunkSize = 3200;

              const streamInterval = setInterval(() => {
                if (offset < audioData.length) {
                  if (offset === 0) firstChunkTime = performance.now();
                  const end = Math.min(offset + chunkSize, audioData.length);
                  ws.send(audioData.subarray(offset, end));
                  offset += chunkSize;
                } else {
                  offset = 0; // Restart loop if needed to ensure token arrival
                }
              }, 100);
              intervals.push(streamInterval);
            }, 500);
          };

          ws.onmessage = (event) => {
            try {
              const parsed = JSON.parse(event.data.toString());
              if (
                parsed.type === "transcription" &&
                !firstTokenTime &&
                firstChunkTime
              ) {
                firstTokenTime = performance.now();
                const ttft = firstTokenTime - firstChunkTime;
                ttfts.push(ttft);

                console.log(
                  `  Stream ${index + 1}/${level} received token: \x1b[32m"${parsed.text}"\x1b[0m in ${ttft.toFixed(2)}ms`,
                );

                completed++;
                if (completed === level) finish();
              }
            } catch (e) {}
          };
        });

        // Safeguard: Timeout after 45 seconds if the Soniox streams lock up
        setTimeout(() => {
          if (!isFinished) {
            console.log(
              `\n\x1b[31m[Timeout]\x1b[0m Only ${completed}/${level} streams responded.`,
            );
            finish();
          }
        }, 45000);
      });

      // --- PHASE 3: INLINE CLEANUP ---
      // Proactively tear down these specific meetings/sockets so they don't
      // bloat memory and exhaust connections during the next concurrency tier.
      for (const meeting of meetings) {
        await endMeeting(meeting.id, host.token);

        const mIdx = createdMeetings.findIndex((cm) => cm.id === meeting.id);
        if (mIdx > -1) createdMeetings.splice(mIdx, 1);
      }

      // Close sockets and remove them from the global safety tracker
      for (let i = activeSockets.length - 1; i >= 0; i--) {
        const ws = activeSockets[i];
        if (!ws) {
          continue;
        }

        if (meetings.some((m) => ws.url.includes(m.token))) {
          ws.close();
          activeSockets.splice(i, 1);
        }
      }
    }, 120000);
  }
});
