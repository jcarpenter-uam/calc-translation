import { describe, it, expect, beforeAll } from "bun:test";
import fs from "fs";
import { db } from "../core/database";
import { users } from "../models/userModel";
import { generateApiSessionToken } from "../utils/security";

const PORT = process.env.PORT || 8000;
const API_URL = `http://localhost:${PORT}/api/meeting`;
const WS_URL = `ws://localhost:${PORT}/ws`;
const AUDIO_FILE = "./tests/samples/sample.raw";
const HOST_ID = "host-0";

let validCookie = "";
const audioData = fs.readFileSync(AUDIO_FILE);

/**
 * Ensures the test host user exists in the database and generates a valid
 * authentication cookie for the API requests.
 */
async function setupHostUser() {
  await db
    .insert(users)
    .values({
      id: HOST_ID,
      name: "Smoke Test Host",
      email: `${HOST_ID}@test.com`,
      languageCode: "en",
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { languageCode: "en" },
    });

  const token = await generateApiSessionToken(HOST_ID, "test-tenant");
  return `auth_session=${token}`;
}

/**
 * Creates a meeting in the database and immediately joins it as the host.
 * Configures the meeting for English transcription to trigger the worker.
 */
async function createAndJoinMeeting() {
  try {
    const createRes = await fetch(`${API_URL}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: validCookie },
      body: JSON.stringify({
        topic: "Single Stream Debug Meeting",
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
 * Ends an active meeting, stopping the transcription streams and updating the database.
 */
async function endMeeting(id: string) {
  try {
    await fetch(`${API_URL}/end/${id}`, {
      method: "POST",
      headers: { Cookie: validCookie },
    });
    console.log(`\n\x1b[33mMeeting ${id} ended gracefully.\x1b[0m`);
  } catch (err) {}
}

describe("Smoke Test - Single Stream", () => {
  beforeAll(async () => {
    validCookie = await setupHostUser();
  });

  // Added a timeout override (15000ms) because streaming the audio takes several seconds
  it("should stream audio and receive transcription tokens", async () => {
    console.log(`\x1b[36mInitializing Single Stream Test...\x1b[0m`);

    const meeting = await createAndJoinMeeting();
    expect(meeting).toBeDefined(); // Fail the test if meeting creation fails

    console.log(
      `\x1b[32mSuccessfully joined meeting ${meeting?.id}. Opening WebSocket...\x1b[0m`,
    );

    let receivedTranscription = false;

    await new Promise<void>((resolve) => {
      // Using Bun's native WebSocket
      const ws = new WebSocket(`${WS_URL}?ticket=${meeting?.token}`);
      let streamInterval: Timer;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({ action: "subscribe_meeting", meetingId: meeting?.id }),
        );

        console.log(`\x1b[35mStreaming audio chunks...\x1b[0m\n`);

        let offset = 0;
        const chunkSize = 3200;

        streamInterval = setInterval(() => {
          if (offset < audioData.length) {
            const end = Math.min(offset + chunkSize, audioData.length);
            ws.send(audioData.subarray(offset, end));
            offset += chunkSize;
          } else {
            clearInterval(streamInterval);
            console.log(
              `\n\n\x1b[36mFinished streaming audio file. Closing connection in 2 seconds...\x1b[0m`,
            );

            setTimeout(async () => {
              ws.close();
              if (meeting?.id) await endMeeting(meeting.id);
              resolve();
            }, 2000);
          }
        }, 100);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data.toString());
          if (parsed.type === "transcription") {
            receivedTranscription = true;
            process.stdout.write(`\r\x1b[K\x1b[32m${parsed.text}\x1b[0m`);
            if (parsed.isFinal) {
              process.stdout.write("\n");
            }
          }
        } catch (e) {}
      };

      ws.onerror = (err) => {
        console.error("\x1b[31mWebSocket Error:\x1b[0m", err);
        clearInterval(streamInterval);
        resolve();
      };
    });

    // Assert that we actually got text back from Soniox
    expect(receivedTranscription).toBe(true);
  }, 60000); 
});
