import { useParams, useNavigate } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
import Header from "../components/header";
import Transcript from "../components/transcript.jsx";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import DownloadVttButton from "../components/vtt-download.jsx";
import Unauthorized from "../components/unauthorized.jsx";
import { useTranscriptStream } from "../hooks/use-transcript-stream.js";

export default function SessionPage() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [showUnauthorized, setShowUnauthorized] = useState(false);
  const { integration, sessionId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const rawIds = localStorage.getItem("authorizedSessionIds");
    const idSet = new Set(rawIds ? JSON.parse(rawIds) : []);

    if (idSet.has(sessionId)) {
      setIsAuthorized(true);
    } else {
      setShowUnauthorized(true);
      const timer = setTimeout(() => {
        navigate("/");
      }, 5000); // 5-second delay

      return () => clearTimeout(timer);
    }
  }, [sessionId, navigate]);

  const wsUrl = isAuthorized ? `/ws/view/${integration}/${sessionId}` : null;
  const { transcripts, isDownloadable } = useTranscriptStream(wsUrl, sessionId);

  const lastTopTextRef = useRef(null);

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
        <DownloadVttButton isDownloadable={isDownloadable} />
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
    </>
  );
}
