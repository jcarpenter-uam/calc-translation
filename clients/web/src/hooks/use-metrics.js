import { useState, useEffect, useCallback } from "react";

export function useMetrics(intervalMs = 15000) {
  const [serverMetrics, setServerMetrics] = useState(null);
  const [zoomMetrics, setZoomMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const [serverRes, zoomRes] = await Promise.all([
        fetch("/api/metrics/server"),
        fetch("/api/metrics/zoom"),
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

  useEffect(() => {
    fetchMetrics();

    if (intervalMs > 0) {
      const interval = setInterval(fetchMetrics, intervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchMetrics, intervalMs]);

  return {
    serverMetrics,
    zoomMetrics,
    loading,
    error,
    refetch: fetchMetrics,
  };
}
