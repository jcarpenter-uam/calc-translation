import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { env } from "./config";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Shared Drizzle database client.
 */
export const db = drizzle(env.DATABASE_URL);

/**
 * Verifies the database connection before server startup.
 */
export async function testDbConnection() {
  try {
    await db.execute(sql`SELECT 1`);
    logger.info("Database connection verified.");
  } catch (error) {
    logger.error("Database connection failed.", { error });
    process.exit(1);
  }
}

/**
 * Applies pending Drizzle migrations before server startup.
 */
export async function runMigrations() {
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    logger.info("Database migrations applied successfully.");
  } catch (error) {
    logger.error("Database migration failed.", { error });
    process.exit(1);
  }
}
