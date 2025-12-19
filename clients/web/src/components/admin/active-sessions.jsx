import React from "react";
import { useTranslation } from "react-i18next";

export default function ActiveSessions({
  sessions,
  loading,
  error,
  lastUpdated,
  onRefresh,
}) {
  const { t } = useTranslation();

  return (
    <div className="w-full space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {t("active_sessions_title")}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("active_sessions_desc")}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="px-3 py-1.5 text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-300 dark:border-zinc-600"
        >
          {loading
            ? t("refetching")
            : t("updated_at", { time: lastUpdated.toLocaleTimeString() })}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm border border-red-200 dark:border-red-800">
          {t("error_label")} {error}
        </div>
      )}

      {!loading && sessions.length === 0 && !error && (
        <div className="text-center py-12 border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl">
          <p className="text-zinc-500 dark:text-zinc-400 font-medium">
            {t("no_active_sessions")}
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sessions.map((session) => (
          <div
            key={session.session_id}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 hover:border-blue-400 dark:hover:border-blue-500 transition-colors shadow-sm"
          >
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
                <span className="text-xs font-bold text-green-600 dark:text-green-400 tracking-wider uppercase">
                  {t("live_status")}
                </span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wide bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                {session.integration}
              </span>
            </div>

            <div className="mb-4">
              <h3
                className="text-sm font-medium text-zinc-900 dark:text-zinc-100 font-mono truncate"
                title={session.session_id}
              >
                {session.session_id}
              </h3>
            </div>

            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>{t("started_label")}</span>
                <span className="font-mono">
                  {new Date(session.start_time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
