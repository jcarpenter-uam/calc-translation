import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

// Define the custom format for clean terminal output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? JSON.stringify(meta) : "";
    return `[${timestamp}] ${level}: ${message} ${metaString}`;
  }),
);

// Define the standard JSON format for files (easier to parse later)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
);

export const logger = winston.createLogger({
  // Only log 'info' and above in prod, but 'debug' and above in dev
  level: Bun.env.NODE_ENV === "production" ? "info" : "debug",
  transports: [
    // Clean console logs
    new winston.transports.Console({
      format: consoleFormat,
    }),

    // File retention policy: Error logs only
    new DailyRotateFile({
      filename: "logs/error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "error", // Only write errors to this file
      format: fileFormat,
      zippedArchive: true, // Compress old logs to save space
      maxSize: "20m", // Rotate if the file hits 20MB
      maxFiles: "14d", // Retention policy: Delete logs older than 14 days
    }),

    // File retention policy: All logs
    new DailyRotateFile({
      filename: "logs/combined-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      format: fileFormat,
      zippedArchive: true, // Compress old logs to save space
      maxSize: "20m", // Rotate if the file hits 20MB
      maxFiles: "30d", // Keep combined logs for 30 days
    }),
  ],
});
