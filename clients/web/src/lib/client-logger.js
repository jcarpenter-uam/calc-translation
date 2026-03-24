const MAX_LOG_ENTRIES = 400;
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

const state = {
  entries: [],
  installed: false,
};

function normalizeArgs(args) {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`;
      }
      if (typeof arg === "string") {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function pushEntry(level, args) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: normalizeArgs(args),
  };
  state.entries.push(entry);
  if (state.entries.length > MAX_LOG_ENTRIES) {
    state.entries.splice(0, state.entries.length - MAX_LOG_ENTRIES);
  }
}

function write(level, ...args) {
  pushEntry(level, args);
  const writer = originalConsole[level] || originalConsole.log;
  writer(...args);
}

export const clientLogger = {
  log: (...args) => write("log", ...args),
  info: (...args) => write("info", ...args),
  warn: (...args) => write("warn", ...args),
  error: (...args) => write("error", ...args),
  getEntries: () => [...state.entries],
  serialize: () =>
    state.entries
      .map((entry) => `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}`)
      .join("\n"),
};

export function installClientLogging() {
  if (state.installed || typeof window === "undefined") {
    return;
  }

  state.installed = true;

  console.log = (...args) => write("log", ...args);
  console.info = (...args) => write("info", ...args);
  console.warn = (...args) => write("warn", ...args);
  console.error = (...args) => write("error", ...args);

  window.addEventListener("error", (event) => {
    pushEntry("error", [
      `Unhandled error: ${event.message}`,
      event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : "",
    ]);
  });

  window.addEventListener("unhandledrejection", (event) => {
    pushEntry("error", ["Unhandled promise rejection:", event.reason]);
  });

  pushEntry("info", ["Client logging initialized"]);
}

export function getClientEnvironment() {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const ua = nav?.userAgent || "unknown";
  const mobile =
    nav?.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const browserMatch =
    ua.match(/Edg\/([\d.]+)/) ||
    ua.match(/Chrome\/([\d.]+)/) ||
    ua.match(/Firefox\/([\d.]+)/) ||
    ua.match(/Version\/([\d.]+).*Safari/);
  const browser = browserMatch
    ? ua.includes("Edg/")
      ? `Edge ${browserMatch[1]}`
      : ua.includes("Chrome/")
        ? `Chrome ${browserMatch[1]}`
        : ua.includes("Firefox/")
          ? `Firefox ${browserMatch[1]}`
          : `Safari ${browserMatch[1]}`
    : "Unknown browser";

  let os = nav?.userAgentData?.platform || nav?.platform || "Unknown OS";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  return {
    browser,
    os,
    deviceType: mobile ? "mobile" : "desktop",
    userAgent: ua,
    language: nav?.language || "unknown",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
    viewport:
      typeof window !== "undefined"
        ? `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`
        : "unknown",
    path:
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "unknown",
  };
}

export function buildClientDiagnosticsLog() {
  const env = getClientEnvironment();
  const header = [
    "Web Bug Report Diagnostics",
    `Browser: ${env.browser}`,
    `OS: ${env.os}`,
    `Device: ${env.deviceType}`,
    `Language: ${env.language}`,
    `Timezone: ${env.timezone}`,
    `Viewport: ${env.viewport}`,
    `Path: ${env.path}`,
    `User Agent: ${env.userAgent}`,
    "",
    "Recent Client Logs",
    "------------------",
  ].join("\n");

  return `${header}\n${clientLogger.serialize()}`.trim();
}
