import React from "react";

/**
 * A stateless component to display the state of a WS connection.
 */
export default function ConnectionIndicator({
  status = "disconnected",
  label,
}) {
  const statusStyles = {
    connected: "bg-emerald-500",
    connecting: "bg-amber-500 animate-pulse",
    disconnected: "bg-red-500",
  };

  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
      <div
        className={`w-2.5 h-2.5 rounded-full transition-colors ${
          statusStyles[status] || statusStyles.disconnected
        }`}
        title={`Status: ${status}`}
      />
      <span>{label}</span>
    </div>
  );
}
