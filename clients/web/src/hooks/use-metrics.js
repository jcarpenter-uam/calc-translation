import { useCallback } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants/routes.js";
import { apiFetch } from "../lib/api-client.js";

export function useMetrics(intervalMs = 15000) {
  const fetchMetrics = useCallback(async () => {
    const res = await apiFetch(API_ROUTES.metrics.all);
    if (!res.ok) {
      console.error("Failed to fetch metrics");
      return { metrics: null };
    }
    return { metrics: await res.text() };
  }, []);

  const { data, error, isLoading, mutate } = useSWR("metrics", fetchMetrics, {
    refreshInterval: intervalMs > 0 ? intervalMs : 0,
    dedupingInterval: 5_000,
  });

  const refetch = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    serverMetrics: data?.metrics ?? null,
    zoomMetrics: null,
    loading: isLoading,
    error: error?.message || null,
    refetch,
  };
}
