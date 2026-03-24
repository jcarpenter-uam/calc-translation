import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { clientLogger } from "../../lib/client-logger.js";

export default function RouteLogger() {
  const location = useLocation();

  useEffect(() => {
    clientLogger.info("Route change", {
      path: `${location.pathname}${location.search}`,
    });
  }, [location.pathname, location.search]);

  return null;
}
