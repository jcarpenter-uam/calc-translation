import { useCallback } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants/routes.js";
import { apiFetch } from "../lib/api-client.js";

export function useMetrics(intervalMs = 15000) {
  const fetchMetrics = useCallback(async () => {
    const [serverRes, zoomRes] = await Promise.all([
      apiFetch(API_ROUTES.metrics.server),
      apiFetch(API_ROUTES.metrics.zoom),
    ]);

    const metricsData = {
      serverMetrics: null,
      zoomMetrics: null,
    };

    if (serverRes.ok) {
      metricsData.serverMetrics = await serverRes.text();
    } else {
      console.error("Failed to fetch server metrics");
    }

    if (zoomRes.ok) {
      metricsData.zoomMetrics = await zoomRes.text();
    } else {
      console.error("Failed to fetch zoom metrics");
    }

    return metricsData;
  }, []);

  const { data, error, isLoading, mutate } = useSWR("metrics", fetchMetrics, {
    refreshInterval: intervalMs > 0 ? intervalMs : 0,
    dedupingInterval: 5_000,
  });

  const refetch = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    serverMetrics: data?.serverMetrics ?? null,
    zoomMetrics: data?.zoomMetrics ?? null,
    loading: isLoading,
    error: error?.message || null,
    refetch,
  };
}
