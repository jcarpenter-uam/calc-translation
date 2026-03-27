import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

/**
 * Supported application log levels.
 */
type LogLevel = "debug" | "info" | "warn" | "error";

const resolvedLogLevel = Bun.env.LOG_LEVEL as LogLevel;

/**
 * Human-readable console formatter used during local development and interactive debugging.
 */
const consoleFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? JSON.stringify(meta) : "";
    return `[${timestamp}] ${level}: ${message} ${metaString}`;
  }),
);

/**
 * Structured JSON formatter used by rotating log files.
 */
const fileFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp(),
  winston.format.json(),
);

/**
 * Combined console and rotating-file transports shared by the application logger.
 */
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: consoleFormat,
  }),
  new DailyRotateFile({
    filename: "logs/error-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    level: "error",
    format: fileFormat,
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "14d",
  }),
  new DailyRotateFile({
    filename: "logs/combined-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    format: fileFormat,
    zippedArchive: true,
    maxSize: "20m",
    maxFiles: "30d",
  }),
];

/**
 * Shared Winston logger with console and rotating file transports.
 */
export const logger = winston.createLogger({
  level: resolvedLogLevel,
  transports,
});
