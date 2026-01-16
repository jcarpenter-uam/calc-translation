import React from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import DownloadVttButton from "../components/session/vtt-download.jsx";
import Transcript from "../components/session/transcript.jsx";
import Unauthorized from "../components/auth/unauthorized.jsx";
import Notification from "../components/misc/notification.jsx";
import BackfillLoading from "../components/session/backfill-loading.jsx";
import WaitingRoom from "../components/session/waiting.jsx";
import HostAudioSender from "../components/session/host-audio-sender.jsx";
import JoinURLDisplay from "../components/session/joinURL-display.jsx";
import { useTranscriptStream } from "../hooks/use-transcript-stream.js";
import { useSmartScroll } from "../hooks/use-smart-scroll.js";
import { useLanguage } from "../context/language.jsx";
import { useHostAudio } from "../hooks/use-host-audio.js";
import { useTranslation } from "react-i18next";

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export default function SessionPage() {
  const params = useParams();
  const integration = params.integration;
  const sessionId = params["*"];
  const navigate = useNavigate();
  const location = useLocation();

  const query = useQuery();
  const token = query.get("token");

  const isHost = query.get("isHost") === "true";
  const joinUrl = location.state?.joinUrl;

  const [isAuthorized, setIsAuthorized] = useState(!!token);
  const [showUnauthorized, setShowUnauthorized] = useState(false);
  const { language } = useLanguage();
  const { t } = useTranslation();

  const hostAudioProps = useHostAudio(
    isHost ? sessionId : null,
    isHost ? integration : null,
  );

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

  const { transcripts, isDownloadable, isBackfilling, sessionStatus } =
    useTranscriptStream(wsUrl, sessionId, handleAuthFailure);

  const lastTopTextRef = React.useRef(null);
  const notification = useSmartScroll(transcripts, lastTopTextRef);

  if (showUnauthorized) {
    return <Unauthorized message={t("access_denied_session_message")} />;
  }

  if (!isAuthorized) {
    return null;
  }

  if (sessionStatus === "waiting" && !isHost) {
    return (
      <div className="max-w-3xl mx-auto w-full">
        <WaitingRoom />
      </div>
    );
  }

  return (
    <>
      <div className="max-w-3xl mx-auto w-full relative pb-24">
        {/* Host Controls */}
        {isHost && joinUrl && <JoinURLDisplay joinUrl={joinUrl} />}
        {isHost && <HostAudioSender {...hostAudioProps} />}

        {isBackfilling && <BackfillLoading />}
        {transcripts
          .filter((t) => !isBackfilling || !t.isBackfill)
          .map((t, index, array) => (
            <Transcript
              key={t.id}
              {...t}
              topTextRef={index === array.length - 1 ? lastTopTextRef : null}
            />
          ))}
        {isDownloadable && (
          <div className="mt-8 mb-12 mx-4 sm:mx-0 p-6 rounded-lg bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 shadow-sm text-center">
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
        )}
      </div>
      <Notification
        message={notification.message}
        visible={notification.visible}
      />
    </>
  );
}
