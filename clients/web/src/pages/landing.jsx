import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useCalendar } from "../hooks/use-calender.js";
import {
  ZoomForm,
  StandaloneForm,
} from "../components/auth/integration-card.jsx";
import { CalendarView } from "../components/calender/view.jsx";

import { BiLogoZoom, BiUser } from "react-icons/bi";
import { API_ROUTES } from "../constants/routes.js";
import { apiFetch, getErrorMessage } from "../lib/api-client.js";
import { useJoinMeeting } from "../hooks/use-join-meeting.js";

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
  const {
    events,
    loading: calendarLoading,
    error: calendarError,
    syncCalendar,
  } = useCalendar(dateRange.start, dateRange.end);

  const handleJoin = useJoinMeeting({
    integration,
    fallbackErrorMessage: t("login_error_generic"),
    onError: setError,
  });

  useEffect(() => {
    const SYNC_KEY = "calendar_last_synced_at";
    const TTL = 12 * 60 * 60 * 1000;
    const now = Date.now();
    const lastSync = localStorage.getItem(SYNC_KEY);

    if (!lastSync || now - parseInt(lastSync, 10) > TTL) {
      syncCalendar();
      localStorage.setItem(SYNC_KEY, now.toString());
      console.log("Calendar auto synced");
    }
  }, [syncCalendar]);

  useEffect(() => {
    const checkPendingZoomLink = async () => {
      const needsLink = sessionStorage.getItem("zoom_link_pending");

      if (needsLink === "true") {
        try {
          console.log("Found pending Zoom link, attempting to link account...");
          alert(t("finishing_zoom_setup"));

          const response = await apiFetch(API_ROUTES.auth.zoomLinkPending, {
            method: "POST",
          });

          if (!response.ok) {
            throw new Error(
              await getErrorMessage(response, "Failed to link Zoom account."),
            );
          }

          console.log("Zoom account linked successfully!");
          alert(t("zoom_linked_success"));
        } catch (err) {
          console.error("Zoom link error:", err);
          alert(t("zoom_link_failed", { error: err.message }));
        } finally {
          sessionStorage.removeItem("zoom_link_pending");
        }
      }
    };

    checkPendingZoomLink();
  }, [t]);

  const renderForm = () => {
    switch (integration) {
      case "zoom":
        return <ZoomForm onSubmit={(data) => handleJoin(data, "manual")} />;
      case "standalone":
        return (
          <StandaloneForm onSubmit={(data) => handleJoin(data, "manual")} />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col lg:flex-row items-start justify-center w-full gap-8">
      <div className="w-full lg:w-[400px] flex-shrink-0 lg:sticky lg:top-6">
        <h2 className="text-xl font-semibold mb-4 text-center lg:text-left">
          {t("manual_join")}
        </h2>
        <div className="bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm overflow-hidden">
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
            <button
              onClick={() => setIntegration("standalone")}
              className={`cursor-pointer flex-1 flex items-center justify-center gap-2 py-4 text-lg font-bold transition-colors ${
                integration === "standalone"
                  ? "bg-white dark:bg-zinc-800 text-blue-600 border-b-2 border-blue-600"
                  : "bg-zinc-50 dark:bg-zinc-900 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <BiUser className="h-5 w-5" />
              {t("integration_standalone")}
            </button>
          </div>

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

      <div className="hidden lg:flex flex-col items-center self-stretch mt-11 relative">
        <div className="z-10 flex items-center justify-center w-8 h-8 mb-2">
          <span className="text-md font-bold text-zinc-400 dark:text-zinc-500">
            {t("or_divider")}
          </span>
        </div>

        <div className="w-px flex-1 bg-zinc-200 dark:bg-zinc-700"></div>
      </div>

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
          onAppJoin={(event) => handleJoin(event, "calendar")}
        />
      </div>
    </div>
  );
}
