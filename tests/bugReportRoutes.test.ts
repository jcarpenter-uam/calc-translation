import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "../core/database";
import { inArray } from "drizzle-orm";
import { tenants } from "../models/tenantModel";
import { users } from "../models/userModel";
import { bugReports } from "../models/bugReportModel";
import { userTenants } from "../models/userTenantModel";
import { generateApiSessionToken } from "../utils/security";
import {
  BASE_URL,
  cleanupTestData,
  trackTestTenants,
  trackTestUsers,
} from "./utils/testHelpers";

describe("Bug report routes", () => {
  const tenantId = "bug-report-tenant";
  const userIds = [
    "bug_report_super",
    "bug_report_tenant_admin",
    "bug_report_user",
  ] as const;
  const [superUserId, tenantAdminUserId, regularUserId] = userIds;

  let superToken = "";
  let tenantAdminToken = "";
  let userToken = "";
  let createdReportId = "";

  beforeAll(async () => {
    trackTestTenants(tenantId);
    trackTestUsers(...userIds);

    await db
      .insert(tenants)
      .values({
        tenantId,
        organizationName: "Bug Report Tenant",
      })
      .onConflictDoNothing();

    await db
      .insert(users)
      .values([
        {
          id: superUserId,
          name: "Bug Report Super",
          email: "bug-report-super@test.com",
          languageCode: "en",
          role: "super_admin" as any,
        },
        {
          id: tenantAdminUserId,
          name: "Bug Report Tenant Admin",
          email: "bug-report-tenant-admin@test.com",
          languageCode: "en",
          role: "tenant_admin" as any,
        },
        {
          id: regularUserId,
          name: "Bug Report User",
          email: "bug-report-user@test.com",
          languageCode: "en",
          role: "user" as any,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(userTenants)
      .values([
        { userId: superUserId, tenantId },
        { userId: tenantAdminUserId, tenantId },
        { userId: regularUserId, tenantId },
      ])
      .onConflictDoNothing();

    superToken = await generateApiSessionToken(superUserId, tenantId);
    tenantAdminToken = await generateApiSessionToken(tenantAdminUserId, tenantId);
    userToken = await generateApiSessionToken(regularUserId, tenantId);
  });

  afterAll(async () => {
    await db.delete(bugReports).where(inArray(bugReports.userId, [...userIds]));
    await cleanupTestData();
  });

  it("allows authenticated users to submit bug reports", async () => {
    const response = await fetch(`${BASE_URL}/bug-reports/`, {
      method: "POST",
      headers: {
        Cookie: `auth_session=${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Toolbar button does nothing",
        description: "Clicked the toolbar button and no action fired.",
        currentRoute: "home",
        clientLogFileName: "bug-report-test.log",
        clientLogFileContent:
          "Generated At: 2026-03-25T00:00:00.000Z\nClient Logs\n-----------\n2026-03-25T00:00:00.000Z [ERROR] Button click handler was undefined",
        clientMetadata: {
          clientType: "web",
          osPlatform: "linux",
          appVersion: "1.2.3",
          browserName: "Firefox",
          browserVersion: "123.0",
          userAgent: "Mozilla/5.0",
        },
        clientLogs: [
          {
            timestamp: new Date().toISOString(),
            level: "error",
            message: "Button click handler was undefined",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      message: string;
      report: {
        id: string;
        title: string;
        status: string;
        userId: string | null;
        tenantId: string | null;
        clientLogFileName: string | null;
        clientLogFileContent: string | null;
        clientLogs: Array<{ message: string }>;
      } | null;
    };

    expect(data.message).toBe("Bug report submitted successfully");
    createdReportId = data.report?.id || "";
    expect(data.report?.title).toBe("Toolbar button does nothing");
    expect(data.report?.status).toBe("open");
    expect(data.report?.userId).toBe(regularUserId);
    expect(data.report?.tenantId).toBe(tenantId);
    expect(data.report?.clientLogFileName).toBe("bug-report-test.log");
    expect(data.report?.clientLogFileContent).toContain("Client Logs");
    expect(data.report?.clientLogs[0]?.message).toContain("undefined");
  });

  it("restricts bug report listing to super admins and defaults to open reports", async () => {
    const tenantAdminResponse = await fetch(`${BASE_URL}/bug-reports/`, {
      headers: {
        Cookie: `auth_session=${tenantAdminToken}`,
      },
    });

    expect(tenantAdminResponse.status).toBe(403);

    const superResponse = await fetch(`${BASE_URL}/bug-reports/`, {
      headers: {
        Cookie: `auth_session=${superToken}`,
      },
    });

    expect(superResponse.status).toBe(200);

    const data = (await superResponse.json()) as {
      reports: Array<{ title: string; userId: string | null; status: string }>;
    };

    // Listing defaults to the unresolved triage queue unless a status filter is supplied.
    expect(data.reports.length).toBeGreaterThan(0);
    expect(data.reports.some((report) => report.userId === regularUserId)).toBe(true);
    expect(
      data.reports.some((report) => report.title === "Toolbar button does nothing"),
    ).toBe(true);
    expect(data.reports.every((report) => report.status === "open")).toBe(true);
  });

  it("allows super admins to resolve bug reports and filter by status", async () => {
    const updateResponse = await fetch(
      `${BASE_URL}/bug-reports/${createdReportId}/status`,
      {
        method: "PATCH",
        headers: {
          Cookie: `auth_session=${superToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "resolved" }),
      },
    );

    expect(updateResponse.status).toBe(200);

    const updatedData = (await updateResponse.json()) as {
      report: { id: string; status: string };
    };
    expect(updatedData.report.id).toBe(createdReportId);
    expect(updatedData.report.status).toBe("resolved");

    const openResponse = await fetch(`${BASE_URL}/bug-reports/?status=open`, {
      headers: {
        Cookie: `auth_session=${superToken}`,
      },
    });
    const openData = (await openResponse.json()) as {
      reports: Array<{ id: string; status: string }>;
    };
    expect(openResponse.status).toBe(200);
    expect(openData.reports.some((report) => report.id === createdReportId)).toBe(false);

    const resolvedResponse = await fetch(
      `${BASE_URL}/bug-reports/?status=resolved`,
      {
        headers: {
          Cookie: `auth_session=${superToken}`,
        },
      },
    );
    const resolvedData = (await resolvedResponse.json()) as {
      reports: Array<{ id: string; status: string }>;
    };
    expect(resolvedResponse.status).toBe(200);
    expect(
      resolvedData.reports.some(
        (report) => report.id === createdReportId && report.status === "resolved",
      ),
    ).toBe(true);

    const reopenResponse = await fetch(
      `${BASE_URL}/bug-reports/${createdReportId}/status`,
      {
        method: "PATCH",
        headers: {
          Cookie: `auth_session=${superToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "open" }),
      },
    );
    expect(reopenResponse.status).toBe(200);

    const reopenedData = (await reopenResponse.json()) as {
      report: { id: string; status: string };
    };
    expect(reopenedData.report.id).toBe(createdReportId);
    expect(reopenedData.report.status).toBe("open");
  });
});
