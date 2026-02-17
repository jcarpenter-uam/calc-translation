import { useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";

export function useSessionRoute() {
  const params = useParams();
  const location = useLocation();

  return useMemo(() => {
    const integration = params.integration;
    const sessionId = params["*"];
    const query = new URLSearchParams(location.search);

    return {
      integration,
      sessionId,
      token: query.get("token"),
      isHost: query.get("isHost") === "true",
      joinUrl: location.state?.joinUrl,
    };
  }, [location.search, location.state, params]);
}
