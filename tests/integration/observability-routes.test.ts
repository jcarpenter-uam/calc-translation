import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BASE_URL,
  cleanupTestUsers,
  createTestUser,
} from "../setup/utils/testHelpers";

describe("Observability routes", () => {
  const logsDir = path.resolve(process.cwd(), "logs");
  const combinedLogFile = path.join(logsDir, "combined-zzzz-test.log");
  const errorLogFile = path.join(logsDir, "error-zzzz-test.log");

  let superAdmin: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    superAdmin = await createTestUser(
      "observability-super-admin",
      "Observability Super Admin",
      "en",
      "super_admin",
    );
    regularUser = await createTestUser(
      "observability-regular-user",
      "Observability Regular User",
      "en",
    );

    await mkdir(logsDir, { recursive: true });
    await writeFile(combinedLogFile, "combined line 1\ncombined line 2\ncombined line 3\n");
    await writeFile(errorLogFile, "error line 1\nerror line 2\nerror line 3\n");
  });

  afterAll(async () => {
    await Promise.allSettled([rm(combinedLogFile), rm(errorLogFile)]);
    await cleanupTestUsers();
  });

  it("serves Prometheus metrics without requiring authentication", async () => {
    const response = await fetch(`${BASE_URL}/metrics`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") || "").toContain("text/plain");

    const body = await response.text();
    expect(body).toContain("calc_translation_active_websockets");
    expect(body).toContain("calc_translation_active_meetings");
  });

  it("forbids server log access for non-super-admin users", async () => {
    const response = await fetch(`${BASE_URL}/server-logs/?lines=200`, {
      headers: { Cookie: `auth_session=${regularUser.token}` },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Forbidden - Super admin access required",
    });
  });

  it("returns clamped server log payloads for super admins", async () => {
    const response = await fetch(`${BASE_URL}/server-logs/?lines=2`, {
      headers: { Cookie: `auth_session=${superAdmin.token}` },
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      lines: number;
      combined: { fileName: string | null; content: string };
      error: { fileName: string | null; content: string };
    };

    expect(body.lines).toBe(50);
    expect(body.combined.fileName).toBe("combined-zzzz-test.log");
    expect(body.error.fileName).toBe("error-zzzz-test.log");
    expect(body.combined.content).toContain("combined line 3");
    expect(body.error.content).toContain("error line 3");
  });
});
