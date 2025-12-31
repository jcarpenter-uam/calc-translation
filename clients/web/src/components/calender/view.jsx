import {
  BiCalendar,
  BiRefresh,
  BiLinkExternal,
  BiVideo,
  BiXCircle,
  BiTime,
  BiMap,
  BiUser,
  BiLogoZoom,
  BiLogoMicrosoftTeams,
} from "react-icons/bi";

import { SiGooglemeet } from "react-icons/si";

export function CalendarView({ events, loading, onSync, error }) {
  const formatDate = (dateString) => {
    if (!dateString) return "";
    return new Date(dateString).toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getPlatformConfig = (location) => {
    const loc = location?.toLowerCase() || "";

    if (loc.includes("zoom")) {
      return {
        icon: <BiLogoZoom className="w-3.5 h-3.5" />,
        label: "Zoom",
        className:
          "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border-blue-200 dark:border-blue-800",
      };
    }

    if (loc.includes("google")) {
      return {
        icon: <SiGooglemeet className="w-3.5 h-3.5" />,
        label: "Google Meet",
        className:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
      };
    }

    if (loc.includes("teams")) {
      return {
        icon: <BiLogoMicrosoftTeams className="w-3.5 h-3.5" />,
        label: "Teams",
        className:
          "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
      };
    }

    return {
      icon: <BiVideo className="w-3.5 h-3.5" />,
      label: location || "Online",
      className:
        "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700",
    };
  };

  return (
    <div className="w-full max-w-4xl mx-auto mt-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BiCalendar className="h-5 w-5 text-blue-600 dark:text-blue-500" />
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Upcoming Meetings
            </h2>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 ml-7">
            View and join your scheduled online meetings
          </p>
        </div>
        <button
          onClick={onSync}
          disabled={loading}
          className="cursor-pointer flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-500 disabled:opacity-50 transition-all shadow-sm"
        >
          <BiRefresh className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Syncing..." : "Sync Calendar"}
        </button>
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
            No upcoming events found
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
            Click sync to refresh your calendar
          </p>
        </div>
      )}

      <div className="grid gap-4">
        {events.map((event) => {
          const isCancelled = event.is_cancelled;
          const hasJoinUrl = !!event.join_url;
          const platformConfig = getPlatformConfig(event.location);

          return (
            <div
              key={event.id}
              className={`group relative flex flex-col sm:flex-row sm:items-start justify-between p-5 rounded-xl border transition-all duration-200 ${
                isCancelled
                  ? "bg-zinc-50 dark:bg-zinc-900/30 border-zinc-200 dark:border-zinc-800 opacity-75"
                  : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:border-blue-400 dark:hover:border-blue-500 shadow-sm hover:shadow-md"
              }`}
            >
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 mb-3">
                  {isCancelled ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800">
                      Cancelled
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
                      Scheduled
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
                    isCancelled
                      ? "text-zinc-500 line-through"
                      : "text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
                  }`}
                >
                  {event.subject || "No Subject"}
                </h3>

                <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-sm text-zinc-500 dark:text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <BiTime className="w-4 h-4 text-zinc-400" />
                    <span
                      className={
                        isCancelled ? "line-through" : "font-mono text-xs"
                      }
                    >
                      {formatDate(event.start_time)}
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
                {event.web_link && (
                  <a
                    href={event.web_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-zinc-400 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400 transition-colors rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/20"
                    title="View in Outlook"
                  >
                    <BiLinkExternal className="w-5 h-5" />
                  </a>
                )}

                {hasJoinUrl && !isCancelled && (
                  <a
                    href={event.join_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-900"
                  >
                    Join
                    <BiVideo className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
