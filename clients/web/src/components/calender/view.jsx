import {
  BiCalendar,
  BiRefresh,
  BiVideo,
  BiXCircle,
  BiMap,
  BiUser,
  BiLogoZoom,
  BiLogoMicrosoftTeams,
  BiTime,
  BiCheckCircle,
} from "react-icons/bi";
import { useTranslation } from "react-i18next";
import { SiGooglemeet } from "react-icons/si";

export function CalendarView({
  events,
  loading,
  onSync,
  error,
  startDate,
  endDate,
  onDateChange,
  onAppJoin,
}) {
  const { t } = useTranslation();

  const formatTime = (dateString) => {
    if (!dateString) return "";
    return new Date(dateString).toLocaleString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDateForInput = (date) => {
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const parseInputDate = (dateString) => {
    if (!dateString) return null;
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const groupEventsByDate = (eventsList) => {
    const groups = [];
    let lastDateKey = null;

    eventsList.forEach((event) => {
      const date = new Date(event.start_time);
      const dateKey = date.toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
      });

      if (dateKey !== lastDateKey) {
        groups.push({ date: dateKey, events: [] });
        lastDateKey = dateKey;
      }
      groups[groups.length - 1].events.push(event);
    });

    return groups;
  };

  const getPlatformConfig = (location) => {
    const loc = location?.toLowerCase() || "";

    if (loc.includes("zoom")) {
      return {
        icon: <BiLogoZoom className="w-3.5 h-3.5" />,
        label: "Zoom",
        className:
          "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border-blue-200 dark:border-blue-800",
        comingSoon: false,
      };
    }

    if (loc.includes("google")) {
      return {
        icon: <SiGooglemeet className="w-3.5 h-3.5" />,
        label: "Google Meet",
        className:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
        comingSoon: true,
      };
    }

    if (loc.includes("teams")) {
      return {
        icon: <BiLogoMicrosoftTeams className="w-3.5 h-3.5" />,
        label: "Teams",
        className:
          "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
        comingSoon: true,
      };
    }

    return {
      icon: <BiVideo className="w-3.5 h-3.5" />,
      label: location || t("platform_online"),
      className:
        "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700",
      comingSoon: false,
    };
  };

  const groupedEvents = groupEventsByDate(events);

  return (
    <div className="w-full h-full space-y-6 border border-zinc-200 dark:border-zinc-700 rounded-2xl p-6 bg-white/50 dark:bg-zinc-900/50">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-6 border-b border-zinc-200 dark:border-zinc-700">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {t("calendar_title")}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("calendar_subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="date"
            value={formatDateForInput(startDate)}
            onChange={(e) => {
              const date = parseInputDate(e.target.value);
              if (date) {
                date.setHours(0, 0, 0, 0);
                onDateChange((prev) => ({ ...prev, start: date }));
              }
            }}
            className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
          />

          <span className="text-zinc-400 text-xs sm:text-sm flex-shrink-0">
            -
          </span>

          <input
            type="date"
            value={formatDateForInput(endDate)}
            onChange={(e) => {
              const date = parseInputDate(e.target.value);
              if (date) {
                date.setHours(23, 59, 59, 999);
                onDateChange((prev) => ({ ...prev, end: date }));
              }
            }}
            className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
          />

          <button
            onClick={onSync}
            disabled={loading}
            title={loading ? t("refreshing") : t("calendar_sync_btn")}
            className="flex-shrink-0 p-1.5 sm:p-2 text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-500 disabled:opacity-50 transition-all shadow-sm cursor-pointer disabled:cursor-not-allowed"
          >
            <BiRefresh className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm border border-red-200 dark:border-red-800 flex items-center gap-2">
          <BiXCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      )}

      {events.length === 0 && !loading && !error && (
        <div className="text-center py-12 border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50/50 dark:bg-zinc-900/50">
          <BiCalendar className="h-10 w-10 mx-auto text-zinc-400 mb-3" />
          <p className="text-zinc-500 dark:text-zinc-400 font-medium">
            {t("calendar_no_events")}
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
            {t("calendar_no_events_hint")}
          </p>
        </div>
      )}

      {/* BUG: Mobile displays scrolled content beyond this div */}
      <div className="space-y-8 max-h-[500px] overflow-y-auto scrollbar-none">
        {groupedEvents.map((group, groupIndex) => (
          <div key={group.date || groupIndex}>
            <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 py-2 px-1 mb-3 border-b border-zinc-100 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                {group.date}
              </h3>
            </div>

            <div className="grid gap-4">
              {group.events.map((event) => {
                const isCancelled = event.is_cancelled;
                const endTime = event.end_time
                  ? new Date(event.end_time)
                  : null;
                const isEnded = endTime && endTime < new Date();
                const hasJoinUrl = !!event.join_url;
                const platformConfig = getPlatformConfig(event.location);

                return (
                  <div
                    key={event.id}
                    className={`group relative flex flex-col sm:flex-row sm:items-start justify-between p-5 rounded-xl border transition-all duration-200 ${
                      isCancelled
                        ? "bg-zinc-50 dark:bg-zinc-900/30 border-zinc-200 dark:border-zinc-800 opacity-75"
                        : isEnded
                          ? "bg-zinc-50/50 dark:bg-zinc-900/30 border-zinc-200 dark:border-zinc-800 opacity-60"
                          : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:border-blue-400 dark:hover:border-blue-500 shadow-sm hover:shadow-md"
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2 mb-3">
                        {isCancelled ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800">
                            {t("status_cancelled")}
                          </span>
                        ) : isEnded ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                            <BiCheckCircle className="w-3 h-3" />{" "}
                            {t("status_ended")}
                          </span>
                        ) : hasJoinUrl ? (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide border ${platformConfig.className}`}
                          >
                            {platformConfig.icon}
                            <span className="truncate max-w-[150px]">
                              {platformConfig.label}
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                            {t("status_scheduled")}
                          </span>
                        )}

                        {event.location && !hasJoinUrl && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                            <BiMap className="w-3 h-3" /> {event.location}
                          </span>
                        )}
                      </div>

                      <h3
                        className={`text-base font-semibold mb-2 ${
                          isCancelled || isEnded
                            ? "text-zinc-500"
                            : "text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
                        } ${isCancelled ? "line-through" : ""}`}
                      >
                        {event.subject || t("no_subject")}
                      </h3>

                      <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-sm text-zinc-500 dark:text-zinc-400">
                        <div className="flex items-center gap-1.5">
                          <BiTime className="w-4 h-4 text-zinc-400" />
                          <span
                            className={
                              isCancelled ? "line-through" : "font-mono text-xs"
                            }
                          >
                            {formatTime(event.start_time)} -{" "}
                            {formatTime(event.end_time)}
                          </span>
                        </div>

                        {event.organizer && (
                          <div
                            className="flex items-center gap-1.5"
                            title={event.organizer}
                          >
                            <BiUser className="w-4 h-4 text-zinc-400" />
                            <span className="truncate max-w-[150px] text-xs">
                              {event.organizer}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 sm:mt-0 flex items-center gap-2 sm:self-center">
                      {hasJoinUrl && !isCancelled && !isEnded && (
                        <a
                          href={event.join_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-zinc-400 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer"
                          title={`Join on ${platformConfig.label}`}
                        >
                          {platformConfig.icon}
                        </a>
                      )}

                      {!isCancelled && !isEnded && (
                        <button
                          onClick={() => onAppJoin && onAppJoin(event)}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 cursor-pointer"
                        >
                          {t("start_transcription_btn")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
