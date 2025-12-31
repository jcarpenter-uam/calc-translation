import { BiCalendar, BiRefresh, BiLinkExternal, BiVideo } from "react-icons/bi";

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

  return (
    <div className="w-full max-w-4xl mx-auto mt-8 p-6 bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 transition-colors">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BiCalendar className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Upcoming Meetings
          </h2>
        </div>
        <button
          onClick={onSync}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-all"
        >
          <BiRefresh className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Syncing..." : "Sync Calendar"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-md text-sm border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {events.length === 0 && !loading && !error ? (
        <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">
          No upcoming events found. Click sync to refresh.
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-md bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {event.subject || "No Subject"}
                  </h3>
                  {event.is_online_meeting && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      Online
                    </span>
                  )}
                </div>

                <div className="text-sm text-zinc-500 dark:text-zinc-400 flex flex-col sm:flex-row sm:gap-4">
                  <span>{formatDate(event.start_time)}</span>
                  {event.organizer && (
                    <span className="hidden sm:inline text-zinc-300 dark:text-zinc-600">
                      |
                    </span>
                  )}
                  {event.organizer && (
                    <span className="truncate">Org: {event.organizer}</span>
                  )}
                </div>
              </div>

              <div className="mt-3 sm:mt-0 sm:ml-4 flex items-center">
                {event.web_link && (
                  <a
                    href={event.web_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                  >
                    {event.is_online_meeting ? "Join Meeting" : "View Event"}
                    {event.is_online_meeting ? <BiVideo /> : <BiLinkExternal />}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
