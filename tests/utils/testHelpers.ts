import { db } from "../../core/database";
import { users } from "../../models/userModel";
import { meetings } from "../../models/meetingModel";
import {
  tenants,
  tenantDomains,
  tenantAuthConfigs,
} from "../../models/tenantModel";
import { inArray } from "drizzle-orm";
import { generateApiSessionToken } from "../../utils/security";
import * as fs from "fs";

export interface TestUser {
  id: string;
  token: string;
  languageCode: string;
}

export interface CreateMeetingResponse {
  message: string;
  meetingId: string;
  readableId: string;
}

export interface JoinMeetingResponse {
  message: string;
  meetingId: string;
  readableId: string;
  token: string;
  isActive: boolean;
  isHost: boolean;
}

export interface EndMeetingResponse {
  message: string;
  meetingId: string;
}

export const PORT = process.env.PORT || 8000;
export const BASE_URL = `http://localhost:${PORT}/api`;
export const WS_URL = `ws://localhost:${PORT}/ws`;

// Load test audio once per process.
export const AUDIO_FILE = "./tests/samples/sample.raw";
export const audioData = fs.readFileSync(AUDIO_FILE);

const createdTestUsers: string[] = [];
const createdTestTenants: string[] = [];

/**
 * Tracks test tenant ids for teardown.
 */
export function trackTestTenants(...tenantIds: string[]) {
  for (const tenantId of tenantIds) {
    if (!createdTestTenants.includes(tenantId)) {
      createdTestTenants.push(tenantId);
    }
  }
}

/**
 * Tracks test user ids for teardown.
 */
export function trackTestUsers(...userIds: string[]) {
  for (const userId of userIds) {
    if (!createdTestUsers.includes(userId)) {
      createdTestUsers.push(userId);
    }
  }
}

/**
 * Creates or updates a test user in the database and generates an auth token.
 */
export async function createTestUser(
  id: string,
  name: string,
  languageCode: string,
): Promise<TestUser> {
  // Seed the shared tenant to satisfy foreign-key constraints.
  await db
    .insert(tenants)
    .values({
      tenantId: "test-tenant",
      organizationName: "Test Organization",
    })
    .onConflictDoNothing();

  trackTestTenants("test-tenant");

  await db
    .insert(users)
    .values({ id, name, email: `${id}@test.com`, languageCode })
    .onConflictDoUpdate({
      target: users.id,
      set: { languageCode },
    });

  trackTestUsers(id);

  const token = await generateApiSessionToken(id, "test-tenant");
  return { id, token, languageCode };
}

/**
 * Bulk deletes tracked meetings, users, tenant domains/configs, and tenants.
 * Deletion order is foreign-key safe for the current schema.
 */
export async function cleanupTestData() {
  if (createdTestUsers.length === 0 && createdTestTenants.length === 0) {
    return;
  }

  try {
    if (createdTestUsers.length > 0 && createdTestTenants.length > 0) {
      await db
        .delete(meetings)
        .where(inArray(meetings.host_id, createdTestUsers));

      await db
        .delete(meetings)
        .where(inArray(meetings.tenant_id, createdTestTenants));
    } else if (createdTestUsers.length > 0) {
      await db
        .delete(meetings)
        .where(inArray(meetings.host_id, createdTestUsers));
    } else if (createdTestTenants.length > 0) {
      await db
        .delete(meetings)
        .where(inArray(meetings.tenant_id, createdTestTenants));
    }

    if (createdTestUsers.length > 0) {
      await db.delete(users).where(inArray(users.id, createdTestUsers));
    }

    if (createdTestTenants.length > 0) {
      await db
        .delete(tenantDomains)
        .where(inArray(tenantDomains.tenantId, createdTestTenants));

      await db
        .delete(tenantAuthConfigs)
        .where(inArray(tenantAuthConfigs.tenantId, createdTestTenants));

      await db
        .delete(tenants)
        .where(inArray(tenants.tenantId, createdTestTenants));
    }

    console.log(
      `Destroyed ${createdTestUsers.length} test users and ${createdTestTenants.length} test tenants (plus domains, auth configs, and meetings).`,
    );

    createdTestUsers.length = 0;
    createdTestTenants.length = 0;
  } catch (err) {
    console.error("Failed to clean up test data:", err);
  }
}

/**
 * Backward-compatible alias for existing tests.
 */
export async function cleanupTestUsers() {
  await cleanupTestData();
}

/**
 * Executes an authenticated HTTP POST request.
 */
export async function apiFetch<T = any>(
  path: string,
  token: string,
  body?: any,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Cookie: `auth_session=${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API Error [${path}]: ${await res.text()}`);
  return (await res.json()) as T;
}

/**
 * High-level factory to create a meeting.
 */
export async function createMeeting(
  token: string,
  config: { topic?: string; method?: string; languages?: string[] } = {},
): Promise<CreateMeetingResponse> {
  const body = {
    topic: config.topic || "Test Meeting",
    method: config.method || "one_way",
    languages: config.languages || ["en"],
  };
  return apiFetch<CreateMeetingResponse>("/meeting/create", token, body);
}

/**
 * High-level factory to end a meeting.
 */
export async function endMeeting(
  meetingId: string,
  hostToken: string,
): Promise<EndMeetingResponse> {
  return apiFetch<EndMeetingResponse>(`/meeting/end/${meetingId}`, hostToken);
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
