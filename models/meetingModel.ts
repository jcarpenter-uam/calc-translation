import {
  pgTable,
  text,
  timestamp,
  varchar,
  jsonb,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./userModel";

export const meetings = pgTable("meetings", {
  id: uuid("id").defaultRandom().primaryKey(),
  readable_id: varchar("readable_id", { length: 255 }).unique(),
  passcode: varchar("passcode", { length: 50 }),
  join_url: text("join_url"),
  languages: jsonb("languages").$type<string[]>(),
  integration: varchar("integration", { length: 50 }),
  scheduled_time: timestamp("scheduled_time", { withTimezone: true }),
  started_at: timestamp("started_at", { withTimezone: true }),
  ended_at: timestamp("ended_at", { withTimezone: true }),
  host_id: text("host_id").references(() => users.id),
  attendees: jsonb("attendees").$type<string[]>(),
  topic: text("topic"),
});
