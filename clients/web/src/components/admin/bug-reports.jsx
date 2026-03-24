import React, { useEffect, useState } from "react";
import { AdminCard, AdminSection } from "./ui.jsx";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function StatusBadge({ isResolved }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        isResolved
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      }`}
    >
      {isResolved ? "Resolved" : "Open"}
    </span>
  );
}

function MetaItem({ label, value }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/80">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-1 break-words text-sm text-zinc-800 dark:text-zinc-200">
        {value || "-"}
      </div>
    </div>
  );
}

function DetailBlock({ label, value }) {
  if (!value) {
    return null;
  }

  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="min-w-0 whitespace-pre-wrap break-all text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        {value}
      </div>
    </div>
  );
}

export default function BugReportsManagement({
  reports = [],
  loading,
  error,
  onRefresh,
  onViewLog,
  onSetResolved,
  filter = "open",
  onFilterChange,
}) {
  const [activeLog, setActiveLog] = useState(null);
  const [activeError, setActiveError] = useState("");
  const [loadingLogId, setLoadingLogId] = useState(null);
  const [statusUpdateId, setStatusUpdateId] = useState(null);

  useEffect(() => {
    if (!activeLog) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setActiveLog(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeLog]);

  const handleViewLog = async (report) => {
    setActiveError("");
    setLoadingLogId(report.id);
    try {
      const text = await onViewLog(report.id);
      setActiveLog({ report, text });
    } catch (viewError) {
      setActiveError(viewError.message || "Failed to load bug report log");
    } finally {
      setLoadingLogId(null);
    }
  };

  const handleRefresh = () => {
    onRefresh(filter);
  };

  const handleResolveToggle = async (report) => {
    setActiveError("");
    setStatusUpdateId(report.id);
    try {
      await onSetResolved(report.id, !report.is_resolved);
      await onRefresh(filter);
      if (activeLog?.report.id === report.id) {
        setActiveLog((current) =>
          current
            ? {
                ...current,
                report: { ...current.report, is_resolved: !report.is_resolved },
              }
            : current,
        );
      }
    } catch (statusError) {
      setActiveError(
        statusError.message || "Failed to update bug report status",
      );
    } finally {
      setStatusUpdateId(null);
    }
  };

  return (
    <AdminSection className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Bug Reports
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Review reported issues, inspect attached logs, and track resolution
            status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["open", "Open"],
            ["resolved", "Resolved"],
            ["all", "All"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => onFilterChange(value)}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${
                filter === value
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="cursor-pointer rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 disabled:cursor-not-allowed"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          Failed to load bug reports: {error}
        </div>
      ) : reports.length === 0 ? (
        <AdminCard className="bg-white p-10 text-center dark:bg-zinc-900">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            No bug reports match the current filter.
          </div>
        </AdminCard>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <AdminCard
              key={report.id}
              className="bg-white p-5 shadow-sm ring-1 ring-zinc-200/70 dark:bg-zinc-900 dark:ring-zinc-800"
            >
              <div className="space-y-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge isResolved={report.is_resolved} />
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Report #{report.id}
                      </span>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        •
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatDate(report.created_at)}
                      </span>
                    </div>
                    <div>
                      <h3 className="break-words text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        {report.title}
                      </h3>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                        {report.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row xl:min-w-[140px] xl:flex-col xl:items-stretch">
                    <button
                      onClick={() => handleViewLog(report)}
                      disabled={
                        !report.has_log_file || loadingLogId === report.id
                      }
                      className="cursor-pointer rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loadingLogId === report.id ? "Loading..." : "View log"}
                    </button>
                    <button
                      onClick={() => handleResolveToggle(report)}
                      disabled={statusUpdateId === report.id}
                      className="cursor-pointer rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {statusUpdateId === report.id
                        ? "Saving..."
                        : report.is_resolved
                          ? "Mark open"
                          : "Resolve"}
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetaItem
                    label="Reporter"
                    value={report.user_name || "Unknown"}
                  />
                  <MetaItem
                    label="Email / ID"
                    value={report.user_email || report.user_id}
                  />
                  <MetaItem label="Version" value={report.app_version} />
                  <MetaItem
                    label="Environment"
                    value={`${report.platform || "-"}${report.has_log_file ? " • Log attached" : " • No log"}`}
                  />
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="lg:col-span-3">
                    <DetailBlock
                      label="Steps to reproduce"
                      value={report.steps_to_reproduce}
                    />
                  </div>
                  <DetailBlock
                    label="Expected behavior"
                    value={report.expected_behavior}
                  />
                  <DetailBlock
                    label="Actual behavior"
                    value={report.actual_behavior}
                  />
                </div>
              </div>
            </AdminCard>
          ))}
        </div>
      )}

      {activeError ? (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {activeError}
        </div>
      ) : null}

      {activeLog ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4"
          onClick={() => setActiveLog(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex h-[min(80vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-zinc-100">
                  {activeLog.report.title}
                </h3>
                <p className="mt-1 text-xs text-zinc-400">
                  Log attached to report #{activeLog.report.id}
                </p>
              </div>
              <button
                onClick={() => setActiveLog(null)}
                className="cursor-pointer rounded-md border border-zinc-700 px-3 py-1 text-sm font-medium text-zinc-200 hover:bg-zinc-900"
              >
                Close
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-5 text-xs leading-5 text-zinc-300">
              {activeLog.text}
            </pre>
          </div>
        </div>
      ) : null}
    </AdminSection>
  );
}
