import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Point this to where Drizzle models are stored
  schema: "./models/*.ts",
  // The folder where the generated .sql migration files will be saved
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
  },
  verbose: true,
  strict: true,
});

// NOTE: bunx drizzle-kit generate
