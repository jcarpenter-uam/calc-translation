import { useState } from "react";
import TranslationModes from "../components/standalone/modes";
import SupportedLangs from "../components/standalone/supported-langs";
import { API_ROUTES } from "../constants/routes.js";
import { JSON_HEADERS, apiFetch, getErrorMessage } from "../lib/api-client.js";
import { useSessionNavigation } from "../hooks/use-session-navigation.js";

export default function StandalonePage() {
  const [error, setError] = useState(null);
  const navigateToSession = useSessionNavigation();

  const handleJoin = async (data) => {
    setError(null);
    try {
      const response = await apiFetch(API_ROUTES.auth.standalone, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          host: data.mode === "host",
          join_url: data.joinUrl,
          language_hints: data.languageHints,
          translation_type: data.translationType,
          language_a: data.languageA,
          language_b: data.languageB,
        }),
      });

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Join failed"));
      }

      const responseData = await response.json();
      const { sessionId, token, type, joinUrl } = responseData;

      const isHost = data.mode === "host";
      navigateToSession(type, sessionId, token, isHost, joinUrl);
    } catch (err) {
      console.error("Join failed:", err);
      setError(err.message);
    }
  };

  return (
    <>
      <SupportedLangs />
      <TranslationModes onSubmit={handleJoin} />

      {error && (
        <div className="text-red-500 text-center mt-4 font-semibold">
          {error}
        </div>
      )}
    </>
  );
}
