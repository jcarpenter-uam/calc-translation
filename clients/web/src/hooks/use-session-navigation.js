import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { buildSessionPath } from "../constants/routes.js";

export function useSessionNavigation() {
  const navigate = useNavigate();

  return useCallback((type, sessionId, token, isHost, joinUrl) => {
    navigate(buildSessionPath(type, sessionId, token, isHost), {
      state: { joinUrl },
    });
  }, [navigate]);
}
