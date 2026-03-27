import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../core/logger";
import { isSuperAdmin } from "../utils/accessPolicy";

type ServerLogPayload = {
  fileName: string | null;
  content: string;
};

/**
 * Returns the most recent lines from a log file payload.
 */
function tailLines(content: string, limit: number) {
  const lines = content.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - limit)).join("\n");
}

/**
 * Loads the newest matching rotated log file and trims it to the requested line count.
 */
async function readLatestLog(prefix: string, lines: number): Promise<ServerLogPayload> {
  const logsDir = path.resolve(process.cwd(), "logs");
  const entries = await readdir(logsDir, { withFileTypes: true });
  const matchingFiles = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && !entry.name.endsWith(".gz"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const fileName = matchingFiles[0] || null;
  if (!fileName) {
    return {
      fileName: null,
      content: "No server log file found.",
    };
  }

  const filePath = path.join(logsDir, fileName);
  const content = await readFile(filePath, "utf8");

  return {
    fileName,
    content: tailLines(content, lines),
  };
}

/**
 * Returns recent server logs for super-admin troubleshooting.
 */
export const getServerLogs = async ({ query, set, user }: any) => {
  const userId = user?.id || "unknown_user";

  if (!isSuperAdmin(user)) {
    set.status = 403;
    return { error: "Forbidden - Super admin access required" };
  }

  const requestedLines = Number(query?.lines);
  const lines = Number.isFinite(requestedLines)
    ? Math.min(Math.max(Math.trunc(requestedLines), 50), 1000)
    : 300;

  try {
    const [combined, error] = await Promise.all([
      readLatestLog("combined-", lines),
      readLatestLog("error-", lines),
    ]);

    logger.debug("Server logs retrieved.", {
      userId,
      lines,
      combinedFile: combined.fileName,
      errorFile: error.fileName,
    });

    return {
      lines,
      combined,
      error,
    };
  } catch (errorValue) {
    logger.error("Failed to load server logs.", {
      userId,
      error: errorValue,
    });
    set.status = 500;
    return { error: "Failed to load server logs" };
  }
};
