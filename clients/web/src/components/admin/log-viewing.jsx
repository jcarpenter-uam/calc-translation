import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminSection } from "./ui.jsx";

export default function LogViewing({ logs = [], loading, error, onRefresh }) {
  const { t } = useTranslation();
  const scrollRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      const element = scrollRef.current;
      element.scrollTop = element.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;

    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  return (
    <AdminSection className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {t("logs_title")}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("logs_subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
            />
            {t("auto_scroll_label")}
          </label>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="rounded-md bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            {loading ? t("refreshing") : t("refresh_now")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {t("error_loading_logs")} {error}
        </div>
      ) : (
        <div className="relative">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-[500px] w-full overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-950 p-4 font-mono text-xs text-zinc-300 shadow-inner dark:border-zinc-800"
          >
            {logs.length === 0 ? (
              <div className="italic text-zinc-500">{t("no_logs")}</div>
            ) : (
              logs.map((line, index) => (
                <div
                  key={index}
                  className="whitespace-pre-wrap break-all border-b border-zinc-900/50 py-0.5 hover:bg-zinc-900"
                >
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </AdminSection>
  );
}
