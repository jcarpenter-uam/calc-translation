import { pgTable, text, pgEnum, timestamp } from "drizzle-orm/pg-core";

/**
 * Supported user roles for RBAC checks.
 */
export const roleEnum = pgEnum("role", ["user", "tenant_admin", "super_admin"]);

/**
 * Users table schema.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  languageCode: text("language_code"),
  role: roleEnum("role").default("user").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
