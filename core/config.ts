import { z } from "zod";
import { logger } from "./logger";

const envSchema = z.object({
  PORT: z.coerce.number().default(8000),

  NODE_ENV: z.enum(["development", "production"]).default("development"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  BASE_URL: z
    .string()
    .url({ message: "BASE_URL must be a valid URL" })
    .default("http://localhost:8000"),

  DATABASE_URL: z.string().url({ message: "DATABASE_URL must be a valid URL" }),

  ENCRYPTION_KEY: z.string().length(44, {
    message:
      "ENCRYPTION_KEY must be exactly 44 characters (a valid Fernet key)",
  }),

  JWT_SECRET: z.string().min(1, "JWT_SECRET must be defined in your .env file"),

  SONIOX_API_KEY: z.string({ message: "SONIOX_API_KEY must be a string" }),
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
