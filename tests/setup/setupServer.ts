/**
 * Global Bun test preload that boots the app once per test process.
 */
const testPort = process.env.PORT ?? "18000";

process.env.PORT = testPort;
process.env.BASE_URL = process.env.BASE_URL ?? `http://localhost:${testPort}`;
process.env.NODE_ENV = "development";

const { startServer, stopServer } = await import("../../index");

await startServer(Number.parseInt(testPort, 10));

/**
 * Gracefully stops the shared test server.
 */
const shutdown = async () => {
  await stopServer();
};

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});
