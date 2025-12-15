import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/auth";
import Header from "../components/header/header";
import UserAvatar from "../components/header/user.jsx";
import {
  IntegrationCard,
  ZoomForm,
  TestForm,
} from "../components/auth/integration-card.jsx";
import Footer from "../components/misc/footer.jsx";

import { BiLogoZoom, BiSolidFlask } from "react-icons/bi";

export default function LandingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [integration, setIntegration] = useState("zoom");
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkPendingZoomLink = async () => {
      const needsLink = sessionStorage.getItem("zoom_link_pending");

      if (needsLink === "true") {
        try {
          console.log("Found pending Zoom link, attempting to link account...");
          alert(t("finishing_zoom_setup"));

          const response = await fetch("/api/auth/zoom/link-pending", {
            method: "POST",
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || "Failed to link Zoom account.");
          }

          console.log("Zoom account linked successfully!");
          alert(t("zoom_linked_success"));
        } catch (error) {
          console.error("Zoom link error:", error);
          alert(t("zoom_link_failed", { error: error.message }));
        } finally {
          sessionStorage.removeItem("zoom_link_pending");
        }
      }
    };

    checkPendingZoomLink();
  }, [t]);

  const handleJoin = (type, sessionId, token) => {
    navigate(`/sessions/${type}/${sessionId}?token=${token}`);
  };

  const handleZoomSubmit = async ({ meetingId, password, joinUrl }) => {
    setError(null);

    if (!joinUrl && !meetingId) {
      setError(t("error_missing_zoom_input"));
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
        throw new Error(errorData.detail || t("error_auth_failed"));
      }

      const data = await response.json();
      const sessionId = data.meetinguuid;
      const token = data.token;

      if (!sessionId) {
        throw new Error(t("error_no_session_id"));
      }

      if (!token) {
        throw new Error(t("error_no_token"));
      }

      handleJoin("zoom", sessionId, token);
    } catch (err) {
      console.error("Authentication failed:", err);
      setError(err.message);
    }
  };

  const handleTestSubmit = async ({ sessionId }) => {
    setError(null);

    if (!sessionId) {
      setError(t("error_missing_session_id"));
      return;
    }

    try {
      const response = await fetch("/api/auth/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: sessionId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || t("error_test_auth_failed"));
      }

      const data = await response.json();
      const returnedSessionId = data.meetinguuid;
      const token = data.token;

      if (!returnedSessionId) {
        throw new Error(t("error_no_session_id"));
      }

      if (!token) {
        throw new Error(t("error_no_token"));
      }

      handleJoin("test", returnedSessionId, token);
    } catch (err) {
      console.error("Test authentication failed:", err);
      setError(err.message);
    }
  };

  const renderForm = () => {
    if (integration === "zoom") {
      return <ZoomForm onSubmit={handleZoomSubmit} />;
    }
    if (integration === "test") {
      return <TestForm onSubmit={handleTestSubmit} />;
    }
    return null;
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header>
        <UserAvatar />
      </Header>

      <main className="flex-grow flex items-center justify-center container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="text-xl font-semibold mb-4 text-center">
              {t("choose_integration")}
            </h2>
            <div className="flex flex-wrap justify-center gap-4">
              <IntegrationCard
                id="zoom"
                title={t("integration_zoom")}
                icon={<BiLogoZoom className="h-7 w-7 text-blue-500" />}
                selected={integration}
                onSelect={setIntegration}
              />
              {user?.is_admin && (
                <IntegrationCard
                  id="test"
                  title={t("integration_test")}
                  icon={<BiSolidFlask className="h-7 w-7 text-green-500" />}
                  selected={integration}
                  onSelect={setIntegration}
                />
              )}
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

      <Footer />
    </div>
  );
}
