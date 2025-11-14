import { useParams, useNavigate } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
import Header from "../components/header";
import Transcript from "../components/transcript.jsx";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import DownloadVttButton from "../components/vtt-download.jsx";
import { useTranscriptStream } from "../hooks/use-transcript-stream.js";

export default function SessionPage() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const { integration, sessionId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const authorizedId = localStorage.getItem("authorizedSessionId");

    if (sessionId === authorizedId) {
      setIsAuthorized(true);
    } else {
      // TODO: Give the user a "Please Login" message
      navigate("/");
    }
  }, [sessionId, navigate]);

  const wsUrl = isAuthorized ? `/ws/view/${integration}/${sessionId}` : null;
  const { transcripts, isDownloadable } = useTranscriptStream(wsUrl);

  const lastTopTextRef = useRef(null);

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
