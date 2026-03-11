import { z } from "zod";
import { logger } from "./logger";

const envSchema = z.object({
  // Automatically converts string "3000" to number 3000
  PORT: z.string().transform(Number).default("8000"),

  DATABASE_URL: z.string().url({ message: "DATABASE_URL must be a valid URL" }),

  SONIOX_API_KEY: z.string({ message: "SONIOX_API_KEY must be a string" }),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

// Validate Bun.env against the schema
const _env = envSchema.safeParse(Bun.env);

if (!_env.success) {
  // Map over the Zod errors and format them neatly
  const errorMessages = _env.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  // Pass it to the logger as a single, nicely formatted string
  logger.error(`Invalid environment variables:\n${errorMessages}`);

  process.exit(1);
}

// Export the validated data
export const env = _env.data;
