import { useEffect } from "react";

export function usePolling(callback, intervalMs = 0) {
  useEffect(() => {
    callback();

    if (intervalMs > 0) {
      const intervalId = setInterval(callback, intervalMs);
      return () => clearInterval(intervalId);
    }
  }, [callback, intervalMs]);
}
