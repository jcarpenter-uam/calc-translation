import { useState } from "react";

export function IntegrationCard({ id, title, icon, selected, onSelect }) {
  const baseClasses =
    "flex items-center gap-4 p-6 rounded-lg border-2 cursor-pointer transition-all duration-200 ease-in-out";
  const selectedClasses = "border-blue-500 bg-blue-500/10 ring-2 ring-blue-500";
  const deselectedClasses =
    "border-zinc-300 dark:border-zinc-700 hover:border-blue-400 dark:hover:border-blue-400";

  return (
    <button
      onClick={() => onSelect(id)}
      className={`${baseClasses} ${selected === id ? selectedClasses : deselectedClasses}`}
    >
      {icon}
      <span className="text-lg font-semibold">{title}</span>
    </button>
  );
}

// --- Zoom-Specific Form ---
export function ZoomForm({ onSubmit }) {
  const [meetingId, setMeetingId] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(meetingId);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* ... form content ... */}
      <div>
        <label htmlFor="meetingId" className="block text-sm font-medium">
          Meeting ID
        </label>
        <input
          type="text"
          id="meetingId"
          value={meetingId}
          onChange={(e) => setMeetingId(e.target.value)}
          placeholder="e.g., 800 1234 5678"
          className="mt-1 block w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
          required
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Passcode
        </label>
        <input
          type="password"
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="e.g., a1B2c3"
          className="mt-1 block w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
        />
      </div>
      <button
        type="submit"
        className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
      >
        Join Zoom Session
      </button>
    </form>
  );
}
