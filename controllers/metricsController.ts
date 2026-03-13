import client from "prom-client";

// This automatically gathers memory, CPU, and Bun runtime stats
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ prefix: "calc_translation_" });

// TODO: Create custom metrics relevant to your application
export const activeWebsocketsGauge = new client.Gauge({
  name: "calc_translation_active_websockets",
  help: "Number of currently active WebSocket connections",
});

export const activeMeetingsGauge = new client.Gauge({
  name: "calc_translation_active_meetings",
  help: "Number of currently active meetings in memory",
});

/**
 * Handler for the Prometheus scraping endpoint
 */
export const systemMetrics = async ({ set }: any) => {
  // Prometheus requires this specific content-type header
  set.headers["Content-Type"] = client.register.contentType;

  // Return the formatted metrics string
  return await client.register.metrics();
};
