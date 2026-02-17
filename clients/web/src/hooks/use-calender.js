import { useState, useEffect, useCallback } from "react";
import { API_ROUTES } from "../constants/routes.js";
import { apiFetch, getErrorMessage } from "../lib/api-client.js";

export function useCalendar(startDate = null, endDate = null) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchCalendar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append("start", startDate.toISOString());
      if (endDate) params.append("end", endDate.toISOString());

      const queryString = params.toString();
      const url = queryString
        ? `${API_ROUTES.calendar.base}?${queryString}`
        : API_ROUTES.calendar.base;

      const response = await apiFetch(url);
      if (response.ok) {
        const data = await response.json();
        setEvents(data);
      } else {
        console.warn("Failed to fetch initial calendar data");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to load calendar.");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  const syncCalendar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(API_ROUTES.calendar.sync);

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Failed to sync calendar."));
      }

      await fetchCalendar();
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchCalendar]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  return { events, loading, error, syncCalendar, refetch: fetchCalendar };
}
