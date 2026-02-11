import { useState } from "react";
import { useNavigate } from "react-router-dom";
import TranslationModes from "../components/standalone/modes";
import SupportedLangs from "../components/standalone/supported-langs";

export default function StandalonePage() {
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleJoin = async (data) => {
    setError(null);
    try {
      const headers = {
        "Content-Type": "application/json",
      };

      const response = await fetch("/api/auth/standalone", {
        method: "POST",
        headers,
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
        const errorData = await response.json();
        throw new Error(errorData.detail);
      }

      const responseData = await response.json();
      const { sessionId, token, type, joinUrl } = responseData;

      const isHost = data.mode === "host";

      navigate(
        `/sessions/${type}/${encodeURIComponent(sessionId)}?token=${token}${isHost ? "&isHost=true" : ""}`,
        { state: { joinUrl } },
      );
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
