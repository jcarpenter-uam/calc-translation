import { useState, useEffect, useCallback } from "react";

export function useLogs(intervalMs = 3000, lines = 200) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchLogs = useCallback(async () => {
    try {
      const response = await fetch(`/api/logs/?lines=${lines}`);
      if (!response.ok) throw new Error("Failed to fetch logs");

      const data = await response.json();
      setLogs(data.logs || []);
      setError(null);
    } catch (err) {
      console.error("Log fetch failed", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [lines]);

  useEffect(() => {
    fetchLogs();

    if (intervalMs > 0) {
      const interval = setInterval(fetchLogs, intervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchLogs, intervalMs]);

  return {
    logs,
    loading,
    error,
    refetch: fetchLogs,
  };
}
