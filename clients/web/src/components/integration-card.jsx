import { useState } from "react";
import { BiLogoZoom } from "react-icons/bi";

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
  const [joinUrl, setJoinUrl] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ meetingId, password, joinUrl });
  };

  return (
    // TODO: MeetingID field should auto format and limit input
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="joinUrl" className="block text-sm font-medium">
          Join URL
        </label>
        <input
          type="url"
          id="joinUrl"
          value={joinUrl}
          onChange={(e) => setJoinUrl(e.target.value)}
          placeholder="e.g., https://us02web.zoom.us/j/..."
          className="mt-1 block w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
        />
      </div>

      <div className="flex items-center">
        <div className="flex-grow border-t border-zinc-300 dark:border-zinc-700"></div>
        <span className="flex-shrink mx-4 text-sm text-zinc-500 dark:text-zinc-400">
          OR
        </span>
        <div className="flex-grow border-t border-zinc-300 dark:border-zinc-700"></div>
      </div>

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
      <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-700 text-center">
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
          Haven't added our app to your Zoom account yet?
        </p>
        <a
          href="https://zoom.us/oauth/authorize?response_type=code&client_id=LvEJnDi1TtGpWjUba7xxfg&redirect_uri=https://translator.my-uam.com/api/auth/zoom/callback"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center w-full px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 font-medium rounded-lg text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
        >
          <BiLogoZoom className="mr-2 h-4 w-4 text-blue-500" />
          Add App to Zoom
        </a>
      </div>
    </form>
  );
}

export function TestForm({ onSubmit }) {
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
          Session ID
        </label>
        <input
          type="text"
          id="session-id"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="e.g., 'test'"
          required
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600"
        />
      </div>
      <button
        type="submit"
        className="w-full justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        Join Test Session
      </button>
    </form>
  );
}
