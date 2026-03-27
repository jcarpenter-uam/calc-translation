import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  createTestUser,
  cleanupTestUsers,
  apiFetch,
  createMeeting,
  endMeeting,
  streamAudio,
  WS_URL,
} from "./utils/testHelpers";

/**
 * Integration test suite for the complete real-time translation lifecycle.
 * Measures the Time To First Token (TTFT) across various join scenarios.
 */
describe("Meeting Lifecycle & Real-Time TTFT", () => {
  let host: any;
  let attendees: any[] = [];

  // Track resources explicitly because these scenarios create multiple sockets and meetings.
  const activeSockets: WebSocket[] = [];
  const createdMeetings: { id: string; hostToken: string }[] = [];

  beforeAll(async () => {
    host = await createTestUser("host-1", "Host User", "en");

    // Mix shared and unique languages so the meeting exercises both reused and dynamically added
    // one-way transcription workers.
    const languages = ["en", "es", "fr", "de", "it"];
    for (let i = 0; i < 5; i++) {
      const language = languages[i] || "en";
      attendees.push(
        await createTestUser(`attendee-${i}`, `User ${i}`, language),
      );
    }
  });

  afterAll(async () => {
    for (const ws of activeSockets) {
      if (ws.readyState === 1 || ws.readyState === 0) ws.close();
    }

    for (const meeting of createdMeetings) {
      try {
        await endMeeting(meeting.id, meeting.hostToken);
      } catch (err) {}
    }

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

    // Join sequentially so every attendee is parked in the waiting room before the host activates
    // the room and starts audio.
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

    // Give the waiting-room subscribers time to attach before the host starts the room.
    await new Promise((r) => setTimeout(r, 500));

    // --- PHASE 3: HOST JOINS THE ROOM ---
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

    // --- PHASE 4: SEND AUDIO, START MEETING, & MEASURE TTFT ---
    audioDispatchTime = performance.now();
    await streamAudio(hostWs, 3000);

    // Every attendee should receive tokens in their own language once the meeting becomes live.
    const results = await Promise.all(ttftPromises);
    expect(attendeesInWaitingRoom).toBe(5);

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

      // The host has joined, but attendees should still see the room as inactive until audio flows.
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
    await streamAudio(hostWs, 3000);

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

    // --- PHASE 3: HOST JOINS THE ROOM ---
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

    // --- PHASE 4: LATE ATTENDEES JOIN (DYNAMIC SCALING) ---
    for (const attendee of lateAttendees) {
      const joinRes = await apiFetch(
        `/meeting/join/${meetingReadableId}`,
        attendee.token,
      );

      // The host is connected, but the meeting does not become active until audio starts.
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

    // --- PHASE 5: SEND AUDIO, START MEETING, & MEASURE TTFT ---
    audioDispatchTime = performance.now();
    await streamAudio(hostWs, 3000);

    // Wait for all 5 attendees (both early and late) to get their transcriptions
    const results = await Promise.all(ttftPromises);
    expect(attendeesInWaitingRoom).toBe(2);

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
