import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCalendar } from "../hooks/use-calender.js";
import { ZoomForm } from "../components/auth/integration-card.jsx";
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

      const { sessionId, token, type } = data;

      if (!sessionId) {
        throw new Error(t("error_no_session_id"));
      }

      if (!token) {
        throw new Error(t("error_no_token"));
      }

      handleJoin(type, sessionId, token);
    } catch (err) {
      console.error("Authentication failed:", err);
      setError(err.message);
    }
  };

  const handleCalendarJoin = async (event) => {
    try {
      const response = await fetch("/api/auth/calendar-join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meetingId: event.id,
          joinUrl: event.join_url,
          startTime: event.start_time,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to initialize session");
      }

      const data = await response.json();

      const { sessionId, token, type } = data;

      navigate(
        `/sessions/${type}/${encodeURIComponent(sessionId)}?token=${token}`,
      );
    } catch (err) {
      console.error("Failed to quick-join:", err);
      setError("Failed to start assistant. Please try again.");
    }
  };

  const renderForm = () => {
    if (integration === "zoom") {
      return <ZoomForm onSubmit={handleZoomSubmit} />;
    }
    return null;
  };

  return (
    <div className="flex flex-col lg:flex-row items-start justify-center w-full gap-8">
      {/* Left Column: Integration Tabs & Form */}
      <div className="w-full lg:w-[400px] flex-shrink-0 lg:sticky lg:top-6">
        <h2 className="text-xl font-semibold mb-4 text-center lg:text-left">
          {t("manual_join")}
        </h2>
        <div className="bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm overflow-hidden">
          {/* Integration Tabs */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-700">
            <button
              onClick={() => setIntegration("zoom")}
              className={`cursor-pointer flex-1 flex items-center justify-center gap-2 py-4 text-lg font-bold transition-colors ${
                integration === "zoom"
                  ? "bg-white dark:bg-zinc-800 text-blue-600 border-b-2 border-blue-600"
                  : "bg-zinc-50 dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <BiLogoZoom className="h-5 w-5" />
              {t("integration_zoom")}
            </button>
          </div>

          {/* Form Content */}
          <div className="p-6">
            {renderForm()}
            {error && (
              <p className="mt-4 text-center text-sm font-medium text-red-600">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Vertical Divider */}
      <div className="hidden lg:flex flex-col items-center self-stretch mt-11 relative">
        <div className="z-10 flex items-center justify-center w-8 h-8 mb-2">
          <span className="text-md font-bold text-zinc-400 dark:text-zinc-500">
            {t("or_divider")}
          </span>
        </div>

        <div className="w-px flex-1 bg-zinc-200 dark:bg-zinc-700"></div>
      </div>

      {/* Right Column: Calendar */}
      <div className="flex-1 w-full min-w-0">
        <h2 className="text-xl font-semibold mb-4 text-center lg:text-left">
          {t("calendar_join")}
        </h2>
        <CalendarView
          events={events}
          loading={calendarLoading}
          error={calendarError}
          onSync={syncCalendar}
          startDate={dateRange.start}
          endDate={dateRange.end}
          onDateChange={setDateRange}
          onAppJoin={handleCalendarJoin}
        />
      </div>
    </div>
  );
}
