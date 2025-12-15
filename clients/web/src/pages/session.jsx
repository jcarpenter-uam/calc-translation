import React from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import DownloadVttButton from "../components/session/vtt-download.jsx";
import Transcript from "../components/session/transcript.jsx";
import Unauthorized from "../components/auth/unauthorized.jsx";
import Notification from "../components/misc/notification.jsx";
import { useTranscriptStream } from "../hooks/use-transcript-stream.js";
import { useSmartScroll } from "../hooks/use-smart-scroll.js";
import { useLanguage } from "../context/language.jsx";
import { useTranslation } from "react-i18next";
import { AiOutlineLoading3Quarters } from "react-icons/ai";

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export default function SessionPage() {
  const params = useParams();
  const integration = params.integration;
  const sessionId = params["*"];
  const navigate = useNavigate();

  const query = useQuery();
  const token = query.get("token");

  const [isAuthorized, setIsAuthorized] = useState(!!token);
  const [showUnauthorized, setShowUnauthorized] = useState(false);
  const { language } = useLanguage();
  const { t } = useTranslation();

  const handleAuthFailure = useCallback(() => {
    setIsAuthorized(false);
    setShowUnauthorized(true);
  }, []);

  useEffect(() => {
    if (!isAuthorized) {
      setShowUnauthorized(true);
      const timer = setTimeout(() => {
        navigate("/");
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [isAuthorized, navigate]);

  const encodedSessionId = isAuthorized ? encodeURIComponent(sessionId) : null;

  const wsUrl = isAuthorized
    ? `/ws/view/${integration}/${encodedSessionId}?token=${token}&language=${language}`
    : null;

  const { transcripts, isDownloadable, isBackfilling } = useTranscriptStream(
    wsUrl,
    sessionId,
    handleAuthFailure,
  );

  const lastTopTextRef = React.useRef(null);
  const notification = useSmartScroll(transcripts, lastTopTextRef);

  if (showUnauthorized) {
    return <Unauthorized message={t("access_denied_session_message")} />;
  }

  if (!isAuthorized) {
    return null;
  }

  if (isBackfilling) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="animate-spin text-blue-600 dark:text-blue-500">
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        </div>
        <p className="text-lg font-medium text-zinc-600 dark:text-zinc-300 animate-pulse">
          {t("loading_history", "Translating conversation history...")}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-3xl mx-auto w-full">
        {transcripts.map((t, index) => (
          <Transcript
            key={t.id}
            {...t}
            topTextRef={
              index === transcripts.length - 1 ? lastTopTextRef : null
            }
          />
        ))}
        {isDownloadable && (
          <div className="flex flex-col items-center justify-center">
            <DownloadVttButton
              isDownloadable={isDownloadable}
              integration={integration}
              sessionId={sessionId}
              token={token}
            />
          </div>
        )}
      </div>
      <Notification
        message={notification.message}
        visible={notification.visible}
      />
    </>
  );
}
