import React from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
import Header from "../components/header";
import Transcript from "../components/transcript.jsx";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import DownloadVttButton from "../components/vtt-download.jsx";
import Unauthorized from "../components/unauthorized.jsx";
import Notification from "../components/notification.jsx";
import { useTranscriptStream } from "../hooks/use-transcript-stream.js";
import { useSmartScroll } from "../hooks/use-smart-scroll.js";

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

  useEffect(() => {
    if (!isAuthorized) {
      setShowUnauthorized(true);
      const timer = setTimeout(() => {
        navigate("/");
      }, 5000); // 5-second delay

      return () => clearTimeout(timer);
    }
  }, [isAuthorized, navigate]);

  const encodedSessionId = isAuthorized ? encodeURIComponent(sessionId) : null;

  const wsUrl = isAuthorized
    ? `/ws/view/${integration}/${encodedSessionId}?token=${token}`
    : null;

  const { transcripts, isDownloadable } = useTranscriptStream(wsUrl, sessionId);

  const lastTopTextRef = React.useRef(null);
  const notification = useSmartScroll(transcripts, lastTopTextRef);

  if (showUnauthorized) {
    return (
      <Unauthorized message="You do not have permission to view this session. You will be redirected to the homepage." />
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <>
      <Header>
        <ThemeToggle />
        <LanguageToggle />
        <DownloadVttButton
          isDownloadable={isDownloadable}
          integration={integration}
          sessionId={sessionId}
        />
      </Header>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
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
      </main>
      <Notification
        message={notification.message}
        visible={notification.visible}
      />
    </>
  );
}
