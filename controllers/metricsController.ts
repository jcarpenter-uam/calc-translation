import client from "prom-client";

const collectDefaultMetrics = client.collectDefaultMetrics;
// Default process/runtime metrics are exported once when this module is loaded.
collectDefaultMetrics({ prefix: "calc_translation_" });

/**
 * Gauge for active authenticated WebSocket connections.
 */
export const activeWebsocketsGauge = new client.Gauge({
  name: "calc_translation_active_websockets",
  help: "Number of currently active WebSocket connections",
});

/**
 * Gauge for active in-memory meeting sessions.
 */
export const activeMeetingsGauge = new client.Gauge({
  name: "calc_translation_active_meetings",
  help: "Number of currently active meetings in memory",
});

/**
 * Returns metrics in Prometheus text format.
 */
export const systemMetrics = async ({ set }: any) => {
  set.headers["Content-Type"] = client.register.contentType;
  return await client.register.metrics();
};
