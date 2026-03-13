import { pgTable, text, pgEnum } from "drizzle-orm/pg-core";

// Define the available roles
export const roleEnum = pgEnum("role", ["user", "tenant_admin", "super_admin"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email"),
  languageCode: text("language_code"),
  role: roleEnum("role").default("user").notNull(),
});
