import { useTranslation } from "react-i18next";
import { useSession } from "../../context/session.jsx";
import DownloadVttButton from "./vtt-download.jsx";

export default function MeetingEndedCard({ topTextRef, isDownloadable }) {
  const { t } = useTranslation();
  const { integration, sessionId, token } = useSession();

  if (!isDownloadable) {
    return null;
  }

  return (
    <div
      ref={topTextRef}
      className="mt-8 mx-4 sm:mx-0 p-6 rounded-lg bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 shadow-sm text-center"
    >
      <div className="flex flex-col items-center justify-center space-y-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("meeting_ended")}
        </h3>

        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md leading-snug">
          {t("meeting_ended_description")}
        </p>

        <div className="pt-2">
          <DownloadVttButton
            isDownloadable={isDownloadable}
            integration={integration}
            sessionId={sessionId}
            token={token}
          />
        </div>
      </div>
    </div>
  );
}
