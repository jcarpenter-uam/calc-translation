import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants/routes.js";
import { apiFetch, getErrorMessage, requestJson } from "../lib/api-client.js";
import { clientLogger } from "../lib/client-logger.js";

export function useCalendar(startDate = null, endDate = null) {
  const [syncError, setSyncError] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const calendarUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (startDate) params.append("start", startDate.toISOString());
    if (endDate) params.append("end", endDate.toISOString());

    const queryString = params.toString();
    return queryString
      ? `${API_ROUTES.calendar.base}?${queryString}`
      : API_ROUTES.calendar.base;
  }, [startDate, endDate]);

  const fetchCalendar = useCallback(
    async (url) => {
      clientLogger.info("Calendar: Fetching events", { url });
      const data = await requestJson(url, {}, "Failed to load calendar.");
      clientLogger.info("Calendar: Event fetch succeeded", {
        count: Array.isArray(data) ? data.length : 0,
      });
      return data;
    },
    [],
  );

  const {
    data,
    error: fetchError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR(calendarUrl, fetchCalendar, { keepPreviousData: true });

  const syncCalendar = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      clientLogger.info("Calendar: Starting sync");
      const response = await apiFetch(API_ROUTES.calendar.sync);

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Failed to sync calendar."));
      }

      await mutate();
    } catch (err) {
      clientLogger.error("Calendar: Sync failed", err);
      setSyncError(err.message);
    } finally {
      setIsSyncing(false);
    }
  }, [mutate]);

  const refetch = useCallback(async () => {
    setSyncError(null);
    await mutate();
  }, [mutate]);

  return {
    events: data ?? [],
    loading: isLoading || isValidating || isSyncing,
    error: syncError || fetchError?.message || null,
    syncCalendar,
    refetch,
  };
}
