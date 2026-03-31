import { pgTable, text, timestamp, uuid, unique, varchar } from "drizzle-orm/pg-core";
import { tenants } from "./tenantModel";
import { users } from "./userModel";

/**
 * Persisted per-user OAuth grants reusable across provider-backed features.
 */
export const userOAuthGrants = pgTable(
  "user_oauth_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 20 }).notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    scopes: text("scopes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uqUserTenantProvider: unique("uq_user_oauth_grants_user_tenant_provider").on(
      table.userId,
      table.tenantId,
      table.provider,
    ),
  }),
);
