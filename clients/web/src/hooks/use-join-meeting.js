import { useCallback } from "react";
import { API_ROUTES } from "../constants/routes.js";
import { JSON_HEADERS, apiFetch, getErrorMessage } from "../lib/api-client.js";
import { useSessionNavigation } from "./use-session-navigation.js";

export function useJoinMeeting({ integration, fallbackErrorMessage, onError }) {
  const navigateToSession = useSessionNavigation();

  return useCallback(async (data, source = "manual") => {
    onError(null);

    try {
      let response;

      if (source === "calendar") {
        response = await apiFetch(API_ROUTES.auth.calendarJoin, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            meetingId: data.id,
            joinUrl: data.join_url,
            startTime: data.start_time,
          }),
        });
      } else if (integration === "zoom") {
        response = await apiFetch(API_ROUTES.auth.zoom, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            meetingid: data.meetingId,
            meetingpass: data.password,
            join_url: data.joinUrl,
          }),
        });
      } else if (integration === "standalone") {
        response = await apiFetch(API_ROUTES.auth.standalone, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            host: data.mode === "host",
            join_url: data.joinUrl,
          }),
        });
      }

      if (!response?.ok) {
        throw new Error(
          response
            ? await getErrorMessage(response, fallbackErrorMessage)
            : fallbackErrorMessage,
        );
      }

      const responseData = await response.json();
      const { sessionId, token, type, joinUrl } = responseData;

      const isHost = integration === "standalone" && data.mode === "host";
      navigateToSession(type, sessionId, token, isHost, joinUrl);
    } catch (err) {
      console.error("Join failed:", err);
      onError(err.message || fallbackErrorMessage);
    }
  }, [integration, fallbackErrorMessage, onError, navigateToSession]);
}
