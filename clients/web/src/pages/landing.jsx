import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/header";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import { IntegrationCard, ZoomForm } from "../components/integration-card.jsx";

import { BiLogoZoom } from "react-icons/bi";

export default function LandingPage() {
  const [integration, setIntegration] = useState(null);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleJoin = (type, sessionId, token) => {
    let safeSessionId = sessionId;

    if (type === "zoom") {
      safeSessionId = sessionId.replace(/\//g, "_"); // Replaces any "/" with "_"
    }

    navigate(`/sessions/${type}/${safeSessionId}?token=${token}`);
  };

  const handleZoomSubmit = async ({ meetingId, password, joinUrl }) => {
    setError(null);

    if (!joinUrl && !meetingId) {
      setError("Please provide either a Join URL or a Meeting ID.");
      return;
    }

    try {
      const response = await fetch("/api/auth/zoom", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingid: meetingId || null,
          meetingpass: password || null,
          join_url: joinUrl || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.detail ||
            "Authentication failed. Please check your inputs.",
        );
      }

      const data = await response.json();
      console.log("Server response:", data);
      const sessionId = data.meetinguuid;
      const token = data.token;

      if (!sessionId) {
        throw new Error("Server did not return a session ID.");
      }

      if (!token) {
        throw new Error("Server did not return an auth token.");
      }

      handleJoin("zoom", sessionId, token);
    } catch (err) {
      console.error("Authentication failed:", err);
      setError(err.message);
    }
  };

  const renderForm = () => {
    if (integration === "zoom") {
      return <ZoomForm onSubmit={handleZoomSubmit} />;
    }
    return null;
  };

  return (
    <>
      <Header>
        <ThemeToggle />
        <LanguageToggle />
      </Header>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-md mx-auto space-y-8">
          <div>
            <h2 className="text-xl font-semibold mb-4 text-center">
              Choose your integration
            </h2>
            <div className="flex flex-wrap justify-center gap-4">
              <IntegrationCard
                id="zoom"
                title="Zoom"
                icon={<BiLogoZoom className="h-7 w-7 text-blue-500" />}
                selected={integration}
                onSelect={setIntegration}
              />
            </div>
          </div>

          <div className="transition-all">
            {renderForm()}
            {error && (
              <p className="mt-4 text-center text-sm font-medium text-red-600">
                {error}
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
