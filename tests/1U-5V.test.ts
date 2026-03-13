import { describe, it, expect, beforeAll } from "bun:test";
import { db } from "../core/database";
import { users } from "../models/userModel";
import { generateApiSessionToken } from "../utils/security";
import * as fs from "fs";

const PORT = process.env.PORT || 8000;
const BASE_URL = `http://localhost:${PORT}/api`;
const WS_URL = `ws://localhost:${PORT}/ws`;

/**
 * Helper to set up a test user in the database and generate their authentication cookie.
 *
 * @param id - The specific UUID/ID to assign to the test user.
 * @param name - The display name of the test user.
 * @param languageCode - The preferred language code (e.g., 'en', 'es', 'fr') for translation.
 * @returns An object containing the user's ID, auth token, and language code.
 */
async function createTestUser(id: string, name: string, languageCode: string) {
  await db
    .insert(users)
    .values({ id, name, email: `${id}@test.com`, languageCode })
    .onConflictDoUpdate({
      target: users.id,
      set: { languageCode },
    });

  const token = await generateApiSessionToken(id, "test-tenant");
  return { id, token, languageCode };
}

/**
 * Helper to execute authenticated HTTP POST requests against the local API.
 *
 * @param path - The API endpoint path (e.g., '/meeting/create').
 * @param token - The user's valid session JWT.
 * @param body - Optional JSON payload to send in the request body.
 * @returns The parsed JSON response.
 */
