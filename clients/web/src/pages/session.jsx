import React from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import Transcript from "../components/session/transcript.jsx";
import Unauthorized from "../components/auth/unauthorized.jsx";
import Notification from "../components/misc/notification.jsx";
import { useTranscriptStream } from "../hooks/use-transcript-stream.js";
import { useSmartScroll } from "../hooks/use-smart-scroll.js";
import { useLanguage } from "../context/language.jsx";
import { useTranslation } from "react-i18next";

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

  const { transcripts, isDownloadable } = useTranscriptStream(
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
      </div>
      <Notification
        message={notification.message}
        visible={notification.visible}
      />
    </>
  );
}
