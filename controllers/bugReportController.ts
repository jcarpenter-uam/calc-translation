import { and, desc, eq } from "drizzle-orm";
import { db } from "../core/database";
import { logger } from "../core/logger";
import { bugReports } from "../models/bugReportModel";
import { isSuperAdmin } from "../utils/accessPolicy";

type BugReportLogEntry = {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
};

type BugReportRecord = {
  id: string;
  createdAt: Date;
  userId: string | null;
  tenantId: string | null;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
  status: string;
  title: string;
  description: string;
  currentRoute: string | null;
  clientType: string;
  osPlatform: string;
  appVersion: string;
  browserName: string | null;
  browserVersion: string | null;
  userAgent: string | null;
  clientLogFileName: string | null;
  clientLogFileContent: string | null;
  clientLogs: string;
};

/**
 * Parses the stored JSON log payload back into typed bug-report entries.
 */
function parseClientLogs(rawValue: string): BugReportLogEntry[] {
  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter((entry): entry is BugReportLogEntry => {
      return (
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as BugReportLogEntry).timestamp === "string" &&
        typeof (entry as BugReportLogEntry).level === "string" &&
        typeof (entry as BugReportLogEntry).message === "string"
      );
    });
  } catch {
    return [];
  }
}

/**
 * Converts a database bug-report row into the API shape returned to clients.
 */
function serializeBugReport(record: BugReportRecord) {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    userId: record.userId,
    tenantId: record.tenantId,
    userName: record.userName,
    userEmail: record.userEmail,
    userRole: record.userRole,
    status: record.status,
    title: record.title,
    description: record.description,
    currentRoute: record.currentRoute,
    clientType: record.clientType,
    osPlatform: record.osPlatform,
    appVersion: record.appVersion,
    browserName: record.browserName,
    browserVersion: record.browserVersion,
    userAgent: record.userAgent,
    clientLogFileName: record.clientLogFileName,
    clientLogFileContent: record.clientLogFileContent,
    clientLogs: parseClientLogs(record.clientLogs),
  };
}

/**
 * Stores a new client-submitted bug report for the authenticated user.
 */
export const createBugReport = async ({ body, set, tenantId, user }: any) => {
  const userId = user?.id || "unknown_user";

  try {
    const [createdReport] = await db
      .insert(bugReports)
      .values({
        userId: user?.id || null,
        tenantId: tenantId || null,
        userName: user?.name || null,
        userEmail: user?.email || null,
        userRole: user?.role || null,
        status: "open",
        title: body.title.trim(),
        description: body.description.trim(),
        currentRoute: body.currentRoute?.trim() || null,
        clientType: body.clientMetadata.clientType,
        osPlatform: body.clientMetadata.osPlatform,
        appVersion: body.clientMetadata.appVersion.trim(),
        browserName: body.clientMetadata.browserName?.trim() || null,
        browserVersion: body.clientMetadata.browserVersion?.trim() || null,
        userAgent: body.clientMetadata.userAgent?.trim() || null,
        clientLogFileName: body.clientLogFileName.trim(),
        clientLogFileContent: body.clientLogFileContent,
        clientLogs: JSON.stringify(body.clientLogs),
      })
      .returning();

    logger.info("Bug report created.", {
      bugReportId: createdReport?.id,
      userId,
      tenantId,
      clientType: body.clientMetadata.clientType,
      osPlatform: body.clientMetadata.osPlatform,
      logCount: Array.isArray(body.clientLogs) ? body.clientLogs.length : 0,
    });

    return {
      message: "Bug report submitted successfully",
      report: createdReport ? serializeBugReport(createdReport) : null,
    };
  } catch (error) {
    logger.error("Failed to create bug report.", {
      userId,
      tenantId,
      error,
    });
    set.status = 500;
    return { error: "Failed to submit bug report" };
  }
};

/**
 * Lists bug reports for super-admin review.
 */
export const listBugReports = async ({ query, set, user }: any) => {
  const userId = user?.id || "unknown_user";

  if (!isSuperAdmin(user)) {
    set.status = 403;
    return { error: "Forbidden - Super admin access required" };
  }

  try {
    const requestedStatus =
      query?.status === "all"
        ? null
        : query?.status === "resolved"
          ? "resolved"
          : "open";
    const reports = await db
      .select()
      .from(bugReports)
      .where(requestedStatus ? eq(bugReports.status, requestedStatus) : undefined)
      .orderBy(desc(bugReports.createdAt));

    logger.debug("Bug reports retrieved.", {
      userId,
      count: reports.length,
      status: requestedStatus || "all",
    });

    return {
      reports: reports.map(serializeBugReport),
    };
  } catch (error) {
    logger.error("Failed to list bug reports.", {
      userId,
      error,
    });
    set.status = 500;
    return { error: "Failed to load bug reports" };
  }
};

/**
 * Updates the current status of a bug report for super-admin triage.
 */
export const updateBugReportStatus = async ({ body, params, set, user }: any) => {
  const userId = user?.id || "unknown_user";

  if (!isSuperAdmin(user)) {
    set.status = 403;
    return { error: "Forbidden - Super admin access required" };
  }

  try {
    const [updatedReport] = await db
      .update(bugReports)
      .set({ status: body.status })
      .where(and(eq(bugReports.id, params.id)))
      .returning();

    if (!updatedReport) {
      set.status = 404;
      return { error: "Bug report not found" };
    }

    logger.info("Bug report status updated.", {
      bugReportId: updatedReport.id,
      userId,
      status: body.status,
    });

    return {
      message: "Bug report status updated successfully",
      report: serializeBugReport(updatedReport),
    };
  } catch (error) {
    logger.error("Failed to update bug report status.", {
      bugReportId: params?.id,
      userId,
      error,
    });
    set.status = 500;
    return { error: "Failed to update bug report status" };
  }
};
