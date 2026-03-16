import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

type LogLevel = "debug" | "info" | "warn" | "error";

const resolvedLogLevel = Bun.env.LOG_LEVEL as LogLevel;

// Define the custom format for clean terminal output
const consoleFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? JSON.stringify(meta) : "";
    return `[${timestamp}] ${level}: ${message} ${metaString}`;
  }),
);

// Define the standard JSON format for files (easier to parse later)
const fileFormat = winston.format.combine(
  winston.format.errors({ stack: true }),
  winston.format.timestamp(),
  winston.format.json(),
);

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

export const logger = winston.createLogger({
  level: resolvedLogLevel,
  transports,
});