async function apiFetch(path: string, token: string, body?: any) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Cookie: `auth_session=${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

/**
 * Integration test suite for the complete real-time translation lifecycle.
 * Measures the Time To First Token (TTFT) across various join scenarios.
 */
describe("Meeting Lifecycle & Real-Time TTFT", () => {
  let host: any;
  let attendees: any[] = [];

  beforeAll(async () => {
    // Seed the Host
    host = await createTestUser("host-1", "Host User", "en");

    // Seed 5 attendees, giving some of them unique languages to test dynamic spawning
    const languages = ["en", "es", "fr", "de", "it"];
    for (let i = 0; i < 5; i++) {
      attendees.push(await createTestUser(`attendee-${i}`, `User ${i}`, languages[i]));
    }
  });

  /**
   * Tests the scenario where attendees arrive before the host. 
   * Verifies the waiting room logic and ensures the backend can bulk-spawn workers.
   */
  it("Scenario A: Waiting room, bulk worker spawn, and TTFT", async () => {
    let audioDispatchTime = 0; 
    
    // --- PHASE 1: HOST CREATES MEETING ---
    const createRes = await apiFetch("/meeting/create", host.token, {
      topic: "Waiting Room TTFT Test",
      method: "one_way",
      languages: ["en", "es"], // Only preload two languages
    });

    expect(createRes.readableId).toBeDefined();
    const meetingReadableId = createRes.readableId;
    const meetingInternalId = createRes.meetingId;

    // --- PHASE 2: ATTENDEES JOIN (WAITING ROOM) ---
    let attendeesInWaitingRoom = 0;
    const ttftPromises: Promise<{ ttft: number; language: string }>[] = [];

    // Process HTTP joins sequentially so we know they are in the waiting room BEFORE the host joins
    for (const attendee of attendees) {
      const joinRes = await apiFetch(`/meeting/join/${meetingReadableId}`, attendee.token);
      expect(joinRes.isActive).toBe(false); // Meeting strictly not started yet!

      const ttftPromise = new Promise<{ ttft: number; language: string }>((resolve) => {
        const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);

        ws.onopen = () => {
          ws.send(JSON.stringify({ action: "subscribe_meeting", meetingId: meetingInternalId }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data.toString());

          if (data.event === "meeting_started") {
            attendeesInWaitingRoom++;
          }

          if (data.type === "transcription" && data.language === attendee.languageCode) {
            const ttft = performance.now() - audioDispatchTime;
            ws.close();
            resolve({ ttft, language: data.language });
          }
        };
      });

      ttftPromises.push(ttftPromise);
    }

    // Give the WebSockets a brief moment to connect
    await new Promise((r) => setTimeout(r, 500));

    // --- PHASE 3: HOST JOINS & TRIGGERS START ---
    const hostJoinRes = await apiFetch(`/meeting/join/${meetingReadableId}`, host.token);
    expect(hostJoinRes.isActive).toBe(true);
    expect(hostJoinRes.isHost).toBe(true);

    const hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoinRes.token}`);
    
    await new Promise<void>((resolve) => {
      hostWs.onopen = () => {
        hostWs.send(JSON.stringify({ action: "subscribe_meeting", meetingId: meetingInternalId }));
        resolve();
      };
    });

    // Wait a brief moment to ensure WebSocket events propagate
    await new Promise((r) => setTimeout(r, 500));
    expect(attendeesInWaitingRoom).toBe(5); // Verify all attendees received the start event

    // --- PHASE 4: SEND AUDIO & MEASURE TTFT ---
    const pcmBuffer = fs.readFileSync("./tests/samples/sample.raw");
    audioDispatchTime = performance.now();
    hostWs.send(pcmBuffer);

    // Wait for all 5 attendees to receive their translated text
    const results = await Promise.all(ttftPromises);

    // --- PHASE 5: ASSERTIONS & LOGGING ---
    console.log(`\n--- TTFT Results for Scenario A (Bulk Spawn) ---`);
    results.forEach((res, i) => {
      console.log(`Attendee ${i} (${res.language}): ${res.ttft.toFixed(2)} ms`);
      expect(res.ttft).toBeGreaterThan(0);
      expect(res.ttft).toBeLessThan(3000); 
    });

    hostWs.close();
    await apiFetch(`/meeting/end/${meetingInternalId}`, host.token);
  });

  /**
   * Tests the scenario where the host starts the meeting first.
   * Verifies the backend can dynamically spin up new language workers on demand as users join.
   */
  it("Scenario B: Dynamic late-joiners, on-demand worker spawn, and TTFT", async () => {
    let audioDispatchTime = 0;

    // --- PHASE 1: HOST CREATES MEETING ---
    const createRes = await apiFetch("/meeting/create", host.token, {
      topic: "On-Demand TTFT Test",
      method: "one_way",
      languages: ["en"], // Host only configures English initially
    });

    expect(createRes.readableId).toBeDefined();
    const meetingReadableId = createRes.readableId;
    const meetingInternalId = createRes.meetingId;

    // --- PHASE 2: HOST JOINS FIRST ---
    const hostJoinRes = await apiFetch(`/meeting/join/${meetingReadableId}`, host.token);
    expect(hostJoinRes.isActive).toBe(true);

    const hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoinRes.token}`);
    await new Promise<void>((resolve) => {
      hostWs.onopen = () => {
        hostWs.send(JSON.stringify({ action: "subscribe_meeting", meetingId: meetingInternalId }));
        resolve();
      };
    });
    
    // Give the initial English Soniox worker a moment to connect upstream
    await new Promise((r) => setTimeout(r, 500)); 

    // --- PHASE 3: ATTENDEES JOIN (DYNAMIC SCALING) ---
    const ttftPromises: Promise<{ ttft: number; language: string }>[] = [];

    for (const attendee of attendees) {
      const joinRes = await apiFetch(`/meeting/join/${meetingReadableId}`, attendee.token);
      
      // Because the host is already in, they skip the waiting room and the backend
      // dynamically spawns a new Soniox worker for their language immediately.
      expect(joinRes.isActive).toBe(true); 

      const ttftPromise = new Promise<{ ttft: number; language: string }>((resolve) => {
        const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);

        ws.onopen = () => {
          ws.send(JSON.stringify({ action: "subscribe_meeting", meetingId: meetingInternalId }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data.toString());

          if (data.type === "transcription" && data.language === attendee.languageCode) {
            const ttft = performance.now() - audioDispatchTime;
            ws.close();
            resolve({ ttft, language: data.language });
          }
        };
      });

      ttftPromises.push(ttftPromise);
    }

    // Give the dynamically spawned Soniox workers a moment to finish their handshake
    await new Promise((r) => setTimeout(r, 1000));

    // --- PHASE 4: SEND AUDIO & MEASURE TTFT ---
    const pcmBuffer = fs.readFileSync("./tests/samples/sample.raw");
    audioDispatchTime = performance.now();
    hostWs.send(pcmBuffer);

    const results = await Promise.all(ttftPromises);

    // --- PHASE 5: ASSERTIONS & LOGGING ---
    console.log(`\n--- TTFT Results for Scenario B (On-Demand Spawn) ---`);
    results.forEach((res, i) => {
      console.log(`Attendee ${i} (${res.language}): ${res.ttft.toFixed(2)} ms`);
      expect(res.ttft).toBeGreaterThan(0);
      expect(res.ttft).toBeLessThan(3000);
    });

    hostWs.close();
    await apiFetch(`/meeting/end/${meetingInternalId}`, host.token);
  });

  /**
   * Tests a hybrid scenario combining both early and late joiners.
   * Ensures the system can handle bulk startup and dynamic scaling in the same session.
   */
  it("Scenario C: Mixed early and late joiners, hybrid worker spawn, and TTFT", async () => {
    let audioDispatchTime = 0;

    // --- PHASE 1: HOST CREATES MEETING ---
    const createRes = await apiFetch("/meeting/create", host.token, {
      topic: "Hybrid TTFT Test",
      method: "one_way",
      languages: ["en"], // Start with just English
    });

    expect(createRes.readableId).toBeDefined();
    const meetingReadableId = createRes.readableId;
    const meetingInternalId = createRes.meetingId;

    const ttftPromises: Promise<{ ttft: number; language: string }>[] = [];
    let attendeesInWaitingRoom = 0;

    // Split our 5 test attendees into two groups
    const earlyAttendees = attendees.slice(0, 2); // The first 2 join early
    const lateAttendees = attendees.slice(2);     // The remaining 3 join late

    // --- PHASE 2: EARLY ATTENDEES JOIN (WAITING ROOM) ---
    for (const attendee of earlyAttendees) {
      const joinRes = await apiFetch(`/meeting/join/${meetingReadableId}`, attendee.token);
      
      // Assert they are placed in the waiting room
      expect(joinRes.isActive).toBe(false);

      const ttftPromise = new Promise<{ ttft: number; language: string }>((resolve) => {
        const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);

        ws.onopen = () => {
          ws.send(JSON.stringify({ action: "subscribe_meeting", meetingId: meetingInternalId }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data.toString());

          if (data.event === "meeting_started") {
            attendeesInWaitingRoom++;
          }

          if (data.type === "transcription" && data.language === attendee.languageCode) {
            const ttft = performance.now() - audioDispatchTime;
            ws.close();
            resolve({ ttft, language: data.language });
          }
        };
      });

      ttftPromises.push(ttftPromise);
    }

    // Give early attendees time to establish WS connections
    await new Promise((r) => setTimeout(r, 500));

    // --- PHASE 3: HOST JOINS & TRIGGERS START ---
    // The host joins, instantly booting up Soniox workers for "en" and whatever 
    // languages the early attendees brought with them.
    const hostJoinRes = await apiFetch(`/meeting/join/${meetingReadableId}`, host.token);
    expect(hostJoinRes.isActive).toBe(true);
    expect(hostJoinRes.isHost).toBe(true);

    const hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoinRes.token}`);
    
    await new Promise<void>((resolve) => {
      hostWs.onopen = () => {
        hostWs.send(JSON.stringify({ action: "subscribe_meeting", meetingId: meetingInternalId }));
        resolve();
      };
    });

    // Wait for the early attendees to receive the start event over the WebSocket
    await new Promise((r) => setTimeout(r, 500));
    expect(attendeesInWaitingRoom).toBe(2); 

    // --- PHASE 4: LATE ATTENDEES JOIN (DYNAMIC SCALING) ---
    for (const attendee of lateAttendees) {
      const joinRes = await apiFetch(`/meeting/join/${meetingReadableId}`, attendee.token);
      
      // Assert that the meeting is fully active for them
      expect(joinRes.isActive).toBe(true); 

      const ttftPromise = new Promise<{ ttft: number; language: string }>((resolve) => {
        const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);

        ws.onopen = () => {
          ws.send(JSON.stringify({ action: "subscribe_meeting", meetingId: meetingInternalId }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data.toString());

          if (data.type === "transcription" && data.language === attendee.languageCode) {
            const ttft = performance.now() - audioDispatchTime;
            ws.close();
            resolve({ ttft, language: data.language });
          }
        };
      });

      ttftPromises.push(ttftPromise);
    }

    // Give the dynamically spawned Soniox workers a moment to finish their handshake
    await new Promise((r) => setTimeout(r, 1000));

    // --- PHASE 5: SEND AUDIO & MEASURE TTFT ---
    const pcmBuffer = fs.readFileSync("./tests/samples/sample.raw");
    audioDispatchTime = performance.now();
    hostWs.send(pcmBuffer);

    // Wait for all 5 attendees (both early and late) to get their transcriptions
    const results = await Promise.all(ttftPromises);

    // --- PHASE 6: ASSERTIONS & LOGGING ---
    console.log(`\n--- TTFT Results for Scenario C (Hybrid Spawn) ---`);
    results.forEach((res, i) => {
      // i < 2 are the early attendees, the rest are late attendees
      const type = i < 2 ? "Early" : "Late";
      console.log(`Attendee ${i} [${type}] (${res.language}): ${res.ttft.toFixed(2)} ms`);
      expect(res.ttft).toBeGreaterThan(0);
      expect(res.ttft).toBeLessThan(3000);
    });

    hostWs.close();
    await apiFetch(`/meeting/end/${meetingInternalId}`, host.token);
  });
});
