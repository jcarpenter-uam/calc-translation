import { useCallback } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants/routes.js";
import { requestJson } from "../lib/api-client.js";

export function useLogs(intervalMs = 3000, lines = 200) {
  const logsKey = API_ROUTES.logs.byLines(lines);

  const fetchLogs = useCallback(
    async () =>
      requestJson(API_ROUTES.logs.byLines(lines), {}, "Failed to fetch logs"),
    [lines],
  );

  const { data, error, isLoading, mutate } = useSWR(logsKey, fetchLogs, {
    refreshInterval: intervalMs > 0 ? intervalMs : 0,
    dedupingInterval: 1_000,
  });

  const refetch = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    logs: data?.logs || [],
    loading: isLoading,
    error: error?.message || null,
    refetch,
  };
}
