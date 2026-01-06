import React, { useState } from "react";

const formatUptime = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
};

const SystemCard = ({ title, data }) => {
  if (!data || !data.system) return null;

  const { uptimeSeconds, managerMemoryMB, memoryMB, loadAverage, cpuPercent } =
    data.system;
  const rss = managerMemoryMB?.rss || memoryMB?.rss || 0;

  const cpuDisplay =
    cpuPercent !== undefined ? `${cpuPercent.toFixed(1)}%` : "N/A";

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-700 p-4">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3 border-b border-zinc-100 dark:border-zinc-800 pb-2">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        {/* Uptime */}
        <div>
          <p className="text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider">
            Uptime
          </p>
          <p className="font-mono text-zinc-700 dark:text-zinc-200">
            {formatUptime(uptimeSeconds)}
          </p>
        </div>

        {/* Memory */}
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider">
              Memory (RSS)
            </p>
            <Tooltip text="Actual RAM used by the process (excluding swap)." />
          </div>
          <p className="font-mono text-zinc-700 dark:text-zinc-200">{rss} MB</p>
        </div>

        {/* CPU Usage (Container/Process Specific) */}
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider">
              CPU Usage
            </p>
            <Tooltip text="Percentage of a single CPU core used by this specific container/process." />
          </div>
          <p
            className={`font-mono font-bold ${parseFloat(cpuDisplay) > 80 ? "text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"}`}
          >
            {cpuDisplay}
          </p>
        </div>

        {/* Load Average (System Wide) */}
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-zinc-500 dark:text-zinc-400 text-xs uppercase tracking-wider">
              Host Load (1m)
            </p>
            <Tooltip text="Global system load. High values affect all containers on this node." />
          </div>
          <p className="font-mono text-zinc-700 dark:text-zinc-200">
            {loadAverage && loadAverage.length > 0
              ? loadAverage[0].toFixed(2)
              : "0.00"}
          </p>
        </div>
      </div>
    </div>
  );
};

const Tooltip = ({ text }) => (
  <div className="group relative flex items-center">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-zinc-400 cursor-help"
    >
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 hidden group-hover:block z-50">
      <div className="bg-zinc-800 text-white text-xs rounded py-1 px-2 shadow-lg text-center">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800"></div>
      </div>
    </div>
  </div>
);

const ActiveItemsTable = ({ title, items, columns, emptyMessage }) => {
  if (!items || items.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-700 p-4">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
          {title}
        </h3>
        <p className="text-sm text-zinc-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 flex justify-between items-center">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {title} <span className="text-zinc-500 ml-1">({items.length})</span>
        </h3>
      </div>
      <div className="max-h-96 overflow-y-auto">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
          <thead className="bg-zinc-50 dark:bg-zinc-800">
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className={`px-4 py-2 text-xs font-medium text-zinc-500 uppercase ${col.align === "right" ? "text-right" : "text-left"}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {items.map((item, idx) => (
              <tr
                key={item.id || idx}
                className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                {columns.map((col, cIdx) => (
                  <td
                    key={cIdx}
                    className={`px-4 py-2 text-xs font-mono text-zinc-600 dark:text-zinc-300 ${col.className || ""} ${col.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {col.render ? col.render(item) : item[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default function MetricsViewing({
  serverMetrics,
  zoomMetrics,
  loading,
  error,
  onRefresh,
}) {
  const [activeTab, setActiveTab] = useState("server");

  const safeParse = (data) => {
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch (e) {
        return null;
      }
    }
    return data;
  };

  const serverData = safeParse(serverMetrics);
  const zoomData = safeParse(zoomMetrics);

  const zoomStreamColumns = [
    {
      header: "Role",
      key: "role",
      render: (stream) => (
        <span
          className={`px-2 py-0.5 rounded ${
            stream.role === "PRIMARY"
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
          }`}
        >
          {stream.role}
        </span>
      ),
    },
    { header: "Meeting UUID", key: "meetingUuid", className: "break-all" },
    {
      header: "Duration",
      key: "durationSeconds",
      align: "right",
      render: (stream) => formatUptime(stream.durationSeconds),
    },
  ];

  const serverSessionColumns = [
    {
      header: "Session ID",
      key: "session_id",
      className: "break-all font-semibold",
    },
    { header: "Meeting ID", key: "meeting_id" },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      {/* Header Area */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          System Metrics
        </h2>
        <button
          onClick={onRefresh}
          className="cursor-pointer text-xs px-3 py-1.5 rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors border border-zinc-200 dark:border-zinc-700"
        >
          Refresh Data
        </button>
      </div>

      {loading && !serverData && !zoomData ? (
        <div className="p-8 text-center text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
          Loading metrics...
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-800">
          Failed to load metrics: {error}
        </div>
      ) : (
        <>
          {/* Tabs Navigation */}
          <div className="border-b border-zinc-200 dark:border-zinc-700">
            <nav className="-mb-px flex space-x-8" aria-label="Tabs">
              <button
                onClick={() => setActiveTab("server")}
                className={`
                  cursor-pointer whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    activeTab === "server"
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-300"
                  }
                `}
              >
                Server
              </button>
              <button
                onClick={() => setActiveTab("zoom")}
                className={`
                  cursor-pointer whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    activeTab === "zoom"
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-300"
                  }
                `}
              >
                Zoom
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          <div className="space-y-6 pt-2">
            {activeTab === "server" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <SystemCard title="Backend Server (Python)" data={serverData} />
                <ActiveItemsTable
                  title="Active Transcription Sessions"
                  items={serverData?.sessions || []}
                  columns={serverSessionColumns}
                  emptyMessage="No active transcription sessions on the server."
                />
              </div>
            )}

            {activeTab === "zoom" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <SystemCard title="Zoom Microservice (Node)" data={zoomData} />
                <ActiveItemsTable
                  title="Active Zoom Streams"
                  items={zoomData?.streams || []}
                  columns={zoomStreamColumns}
                  emptyMessage="No active Zoom streams connected."
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
