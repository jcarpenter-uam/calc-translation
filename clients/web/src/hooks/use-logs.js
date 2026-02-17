import { useCallback, useState } from "react";
import { API_ROUTES } from "../constants/routes.js";
import { requestJson } from "../lib/api-client.js";
import { usePolling } from "./use-polling.js";

export function useLogs(intervalMs = 3000, lines = 200) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await requestJson(
        API_ROUTES.logs.byLines(lines),
        {},
        "Failed to fetch logs",
      );
      setLogs(data.logs || []);
      setError(null);
    } catch (err) {
      console.error("Log fetch failed", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [lines]);

  usePolling(fetchLogs, intervalMs);

  return {
    logs,
    loading,
    error,
    refetch: fetchLogs,
  };
}
