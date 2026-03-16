import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  createTestUser,
  cleanupTestUsers,
  apiFetch,
  createMeeting,
  endMeeting,
  WS_URL,
  audioData,
} from "./utils/testHelpers";

/**
 * Integration test suite for the complete real-time translation lifecycle.
 * Measures the Time To First Token (TTFT) across various join scenarios.
 */
describe("Meeting Lifecycle & Real-Time TTFT", () => {
  let host: any;
  let attendees: any[] = [];

  /* Resource trackers for guaranteed cleanup */
  const activeSockets: WebSocket[] = [];
  const createdMeetings: { id: string; hostToken: string }[] = [];

  beforeAll(async () => {
    // Seed the Host
    host = await createTestUser("host-1", "Host User", "en");

    // Seed 5 attendees, giving some of them unique languages to test dynamic spawning
    const languages = ["en", "es", "fr", "de", "it"];
    for (let i = 0; i < 5; i++) {
      const language = languages[i] || "en";
      attendees.push(
        await createTestUser(`attendee-${i}`, `User ${i}`, language),
      );
    }
  });

  afterAll(async () => {
    // 1. Force close any active WebSockets
    for (const ws of activeSockets) {
      if (ws.readyState === 1 || ws.readyState === 0) ws.close();
    }

    // 2. End all meetings via the API to tear down Soniox sessions
    for (const meeting of createdMeetings) {
      try {
        await endMeeting(meeting.id, meeting.hostToken);
      } catch (err) {}
    }

    // 3. Destroy all test users and their database records
    await cleanupTestUsers();
  });

  /**
   * Tests the scenario where attendees arrive before the host.
   * Verifies the waiting room logic and ensures the backend can bulk-spawn workers.
   */
  it("Scenario A: Waiting room, bulk worker spawn, and TTFT", async () => {
    let audioDispatchTime = 0;

    // --- PHASE 1: HOST CREATES MEETING ---
    const createRes = await createMeeting(host.token, {
      topic: "Waiting Room TTFT Test",
      method: "one_way",
      languages: ["en", "es"], // Only preload two languages
    });

    expect(createRes.readableId).toBeDefined();
    const meetingReadableId = createRes.readableId;
    const meetingInternalId = createRes.meetingId;
    createdMeetings.push({ id: meetingInternalId, hostToken: host.token });

    // --- PHASE 2: ATTENDEES JOIN (WAITING ROOM) ---
    let attendeesInWaitingRoom = 0;
    const ttftPromises: Promise<{ ttft: number; language: string }>[] = [];

    // Process HTTP joins sequentially so we know they are in the waiting room BEFORE the host joins
    for (const attendee of attendees) {
      const joinRes = await apiFetch(
        `/meeting/join/${meetingReadableId}`,
        attendee.token,
      );
      expect(joinRes.isActive).toBe(false); // Meeting strictly not started yet!

      const ttftPromise = new Promise<{ ttft: number; language: string }>(
        (resolve) => {
          const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);
          activeSockets.push(ws);

          ws.onopen = () => {
            ws.send(
              JSON.stringify({
                action: "subscribe_meeting",
                meetingId: meetingInternalId,
              }),
            );
          };

          ws.onmessage = (event) => {
            const data = JSON.parse(event.data.toString());

            if (data.event === "meeting_started") {
              attendeesInWaitingRoom++;
            }

            if (
              data.type === "transcription" &&
              data.language === attendee.languageCode
            ) {
              const ttft = performance.now() - audioDispatchTime;
              ws.close();
              resolve({ ttft, language: data.language });
            }
          };
        },
      );

      ttftPromises.push(ttftPromise);
    }

    // Give the WebSockets a brief moment to connect
    await new Promise((r) => setTimeout(r, 500));

    // --- PHASE 3: HOST JOINS & TRIGGERS START ---
    const hostJoinRes = await apiFetch(
      `/meeting/join/${meetingReadableId}`,
      host.token,
    );
    expect(hostJoinRes.isActive).toBe(true);
    expect(hostJoinRes.isHost).toBe(true);

    const hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoinRes.token}`);
    activeSockets.push(hostWs);

    await new Promise<void>((resolve) => {
      hostWs.onopen = () => {
        hostWs.send(
          JSON.stringify({
            action: "subscribe_meeting",
            meetingId: meetingInternalId,
          }),
        );
        resolve();
      };
    });

    // Wait a brief moment to ensure WebSocket events propagate
    await new Promise((r) => setTimeout(r, 500));
    expect(attendeesInWaitingRoom).toBe(5); // Verify all attendees received the start event

    // --- PHASE 4: SEND AUDIO & MEASURE TTFT ---
    audioDispatchTime = performance.now();
    hostWs.send(audioData);

    // Wait for all 5 attendees to receive their translated text
    const results = await Promise.all(ttftPromises);

    // --- PHASE 5: ASSERTIONS & LOGGING ---
    console.log(`\n--- TTFT Results for Scenario A (Bulk Spawn) ---`);
    results.forEach((res, i) => {
      console.log(`Attendee ${i} (${res.language}): ${res.ttft.toFixed(2)} ms`);
      expect(res.ttft).toBeGreaterThan(0);
      expect(res.ttft).toBeLessThan(3000);
    });

    // --- CLEANUP ---
    hostWs.close();
    await endMeeting(meetingInternalId, host.token);

    const cleanupIdx = createdMeetings.findIndex(
      (m) => m.id === meetingInternalId,
    );
    if (cleanupIdx > -1) createdMeetings.splice(cleanupIdx, 1);
  }, 15000);

  /**
   * Tests the scenario where the host starts the meeting first.
   * Verifies the backend can dynamically spin up new language workers on demand as users join.
   */
  it("Scenario B: Dynamic late-joiners, on-demand worker spawn, and TTFT", async () => {
    let audioDispatchTime = 0;

    // --- PHASE 1: HOST CREATES MEETING ---
    const createRes = await createMeeting(host.token, {
      topic: "On-Demand TTFT Test",
      method: "one_way",
      languages: ["en"], // Host only configures English initially
    });

    expect(createRes.readableId).toBeDefined();
    const meetingReadableId = createRes.readableId;
    const meetingInternalId = createRes.meetingId;
    createdMeetings.push({ id: meetingInternalId, hostToken: host.token });

    // --- PHASE 2: HOST JOINS FIRST ---
    const hostJoinRes = await apiFetch(
      `/meeting/join/${meetingReadableId}`,
      host.token,
    );
    expect(hostJoinRes.isActive).toBe(true);

    const hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoinRes.token}`);
    activeSockets.push(hostWs);

    await new Promise<void>((resolve) => {
      hostWs.onopen = () => {
        hostWs.send(
          JSON.stringify({
            action: "subscribe_meeting",
            meetingId: meetingInternalId,
          }),
        );
        resolve();
      };
    });

    // Give the initial English Soniox worker a moment to connect upstream
    await new Promise((r) => setTimeout(r, 500));

    // --- PHASE 3: ATTENDEES JOIN (DYNAMIC SCALING) ---
    const ttftPromises: Promise<{ ttft: number; language: string }>[] = [];

    for (const attendee of attendees) {
      const joinRes = await apiFetch(
        `/meeting/join/${meetingReadableId}`,
        attendee.token,
      );

      // Because the host is already in, they skip the waiting room and the backend
      // dynamically spawns a new Soniox worker for their language immediately.
      expect(joinRes.isActive).toBe(true);

      const ttftPromise = new Promise<{ ttft: number; language: string }>(
        (resolve) => {
          const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);
          activeSockets.push(ws);

          ws.onopen = () => {
            ws.send(
              JSON.stringify({
                action: "subscribe_meeting",
                meetingId: meetingInternalId,
              }),
            );
          };

          ws.onmessage = (event) => {
            const data = JSON.parse(event.data.toString());

            if (
              data.type === "transcription" &&
              data.language === attendee.languageCode
            ) {
              const ttft = performance.now() - audioDispatchTime;
              ws.close();
              resolve({ ttft, language: data.language });
            }
          };
        },
      );

      ttftPromises.push(ttftPromise);
    }

    // Give the dynamically spawned Soniox workers a moment to finish their handshake
    await new Promise((r) => setTimeout(r, 1000));

    // --- PHASE 4: SEND AUDIO & MEASURE TTFT ---
    audioDispatchTime = performance.now();
    hostWs.send(audioData);

    const results = await Promise.all(ttftPromises);

    // --- PHASE 5: ASSERTIONS & LOGGING ---
    console.log(`\n--- TTFT Results for Scenario B (On-Demand Spawn) ---`);
    results.forEach((res, i) => {
      console.log(`Attendee ${i} (${res.language}): ${res.ttft.toFixed(2)} ms`);
      expect(res.ttft).toBeGreaterThan(0);
      expect(res.ttft).toBeLessThan(3000);
    });

    // --- CLEANUP ---
    hostWs.close();
    await endMeeting(meetingInternalId, host.token);

    const cleanupIdx = createdMeetings.findIndex(
      (m) => m.id === meetingInternalId,
    );
    if (cleanupIdx > -1) createdMeetings.splice(cleanupIdx, 1);
  }, 15000);

  /**
   * Tests a hybrid scenario combining both early and late joiners.
   * Ensures the system can handle bulk startup and dynamic scaling in the same session.
   */
  it("Scenario C: Mixed early and late joiners, hybrid worker spawn, and TTFT", async () => {
    let audioDispatchTime = 0;

    // --- PHASE 1: HOST CREATES MEETING ---
    const createRes = await createMeeting(host.token, {
      topic: "Hybrid TTFT Test",
      method: "one_way",
      languages: ["en"], // Start with just English
    });

    expect(createRes.readableId).toBeDefined();
    const meetingReadableId = createRes.readableId;
    const meetingInternalId = createRes.meetingId;
    createdMeetings.push({ id: meetingInternalId, hostToken: host.token });

    const ttftPromises: Promise<{ ttft: number; language: string }>[] = [];
    let attendeesInWaitingRoom = 0;

    // Split our 5 test attendees into two groups
    const earlyAttendees = attendees.slice(0, 2); // The first 2 join early
    const lateAttendees = attendees.slice(2); // The remaining 3 join late

    // --- PHASE 2: EARLY ATTENDEES JOIN (WAITING ROOM) ---
    for (const attendee of earlyAttendees) {
      const joinRes = await apiFetch(
        `/meeting/join/${meetingReadableId}`,
        attendee.token,
      );

      // Assert they are placed in the waiting room
      expect(joinRes.isActive).toBe(false);

      const ttftPromise = new Promise<{ ttft: number; language: string }>(
        (resolve) => {
          const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);
          activeSockets.push(ws);

          ws.onopen = () => {
            ws.send(
              JSON.stringify({
                action: "subscribe_meeting",
                meetingId: meetingInternalId,
              }),
            );
          };

          ws.onmessage = (event) => {
            const data = JSON.parse(event.data.toString());

            if (data.event === "meeting_started") {
              attendeesInWaitingRoom++;
            }

            if (
              data.type === "transcription" &&
              data.language === attendee.languageCode
            ) {
              const ttft = performance.now() - audioDispatchTime;
              ws.close();
              resolve({ ttft, language: data.language });
            }
          };
        },
      );

      ttftPromises.push(ttftPromise);
    }

    // Give early attendees time to establish WS connections
    await new Promise((r) => setTimeout(r, 500));

    // --- PHASE 3: HOST JOINS & TRIGGERS START ---
    // The host joins, instantly booting up Soniox workers for "en" and whatever
    // languages the early attendees brought with them.
    const hostJoinRes = await apiFetch(
      `/meeting/join/${meetingReadableId}`,
      host.token,
    );
    expect(hostJoinRes.isActive).toBe(true);
    expect(hostJoinRes.isHost).toBe(true);

    const hostWs = new WebSocket(`${WS_URL}?ticket=${hostJoinRes.token}`);
    activeSockets.push(hostWs);

    await new Promise<void>((resolve) => {
      hostWs.onopen = () => {
        hostWs.send(
          JSON.stringify({
            action: "subscribe_meeting",
            meetingId: meetingInternalId,
          }),
        );
        resolve();
      };
    });

    // Wait for the early attendees to receive the start event over the WebSocket
    await new Promise((r) => setTimeout(r, 500));
    expect(attendeesInWaitingRoom).toBe(2);

    // --- PHASE 4: LATE ATTENDEES JOIN (DYNAMIC SCALING) ---
    for (const attendee of lateAttendees) {
      const joinRes = await apiFetch(
        `/meeting/join/${meetingReadableId}`,
        attendee.token,
      );

      // Assert that the meeting is fully active for them
      expect(joinRes.isActive).toBe(true);

      const ttftPromise = new Promise<{ ttft: number; language: string }>(
        (resolve) => {
          const ws = new WebSocket(`${WS_URL}?ticket=${joinRes.token}`);
          activeSockets.push(ws);

          ws.onopen = () => {
            ws.send(
              JSON.stringify({
                action: "subscribe_meeting",
                meetingId: meetingInternalId,
              }),
            );
          };

          ws.onmessage = (event) => {
            const data = JSON.parse(event.data.toString());

            if (
              data.type === "transcription" &&
              data.language === attendee.languageCode
            ) {
              const ttft = performance.now() - audioDispatchTime;
              ws.close();
              resolve({ ttft, language: data.language });
            }
          };
        },
      );

      ttftPromises.push(ttftPromise);
    }

    // Give the dynamically spawned Soniox workers a moment to finish their handshake
    await new Promise((r) => setTimeout(r, 1000));

    // --- PHASE 5: SEND AUDIO & MEASURE TTFT ---
    audioDispatchTime = performance.now();
    hostWs.send(audioData);

    // Wait for all 5 attendees (both early and late) to get their transcriptions
    const results = await Promise.all(ttftPromises);

    // --- PHASE 6: ASSERTIONS & LOGGING ---
    console.log(`\n--- TTFT Results for Scenario C (Hybrid Spawn) ---`);
    results.forEach((res, i) => {
      // i < 2 are the early attendees, the rest are late attendees
      const type = i < 2 ? "Early" : "Late";
      console.log(
        `Attendee ${i} [${type}] (${res.language}): ${res.ttft.toFixed(2)} ms`,
      );
      expect(res.ttft).toBeGreaterThan(0);
      expect(res.ttft).toBeLessThan(3000);
    });

    // --- CLEANUP ---
    hostWs.close();
    await endMeeting(meetingInternalId, host.token);

    const cleanupIdx = createdMeetings.findIndex(
      (m) => m.id === meetingInternalId,
    );
    if (cleanupIdx > -1) createdMeetings.splice(cleanupIdx, 1);
  }, 15000);
});
