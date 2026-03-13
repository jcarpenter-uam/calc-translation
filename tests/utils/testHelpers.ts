import { db } from "../../core/database";
import { users } from "../../models/userModel";
import { meetings } from "../../models/meetingModel";
import { inArray } from "drizzle-orm";
import { generateApiSessionToken } from "../../utils/security";
import * as fs from "fs";

export const PORT = process.env.PORT || 8000;
export const BASE_URL = `http://localhost:${PORT}/api`;
export const WS_URL = `ws://localhost:${PORT}/ws`;

// Load audio file into memory ONCE for the entire test suite
export const AUDIO_FILE = "./tests/samples/sample.raw";
export const audioData = fs.readFileSync(AUDIO_FILE);

const createdTestUsers: string[] = [];

/**
 * Creates or updates a test user in the database and generates an auth token.
 */
export async function createTestUser(
  id: string,
  name: string,
  languageCode: string,
) {
  await db
    .insert(users)
    .values({ id, name, email: `${id}@test.com`, languageCode })
    .onConflictDoUpdate({
      target: users.id,
      set: { languageCode },
    });

  // Track the user ID so we can destroy it later
  if (!createdTestUsers.includes(id)) {
    createdTestUsers.push(id);
  }

  const token = await generateApiSessionToken(id, "test-tenant");
  return { id, token, languageCode };
}

/**
 * Bulk deletes all tracked test users from the database.
 * Call this in the `afterAll` hook of your test suites.
 */
export async function cleanupTestUsers() {
  if (createdTestUsers.length === 0) return;

  try {
    await db
      .delete(meetings)
      .where(inArray(meetings.host_id, createdTestUsers));
    await db.delete(users).where(inArray(users.id, createdTestUsers));
    console.log(
      `Destroyed ${createdTestUsers.length} test users from the database.`,
    );
    createdTestUsers.length = 0; // Reset the tracker
  } catch (err) {
    console.error("Failed to clean up test users:", err);
  }
}

/**
 * Executes an authenticated HTTP POST request.
 */
export async function apiFetch(path: string, token: string, body?: any) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Cookie: `auth_session=${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API Error [${path}]: ${await res.text()}`);
  return res.json();
}

/**
 * High-level factory to create a meeting.
 */
export async function createMeeting(
  token: string,
  config: { topic?: string; method?: string; languages?: string[] } = {},
) {
  const body = {
    topic: config.topic || "Test Meeting",
    method: config.method || "one_way",
    languages: config.languages || ["en"],
  };
  return apiFetch("/meeting/create", token, body);
}

/**
 * High-level factory to end a meeting.
 */
export async function endMeeting(meetingId: string, hostToken: string) {
  return apiFetch(`/meeting/end/${meetingId}`, hostToken);
}

/**
 * Continuously streams PCM audio chunks to a WebSocket for a set duration.
 */
export function streamAudio(ws: WebSocket, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    let offset = 0;
    const chunkSize = 3200; // ~100ms of 16kHz PCM audio

    const interval = setInterval(() => {
      if (ws.readyState === 1) {
        // 1 = OPEN
        if (offset >= audioData.length) offset = 0; // Loop if needed
        const end = Math.min(offset + chunkSize, audioData.length);
        ws.send(audioData.subarray(offset, end));
        offset += chunkSize;
      }
    }, 100);

    setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, durationMs);
  });
}

/**
 * Blocks execution until a specific condition is met in an event array.
 */
export async function waitForEvent(
  messages: any[],
  predicate: (msg: any) => boolean,
  timeout = 10000,
) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (messages.find(predicate)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timeout waiting for specific WebSocket event.");
}
