import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./userModel";
import { tenants } from "./tenantModel";

/**
 * User-to-tenant membership mapping table.
 */
export const userTenants = pgTable(
  "user_tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      uqUserTenant: unique("uq_user_tenant").on(table.userId, table.tenantId),
    };
  },
);
