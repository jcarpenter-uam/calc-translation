import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./userModel";
import { tenants } from "./tenantModel";

export const bugReportStatusEnum = ["open", "resolved"] as const;

/**
 * Persisted bug reports submitted from the client applications.
 */
export const bugReports = pgTable("bug_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  tenantId: text("tenant_id").references(() => tenants.tenantId, {
    onDelete: "set null",
  }),
  userName: text("user_name"),
  userEmail: text("user_email"),
  userRole: text("user_role"),
  status: text("status").default("open").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  currentRoute: text("current_route"),
  clientType: text("client_type").notNull(),
  osPlatform: text("os_platform").notNull(),
  appVersion: text("app_version").notNull(),
  browserName: text("browser_name"),
  browserVersion: text("browser_version"),
  userAgent: text("user_agent"),
  clientLogFileName: text("client_log_file_name"),
  clientLogFileContent: text("client_log_file_content"),
  clientLogs: text("client_logs").notNull(),
});
