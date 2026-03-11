import { z } from "zod";

const envSchema = z.object({
  // Automatically converts string "3000" to number 3000
  PORT: z.string().transform(Number).default("8000"),

  DATABASE_URL: z.string().url({ message: "DATABASE_URL must be a valid URL" }),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

// Validate Bun.env against the schema
const _env = envSchema.safeParse(Bun.env);

if (!_env.success) {
  console.error("Invalid environment variables:", _env.error.format());
  process.exit(1);
}

// Export the validated data
export const env = _env.data;
