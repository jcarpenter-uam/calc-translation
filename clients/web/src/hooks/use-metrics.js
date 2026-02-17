import { useCallback, useState } from "react";
import { API_ROUTES } from "../constants/routes.js";
import { apiFetch } from "../lib/api-client.js";
import { usePolling } from "./use-polling.js";

export function useMetrics(intervalMs = 15000) {
  const [serverMetrics, setServerMetrics] = useState(null);
  const [zoomMetrics, setZoomMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const [serverRes, zoomRes] = await Promise.all([
        apiFetch(API_ROUTES.metrics.server),
        apiFetch(API_ROUTES.metrics.zoom),
      ]);

      if (serverRes.ok) {
        const text = await serverRes.text();
        setServerMetrics(text);
      } else {
        console.error("Failed to fetch server metrics");
      }

      if (zoomRes.ok) {
        const text = await zoomRes.text();
        setZoomMetrics(text);
      } else {
        console.error("Failed to fetch zoom metrics");
      }

      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(fetchMetrics, intervalMs);

  return {
    serverMetrics,
    zoomMetrics,
    loading,
    error,
    refetch: fetchMetrics,
  };
}
