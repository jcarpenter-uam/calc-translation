import { describe, it, expect, beforeAll } from "bun:test";
import fs from "fs";
import { performance } from "perf_hooks";
import { db } from "../core/database";
import { users } from "../models/userModel";
import { generateApiSessionToken } from "../utils/security";

const PORT = process.env.PORT || 8000;
const API_URL = `http://localhost:${PORT}/api/meeting`;
const WS_URL = `ws://localhost:${PORT}/ws`;
const AUDIO_FILE = "./tests/samples/sample.raw";
const HOST_ID = "host-0";

const CONCURRENCY_LEVELS = [1, 5, 10, 25, 50, 100];

let validCookie = "";
const audioData = fs.readFileSync(AUDIO_FILE);

/**
 * Ensures the test host user exists in the database and generates a valid
 * authentication cookie for the API requests.
 *
 * @returns {Promise<string>} The formatted cookie string.
 */
async function setupHostUser() {
  await db
    .insert(users)
    .values({
      id: HOST_ID,
      name: "Stress Test Host",
      email: `${HOST_ID}@test.com`,
      languageCode: "en",
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { languageCode: "en" },
    });

  const token = await generateApiSessionToken(HOST_ID, "stress-test-tenant");
  return `auth_session=${token}`;
}

/**
 * Creates a meeting in the database and immediately joins it as the host.
 * Configures the meeting for English transcription to trigger the worker.
 *
 * @returns {Promise<{ id: string, token: string } | null>}
 */
async function createAndJoinMeeting() {
  try {
    const createRes = await fetch(`${API_URL}/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validCookie,
      },
      body: JSON.stringify({
        topic: "Stress Test Meeting",
        method: "one_way",
        languages: ["en"],
      }),
    });

    if (!createRes.ok)
      throw new Error(`Create API Error: ${await createRes.text()}`);
    const { readableId } = await createRes.json();

    const joinRes = await fetch(`${API_URL}/join/${readableId}`, {
      method: "POST",
      headers: { Cookie: validCookie },
    });

    if (!joinRes.ok) throw new Error(`Join API Error: ${await joinRes.text()}`);
    const joinData = await joinRes.json();

    return { id: joinData.meetingId, token: joinData.token };
  } catch (err) {
    console.error("Error in create/join flow:", err);
    return null;
  }
}

/**
 * Ends an active meeting, stopping the Soniox stream and updating the database.
 *
 * @param {string} id - The internal UUID of the meeting to end.
 * @returns {Promise<void>}
 */
async function endMeeting(id: string) {
  try {
    await fetch(`${API_URL}/end/${id}`, {
      method: "POST",
      headers: { Cookie: validCookie },
    });
  } catch (err) {}
}

describe("Stress Test & TTFT Measurement", () => {
  beforeAll(async () => {
    validCookie = await setupHostUser();
  });

  // Dynamically generate a test block for each concurrency tier
  for (const level of CONCURRENCY_LEVELS) {
    // Increased timeout heavily (120 seconds) for the higher concurrency levels (50-100)
    it(
      `should start ${level} concurrent streams and measure TTFT`,
      async () => {
        console.log(`\n=================================================`);
        console.log(
          `\x1b[36mRunning Stress Test: ${level} Concurrent Stream(s)\x1b[0m`,
        );
        console.log(`=================================================`);

        const meetings: any[] = [];
        for (let i = 0; i < level; i++) {
          const meetingData = await createAndJoinMeeting();
          if (meetingData) meetings.push(meetingData);
        }

        // Ensure we successfully created the required number of meetings
        expect(meetings.length).toBe(level);

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
            sockets.forEach((ws) => ws.close());

            for (const meeting of meetings) {
              await endMeeting(meeting.id);
            }

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
            // Use native WebSocket mapping
            const ws = new WebSocket(`${WS_URL}?ticket=${meeting.token}`);
            sockets.push(ws);

            let firstChunkTime: number | null = null;
            let firstTokenTime: number | null = null;

            ws.onopen = () => {
              ws.send(
                JSON.stringify({
                  action: "subscribe_meeting",
                  meetingId: meeting.id,
                }),
              );

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
      },
      120000, 
    );
  }
});
