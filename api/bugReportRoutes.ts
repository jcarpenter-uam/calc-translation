import { Elysia, t } from "elysia";
import {
  createBugReport,
  listBugReports,
  updateBugReportStatus,
} from "../controllers/bugReportController";

/**
 * Authenticated bug reporting routes.
 */
export const bugReportRoutes = new Elysia({ prefix: "/bug-reports" })
  .post("/", createBugReport, {
    body: t.Object({
      title: t.String({ minLength: 1, maxLength: 200 }),
      description: t.String({ minLength: 1, maxLength: 5000 }),
      currentRoute: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
      clientLogFileName: t.String({ minLength: 1, maxLength: 255 }),
      clientLogFileContent: t.String({ minLength: 1, maxLength: 200000 }),
      clientMetadata: t.Object({
        clientType: t.Union([t.Literal("web"), t.Literal("desktop")]),
        osPlatform: t.Union([
          t.Literal("windows"),
          t.Literal("linux"),
          t.Literal("macos"),
          t.Literal("unknown"),
        ]),
        appVersion: t.String({ minLength: 1, maxLength: 50 }),
        browserName: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
        browserVersion: t.Optional(t.Nullable(t.String({ maxLength: 50 }))),
        userAgent: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
      clientLogs: t.Array(
        t.Object({
          timestamp: t.String({ minLength: 1, maxLength: 64 }),
          level: t.Union([
            t.Literal("debug"),
            t.Literal("info"),
            t.Literal("warn"),
            t.Literal("error"),
          ]),
          message: t.String({ minLength: 1, maxLength: 2000 }),
        }),
        { maxItems: 200 },
      ),
    }),
  })
  .get("/", listBugReports, {
    query: t.Object({
      status: t.Optional(
        t.Union([
          t.Literal("all"),
          t.Literal("open"),
          t.Literal("resolved"),
        ]),
      ),
    }),
  })
  .patch("/:id/status", updateBugReportStatus, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      status: t.Union([t.Literal("open"), t.Literal("resolved")]),
    }),
  });
