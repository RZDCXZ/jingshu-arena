import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const schemaMetadata = pgTable("jingshu_schema_metadata", {
  key: text("key").primaryKey(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  value: text("value").notNull(),
});
