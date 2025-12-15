import { useState } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const [meetingId, setMeetingId] = useState("");
  const [password, setPassword] = useState("");
  const [joinUrl, setJoinUrl] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ meetingId, password, joinUrl });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="joinUrl" className="block text-sm font-medium">
          {t("join_url_label")}
        </label>
        <input
          type="url"
          id="joinUrl"
          value={joinUrl}
          onChange={(e) => setJoinUrl(e.target.value)}
          placeholder={t("join_url_placeholder")}
          className="mt-1 block w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
        />
      </div>

      <div className="flex items-center">
        <div className="flex-grow border-t border-zinc-300 dark:border-zinc-700"></div>
        <span className="flex-shrink mx-4 text-sm text-zinc-500 dark:text-zinc-400">
          {t("or_divider")}
        </span>
        <div className="flex-grow border-t border-zinc-300 dark:border-zinc-700"></div>
      </div>

      <div>
        <label htmlFor="meetingId" className="block text-sm font-medium">
          {t("meeting_id_label")}
        </label>
        <input
          type="text"
          id="meetingId"
          value={meetingId}
          onChange={(e) => setMeetingId(e.target.value)}
          placeholder={t("meeting_id_placeholder")}
          className="mt-1 block w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          {t("passcode_label")}
        </label>
        <input
          type="password"
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("passcode_placeholder")}
          className="mt-1 block w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
        />
      </div>
      <button
        type="submit"
        className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
      >
        {t("join_zoom_btn")}
      </button>
    </form>
  );
}

export function TestForm({ onSubmit }) {
  const { t } = useTranslation();
  const [sessionId, setSessionId] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!sessionId) return;
    onSubmit({ sessionId });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="session-id"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t("session_id_label")}
        </label>
        <input
          type="text"
          id="session-id"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder={t("session_id_placeholder")}
          required
          className="mt-1 block w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
        />
      </div>
      <button
        type="submit"
        className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
      >
        {t("join_test_btn")}
      </button>
    </form>
  );
}
