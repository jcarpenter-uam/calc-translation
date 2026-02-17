import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Unauthorized from "../components/auth/unauthorized.jsx";
import Notification from "../components/misc/notification.jsx";
import BackfillLoading from "../components/session/backfill-loading.jsx";
import WaitingRoom from "../components/session/waiting.jsx";
import HostAudioSender from "../components/session/host-audio-sender.jsx";
import TranscriptList from "../components/session/transcript-list.jsx";
import MeetingEndedCard from "../components/session/meeting-ended.jsx";
import { useTranscriptStream } from "../hooks/use-transcript-stream.js";
import { useSmartScroll } from "../hooks/use-smart-scroll.js";
import { useLanguage } from "../context/language.jsx";
import { useHostAudio } from "../hooks/use-host-audio.js";
import { useTranslation } from "react-i18next";
import { useSessionRoute } from "../hooks/use-session-route.js";
import { SessionProvider } from "../context/session.jsx";
import { buildSessionWsUrl } from "../constants/routes.js";

export default function SessionPage() {
  const { integration, sessionId, token, isHost, joinUrl } = useSessionRoute();
  const navigate = useNavigate();
  const { targetLanguage } = useLanguage();
  const { t } = useTranslation();

  const [isAuthorized, setIsAuthorized] = useState(!!token);
  const [showUnauthorized, setShowUnauthorized] = useState(false);

  const hostAudioProps = useHostAudio(
    isHost ? sessionId : null,
    isHost ? integration : null,
  );

  const handleAuthFailure = useCallback(() => {
    setIsAuthorized(false);
    setShowUnauthorized(true);
  }, []);

  useEffect(() => {
    if (showUnauthorized || !isAuthorized) {
      const timer = setTimeout(() => {
        navigate("/", { replace: true });
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [isAuthorized, showUnauthorized, navigate]);

  const wsUrl =
    isAuthorized && !showUnauthorized
      ? buildSessionWsUrl(integration, sessionId, token, targetLanguage)
      : null;

  const {
    transcripts,
    isDownloadable,
    isBackfilling,
    sessionStatus,
    isSharedTwoWayMode,
  } = useTranscriptStream(wsUrl, sessionId, handleAuthFailure);

  const lastTopTextRef = React.useRef(null);
  const scrollDependencies = useMemo(() => {
    return [transcripts, isDownloadable];
  }, [transcripts, isDownloadable]);
  const notification = useSmartScroll(scrollDependencies, lastTopTextRef);

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

  const sessionContextValue = {
    integration,
    sessionId,
    token,
    targetLanguage,
  };

  return (
    <SessionProvider value={sessionContextValue}>
      <>
        <div className="max-w-3xl mx-auto w-full">
          {isHost && <HostAudioSender {...hostAudioProps} joinUrl={joinUrl} />}

          {isBackfilling && <BackfillLoading />}
          <TranscriptList
            transcripts={transcripts}
            isBackfilling={isBackfilling}
            isDownloadable={isDownloadable}
            lastTopTextRef={lastTopTextRef}
            isSharedTwoWayMode={isSharedTwoWayMode}
            targetLanguage={targetLanguage}
          />
          <MeetingEndedCard
            topTextRef={lastTopTextRef}
            isDownloadable={isDownloadable}
          />
        </div>
        <Notification
          message={notification.message}
          visible={notification.visible}
        />
      </>
    </SessionProvider>
  );
}
