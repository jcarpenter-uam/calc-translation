import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCalendar } from "../hooks/use-calender.js";
import {
  IntegrationCard,
  ZoomForm,
} from "../components/auth/integration-card.jsx";
import { CalendarView } from "../components/calender/view.jsx";

import { BiLogoZoom } from "react-icons/bi";

const getCurrentWorkWeek = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);

  const start = new Date(now);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 4);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

export default function LandingPage() {
  const { t } = useTranslation();
  const [integration, setIntegration] = useState("zoom");
  const [error, setError] = useState(null);
  const [dateRange, setDateRange] = useState(getCurrentWorkWeek());
  const navigate = useNavigate();
  const {
    events,
    loading: calendarLoading,
    error: calendarError,
    syncCalendar,
  } = useCalendar(dateRange.start, dateRange.end);

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
    navigate(
      `/sessions/${type}/${encodeURIComponent(sessionId)}?token=${token}`,
    );
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

  const renderForm = () => {
    if (integration === "zoom") {
      return <ZoomForm onSubmit={handleZoomSubmit} />;
    }
    return null;
  };

  return (
    <div className="flex flex-col lg:flex-row items-start justify-center w-full min-h-[calc(100vh-4rem)] gap-8 p-6">
      <div className="w-full lg:w-[400px] flex-shrink-0 space-y-8 lg:sticky lg:top-6">
        <div>
          <h2 className="text-xl font-semibold mb-4 text-center lg:text-left">
            {t("choose_integration")}
          </h2>
          <div className="flex flex-col gap-4">
            <IntegrationCard
              id="zoom"
              title={t("integration_zoom")}
              icon={<BiLogoZoom className="h-7 w-7 text-blue-500" />}
              selected={integration}
              onSelect={setIntegration}
            />
          </div>
        </div>

        <div className="transition-all bg-white dark:bg-zinc-900/50 p-6 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm">
          {renderForm()}
          {error && (
            <p className="mt-4 text-center text-sm font-medium text-red-600">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 w-full min-w-0">
        <CalendarView
          events={events}
          loading={calendarLoading}
          error={calendarError}
          onSync={syncCalendar}
          startDate={dateRange.start}
          endDate={dateRange.end}
          onDateChange={setDateRange}
        />
      </div>
    </div>
  );
}
