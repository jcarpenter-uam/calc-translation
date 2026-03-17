import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./userModel";
import { tenants } from "./tenantModel";

/**
 * Calendar event records that map external provider meetings to supported links.
 */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.tenantId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 20 }).notNull(),
    providerEventId: text("provider_event_id").notNull(),
    icalUid: text("ical_uid"),
    title: text("title"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: varchar("status", { length: 30 }),
    platform: varchar("platform", { length: 30 }).notNull(),
    joinUrl: text("join_url").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uqUserProviderEvent: unique("uq_calendar_events_user_provider_event").on(
      table.userId,
      table.provider,
      table.providerEventId,
    ),
  }),
);
