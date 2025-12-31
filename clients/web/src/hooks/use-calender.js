import { useState, useEffect, useCallback } from "react";

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
        ? `/api/calender/?${queryString}`
        : "/api/calender/";

      const response = await fetch(url);
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
      const response = await fetch("/api/calender/sync");
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Failed to sync calendar.");
      }
      const data = await response.json();
      setEvents(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  return { events, loading, error, syncCalendar, refetch: fetchCalendar };
}
