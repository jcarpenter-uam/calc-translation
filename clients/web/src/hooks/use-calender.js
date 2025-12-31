import { useState, useEffect, useCallback } from "react";

export function useCalendar() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchCalendar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/calender/");
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
  }, []);

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

  return { events, loading, error, syncCalendar };
}
